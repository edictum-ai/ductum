# P1 - Ductum CLI Skill (operator-direct)

## Problem

The 2026-04-30 audit showed that even agents working on Ductum reach for
curl, hand-edited yaml, or direct DB inspection instead of the CLI. The
factory has the CLI surface; what's missing is documentation that teaches
agents to drive it.

## Scope

Operator-direct. One skill file, one self-test, no Ductum dispatch.

## Behavior Contract

- Create `.claude/skills/ductum-cli/SKILL.md`.
- Skill teaches: every CLI command, when to use it, what NEVER to do
  (no curl, no SQLite, no `--no-verify`, no hand-edited yaml).
- Skill includes recovery recipes mapped to actual failure modes:
  - "run stuck in implement after session-end" → `ductum run end-session`
  - "verified work, reviewer chain broken" → `ductum operator-ship`
  - "approval blocked by stale main" → rebase + re-verify + re-approve
  - "task failed, retry it" → `ductum retry`
  - "stale review run no live session" → `ductum run-close`
  - "spec abandoned" → `ductum spec set-status <spec> failed`
- Skill is invoked by the user typing `/ductum-cli` or by an agent
  needing to drive Ductum.
- Skill self-test: a fresh agent (Codex or Claude) reading only the
  skill + `specs/CURRENT.md` + `AGENTS.md` must complete this exact
  workflow without operator help:
  1. Import a sample spec
  2. Watch dispatcher pick up a task
  3. Approve a passing review
  4. Recover one stuck run with `operator-ship`
  5. Mark a deliberately-failed spec as `failed`

## Verification

The skill is verified by running it. There is no automated test —
the skill is documentation that agents read.

## Exit Demo

I open a fresh Codex Claude Code session, point it at the skill, and
hand it the sample spec. It completes the 5-step workflow above with
zero curl calls in its tool log and zero SQLite reads/writes.

## Slop Review

- Attack a skill that lists commands without saying *when* to reach for
  each one.
- Attack a skill that doesn't name the recovery recipes for the failure
  modes we hit on 2026-04-30.
- Attack a skill that the self-test shows still requires operator
  intervention.
