// ============================================================================
// src/worker/__tests__/helpers/d1-mock.ts — D1Database Mock 辅助
// ============================================================================
//
// 提供一个内存中的 D1Database mock，用于 API 集成测试。
// 支持 users / credentials / user_limits / settings / audit_logs 表。
// ============================================================================

import type { User } from "@shared/types";

interface TableRow {
  [key: string]: unknown;
}

interface MockStatement {
  _sql?: string;
  _values?: unknown[];
  bind(...values: unknown[]): MockStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: true }>;
  raw<T>(): Promise<T[]>;
}

/**
 * 创建一个内存 D1Database mock。
 * 在每个 beforeAll/afterEach 周期重建。
 */
export function createMockDB(): D1Database {
  const tables = new Map<string, TableRow[]>();

  function ensure(table: string) {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  }

  function execute(sql: string, values: unknown[] = []): unknown {
    const trimmed = sql.trim();

    // INSERT
    if (trimmed.startsWith("INSERT")) {
      const match = trimmed.match(/INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (match) {
        const [, table, colsStr] = match;
        const cols = colsStr.split(",").map((c) => c.trim());
        const rows = ensure(table);
        const row: TableRow = {};

        // 使用 bind values 而不是 SQL 字面量
        for (let i = 0; i < cols.length && i < values.length; i++) {
          row[cols[i]] = values[i];
        }
        rows.push(row);
        return { success: true };
      }
      return { success: true };
    }

    // SELECT COUNT(*)
    if (trimmed.toUpperCase().includes("COUNT(*)") || trimmed.toUpperCase().includes("COUNT(")) {
      let table = "";
      const tblMatch = trimmed.match(/FROM\s+(\w+)/i);
      if (tblMatch) table = tblMatch[1];

      let rows = ensure(table);

      // 简单 WHERE 过滤
      if (trimmed.toUpperCase().includes("WHERE")) {
        rows = applySimpleFilter(rows, trimmed, values);
      }

      return { c: rows.length };
    }

    // SELECT *
    if (trimmed.toUpperCase().startsWith("SELECT")) {
      let table = "";
      const tblMatch = trimmed.match(/FROM\s+(\w+)/i);
      if (tblMatch) table = tblMatch[1];

      let rows = [...ensure(table)];

      // 简单 WHERE 过滤
      if (trimmed.toUpperCase().includes("WHERE")) {
        rows = applySimpleFilter(rows, trimmed, values);
      }

      // ORDER BY + LIMIT/OFFSET
      const orderMatch = trimmed.match(/ORDER BY\s+(\w+)\s+(ASC|DESC)/i);
      if (orderMatch) {
        const [, col, dir] = orderMatch;
        rows.sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return dir.toUpperCase() === "DESC" ? bv.localeCompare(av) : av.localeCompare(bv);
        });
      }

      const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
      const offsetMatch = trimmed.match(/OFFSET\s+(\d+)/i);
      const limit = limitMatch ? parseInt(limitMatch[1], 10) : rows.length;
      const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;

      rows = rows.slice(offset, offset + limit);

      // 如果是 first()
      return rows;
    }

    // UPDATE
    if (trimmed.startsWith("UPDATE")) {
      const match = trimmed.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?$/i);
      if (match) {
        const [, table, setsStr, whereStr] = match;
        const rows = ensure(table);
        const sets: [string, unknown][] = [];
        // Parse SET clauses with placeholders
        const setParts = setsStr.split(",");
        let valIdx = 0;
        for (const part of setParts) {
          const kv = part.trim().match(/^(\w+)\s*=\s*(.+)$/);
          if (kv) {
            if (kv[2].trim() === "?") {
              sets.push([kv[1], values[valIdx++]]);
            } else if (kv[2].includes("datetime('now')")) {
              sets.push([kv[1], new Date().toISOString()]);
            } else {
              sets.push([kv[1], kv[2].replace(/['"]/g, "")]);
            }
          }
        }
        // WHERE clause with placeholder
        if (whereStr && whereStr.includes("= ?")) {
          const whereCol = whereStr.split("=")[0].trim();
          const whereVal = values[valIdx];
          for (const row of rows) {
            if (row[whereCol] === whereVal) {
              for (const [k, v] of sets) {
                row[k] = v;
              }
            }
          }
        }
      }
      return { success: true };
    }

    // DELETE
    if (trimmed.toUpperCase().startsWith("DELETE")) {
      const match = trimmed.match(/DELETE FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/i);
      if (match) {
        const [, table, col] = match;
        const rows = ensure(table);
        const newRows = rows.filter((r) => r[col] !== values[0]);
        tables.set(table, newRows);
      }
      return { success: true };
    }

    return { success: true };
  }

  function applySimpleFilter(rows: TableRow[], sql: string, _values: unknown[]): TableRow[] {
    // 非常简化的 WHERE 解析，仅用于测试
    return rows.filter((row) => {
      // WHERE col = ?
      const eqMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/gi);
      if (eqMatch) {
        for (let i = 0; i < eqMatch.length; i++) {
          const col = eqMatch[i].match(/(\w+)\s*=/)?.[1];
          if (col && row[col] !== _values[i]) return false;
        }
      }
      // WHERE ... LIKE
      const likeMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s*$)/i);
      if (likeMatch && likeMatch[1].toUpperCase().includes("LIKE")) {
        // 简化：如果包含 LIKE 就不做过滤（测试中手动验证）
        return true;
      }
      return true;
    });
  }

  const db = {
    prepare(sql: string): MockStatement {
      const stmt: MockStatement = {
        _sql: sql,
        _values: [] as unknown[],
        bind(...values: unknown[]) {
          stmt._values = values;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          const result = execute(sql, stmt._values ?? []) as TableRow[];
          if (Array.isArray(result)) {
            return (result[0] as T) ?? null;
          }
          // COUNT(*) 返回 { c: number }
          return result as T;
        },
        async all<T>(): Promise<{ results: T[] }> {
          const result = execute(sql, stmt._values ?? []) as TableRow[];
          if (Array.isArray(result)) {
            return { results: result as T[] };
          }
          return { results: [] };
        },
        async run(): Promise<{ success: true }> {
          execute(sql, stmt._values ?? []);
          return { success: true };
        },
        async raw<T>(): Promise<T[]> {
          const result = execute(sql, stmt._values ?? []) as TableRow[];
          return result as T[];
        },
      };
      return stmt;
    },
    batch<T>(statements: unknown[]): Promise<T[]> {
      // 顺序执行每个已 prepare+bind 的 statement（createUser 等依赖 batch）
      return (async () => {
        const results: T[] = [];
        for (const stmt of statements as MockStatement[]) {
          results.push((await stmt.run()) as T);
        }
        return results;
      })();
    },
    exec(_sql: string): Promise<D1Result<unknown>> {
      return Promise.resolve({ results: [], success: true } as unknown as D1Result<unknown>);
    },
  };

  return db as unknown as D1Database;
}

/**
 * Seed 测试用户到 mock DB。
 */
export async function seedUsers(db: D1Database): Promise<{ adminUser: User; regularUser: User }> {
  // 由于我们的 mock 比较简单，直接用 db.prepare().run() 插入
  const adminUser: User = {
    id: "user-admin-001",
    username: "admin",
    password: "$pdkdf2$600000$test-salt$test-hash",
    role: "admin",
    status: "active",
    email: "admin@example.com",
    note: null,
    token_version: 0,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const regularUser: User = {
    id: "user-regular-001",
    username: "testuser",
    password: "$pdkdf2$600000$test-salt$test-hash",
    role: "user",
    status: "active",
    email: null,
    note: null,
    token_version: 0,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const suspendedUser: User = {
    id: "user-suspended-001",
    username: "suspended",
    password: "$pdkdf2$600000$test-salt$test-hash",
    role: "user",
    status: "suspended",
    email: null,
    note: null,
    token_version: 0,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  for (const u of [adminUser, regularUser, suspendedUser]) {
    await db
      .prepare(`
      INSERT INTO users (id, username, password, role, status, email, note, token_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        u.id,
        u.username,
        u.password,
        u.role,
        u.status,
        u.email,
        u.note,
        u.token_version,
        u.created_at,
        u.updated_at,
      )
      .run();
  }

  // Seed settings
  await db
    .prepare(`
    INSERT INTO settings (key, value, description)
    VALUES (?, ?, ?)
  `)
    .bind("registration_mode", "invite", "open | invite | closed")
    .run();

  return { adminUser, regularUser };
}

/**
 * 产生一个有效的测试 JWT token。
 * 使用 WebCrypto HMAC-SHA256 自签发。
 */
export async function createTestToken(sub: string, role: string, secret: string): Promise<string> {
  const { sign } = await import("../../jwt");
  return sign({ sub, role }, secret);
}
