# P1 redirect URI bugfix Opus review

Command:

`claude -p --model claude-opus-4-7`

Date: 2026-05-03

## Security checklist

1. State: `base64url(randomBytes(32))`, exact-compared on callback. Pass.
2. Verifier length: 32 random bytes yields 43 base64url chars; range guard
   remains 43-128. Pass.
3. Challenge: `base64url(sha256(verifier))`. Pass.
4. Redirect URI exact match: `callbackUrl !== redirectUri`, no prefix or regex
   matching. Pass.
5. Token storage: not touched by this bugfix diff.
6. No token in logs: callback pages and errors do not echo token values. Pass.
7. Callback server: 127.0.0.1-only, default five-minute timeout, single-shot
   close. Pass.
8. Browser URL: authorization URL only; no verifier or token. Pass.
9. Success page: no token echo. Pass.
10. Verifier freshness: each login attempt generates fresh PKCE material. Pass.

## Behavior

- Redirect URI shape now matches the pi-mono/Claude Code registration:
  `http://localhost:53692/callback`.
- Callback server still binds to `127.0.0.1`.
- Tests assert the default registered redirect URI, bind host, port, and auth URL
  redirect parameter.
- Evidence file records the source URL and constants.
- No new D135 output surface added.

## Non-blocking warnings

- IPv6 localhost resolution could matter on environments where `localhost`
  resolves only to `::1`, while the server binds IPv4 `127.0.0.1`. The reviewed
  source registration uses this exact shape.
- Fixed port `53692` means concurrent login attempts can collide; the existing
  `auth_pkce_callback_port_in_use` path handles that.
- Exact redirect matching means a callback using host `127.0.0.1` is rejected;
  this is intended because the registered redirect URI host is `localhost`.

VERDICT:
PASS
