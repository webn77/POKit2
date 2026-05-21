# Architecture

POKit Starter is a local-first PM/PO AI Harness. It keeps project state in repository files so a human PO and an AI agent can restart work, inspect evidence, and decide next actions without relying on hidden chat memory.

## Source of Truth

`.ai-os/` is the source of truth.

- `current.md` restores the active work surface.
- `status-board.md` summarizes the current layer, issue, gate state, and next action.
- `issue-index.md` lists durable Harness Issues.
- `artifact-index.md` lists important outputs.
- `memory/session/handoff.md` carries cumulative recovery context.
- `memory/ai-failures/` records reusable failure-prevention rules.
- `standards/` holds communication, artifact, agent, visualization, and writing rules.

## Runtime Flow

```text
User says start
  -> Agent reads AGENTS.md
  -> Agent reads .ai-os/current.md
  -> Agent follows start_read_order
  -> Agent reports active issue, gate state, and next action
  -> Durable work starts only after a Harness Issue exists
  -> Verification evidence is recorded before gate claims
```

The starter begins at `POK-001`. A real project should change the namespace and issue content to match its own product or project key.

## MVP Scope

Included:

- L0 startup recovery.
- L1 single-file Harness Issue.
- L2-entry memory loop and failure-prevention entry.
- Local runner and doctor scripts.
- Public-safe starter archive.

Excluded:

- Hosted SaaS.
- Web dashboard.
- Required Linear, GitHub, or Slack adapter.
- Semantic search.
- Automatic multi-agent orchestration.
- Package registry distribution.
- First-class epic artifact support.

## v0.2.0 Additions

v0.2.0 keeps the L0/L1/L2 boundary intact while adding PO decision-tracking surfaces and runtime safety contracts.

### PO Decision Tracking Surfaces

- `.ai-os/sprints/<sprint>/release-scope.yaml` — accepted project-owned issue membership for a sprint. Source-of-truth for what is in the sprint.
- `.ai-os/sprints/<sprint>/backlog.md` — read-only derived view grouped by project and status. Reflects POK frontmatter, not edited directly.
- Status enum (`scoped / candidate / accepted / in_progress / gate_passed / dropped`) replaces the previous dual issue/todo split.
- Lifecycle cards (`🚀 시작 / 🔄 진행 / ✅ 완료 / ⚠️ 확인 필요 / 🧭 종료`) are display-only PO/PM response surfaces; they never approve durable work.

### Agent Profile Dispatcher

- POK frontmatter `agent_profile` (planner/coder/reviewer/data-analyst) maps to permission level (`propose_only / write_scoped / read_only`) and worker kind via `scripts/lib/agent-profile-dispatcher.mjs`.
- Runtime fields (`worker_kind`, `model_tier`, `runtime_preference`) are dispatcher output, not POK source-of-truth.
- Concrete provider model names resolve from `pokit.config.yaml` at runtime; POK files never carry vendor model identifiers.

### Runtime Layout

- `scripts/lib/lifecycle-card-renderer.mjs` — open-right ASCII renderer for startup/close cards.
- `scripts/lib/agent-profile-dispatcher.mjs` — dispatch contract for agent_profile.
- `scripts/lib/status-enum.mjs` — status enum source-of-truth + `deriveStatus` auto-derive.
- `scripts/lib/optional-fields.mjs` — optional POK fields validator (`depends_on`, `agent_profile`, `goal`, `ai_self_verify`).
- `scripts/pokit-runner.mjs` — startup preflight (lightweight, no doctor scan; status from `current.gate_state`).
- `scripts/pokit-doctor.mjs` — full audit for explicit CLI / pre-commit / CI / gate-claim.

### Test Infrastructure (dev-only, not in starter)

- `tests/lib/test-fixtures.mjs` — dynamic read helpers (`getCurrentState`, `getActiveIssue`, `getNextAction`, `getActiveIssueFrontmatter`). Tests read `.ai-os/current.md` instead of hardcoding `POK-XXX` literals so gate advances do not break the suite.
- `.ai-os/standards/test-standard.md` — dynamic-read pattern standard backed by AFR-004 prevention rule.

### Startup Boundary

- Startup reads `AGENTS.md`, `.ai-os/current.md`, `.ai-os/memory/session/handoff.md`, and `.ai-os/standards/communication.md` only.
- Startup does not run the full test suite, JSONL parse, gate evidence collection, release packaging checks, issue mutation, release-scope mutation, external writes, or archive/tag/publish actions.
- `runPreflight` readFile count is ≤5 regardless of how many POK files exist.

## Packaging Boundary

`starter-manifest.yaml` is the starter packaging boundary. Packaging is include-only.

- `starter/.ai-os/**` is repository template source.
- In the starter archive, those files are materialized as `.ai-os/**`.
- `starter/scripts/**` is materialized as `scripts/**`.
- Root `.ai-os/**` production history is not copied into the starter archive.
- Run logs, event receipts, personal paths, secrets, local aliases, and private account state are excluded.

## Release Boundary

`v0.1.0` is the first stable starter release. It follows the public `v0.1.0-rc.1` prerelease and keeps the same starter-only publication boundary.

Stable release claims require recorded Git commit, tag, push, GitHub release, and uploaded archive evidence under the active release issue.
