# Changelog

## [Unreleased]

- Package registry publish is not included.

## [0.2.0] - 2026-05-21

### Added

- **PO/PM Response Lifecycle Card Standard** — Open-right ASCII lifecycle cards (`🚀 시작 / 🔄 진행 / ✅ 완료 / ⚠️ 확인 필요 / 🧭 종료`) for session moments. Display-only by contract; cards never approve state transitions.
- **Project-owned Issue Model** — Logical project ownership (`project: pokit`) with status enum (`scoped / candidate / accepted / in_progress / gate_passed / dropped`). Single POK + status model replaces dual issue/todo lists.
- **Sprint Backlog and Release Scope artifacts** — `.ai-os/sprints/v0.2.0/backlog.md` (read-only derived view) and `release-scope.yaml` (accepted membership contract). LLM-confirmed dynamic priority replaces static numeric priority.
- **Agent Profile Dispatcher** — `agent_profile` (planner/coder/reviewer/data-analyst) maps to permission level (`propose_only / write_scoped / read_only`) and runtime worker assignment. Dispatcher contract in `scripts/lib/agent-profile-dispatcher.mjs`.
- **Domain Language Standard** — `issue_type` (이슈 유형) and `agent_profile` (작업 관점) are PO-facing fields; runtime assignment (`worker_kind`, `model_tier`) is dispatcher output, not source-of-truth.
- **Runner Commands** — `/pokit add`, `/pokit dispatch`, `/pokit gate` display-only command contracts with lifecycle card output fields.
- **Lifecycle Card Renderer** — `scripts/lib/lifecycle-card-renderer.mjs` for tested open-right ASCII rendering of startup and session-close cards.
- **Test Brittleness Prevention (AFR-004)** — `tests/lib/test-fixtures.mjs` helper with `getCurrentState/getActiveIssue/getNextAction/getActiveIssueFrontmatter`. Tests read `.ai-os/current.md` dynamically instead of hardcoding `POK-XXX` literals. AFR-004 prevention rule and `.ai-os/standards/test-standard.md` enforce the pattern.
- **Startup Lifecycle Card Auto-Invocation** — Restart phrases ("포킷 시작", "시작하자", "이어서 하자") trigger the open-right ASCII Startup Template from `.ai-os/standards/communication.md`. Standard added to `start_read_order` for reachability.
- **Failure Memory Audit (AFR-003)** — Derived artifact drift rule covers backlog, release-scope, release-facing spec, roadmap, session memory, and local bridge artifacts. Required check after gate-passed work.
- **Session Handoff Compaction** — Active `handoff.md` is a compact startup surface; sprint memory archived to `.ai-os/memory/session/archive/handoff-v0.2.0.md` with legacy pre-compaction archive preserved.
- **Antigravity Startup Boundary** — Startup is lightweight state recovery only (no test suite, JSONL parse, gate evidence, or release packaging at startup).

### Changed

- **Startup IO Budget** — `runPreflight` no longer calls `runDoctor`. Status derived from `current.gate_state`; doctor remains authoritative for explicit CLI, pre-commit, CI, and gate-claim invocations. Startup readFile count reduced from ~125 to ≤5.
- **Repository/File Hygiene** — `.modu-harness/` excluded from git, `.DS_Store` classified as properly ignored, `.ai-os/` issue cards and session archives consolidated.
- **Starter Distribution Verification** — Manifest and self-test cover local-bridge and dev-only isolation exclusions; runtime entrypoint bridges (AGENTS/CLAUDE/ANTIGRAVITY) verified; update preservation simulated.
- **README, Architecture, Roadmap** — Updated for v0.2.0 features and runtime flow.

### Verified

- Full suite 225/225 pass (4 new test files: lifecycle-card-renderer, dry-run-gate, startup-io-budget, test-fixtures).
- Doctor 165 pass, 0 fail, 3 warnings (starter-only mode).
- Starter self-test pass.
- `git diff --check` CLEAN.

### Not Included

- Physical project folder migration (`projects/<project>/issues/POK-XXX.md`) — planned for v0.3+, contract recorded in POK-050.
- `backlog-index.json` derived index — future optimization.
- Package registry publish.
- Hosted dashboard or required SaaS adapter.

## [0.1.0] - 2026-05-19

### Changed

- Promoted the public-safe POKit Starter from `v0.1.0-rc.1` to stable `v0.1.0`.
- Updated public release wording and archive naming for stable starter distribution.

### Verified

- Stable archive content matches manifest-mapped output.
- Extracted stable archive runner and doctor pass.
- Starter self-test, focused starter tests, release governance tests, and repo doctor pass before stable release.

### Release Boundary

- This is the first stable starter release.
- The starter archive source boundary is `starter-manifest.yaml`.
- `starter/.ai-os/**` is packaging source and becomes public `.ai-os/**` inside the starter archive.
- Root `ARCHITECTURE.md`, `CHANGELOG.md`, and `LICENSE` are included in the starter archive.
- Source-repo `RELEASE.md` remains outside the starter archive because it records release checklist and checksum evidence.
- Root project `.ai-os/` production history is not part of the starter archive.

### Not Included

- Hosted service or dashboard.
- Required external adapters.
- First-class epic artifact support.
- Package registry publication.
- Private project history, run logs, event receipts, secrets, or personal paths in the starter archive.

## [0.1.0-rc.1] - 2026-05-19

### Added

- Public-safe POKit Starter bundle.
- Starter `.ai-os/` source-of-truth structure.
- Starter Harness Issue example: `POK-001`.
- Minimal runner and doctor scripts.
- Manifest-based release-candidate archive.
- Public release documents: `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and `RELEASE.md`.
- MIT license.
- Session startup, handoff, failure-memory, and gate evidence conventions.

### Verified

- Archive content matches manifest-mapped output.
- Extracted archive runner and doctor pass.
- Starter self-test, focused starter tests, and repo doctor passed during local release-candidate archive creation.

### Release Boundary

- This is a release candidate, not stable `v0.1.0`.
- The starter archive source boundary is `starter-manifest.yaml`.
- `starter/.ai-os/**` is packaging source and becomes public `.ai-os/**` inside the starter archive.
- Root `ARCHITECTURE.md`, `CHANGELOG.md`, and `LICENSE` are included in the starter archive.
- Source-repo `RELEASE.md` remains outside the starter archive because it records release checklist and checksum evidence.
- Root project `.ai-os/` production history is not part of the starter archive.

### Not Included

- Hosted service or dashboard.
- Required external adapters.
- First-class epic artifact support.
- Package registry publication.
- Private project history, run logs, event receipts, secrets, or personal paths in the starter archive.
