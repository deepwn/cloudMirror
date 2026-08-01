// ============================================================================
// scripts/_reset.ts — 全动态 DROP TABLE + 重建
// ============================================================================
// 从 schema.sql 动态解析：
//   1. 所有表名（CREATE TABLE IF NOT EXISTS xxx）
//   2. 外键依赖（REFERENCES xxx(id)）
//   3. 拓扑排序 → 从叶子表开始 DROP，逐层到根表
// 新增/删除/改名表 → 无需改此脚本。
//
// 用法：
//   tsx scripts/_reset.ts --local          (本地 workerd SQLite)
//   tsx scripts/_reset.ts --remote         (远端 Cloudflare D1)
//   tsx scripts/_reset.ts --remote --yes   (跳过确认)
// ============================================================================

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../schema.sql");

// --------------------------------------------------------------------------
// 解析 schema.sql → { tableNames, dependencyGraph }
// --------------------------------------------------------------------------
function parseSchema(sql: string) {
  const tableNames: string[] = [];
  const graph = new Map<string, Set<string>>(); // table → 它引用了哪些其他表

  // 提取所有表名
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)) {
    const name = m[1];
    tableNames.push(name);
    if (!graph.has(name)) graph.set(name, new Set());
  }

  // 提取 CREATE TABLE 块，分析外键依赖
  const blocks = sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\)\s*;/gi);
  for (const b of blocks) {
    const table = b[1];
    const body = b[2];
    // 匹配 REFERENCES tableName(...) 的外键声明
    for (const ref of body.matchAll(/REFERENCES\s+(\w+)\s*\(/gi)) {
      const parent = ref[1];
      // 跳过自引用
      if (parent !== table) {
        graph.get(table)?.add(parent);
      }
    }
  }

  return { tableNames, graph };
}

// --------------------------------------------------------------------------
// 拓扑排序 — 叶子表（无出度 / 不被别人引用）排最前
// --------------------------------------------------------------------------
function topologicalDropOrder(graph: Map<string, Set<string>>): string[] {
  // 构建 "谁引用了谁" → "谁被谁引用"
  const referencedBy = new Map<string, Set<string>>();
  for (const [table, deps] of graph) {
    for (const dep of deps) {
      if (!referencedBy.has(dep)) referencedBy.set(dep, new Set());
      referencedBy.get(dep)!.add(table);
    }
  }

  // Kahn 算法：入度 = 被多少其他表引用
  const inDegree = new Map<string, number>();
  for (const table of graph.keys()) {
    inDegree.set(table, graph.get(table)!.size);
  }

  // 队列：入度为 0 的表（不引用任何表，或只引用自身）
  const queue: string[] = [];
  for (const [table, deg] of inDegree) {
    if (deg === 0) queue.push(table);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const t = queue.shift()!;
    result.push(t);
    for (const child of referencedBy.get(t) ?? []) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  // 如果有环（不应该发生），把剩余表追加到末尾
  for (const [table, deg] of inDegree) {
    if (deg > 0) result.push(table);
  }

  // 反转：Kahn 输出 CREATE 顺序（根→叶），DROP 需要叶→根
  return result.reverse();
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const isRemote = args.includes("--remote");
  const skipConfirm = args.includes("--yes") || args.includes("-y");
  const mode = isRemote ? "--remote" : "--local";
  const target = isRemote ? "remote D1 (cloudmirror-db)" : "local D1 (cloudmirror-db)";

  if (!skipConfirm) {
    console.log(`⚠️  This will DROP ALL tables and data in ${target}.`);
    console.log("   Re-run with --yes to proceed.");
    process.exit(0);
  }

  const sql = readFileSync(schemaPath, "utf-8");
  const { tableNames, graph } = parseSchema(sql);

  if (tableNames.length === 0) {
    console.error("[reset] No CREATE TABLE statements found in schema.sql");
    process.exit(1);
  }

  const order = topologicalDropOrder(graph);

  console.log(`[reset] Target: ${target}`);
  console.log(`[reset] Tables  : ${tableNames.join(", ")}`);
  console.log(`[reset] FK graph :`);
  for (const [t, deps] of graph) {
    if (deps.size > 0) console.log(`         ${t} → [${[...deps].join(", ")}]`);
  }
  console.log(`[reset] Drop order (leaf→root): ${order.join(" → ")}\n`);

  // PRAGMA foreign_keys=OFF + 按拓扑顺序 DROP（双保险）
  const dropSQL =
    "PRAGMA foreign_keys=OFF; " + order.map((t) => `DROP TABLE IF EXISTS ${t}`).join("; ") + ";";

  console.log("[reset] Dropping all tables...");
  execSync(`npx wrangler d1 execute cloudmirror-db ${mode} --command=${JSON.stringify(dropSQL)}`, {
    stdio: "inherit",
  });

  console.log("\n[reset] Re-applying schema...");
  execSync(`npx wrangler d1 execute cloudmirror-db ${mode} --file=${schemaPath}`, {
    stdio: "inherit",
  });

  console.log("\n[reset] Done!\n");
}

main().catch((err) => {
  console.error("[reset] Fatal:", err);
  process.exit(1);
});
