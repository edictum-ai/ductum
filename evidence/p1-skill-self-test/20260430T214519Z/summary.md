# Ductum CLI Skill — Self-Test Summary

Timestamp: 2026-04-30T21:45:19Z
Skill under test: `.claude/skills/ductum-cli/SKILL.md` (476 lines)
Knowledge corpus the agent was allowed: SKILL.md + AGENTS.md only.
Subagent: fresh general-purpose Task agent (model: opus).

## Result: **PASS**

All five P1 behavior-contract steps were completed using only `ductum`
CLI commands. The agent never reached for curl, sqlite3, or yaml edits,
and never tried to read the source tree to discover commands.

## Counters

- Total Ductum CLI commands run: 7
- curl invocations: **0**
- `sqlite3` / `*.db` reads or writes: **0**
- Hand-edited yaml files: **0**
- `--no-verify` git commits: **0**
- Source-file reads under `packages/`/`decisions/`/`specs/`: **0**

## Steps proven

| # | Step | Command the skill pointed to | Result |
|---|---|---|---|
| 1 | Import a sample 1-task spec | `ductum spec import <path> --project <p>` (with `--waive-contract` escape hatch surfaced) | Behaved as documented; contract check refused, escape hatch named. |
| 2 | Watch dispatcher pick up the task | `ductum queue` + `ductum dispatcher status` + `ductum dispatcher cycle` | All reachable; 0 dispatched (no real adapter — expected). |
| 3 | Approve a passing review | `ductum approve <runId>` | Returned `approved → merged`. Fixture placeholder branch/commit caused merge to be a no-op rather than a hard fail; CLI happy path was correct. |
| 4 | Recover a stuck run | `ductum operator-ship <runId> --reason "<text>"` | Advanced run to `ship`, set `pendingApproval=true`, printed next CLI command. First try. |
| 5 | Mark an abandoned spec failed | `ductum spec set-status <specId> failed --project <p>` | Status flipped to `failed`. |

## Skill gaps the agent flagged

The agent reported *no blocking gaps*. Two non-blocking nits worth
recording for a follow-up pass:

1. The Prerequisites section names `http://localhost:4100/api/health`
   but does not call out the `--api-url` flag explicitly. In the
   self-test the agent only knew about `--api-url` because the test
   brief told it. For a fresh agent on a non-default port, the skill
   should mention `ductum --api-url <url> ...`.
2. The example `export DUCTUM=...` alias would be more useful if it
   demonstrated baking in `DUCTUM_OPERATOR_TOKEN` and `--api-url` for
   non-default environments.

Both are documentation polish, not enforcement gaps. Carry as Stage 2+
follow-up notes.

## Audit anchor

The full transcript is in `transcript.md` at the same path.
