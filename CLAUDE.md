# Project Claude instructions

<!-- project-workflow:start -->
# Project workflow coordination

Read `.agent/project.yaml` at session start. If it selects Advanced, also read `.agent/workflows.yaml`, active `.agent/tasks/*/task.json` capsules, and recent `.agent/sessions/*.json` handoffs. Treat ledger entries as claims and verify them against Git, the working tree, CI, live provider state, and current external state.

Use the exact provider-native session ID printed by the lifecycle briefing for task and checkpoint commands. If multiple same-provider sessions overlap, never guess or reuse another session's ledger.

If the mode is unselected, analyze read-only and ask the user to choose Advanced (recommended/default) or Normal before material mutations. Normal retains minimal logging and global safety but does not impose workflow phases or capsules. An Advanced project may use a Normal override for one session without changing the shared project choice.

For substantial Advanced work, create a task capsule with declared scope, preserve pre-existing changes, checkpoint task-owned files and validation, record repeatable workflow gaps, and log external actions separately. Only the named steward approves workflow evolution. Never silently change authority, security, deployment, production, finance, or payment policy.

Use the global `project-workflow` skill and CLI for selection, task capsules, checkpoints, semantic validation, repair, gaps, and approved evolution.
<!-- project-workflow:end -->
