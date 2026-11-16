import { createHash, randomBytes } from "node:crypto";

export const sha256 = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");

/** Prefixed random id for records created at runtime. Seeded records use fixed, readable ids. */
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

/** Deterministic id derived from stable inputs: re-importing the same record yields the same id. */
export const stableId = (prefix: string, ...parts: (string | number)[]) => `${prefix}_${sha256(parts.join("|")).slice(0, 14)}`;

export const normalizeText = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

export const unique = <T>(xs: T[]) => [...new Set(xs)];
export const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
export function groupBy<T, K extends string>(xs: T[], key: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}
