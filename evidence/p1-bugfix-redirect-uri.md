# P1 redirect URI bugfix evidence

Date: 2026-05-03

## Reproduction

With Anthropic environment variables unset, `ductum init --login` opened the
Anthropic OAuth page and failed before callback with:

`Redirect URI http://127.0.0.1:<random>/callback is not supported by client.`

## Investigation

Checked the installed `@anthropic-ai/claude-agent-sdk` package first. The
TypeScript package under pnpm's virtual store does not expose OAuth constants.
The native SDK binary reports `2.1.119 (Claude Code)`, but string inspection did
not expose a usable redirect URI or client registration constant.

Checked pi-mono's D132 reference source:

`https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/anthropic.ts`

That source uses the same Anthropic OAuth client id as P1 and defines:

- authorize URL: `https://claude.ai/oauth/authorize`
- token URL: `https://platform.claude.com/v1/oauth/token`
- callback bind host: `127.0.0.1`
- callback port: `53692`
- redirect URI: `http://localhost:53692/callback`

Anthropic developer docs did not expose a documented Claude Code OAuth callback
registration shape during this investigation.

## Fix

Ductum now uses the registered Claude Code redirect URI by default:

`http://localhost:53692/callback`

The callback server still binds only to `127.0.0.1`, validates callback URL by
exact match, keeps the five-minute timeout path, and does not include token
values in callback pages or output.

Focused verification run:

- `pnpm --filter @ductum/cli build`
- `pnpm --filter @ductum/cli test -- src/tests/login/pkce-core.test.ts src/tests/login-command.test.ts src/tests/init/auth-anthropic.test.ts`

Result: CLI build passed; CLI tests passed, 73 files / 487 tests.
