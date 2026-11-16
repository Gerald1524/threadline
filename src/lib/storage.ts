/**
 * Private object storage. Development adapter: content-addressed files under
 * THREADLINE_DATA_DIR/blobs, never served statically. Every read goes through `readBlob`,
 * which checks tenant, property and sensitivity. Production swaps this adapter for a private
 * bucket (e.g. Supabase Storage) behind the same two functions.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { AccessDenied, can, scopeOf, type AccessContext } from "./access";
import { dataDir, type Queryable } from "./db/client";
import { blobs } from "./db/schema";
import { sha256, stableId } from "./util/core";

const fileFor = (orgId: string, hash: string) => path.join(dataDir(), "blobs", orgId, hash.slice(0, 2), hash);

export async function putBlob(q: Queryable, p: { orgId: string; propertyId: string; filename: string; mediaType: string; bytes: Uint8Array; sensitivity?: string; sourceRecordId?: string }) {
  const hash = sha256(p.bytes);
  const file = fileFor(p.orgId, hash);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, p.bytes, { mode: 0o600 });
  }
  const id = stableId("blob", p.orgId, p.propertyId, hash, p.filename, p.sourceRecordId ?? "");
  await q.insert(blobs).values({ id, orgId: p.orgId, propertyId: p.propertyId, filename: p.filename, mediaType: p.mediaType, byteSize: p.bytes.byteLength, sha256: hash, storageKey: `${p.orgId}/${hash}`, sensitivity: p.sensitivity ?? "internal_ops", sourceRecordId: p.sourceRecordId ?? null }).onConflictDoNothing();
  return { id, sha256: hash };
}

export function readBlobBytesUnchecked(orgId: string, hash: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(fileFor(orgId, hash)));
}

export async function readBlob(q: Queryable, ctx: AccessContext, blobId: string) {
  const [b] = await q.select().from(blobs).where(and(eq(blobs.id, blobId), scopeOf(ctx, blobs)));
  if (!b) return null;
  if (b.sensitivity === "highly_sensitive" && !can(ctx, "restricted.read")) throw new AccessDenied("restricted.read");
  if (b.sensitivity === "confidential_case" && !can(ctx, "management.read")) throw new AccessDenied("management.read");
  return { meta: b, bytes: readBlobBytesUnchecked(b.orgId, b.sha256) };
}

export function deleteBlobFile(orgId: string, hash: string) {
  fs.rmSync(fileFor(orgId, hash), { force: true });
}
