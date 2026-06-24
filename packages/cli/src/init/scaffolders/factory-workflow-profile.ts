export const factoryWorkflowProfile = `apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: coding-guard
  description: Fresh factory guarded workflow profile

context:
  required_files:
    - .edictum/workflow-profile.yaml
  optional_files:
    - README.md
    - AGENTS.md

setup:
  commands: []

verify:
  commands:
    - test -f ductum.db

review:
  approval_message: Approve only after external review reports no new issues

push:
  protected_branches:
    - main
  allowed_git_commands:
    - git status
    - git diff
    - git add
    - git commit
    - git push
`
