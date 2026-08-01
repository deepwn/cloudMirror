// ============================================================================
// src/worker/crypto.ts — 密码哈希 (PBKDF2) + 凭据加解密 (AES-256-GCM) + 密码强度
// ============================================================================

// NIST SP 800-132 推荐 ≥10,000 次迭代 (PBKDF2-SHA256)
// Workers Free 10ms CPU / Paid 50ms CPU，10,000 次约 10-30ms，安全可用
// 配合 16B 随机 salt + 32B 输出 + 12 位强密码，满足生产安全要求
const PBKDF2_ITERATIONS = 10_000;

/**
 * 哈希密码 — PBKDF2-SHA256
 * 格式: $pdkdf2$<iterations>$<salt-b64>$<hash-b64>
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) {
    throw new Error("hashPassword: password must not be empty");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  const hash = new Uint8Array(bits);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...hash));
  return `$pdkdf2$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password) return false;
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[1] !== "pdkdf2") return false;
  const iterations = parseInt(parts[2], 10);
  const salt = Uint8Array.from(atob(parts[3]), (c) => c.charCodeAt(0));
  const storedHash = parts[4];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const hash = new Uint8Array(bits);
  return btoa(String.fromCharCode(...hash)) === storedHash;
}

// ============================================================================
// AES-256-GCM 凭据加解密
// ============================================================================

/**
 * 将 hex 秘钥字符串解码为 CryptoKey
 */
async function getEncryptionKey(keyHex: string): Promise<CryptoKey> {
  if (!keyHex || keyHex.length < 64) {
    throw new Error(
      "ENCRYPTION_KEY must be at least 32 bytes (64 hex chars). Set ENCRYPTION_KEY in .dev.vars or wrangler secrets.",
    );
  }
  const keyBytes = new Uint8Array(keyHex.length / 2);
  for (let i = 0; i < keyHex.length; i += 2) {
    keyBytes[i / 2] = parseInt(keyHex.substring(i, i + 2), 16);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * 加密凭据
 * @returns Base64(iv + ciphertext) — 格式: <12B iv><ciphertext+16B authTag>
 */
export async function encryptSecret(plaintext: string, encryptionKey: string): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  // Concatenate iv + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * 解密凭据
 */
export async function decryptSecret(cipherB64: string, encryptionKey: string): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const combined = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * 生成随机 hex 字符串（用于 hash 子域名）
 */
export function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

// ============================================================================
// 密码强度校验
// ============================================================================

export interface PasswordPolicy {
  minLength: number;
  requireNumber: boolean;
  requireSymbol: boolean;
}

/** 默认策略 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireNumber: false,
  requireSymbol: false,
};

/**
 * 校验密码是否符合策略，不符合则返回错误信息。
 */
export function validatePassword(pw: string, policy: PasswordPolicy): string | null {
  if (!pw || pw.length < policy.minLength) {
    return `密码长度至少 ${policy.minLength} 位`;
  }
  // 字符始终必选
  if (!/[a-zA-Z]/.test(pw)) {
    return "密码必须包含至少一个字母";
  }
  if (policy.requireNumber && !/[0-9]/.test(pw)) {
    return "密码必须包含至少一个数字";
  }
  if (policy.requireSymbol && !/[^a-zA-Z0-9]/.test(pw)) {
    return "密码必须包含至少一个符号";
  }
  return null;
}

/**
 * 生成满足密码策略的随机密码（管理员重置时使用）。
 */
export function generateCompliantPassword(policy: PasswordPolicy): string {
  const length = Math.max(policy.minLength, 16); // 至少 16 位
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_+=";
  let pool = upper + lower;
  // 保证至少一个字母
  let pw =
    upper[Math.floor(Math.random() * upper.length)] +
    lower[Math.floor(Math.random() * lower.length)];
  if (policy.requireNumber) {
    pw += digits[Math.floor(Math.random() * digits.length)];
    pool += digits;
  }
  if (policy.requireSymbol) {
    pw += symbols[Math.floor(Math.random() * symbols.length)];
    pool += symbols;
  }
  // 剩余随机填充
  const poolArr = pool.split("");
  for (let i = pw.length; i < length; i++) {
    pw += poolArr[Math.floor(Math.random() * poolArr.length)];
  }
  // 打乱
  return pw
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}
