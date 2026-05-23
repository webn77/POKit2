# Changelog

## [Unreleased]

- Package registry publish is not included.

## [0.5.0] - 2026-05-23

### Added

- **v0.5.0 Scope Spec** (POK-090) — `.ai-os`와 `docs/`의 책임 경계를 정리하고 순증가 억제 중심의 sprint gate 조건을 세웠다.
- **Artifact Lifecycle + Doctor Stale Detection** (POK-092) — stale artifact 감지와 삭제/아카이브 판단 기준을 doctor와 표준 문서에 연결했다.
- **Cross-runtime Issue Workflow Contract** (POK-105) — runtime proof debt와 cross-runtime issue workflow contract를 정리했다.
- **Layer A Metrics Collection** (POK-097) — issue execution metrics 12-field schema and ignored run-log storage를 도입했다.
- **Sprint Retrospective Standard** (POK-098) — v0.4.0 retrospective dogfooding 문서와 manual `npm run sprint-close` command를 추가했다.
- **Codex Model Efficiency Probe** (POK-107) — POK-099 전 read-only release audit로 `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` 워커 역할을 매핑했다.

### Changed

- **Main Session / Worker Boundary** (POK-106) — main session은 context, gate, state, integration만 관리하고 durable work는 task-type worker subagents가 수행하는 원칙을 표준화했다.
- **Project Structure Cleanup** (POK-100) — `node_modules`, `package-lock.json`, ESLint config, stale release build leftovers, `.DS_Store`류 잔재를 정리하고 lint 기대를 제거했다.
- **Dead Reaper Cleanup** (POK-091) — stale benchmark 문서를 `docs/research/benchmarks/`로 이동하고 long-range `docs/v2` 정리는 v0.6 bundle로 분리했다.
- **Net-Deletion Accounting Standard** (POK-108) — release gate의 삭제/생성/통합 산정 기준을 category accounting으로 표준화하고 doctor 회귀 체크를 추가했다.
- **Pre-Publish Cleanup Prep** (POK-109) — untracked stale `release/pokit-starter-v0.3.0.tar.gz` 혼동을 제거하고 commit/rebase를 archive 전 PO 승인 항목으로 남겼다.
- **Commit/Rebase Integration Gate** (POK-110) — v0.5.0 accumulated local work를 integration commit으로 고정하고 origin/main 정합을 맞추는 release 전 게이트를 수행한다.

### Verified

- v0.5.0 accepted sprint issues gate_passed: POK-090, POK-091, POK-092, POK-105, POK-100, POK-097, POK-106, POK-098, POK-107.
- POK-099 verifies full tests, doctor fail 0, diff check clean, sprint-close evidence, and deletion/integration accounting; POK-108 codifies the accounting standard before archive/tag/publish.

### Not Included

- Package registry publish.
- v0.6 document optimization bundle: POK-093, POK-094, POK-095, POK-096.
- Cost/model telemetry Layer B.

## [0.4.0] - 2026-05-23

### Added

- **ESLint + Engineering Standards** (POK-074) — `eslint.config.mjs` + `docs/v2/engineering-standards.md` 추가. Code Quality Phase 2 완성. `npm run lint` 스크립트 활성화.
- **contracts/ 테스트 계층** (POK-075) — `tests/contracts/` 디렉토리 + AI-assisted 라벨 정책. Code Quality Phase 3 완성. 정책-코드 일치 검증 계층 도입.
- **pokit-issue Skill** (POK-076) — `.claude/skills/pokit-issue.md` 추가. 이슈 진행 패턴(시작 → gate claim) 자동화. `/pokit-issue` 커맨드로 이슈 워크플로우 표준화.
- **Sub-issue 모델 계약** (POK-082) — `docs/v2/sub-issue-contract.md` 추가. Phase 3 진입 spec. 완전 구현은 v0.5.
- **Day Run 구조 계약** (POK-083) — `docs/v2/day-run-contract.md` 추가. Phase 4 진입 spec. 완전 구현은 v0.5.

### Changed

- **v0.4.0 Scope Spec + Roadmap Revision** (POK-081) — `release-scope.yaml` + `roadmap.md` 갱신. v0.4 / v0.5 경계 확정.
- **외부 스킬 통합 계약** (POK-084) — `docs/v2/skill-management.md` + `docs/v2/skill-catalog.md` 추가. 외부 스킬 수명주기 관리 계약 정의.

### Verified

- Full suite gate_passed: POK-081, POK-084, POK-076, POK-074, POK-075, POK-082, POK-083 (7/7).
- `npm run lint` CLEAN.
- Doctor 0 fail.

### Not Included

- Sub-issue 완전 구현 — v0.5+.
- Day Run 완전 구현 — v0.5+.
- Package registry publish.

## [0.3.0] - 2026-05-22

### Added

- **Physical Issue Migration** (POK-066) — 76개 POK 이슈 파일을 `.ai-os/POK-XXX.md`에서 `projects/pokit/issues/POK-XXX.md`로 물리 이동. `scripts/lib/issue-paths.mjs` redirector로 legacy/new path 자동 해소.
- **depends_on Cycle Detection** (POK-067) — `pokit-doctor.mjs`에 DFS 기반 `checkDependsOnCycles` 추가. 순환 의존성을 gate 이전에 탐지.
- **Schema Version Finalization** (POK-068) — `docs/v2/schema-versioning.md` 생성. `schema_version: 0.1.0` 유지 결정 기록.
- **Completion Claim Protocol** (POK-069) — `docs/v2/completion-claim.md` 생성. `communication.md`에 ✅ 완료 카드 증거 필드(`changes`, `verification`, `gate`) 추가.
- **Lifecycle Card Schema Validation** (POK-070) — `pokit-doctor.mjs`에 `checkLifecycleCardSchemas` 추가. issue 파일의 `issue_type` 필드를 lenient 모드로 검증.
- **Failure Memory Routing Automation** (POK-071) — `scripts/lib/failure-memory.mjs` 신규 생성, doctor 통합. 실패 기억 라우팅을 코드 레벨에서 자동화.
- **Next Path Card Standard** (POK-072) — `communication.md`에 🗺️ Next Path Card 섹션 추가. 5개 경로 옵션과 3개 자동 트리거 정의.
- **GitHub Actions CI + package.json** (POK-073) — `.github/workflows/ci.yml` 추가(PR/push 트리거, ubuntu-latest, Node.js LTS). `package.json` scripts: `test`, `doctor`, `runner`.
- **Test Assertion Fragility Prevention** (POK-077/078) — AFR-004 확장: `current.md gate_state` assertion 금지 + 이슈 경로 하드코딩 금지 규칙 추가. `tests/lib/test-fixtures.mjs`에 `getIssueGateState(issueId)` 헬퍼 추가. `v020-*` 테스트 파일 12개 assertion 마이그레이션 완료. 이슈 전환 시 취약 패턴 0개 달성.
- **AI Failure Record AF-004** — POK-066→073 이슈 전환 시 9개 테스트 동시 fail 패턴 기록. `ai-failure-log.md`에 추가.

### Changed

- **README** — `## Development` 섹션 추가: `npm test`, `npm run doctor` 사용법 + starter-manifest 결정 기록.
- **starter-manifest.yaml** — `starter_version: 0.2.1 → 0.3.0`, `manifest_version: 0.2.0 → 0.3.0`.

### Verified

- Full suite 244/244 pass.
- Doctor fail 0.
- Starter self-test pass.
- `git diff --check` CLEAN.
- GitHub Actions CI workflow 추가로 이후 PR/push 자동 검증.

### Not Included

- ESLint / Biome 통합 — POK-074 (v0.4+).
- contracts/ 테스트 계층 — POK-075 (v0.4+).
- Package registry publish.

## [0.2.1] - 2026-05-21

### Added

- **Sprint Close Summary Format Standard** (POK-063) — `.ai-os/standards/communication.md`에 스프린트/릴리즈 종료 시점의 7-단계 종합 정리 구조 추가. 세션 종료 라이프사이클 카드(`🧭`, 단일 세션)와 스프린트 종료 종합 정리(cross-session)를 명시적으로 구분.

### Patch Boundary

- Documentation-only patch. Runtime behavior, runner, doctor, manifest contract 변경 없음.
- `starter_version: 0.2.0 → 0.2.1`. Contract version은 0.2.0 유지.

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
