# Phase 6 specification (historical)

The approved specification used to build encrypted backup and restore
(Phase 6, Steps 1–5): v2.4 and its amendment v2.5, with their annexes,
change logs and open questions. They are kept here unchanged as the record of
what was decided and why.

They are **not** the description of the current implementation:

- where the code, [TECHNICAL_ARCHITECTURE.md](../../TECHNICAL_ARCHITECTURE.md)
  §8 or [STATUS.md](../../STATUS.md) disagree with them, the code wins;
- clarifications made during implementation are recorded in TA §8.7 and
  §8.7.1, and at the end of `v2.5/13-changelog-v2.5.md`;
- open questions in `14-unresolved*.md` may since have been answered (see
  STATUS.md).

The TZBK v1 file format itself (`v2.4/10-…` §3, Annex A `11-…`, Annex B
`12-…`) **is** still normative: backups written today follow it, and
changing it needs a new format version.
