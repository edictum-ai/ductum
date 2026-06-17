Fix the CLI spec import path so YAML task fields that operators already write are honored.

Problem:
- YAML specs in this repo use fields like `requiredRole`, `complexity`, `status`, and `assignedAgent`.
- `assignedAgent` and `complexity` are honored, but `requiredRole` and `status` are currently parsed or displayed inconsistently and then ignored by `executeSpecImport`.
- This matters because agents/operators need to create specs from YAML without hand-editing the DB afterward.

Requirements:
- Extend the imported task type/parser if needed so YAML task `requiredRole` and `status` survive parsing.
- Pass `requiredRole` and `status` into `ctx.api.createTask` in `executeSpecImport`.
- Preserve existing behavior for specs that omit these fields.
- Add or update focused CLI spec-import tests for both fields.
- Keep files under the repo LOC limits where practical.
- Run `pnpm --filter @ductum/cli exec vitest run src/tests/spec-import.test.ts`.
