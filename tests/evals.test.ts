import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../evals/answer-key";
import { runCase } from "@/lib/evals/run";
import { NOW, useSeededDb } from "./helpers/db";

describe("answer-key evaluation (independent source of truth)", () => {
  useSeededDb();
  for (const c of EVAL_CASES) {
    it(`${c.id} [${c.tags.join(", ")}]`, async () => {
      const r = await runCase(c, NOW);
      expect(r.failures).toEqual([]);
    });
  }
});
