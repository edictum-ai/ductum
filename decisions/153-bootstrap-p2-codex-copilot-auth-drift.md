---
date: 2026-05-03
status: accepted
deciders: Codex
related: 130, 132, 135, 148, 151, 152
references:
  - https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
  - https://github.com/cli/cli/blob/trunk/internal/authflow/flow.go
---

# Decision 153: P2 Codex and Copilot auth acquisition follows the handoff security contract

## Context

The checked-in P2 file still names older acquisition details:

- Codex offered paste-API-key and Ductum-owned subscription-login choices.
- Copilot device auth could write `COPILOT_GITHUB_TOKEN` to `.env.local`.
- The Copilot scope note said `read:user`.

The 2026-05-03 operator handoff superseded those details for P2:

- Codex login is delegated to the installed `codex login` subprocess.
  Ductum does not implement Codex PKCE, callback listeners, or token
  storage.
- Copilot device flow stores the resulting GitHub token through the GitHub
  CLI credential path, so `gh auth status` can read it. Ductum does not
  invent a separate credentials file and does not write Copilot tokens to
  `.env.local`.

## Decision

P2 implements the handoff contract:

- `ductum init` checks `OPENAI_API_KEY` first, then `codex login status`.
  If the operator opts in, it runs `codex login` with an explicit argv
  array and a sanitized env containing only `PATH`, `HOME`, and `TERM`.
  stdout/stderr are captured and never blindly echoed.
- GitHub Copilot uses GitHub's OAuth device-code endpoints. The
  `device_code` stays in memory, polling respects the server interval
  plus jitter, and the timeout is capped at 15 minutes.
- GitHub CLI is required for final storage. Ductum pipes the in-memory token
  to `gh auth login --with-token` and then verifies with
  `gh auth status --hostname github.com`. This inherits gh's credential
  storage mode instead of manually writing `hosts.yml`.
- The OAuth app client ID is GitHub CLI's public OAuth app client ID, as
  published in the `cli/cli` source. The requested scopes are the GitHub
  CLI minimum scopes (`repo`, `read:org`, `gist`) because `gh auth login
  --with-token` rejects narrower tokens for normal gh-managed storage.

## Consequences

Copilot storage is broader than the old P2 `read:user` note, but it is the
only path that keeps Ductum out of manual credential-file handling while
making the token gh-readable. The token is never printed or written by
Ductum outside gh's credential path.

This leaves token rotation and Copilot entitlement validation out of scope,
matching D130.

The P2 demo evidence verified Codex delegation and an existing `codex login
status` success, but did not complete a fresh Codex browser OAuth round-trip
inside this non-interactive implementation session. A real `ductum init`
Codex acquisition still requires the operator to finish the browser step
owned by the Codex CLI.
