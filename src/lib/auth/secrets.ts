/**
 * Encryption for small secrets stored in the database (the authenticator secret).
 * AES-256-GCM; the key comes from THREADLINE_ENCRYPTION_KEY. Each value is bound to a
 * context string (for example the user id), so a sealed value copied onto another row
 * does not decrypt there.
 */
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1:";
let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  let material = process.env.THREADLINE_ENCRYPTION_KEY;
  if (material !== undefined && material !== "") {
    if (material.length < 32) throw new Error("THREADLINE_ENCRYPTION_KEY must be at least 32 characters, e.g. the output of `openssl rand -hex 32`.");
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("THREADLINE_ENCRYPTION_KEY is not set. It is required in production (see docs/DEPLOYMENT.md).");
    // Development convenience: a random key persisted beside the embedded database (never committed).
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.THREADLINE_DATA_DIR ?? ".data");
    const file = path.join(dir, "encryption-key");
    if (fs.existsSync(file)) material = fs.readFileSync(file, "utf8");
    else {
      fs.mkdirSync(dir, { recursive: true });
      material = randomBytes(32).toString("hex");
      fs.writeFileSync(file, material, { mode: 0o600 });
    }
  }
  return (cached = createHash("sha256").update(material).digest());
}

export function sealSecret(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

/** Throws if the value was tampered with, sealed for another context, or sealed with another key. */
export function openSecret(stored: string, context: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // stored before encryption was introduced
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export const isSealed = (stored: string | null | undefined) => !!stored?.startsWith(PREFIX);
