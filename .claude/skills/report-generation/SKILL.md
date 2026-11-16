---
name: report-generation
description: Use when changing the case packet PDF or the report service.
---

# Case packet

Code: `src/lib/services/reports.ts`, `src/lib/pdf/packet.tsx`.

1. Built from `preparePacket`: verified claims and structured evidence only.
2. Requires the reviewer's explicit confirmation; the reviewer's name and note are printed.
3. Sections, in order: summary, reported versus observed, chronology, staff who handled it,
   correspondence, work orders and policy, conflicts, known limitations, source index.
4. Every source in the packet appears in the index with identifier and SHA-256 prefix; every
   `[S#]` citation must resolve (`tests/pdf.test.ts` checks both).
5. State limitations plainly, including tentative links and source coverage. It is a factual
   compilation, never a legal conclusion or a recommendation.
6. The staff section is chain of custody for this case. No totals, rankings or assessments of people.
7. Packets are stored privately with a hash and removed if a record they cite is disposed.
