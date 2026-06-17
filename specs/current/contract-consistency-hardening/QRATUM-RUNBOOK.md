# Qratum Runbook For This Spec

Use this runbook when manually running Claude Code and importing the transcript
into Qratum.

## One-Time Qratum Setup

```sh
cd /Users/acartagena/project/qratum
make build
./bin/qrt --version
```

Optional shell convenience:

```sh
export PATH="/Users/acartagena/project/qratum/bin:$PATH"
```

Verify Qratum locally:

```sh
cd /Users/acartagena/project/qratum
make demo
make dogfood-demo
```

## Start A Claude Code Prompt

Run Claude Code from Ductum:

```sh
cd /Users/acartagena/project/ductum
claude
```

Paste exactly one prompt file at a time, starting with:

```text
specs/current/contract-consistency-hardening/P0-AUDIT-AND-DECISION.md
```

After P0 is reviewed, continue with P1, P2, P3, P4, and P5 as separate Claude
Code sessions.

## Capture With Qratum Manually

Claude Code hooks receive JSON on stdin and include `transcript_path`. Qratum's
current reliable dogfood path is to import that transcript path after the
session finishes.

If Claude Code prints or exposes the transcript path, import it directly:

```sh
cd /Users/acartagena/project/qratum
./bin/qrt dogfood import /absolute/path/to/claude-transcript.jsonl
./bin/qrt dogfood latest
```

If you do not have the path visible, use Claude Code's hook payload or local
session records to find the JSONL transcript path, then run the same import.
Do not copy the raw transcript into the Ductum repo.

## Optional Automatic Hook Setup

For automatic capture, add a project-local Claude Code hook in Ductum at:

```text
/Users/acartagena/project/ductum/.claude/settings.local.json
```

Use:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd /Users/acartagena/project/qratum && ./bin/qrt hook claude-code"
          }
        ]
      }
    ]
  }
}
```

After Claude Code exits, process the captured event:

```sh
cd /Users/acartagena/project/qratum
./bin/qrt daemon run-once
./bin/qrt sessions list
./bin/qrt dogfood latest
```

This keeps the hook small. Heavy work still happens after the session.

## Hook Smoke

Qratum's hook command is intentionally tiny. It reads Claude Code hook JSON from
stdin and writes a local capture event.

```sh
cd /Users/acartagena/project/qratum
cat fixtures/claude-code/hook-session-end.json | ./bin/qrt hook claude-code
./bin/qrt daemon run-once
./bin/qrt sessions list
```

The hook must use `transcript_path` from the payload. Do not hardcode Claude
local transcript paths.

## After Each Claude Code Run

From Qratum:

```sh
cd /Users/acartagena/project/qratum
./bin/qrt dogfood latest
```

Then inspect generated artifacts:

```sh
find .qratum -maxdepth 2 -type f | sort
```

Expected useful outputs:

- `.qratum/reviews/*.review.json`
- `.qratum/reports/*.html`
- `.qratum/evidence/*.evidence.json`
- `.qratum/exports/*.adp.jsonl`

## What To Look For

- final edit after last verification
- missing final verification
- repeated failing command
- redaction warnings
- whether the review evidence matches the actual Claude Code behavior

## Source Note

Claude Code hook documentation says command hooks receive JSON over stdin and
the common input includes `transcript_path`; use that field as the boundary.
Reference: https://code.claude.com/docs/en/hooks
