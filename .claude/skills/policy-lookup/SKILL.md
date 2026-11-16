---
name: policy-lookup
description: Use when changing how policy questions are answered or how policy documents are imported and versioned.
---

# Policy lookup

1. Authoritative text = the single `approved` version (`services/policies.ts: currentPolicyFor`).
2. Superseded versions and draft or working documents are never quoted as policy; mention only that they exist and do not apply.
3. Quote clauses verbatim with their number. Numeric thresholds are compared in code, not inferred.
4. If a clause requires manager review, offer a review request; never state that staff may proceed.
5. No approved policy → say so and route to a manager. Do not improvise one.
6. Importing a newer approved version supersedes older approved versions automatically (`upsertPolicy`).
