// ============================================================================
// src/worker/jwt.ts — JWT 签发/校验 (WebCrypto HMAC-SHA256)
// ============================================================================

import type { JwtPayload } from "../shared/types";

const HEADER_B64 = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function base64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error(
      "JWT secret must not be empty. Set JWT_SECRET in .dev.vars or wrangler secrets.",
    );
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * 签发 JWT
 * @param payload — { sub, role }
 * @param secret — JWT_SECRET
 * @param expiresInSeconds — 默认 7 天
 */
export async function sign(
  payload: { sub: string; role: string },
  secret: string,
  expiresInSeconds = 604800,
  tokenVersion = 0,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    sub: payload.sub,
    role: payload.role,
    ver: tokenVersion,
    iat: now,
    exp: now + expiresInSeconds,
  } as JwtPayload;
  const payloadB64 = btoa(JSON.stringify(fullPayload))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const signingInput = `${HEADER_B64}.${payloadB64}`;

  const key = await getKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = base64url(signature);

  return `${signingInput}.${sigB64}`;
}

/**
 * 校验 JWT
 * @returns JwtPayload 或 null
 */
export async function verify(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const signingInput = `${parts[0]}.${parts[1]}`;
    const sigBytes = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );

    const key = await getKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(signingInput),
    );
    if (!valid) return null;

    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson) as JwtPayload;

    // 检查过期
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
