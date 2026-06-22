# Changelog

This public changelog tracks the published `pokit2` package and its public source surfaces. Internal development issues, sprint memory, receipts, and work history are intentionally excluded.

## [0.24.1] - 2026-06-22

### Fixed

- `pokit-public-sync` argument parsing: running with `--apply` but without `--version` no longer mistakes `--apply` for the version string (which produced a `v--apply` tag / commit message). The version now defaults to `package.json` when `--version` is omitted. Argument parsing is extracted into a pure, unit-tested `parseSyncArgs` function.

## [0.24.0] - 2026-06-21

### Added

- Release-artifact gate at sprint close: `pokit-sprint-close` now enforces the 4 release artifacts (npm publish / public source / git tag / GitHub Release) as a mandatory checklist, preventing silent release omissions.
- Event-log team sharing: sprint close copies and commits `logs/` to the work repo, so multi-PC event-log data is no longer stranded local-only.
- Project-aware runner: the runner now reads the `~/.pokit` project registry and surfaces the active project with its registered-project count (e.g. "프로젝트 pokit (등록 2개 중)") plus structured `activeProject` / `registryProjectCount` fields. The project's `.ai-os` stays the source of truth; the registry is a read-only index, and single-project / no-registry environments render unchanged.

### Changed

- Metrics collection (token / duration) is now wired exclusively through the gate collector, unifying instrumentation onto a single path.
- The test layer now distinguishes "never collected" from "regressed" for event-log-dependent tests, so a fresh pull no longer fails on absent local-only receipts while real regressions still fail.
- Gate approval flow streamlined to remove double-confirmation friction while preserving the human approval boundary.

## [0.22.0] - 2026-06-18

### Added

- Release gate G2 now mandates a bootstrap first-run non-crash check: a fresh empty install (`active_issue: null`) must run the startup trigger with exit 0. Enforced by `scripts/pokit-release-g2-check.mjs`.
- Release deployment helpers: `scripts/pokit-public-sync.mjs` (public-repo refined sync — clone, compute file set, replace, leak-scan, diff; `--apply` commits, push stays a human gate) and `scripts/lib/release-artifacts-check.mjs` (measures the 4 release artifacts: npm, public source, tag, GitHub Release).
- Starter branding: POKit2 logo bundled in the starter and surfaced in the README.

### Changed

- doctor distinguishes "never collected" from "regressed" for local-only event-log receipt checks, so a fresh pull / bundle no longer reports missing past receipts as failures while real regressions still fail.
- Startup / current-state triggers now git-sync first, so multi-session state is reconciled before the status card renders.

## [0.19.0] - 2026-06-12

### Added

- npm registry package: `pokit2` is now published to npm. Install with `npx pokit2 install` — no GitHub archive needed.
- `pokit install`: writes the thin project residue (`AGENTS.md` marker block, `.claude/skills/pokit-*`, seed `.ai-os`), and automatically migrates legacy v0.18 full-copy installs while preserving user state.
- `pokit update`: regenerates tool-owned files (marker block, thin skills, `pokit_version`) and never touches user-owned state. Refuses unknown `schema_version`.
- `pokit doctor` detects `pokit_version` drift between project and installed package.
- Engine guards: auto-numbered issue creation is allowed in a fresh project (no active issue yet) and still blocked when an active issue exists; `pokit install` refuses to run inside a POKit2 source checkout; doctor resolves tool-owned standards from the installed package for thin projects.

### Changed

- Topology: the harness body (scripts, standards, seeds) lives once in the global package; each project keeps only three items — `AGENTS.md`, `.claude/skills`, `.ai-os`.
- README and onboarding docs rewritten for the npm-package install path, with an "Everyday commands" / "Agent and advanced commands" split and a legacy v0.18 migration section.

### Removed

- Legacy archive distribution surface: `starter/scripts`, `starter/tests`, the archive build tooling, and `starter-manifest.yaml`. Install seeds remain under `starter/`.

## [0.18.0] - 2026-06-11

### Added

- One-line installer: `npx github:dongwonlee222/POKit2` installs the starter into the current directory. Refuses to overwrite existing files (opt-in `--force`), then points to `node scripts/pokit-doctor.mjs` for the first check.
- Starter `package.json` with the `pokit2-starter` bin entry point backing the npx flow.

### Changed

- Starter version bumped to `0.18.0`.
- Skill instruction contracts compacted (governance diet) — same boundaries, less procedural prose.
- Starter marker guard hardened so packaging drift fails the self-test instead of shipping silently.

### Not Included

- npm registry package (`npx pokit2`) — GitHub-based install only in this release.
- Public push, tag, GitHub release, or package-registry publish without separate approval.

---

## [0.16.0] - 2026-06-09

### Added

- Handoff rotation policy: 스프린트 없는 프로젝트의 handoff.md 회전 기준 정책 (T1 이슈 완료 건수, T2 날짜 주기, T3 크기 임계값).
- `pokit-issue-create`: `--project` 미지정 시 `.ai-os/current.md`의 `active_project`를 자동으로 기본값으로 사용.

### Changed

- Starter version bumped to `0.16.0`.

### Not Included

- Runner automatic handoff rotation (requires separate PO approval per session).
- Public push, tag, GitHub release, or package-registry publish without separate approval.

## [0.15.0] - 2026-06-04

### Added

- Targeted issue preflight before worker fan-out, so malformed execution packets fail early.
- Local automation MVP: register, preview, first dry-run receipt, event-log entry, and disable stop switch.
- Config and state role boundaries for project config, local secrets, user defaults, project state, and issue numbering.

### Changed

- Release-gate checks now run earlier: public-safe scan, archive self-test, extracted starter verification, evidence tracking, and release-boundary recording.
- Starter install docs now point to the local v0.15 archive path and keep public GitHub release publishing behind explicit approval.

### Not Included

- Fully unattended scheduled automation.
- Public push, tag, GitHub release, or package-registry publish without separate approval.

## [0.14.0] - 2026-06-04

### Added

- Multi-session wiring with guided session cards and lifecycle card output from the runner.
- Safe-step automation with pass/fail status indicators per step (reversible steps auto-proceed; push and gate pass require confirmation).
- Starter safety floor: active-issue guard, PreToolUse `require-active-issue-before-mutation` hook, settings bundle, and doctor binding test.
- Multi-session candidate-claim coordination with registry-aware `/pokit.next`.
- Session auto-registration and role-based commit/push guards.
- Sub-session handoff packets for clean context transfer across session boundaries.
- Antigravity skill emulation contract — compatibility scaffolded; official Antigravity runtime support deferred, not claimed.

### Changed

- Full-test suite now uses a temp-isolated `POKIT_HOME` to prevent cross-test state bleed.
- Manifest reconciled: `session-start.mjs` (prevention lever) and `pokit-doctor-binding.test.mjs` (detection lever) added to `include` and `update_refresh_include`.

### Not Included

- Unattended automation (`run-automation`) build is deferred to v0.15; this release ships design and runbook only.
- Package-registry publish and hosted-service launch are not included in this starter release.

## [0.12.0] - 2026-05-31

### Changed

- Promoted the public starter from `v0.12.0-rc.6` to stable `v0.12.0` after fresh external QA.
- Starter install instructions now point to the stable release archive.
- Public starter wording and executable guards are aligned for clarify markers, issue transition blocking, beginner issue creation/list/use flow, and worker/fallback evidence.

### Verification

- Stable release keeps package-registry and hosted-service publishing out of scope.
- Public starter release is based on the sanitized starter manifest, not the private development issue history.

## [0.12.0-rc.2] - 2026-05-30

### Changed

- README and architecture docs now separate verification layers into `doctor`, `tests`, `evals`, `receipts`, `metrics`, `retro`, and `QA`.
- Runtime setup now explains why `.claude/commands` and `.claude/skills` are present, and how Codex installs the sanitized skills into `~/.codex/skills` or `$CODEX_HOME/skills`.
- File structure docs now show the public-safe scaffold folders for future user issues, docs, artifacts, and sprint state.

### Added

- Empty scaffold markers for `projects/`, `docs/`, `artifacts/`, and `.ai-os/sprints/` in the starter archive.
- Standalone user-facing starter scripts for issue creation, issue listing, evidence listing, startup metrics, and sprint close/retro setup.
- Minimal `tests/starter-smoke.test.mjs` so users can run a starter-level test without inheriting POKit2's private development regression suite.

### Not Included

- Real user issues, specs, memory, run logs, event receipts, metrics, documents, artifacts, or sprint history.
- Full development `scripts/lib`, hooks, provider adapters, and internal regression tests.

## [0.12.0-rc.1] - 2026-05-30

### Added

- Public starter README covering philosophy, architecture, install paths, core skills, issue-driven workflow, verification layers, parallel worker method, memory model, and release boundaries.
- Sanitized starter packaging boundary through `starter-manifest.yaml`.
- Public bootstrap state under `starter/.ai-os/`.
- Public skill and command setup surfaces under `starter/.claude/`.

### Changed

- Starter install commands now point at the public POKit2 repository.
- Starter archive naming now uses the release-candidate version.
- Changelog content is sanitized for public distribution.

### Not Included

- Real user-created issues, specs, sprint memory, run logs, event receipts, metrics, or local handoff state.
- Private development repository links.
- Personal paths, local runtime settings, secrets, package registry publishing, or hosted service claims.

## [0.11.0] - 2026-05-29

### Added

- Issue-driven local harness basics.
- Starter runner and doctor entrypoints.
- Bootstrap `.ai-os` structure.

### Not Included

- Package registry publishing.
- Hosted service launch.
- Private development work history.
