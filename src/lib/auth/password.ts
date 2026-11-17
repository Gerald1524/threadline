import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(password, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) for optional MFA ----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  return Array.from(randomBytes(20), (b) => B32[b % 32]).join("");
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

export function totpCode(secret: string, atMs = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / step)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  return matchTotpStep(secret, code, atMs) !== null;
}

/**
 * The 30-second step a code belongs to (allowing one step of clock drift either way), or null.
 * Callers store the step and accept only later ones, so an observed code cannot be replayed.
 */
export function matchTotpStep(secret: string, code: string, atMs = Date.now(), step = 30): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  for (const w of [-1, 0, 1]) {
    const at = atMs + w * step * 1000;
    if (totpCode(secret, at, step) === clean) return Math.floor(at / 1000 / step);
  }
  return null;
}

// ---- One-time recovery codes for when the authenticator is unavailable ----

const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0 or 1

/** Ten codes of 12 characters (60 bits each), shown once; only their scrypt hashes are kept. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const chars = Array.from(randomBytes(12), (b) => RC[b % 32]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const looksLikeRecoveryCode = (code: string) => normalizeRecoveryCode(code).length === 12;
