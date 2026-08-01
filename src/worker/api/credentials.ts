// ============================================================================
// src/worker/api/credentials.ts — /api/v1/credentials CRUD
// ============================================================================

import type { Env } from "../providers/types";
import type { Credential, CredentialPublic } from "@shared/types";
import { makeRes } from "../config";
import { authenticateWeb } from "../auth";
import {
  getCredentials,
  getCredentialById,
  upsertCredential,
  updateCredential,
  deleteCredential,
} from "../db";
import { encryptSecret } from "../crypto";
import { logAudit } from "../db";
import { invalidateCachedAuth } from "../cache";

/** 提取客户端 IP */
function getIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    request.headers.get("X-Real-IP") ??
    "unknown"
  );
}

/** 提取 UA */
function getUA(request: Request): string {
  return request.headers.get("User-Agent") || "";
}

/**
 * 列出当前用户所有凭据（密钥已脱敏）。
 * GET /api/v1/credentials?provider=docker
 */
async function listCredentials(request: Request, env: Env): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || undefined;

  const creds = await getCredentials(env.DB, user.id, provider);
  const publicCreds: CredentialPublic[] = creds.map((c) => ({
    id: c.id,
    provider: c.provider,
    label: c.label,
    username: c.username,
    is_active: c.is_active === 1,
    last_used_at: c.last_used_at,
  }));

  return makeRes(JSON.stringify({ success: true, data: publicCreds }));
}

/**
 * 创建新凭据（密钥在写入前 AES-256-GCM 加密）。
 * POST /api/v1/credentials
 * Body: { provider, label, username, secret }
 */
async function createCredential(request: Request, env: Env): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  let body: { provider?: string; label?: string; username?: string; secret?: string };
  try {
    body = (await request.json()) as Record<string, string>;
  } catch {
    return makeRes(JSON.stringify({ error: "invalid json" }), 400);
  }

  if (!body.provider || !body.secret) {
    return makeRes(JSON.stringify({ error: "provider and secret are required" }), 400);
  }

  // Bearer-only providers (github, hf) auto-use "bearer" as username
  const bearerProviders = new Set(["github", "ghcr", "hf"]);
  const isBearer = bearerProviders.has(body.provider);
  if (!isBearer && !body.username) {
    return makeRes(JSON.stringify({ error: "username is required for this provider" }), 400);
  }
  const username = isBearer ? "bearer" : body.username!;

  // Validate provider type
  const validProviders = ["docker", "ghcr", "gcr", "quay", "k8s", "nvcr", "github", "hf"];
  if (!validProviders.includes(body.provider)) {
    return makeRes(
      JSON.stringify({ error: `invalid provider. Must be one of: ${validProviders.join(", ")}` }),
      400,
    );
  }

  // Encrypt secret before storing
  const encrypted = await encryptSecret(body.secret, env.ENCRYPTION_KEY);

  const cred = await upsertCredential(
    env.DB,
    user.id,
    body.provider,
    username,
    encrypted,
    body.label || "",
  );

  // v4: 凭据变更时失效该 provider 的缓存
  await invalidateCachedAuth(body.provider);

  const clientIp = getIP(request);
  const ua = getUA(request);
  await logAudit(env.DB, "credential_added", {
    actorId: user.id,
    actorIp: clientIp,
    actorUa: ua,
    targetType: "credential",
    targetId: cred.id,
    detail: JSON.stringify({ provider: body.provider, label: body.label || "" }),
  });

  const publicCred: CredentialPublic = {
    id: cred.id,
    provider: cred.provider,
    label: cred.label,
    username: cred.username,
    is_active: true,
    last_used_at: null,
  };

  return makeRes(JSON.stringify({ success: true, data: publicCred }), 201);
}

/**
 * 更新凭据。
 * PUT /api/v1/credentials/:id
 * Body: { label?, username?, secret?, is_active? }
 */
async function updateCredentialHandler(request: Request, env: Env, id: string): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  const existing = await getCredentialById(env.DB, id);
  if (!existing) return makeRes(JSON.stringify({ error: "credential not found" }), 404);
  if (existing.user_id !== user.id && user.role !== "admin") {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  let body: { label?: string; username?: string; secret?: string; is_active?: boolean };
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return makeRes(JSON.stringify({ error: "invalid json" }), 400);
  }

  const fields: Record<string, unknown> = {};
  if (body.label !== undefined) fields.label = body.label;
  if (body.username !== undefined) fields.username = body.username;
  if (body.secret !== undefined) {
    fields.secret = await encryptSecret(body.secret, env.ENCRYPTION_KEY);
  }
  if (body.is_active !== undefined) fields.is_active = body.is_active ? 1 : 0;

  if (Object.keys(fields).length === 0) {
    return makeRes(JSON.stringify({ error: "no fields to update" }), 400);
  }

  await updateCredential(env.DB, id, fields as Partial<Credential>);

  // 凭据变更时失效缓存
  await invalidateCachedAuth(existing.provider);

  const clientIp = getIP(request);
  const ua = getUA(request);
  await logAudit(env.DB, "credential_added", {
    actorId: user.id,
    actorIp: clientIp,
    actorUa: ua,
    targetType: "credential",
    targetId: id,
    detail: "updated",
  });

  return makeRes(JSON.stringify({ success: true }));
}

/**
 * 删除凭据。
 * DELETE /api/v1/credentials/:id
 */
async function deleteCredentialHandler(request: Request, env: Env, id: string): Promise<Response> {
  const user = await authenticateWeb(request, env);
  if (!user) return makeRes(JSON.stringify({ error: "unauthorized" }), 401);

  const existing = await getCredentialById(env.DB, id);
  if (!existing) return makeRes(JSON.stringify({ error: "credential not found" }), 404);
  if (existing.user_id !== user.id && user.role !== "admin") {
    return makeRes(JSON.stringify({ error: "forbidden" }), 403);
  }

  await deleteCredential(env.DB, id);

  // 凭据删除时失效缓存
  await invalidateCachedAuth(existing.provider);

  const clientIp = getIP(request);
  const ua = getUA(request);
  await logAudit(env.DB, "credential_deleted", {
    actorId: user.id,
    actorIp: clientIp,
    actorUa: ua,
    targetType: "credential",
    targetId: id,
  });

  return makeRes(JSON.stringify({ success: true }));
}

/**
 * 凭据路由分发。
 */
export async function handleCredentialRoute(
  request: Request,
  env: Env,
  subPath: string, // e.g., "" or "/{id}"
): Promise<Response> {
  // Remove leading slash
  const id = subPath.replace(/^\//, "").split("/")[0];

  switch (request.method) {
    case "GET":
      if (id) return makeRes(JSON.stringify({ error: "not found" }), 404);
      return listCredentials(request, env);

    case "POST":
      return createCredential(request, env);

    case "PUT":
      if (!id) return makeRes(JSON.stringify({ error: "credential id required" }), 400);
      return updateCredentialHandler(request, env, id);

    case "DELETE":
      if (!id) return makeRes(JSON.stringify({ error: "credential id required" }), 400);
      return deleteCredentialHandler(request, env, id);

    default:
      return makeRes(JSON.stringify({ error: "method not allowed" }), 405);
  }
}
