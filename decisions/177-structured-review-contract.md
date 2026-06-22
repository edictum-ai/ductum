# D177 — Structured review completion contract

Reviewer and Best-of-N judge completions now share one strict public JSON
contract: `kind: "ductum-review-result"`. Ordinary reviews omit `bestOfN`;
blind bakeoff judges include `bestOfN` inside the same object. Prose-only
PASS/WARN/FAIL remains malformed so unattended bakeoffs fail closed. Existing
`best-of-n-verdict` evidence is retained as outcome evidence only; it cannot
override a missing or malformed completion contract.

Malformed review output is recorded in persisted `internal-review` evidence
with `malformed: true`, and `BakeoffCompareResponse` exposes
`malformed.reviewCount` plus `malformed.recoveryState` so unattended bakeoff
operators can see retry/failure state. Malformed reviews get one stricter
automatic retry using the same review task; a second malformed completion
leaves the review task failed with recovery instructions.
