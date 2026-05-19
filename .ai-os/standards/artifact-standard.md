# Artifact Standard

- Durable work must have a Harness Issue unless it is a pre-issue operational artifact.
- Artifacts use frontmatter when they carry state.
- Completion evidence lives in verification or gate artifacts, not chat text.
- Stale artifacts must be marked stale instead of silently overwritten.

## Code Management

- issue-per-durable-change: durable code, contract, docs, or release work must be tied to one Harness Issue.
- small scoped changes: keep changes bounded to the active issue.
- tests before gate claim: add or update verification before claiming behavior, contract, or release state.
- no unrelated refactor: avoid cleanup, formatting churn, or structure moves that are not needed for the active issue.
- public-safe starter content: starter artifacts must avoid secrets, personal paths, private company assumptions, production history, run logs, and event receipts.
- review evidence before completion: use fresh local verification before completion; subagent output is not completion proof.
