# Alpha CLI Onboarding

This is the shortest current CLI path for dogfood operators. Assume Node 22+,
pnpm 10+, and agent provider credentials are already available in the shell or
Factory Settings.

```bash
pnpm install --frozen-lockfile
pnpm build
alias ductum="node $PWD/packages/cli/dist/index.js"

ductum init --no-login --no-browser
ductum start --no-browser
ductum project create ductum --repo "$PWD" --merge-mode human
ductum project agent assign ductum <agentName> --role builder
ductum repair
ductum status
```

Create or import work:

```bash
ductum spec create ductum <specName>
ductum task create <specId> <taskName> --agent <agentName> --role builder
ductum spec approve <specId>
ductum attempt start <taskId> --agent <agentName> --project ductum
```

Operator loop:

```bash
ductum status
ductum watch <attemptId>
ductum logs <attemptId>
ductum approve <attemptId>
ductum deny <attemptId> --reason "Needs a smaller patch"
ductum retry <attemptId>
ductum cancel <attemptId> --reason "Operator cancelled"
```

Current gaps:

- Agent setup still depends on Factory Settings and provider credentials.
- Some advanced recovery remains API/dashboard-only until it is reshaped into
  the Factory -> Project -> Repository -> Spec -> Task -> Attempt model.
