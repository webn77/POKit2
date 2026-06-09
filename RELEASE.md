# Release Checklist

## Reusable Release Readiness

Every release Harness Issue must include README freshness in its Acceptance Criteria or Gate section before external release actions.

- [x] README freshness confirmed against the current starter surface.
- [x] README install commands point to the public `dongwonlee222/POKit2` repository only.
- [x] README explains the sanitized starter boundary.
- [x] README explains issue workflow, verification layers, file structure, runtime setup, project scaffold, and archive instructions.
- [x] README does not claim package-registry, hosted service, or unproven runtime support.
- [x] Public starter scan confirms no real issues, specs, memory, run logs, receipts, private paths, secrets, or Dongwon-specific work artifacts are included.
- [x] Verification layers are separated as doctor, tests, evals, receipts, metrics, retro, and QA.
- [x] Public scaffold folders contain marker files only, not real project work.
- [x] Starter ships user-facing standalone scripts for issue creation, issue listing, evidence listing, startup metrics, sprint retro close, and smoke tests.
- [x] Starter does not ship full development `scripts/lib`, hooks, provider adapters, or internal regression tests.

## Release Identity

- Version: `v0.16.0`
- Type: public starter archive / GitHub release
- Date: 2026-06-09
- Status: `v0.16 public GitHub release/tag/public push completed on 2026-06-09 after PO approval; package-registry publish NOT performed`

This records the v0.16.0 public starter install archive after handoff rotation policy, pokit-issue-create project-default fix, and multi-session reliability convergence work. External publish (GitHub tag, public repo push, archive upload) was completed after PO approval for this release execution.

## Artifact

- File: `release/pokit-starter-v0.16.0.tar.gz`
- Source boundary: `starter-manifest.yaml` include entries only
- Mapping: `starter/.ai-os/**` -> `.ai-os/**`; `starter/.claude/**` -> `.claude/**`; `starter/scripts/**` -> `scripts/**`
- User runtime: runner, doctor, issue-create, list-issues, list-evidence, measure-startup, sprint-close, starter smoke test, doctor-binding test
- Public target repository: `dongwonlee222/POKit2`

Recorded in the release evidence outside the starter archive (populated after archive generation):

- SHA-256: recorded in `release/v0.16.0.md` after archive generation (kept out of this archive-shipped file to avoid a self-referential digest)
- Bytes: recorded in `release/v0.16.0.md` after archive generation
- Public URL: `https://github.com/dongwonlee222/POKit2/releases/tag/v0.16.0`

## Preflight

- [x] `node scripts/pokit-create-starter-archive.mjs release/pokit-starter-v0.16.0.tar.gz` (self-test embedded: runner, doctor, parity, script sentinels, sensitive-content scan — all pass)
- [x] `node scripts/pokit-starter-self-test.mjs` (run via archive build)
- [x] Extracted archive runner passes.
- [x] Extracted archive doctor passes (fail 0).
- [x] Extracted archive smoke tests pass.
- [x] Focused starter/public README checks pass.
- [x] `npm test` or equivalent full root suite.
- [x] `node scripts/pokit-doctor.mjs` (active release-issue checks pass).
- [x] `git diff --check` (clean).
- [x] Archive safety scan finds no private paths, secrets, run logs, event receipts, real issue history, or real sprint memory.

## External Actions

- [x] Public repository target confirmed: `dongwonlee222/POKit2`
- [x] No accidental push to private development repo as the public install source.
- [x] Stable public tag confirmed: `v0.16.0`
- [x] Public README updated.
- [x] Release archive install path documented locally in README.
- [x] Public GitHub release archive uploaded with matching digest.
- [ ] Work repo GitHub release archive uploaded with matching digest.
- [x] External install surface points to the published v0.16 artifact/path.

## Explicit Non-Actions

- No npm, pip, Homebrew, Docker, or package-registry publish.
- No hosted service launch.
- No claim that Codex, Claude, or Antigravity support is fully proven without fresh runtime proof.
- No stable runtime support claim beyond the verified local starter smoke path.

## GitHub Repository Metadata

Recommended description:

```text
Local-first AI work harness for issue-driven PO/product work.
```

Recommended topics:

```text
ai, product-management, po, agents, local-first, starter, harness, issue-driven
```
