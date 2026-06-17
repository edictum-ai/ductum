# P3 - Command Path Validation

You are working in `/Users/acartagena/project/ductum`.

## Goal

Harden command/path validation with explicit high-risk cases rather than
generic regex confidence.

## Required Work

- Expand tests around `workflow-command-scope`.
- Add cases for:
  - `rm -rf` and variants with flags before/after paths
  - `rm /`, `rm ~`, and `$HOME` expansions where visible in command text
  - `git reset --hard`, `git clean -fdx`
  - output redirects and append redirects
  - path flags such as `--output`, `--file`, `--config`, `--cwd`
  - target-directory style flags
  - quoted paths and `--` separators
  - path values that begin with `-`
  - symlink-sensitive protected paths
  - compound `cd ... && <write>` cwd drift
  - PowerShell mutation cases if current code has a PowerShell path
- Improve parsing only as far as needed to pass the new safety tests.
- Return structured denial data where practical: blocked path, command kind,
  reason, and safe suggestion.

## Behavior Contract

- Protected factory DB paths remain blocked.
- Shell mutation remains blocked before write-enabled stages.
- Read-only shell commands should not be blocked just because they contain
  confusing punctuation.
- High-risk destructive commands are detected consistently.
- Parser-aware extraction augments existing regex guards; it does not remove
  protected-path checks.

## Non-Goals

Do not write a complete shell parser.
Do not import a shell parser dependency.
Do not loosen existing protected-path behavior.

## Verification

```sh
pnpm --filter @ductum/core test
pnpm build
node scripts/check-file-size.mjs
git diff --check
```

## Final Report

Report:

- cases added
- parser/validator changes
- false-positive tradeoffs
- verification commands run
