# P1 - Real Claude Code Dogfood Capture

You are working in `/Users/acartagena/project/qratum`.

## Goal

Make Qratum work against real local Claude Code transcript shapes, not only
synthetic Milestone A fixtures.

Milestone A proved the vertical slice with fixtures. This task validates and
hardens the parser, redaction, evidence, review, report, and ADP loop against
sanitized real-shaped Claude Code session data.

## Non-Goals

Do not implement:

- server
- sync
- marketplace
- MCP
- GitHub comments
- GitHub App
- Codex adapter
- OpenCode adapter
- Copilot adapter
- encrypted vault
- database
- bbolt
- SQLite
- Postgres
- LLM scoring
- LLM redaction

## Required Work

### 1. Add a safe real-transcript import workflow

Create:

```sh
qrt dogfood import <transcript_path>
```

Behavior:

- reads a local Claude Code transcript JSONL path
- normalizes it with the existing parser
- runs deterministic redaction
- runs evidence extraction
- creates a review card
- renders the HTML report
- exports ADP strict JSONL
- writes artifacts under `.qratum/`
- never prints raw transcript content
- never copies the raw transcript into `.qratum/`
- fails loudly if the transcript is missing or invalid

### 2. Add parser tolerance for real transcript shapes

Use tolerant parsing only.

Handle unknown record types without failing.

Preserve useful fields when available:

- session id
- timestamps
- model
- user messages
- assistant messages
- tool calls
- tool results
- file edits
- Bash commands
- command success/failure

Do not assume all fields exist.

### 3. Add sanitized real-shaped dogfood fixtures

Add fixtures under:

```text
fixtures/dogfood/
  real-shaped-transcript.jsonl
  real-shaped-transcript.golden.review.json
```

The fixture must be sanitized and must not contain real secrets.

### 4. Add compact latest dogfood review

Create:

```sh
qrt dogfood latest
```

Behavior:

- finds the latest processed session under `.qratum/`
- prints compact review info:
  - session id
  - verdict
  - main finding
  - suggested next habit
  - HTML report path
  - ADP export path

### 5. Documentation

Update README with a short "Dogfood on a local transcript" section.

Include:

```sh
qrt dogfood import /path/to/transcript.jsonl
qrt dogfood latest
```

Warn:

- raw transcripts stay local
- Qratum does not upload anything
- deterministic redaction is best-effort alpha quality

## Tests

Add tests for:

- dogfood import on the sanitized real-shaped fixture
- unknown record types are tolerated
- raw transcript content is not copied into `.qratum/`
- `qrt dogfood latest` prints review, report, and export paths
- missing transcript path fails non-zero

## Verification

Run:

```sh
go test ./...
make build
make demo
```

## Definition Of Done

Done means Qratum can process at least one sanitized real-shaped Claude Code
transcript fixture end-to-end and expose a compact latest dogfood review without
raw transcript leakage.
