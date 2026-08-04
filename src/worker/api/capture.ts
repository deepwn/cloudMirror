// ============================================================================
// src/worker/api/capture.ts — 流量录制管理 API
// ============================================================================
// 会话 CRUD（含专属子域 hash）+ 录制日志查看 + JSONL 导出。
// 路径均在 /cloudmirror-api/v1/capture 下。
// ============================================================================

import type { Env } from "../providers/types";
import { makeRes } from "../config";
import { authenticateWeb } from "../auth";
import { randomHex } from "../crypto";
import type { CaptureSession } from "../../shared/types";
import {
  getCaptureSessions,
  getCaptureSessionById,
  createCaptureSession,
  updateCaptureSession,
  deleteCaptureSession,
  getCaptureLogs,
  getCaptureLogCount,
} from "../db";

const VALID_MODES = ["echo", "challenge", "custom", "transparent"];

export async function handleCaptureRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) {
    return makeRes(JSON.stringify({ success: false, error: "Unauthorized" }), 401);
  }

  const parts = path.replace("/capture", "").split("/").filter(Boolean);
  const method = request.method;

  // ---- 会话列表 ----
  if (method === "GET" && parts.length === 0) {
    const sessions = await getCaptureSessions(env.DB, user.id);
    return makeRes(JSON.stringify({ success: true, data: sessions }), 200, {
      "Content-Type": "application/json",
    });
  }

  // ---- 创建会话 ----
  if (method === "POST" && parts.length === 0) {
    let body: {
      name?: string;
      mode?: string;
      target_upstream?: string;
      target_auth?: string;
      custom_status?: number;
      custom_body?: string;
      custom_headers?: Record<string, string>;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return makeRes(JSON.stringify({ success: false, error: "Invalid JSON body" }), 400);
    }
    const mode = body.mode ?? "echo";
    if (!VALID_MODES.includes(mode)) {
      return makeRes(JSON.stringify({ success: false, error: `Invalid mode: ${mode}` }), 400);
    }
    if (mode === "transparent" && !body.target_upstream) {
      return makeRes(
        JSON.stringify({ success: false, error: "transparent mode requires target_upstream" }),
        400,
      );
    }
    const hash = await generateUniqueCaptureHash(env);
    const session = await createCaptureSession(
      env.DB,
      user.id,
      body.name || "未命名录制",
      hash,
      mode,
      body.target_upstream ?? null,
      body.target_auth ?? null,
      body.custom_status ?? 200,
      body.custom_body ?? null,
      body.custom_headers ? JSON.stringify(body.custom_headers) : null,
    );
    return makeRes(JSON.stringify({ success: true, data: session }), 200, {
      "Content-Type": "application/json",
    });
  }

  // ---- 单会话操作 ----
  if (parts.length >= 1) {
    const sessionId = parts[0];
    const session = await getCaptureSessionById(env.DB, sessionId);
    if (!session || session.user_id !== user.id) {
      return makeRes(JSON.stringify({ success: false, error: "Not Found" }), 404);
    }

    // 查看日志
    if (method === "GET" && parts.length === 1) {
      return makeRes(
        JSON.stringify({
          success: true,
          data: {
            session,
            logs: await getCaptureLogs(env.DB, sessionId, 500, 0),
            total: await getCaptureLogCount(env.DB, sessionId),
          },
        }),
        200,
        { "Content-Type": "application/json" },
      );
    }

    // 导出 JSONL
    if (method === "GET" && parts[1] === "export") {
      const logs = await getCaptureLogs(env.DB, sessionId, 10000, 0);
      const lines = logs
        .map((l) =>
          JSON.stringify({
            seq: l.seq,
            time: l.created_at,
            method: l.method,
            path: l.path,
            headers: l.headers ? JSON.parse(l.headers) : undefined,
            body: l.body ?? undefined,
            client_ip: l.client_ip,
            client_ua: l.client_ua,
          }),
        )
        .join("\n");
      return new Response(lines || "", {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename="capture-${sessionId}.jsonl"`,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 更新会话
    if (method === "PUT" && parts.length === 1) {
      let body: {
        name?: string;
        mode?: string;
        target_upstream?: string;
        target_auth?: string;
        custom_status?: number;
        custom_body?: string;
        custom_headers?: Record<string, string>;
        enabled?: boolean;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return makeRes(JSON.stringify({ success: false, error: "Invalid JSON body" }), 400);
      }
      if (body.mode && !VALID_MODES.includes(body.mode)) {
        return makeRes(JSON.stringify({ success: false, error: `Invalid mode: ${body.mode}` }), 400);
      }
      await updateCaptureSession(env.DB, sessionId, {
        name: body.name,
        mode: body.mode as CaptureSession["mode"] | undefined,
        target_upstream: body.target_upstream,
        target_auth: body.target_auth,
        custom_status: body.custom_status,
        custom_body: body.custom_body,
        custom_headers: body.custom_headers ? JSON.stringify(body.custom_headers) : undefined,
        enabled: body.enabled === undefined ? undefined : body.enabled ? 1 : 0,
      });
      return makeRes(JSON.stringify({ success: true }));
    }

    // 删除会话
    if (method === "DELETE" && parts.length === 1) {
      await deleteCaptureSession(env.DB, sessionId);
      return makeRes(JSON.stringify({ success: true }));
    }
  }

  return makeRes(JSON.stringify({ success: false, error: "Not Found" }), 404);
}

async function generateUniqueCaptureHash(env: Env): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const hash = randomHex(16);
    const existing = await env.DB.prepare("SELECT id FROM capture_sessions WHERE hash = ?")
      .bind(hash)
      .first();
    if (!existing) return hash;
  }
  return randomHex(16);
}
