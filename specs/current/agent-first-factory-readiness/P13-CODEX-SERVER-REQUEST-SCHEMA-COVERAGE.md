# P13 - Codex Server Request Schema Coverage

## Problem

P12 added explicit responses for `mcpServer/elicitation/request` and
`item/tool/requestUserInput`, but adversarial follow-up found the Codex
app-server harness still returns schema-invalid or unsafe results for other
generated server requests:

- `item/permissions/requestApproval` currently returns `{ decision: "decline" }`,
  but the generated `PermissionsRequestApprovalResponse` requires
  `{ permissions, scope, strictAutoReview? }`.
- `account/chatgptAuthTokens/refresh` currently returns `{}`, but the generated
  `ChatgptAuthTokensRefreshResponse` requires
  `{ accessToken, chatgptAccountId, chatgptPlanType }`.
- `applyPatchApproval`, `execCommandApproval`, and `item/tool/call` fall through
  to a generic object that is not valid for their declared response schemas.
- The helper comment claims unknown response shapes are safe for any future
  request type, but Codex has already shown strict deserialization failures.

GLM review run `Lbz8kK3gON9F` passed P12 and explicitly called the auth refresh
`{}` passthrough correct. That review missed the generated protocol evidence.

## Behavior Contract

- Every current generated `ServerRequest` method must be handled deliberately.
- Declines/blocks must be protocol-valid for methods with a declared shaped
  response:
  - `item/permissions/requestApproval`: grant no extra permissions with a
    schema-valid response, scoped to the turn.
  - `applyPatchApproval`: return `{ decision: "denied" }`.
  - `execCommandApproval`: return `{ decision: "denied" }`.
  - `item/tool/call`: return `{ success: false, contentItems: [...] }`.
- `account/chatgptAuthTokens/refresh` must not return a fake token payload. It
  must fail explicitly with a JSON-RPC error and emit Ductum-visible blocker
  activity explaining that non-interactive auth refresh is unsupported.
- Truly unknown future server requests must not receive arbitrary result
  objects. Return a JSON-RPC error with an explicit message so Codex cannot
  strictly deserialize a malformed result.
- Keep `authorize_tool` harness-internal and `gate_check` read-only.
- Do not add tables, dependencies, a second policy path, or prompt-only
  workarounds.

## Generated Protocol Evidence

Verified from `/tmp/ductum-codex-app-ts`:

```ts
export type ServerRequest =
  | { method: "item/commandExecution/requestApproval", ... }
  | { method: "item/fileChange/requestApproval", ... }
  | { method: "item/tool/requestUserInput", ... }
  | { method: "mcpServer/elicitation/request", ... }
  | { method: "item/permissions/requestApproval", ... }
  | { method: "item/tool/call", ... }
  | { method: "account/chatgptAuthTokens/refresh", ... }
  | { method: "applyPatchApproval", ... }
  | { method: "execCommandApproval", ... };

export type PermissionsRequestApprovalResponse = {
  permissions: GrantedPermissionProfile;
  scope: "turn" | "session";
  strictAutoReview?: boolean;
};

export type DynamicToolCallResponse = {
  contentItems: Array<DynamicToolCallOutputContentItem>;
  success: boolean;
};

export type ChatgptAuthTokensRefreshResponse = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
};

export type ApplyPatchApprovalResponse = { decision: ReviewDecision };
export type ExecCommandApprovalResponse = { decision: ReviewDecision };
export type ReviewDecision =
  | "approved"
  | "approved_for_session"
  | "denied"
  | "timed_out"
  | "abort"
  | ...;
```

## Verification

```sh
pnpm --filter @ductum/harness test -- codex-server-responses
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Slop Review

- Attack any remaining `{}` response for a generated shaped server request.
- Attack arbitrary "unknown blocker" result objects sent as successful JSON-RPC
  results.
- Attack fake auth tokens or automatic permission grants.
- Attack tests that only assert JSON serializability instead of protocol shape.
