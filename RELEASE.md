# Release Checklist

## Reusable Release Readiness

Every release Harness Issue must include README freshness in its Acceptance Criteria or Gate section before external release actions.

- [ ] README freshness confirmed against the current starter surface.
- [ ] README install commands point to the public `dongwonlee222/POKit2` repository only.
- [ ] README explains the sanitized starter boundary.
- [ ] README explains issue workflow, verification layers, file structure, runtime setup, project scaffold, and archive instructions.
- [ ] README does not claim package-registry, hosted service, or unproven runtime support.
- [ ] Public starter scan confirms no real issues, specs, memory, run logs, receipts, private paths, secrets, or Dongwon-specific work artifacts are included.
- [ ] Verification layers are separated as doctor, tests, evals, receipts, metrics, retro, and QA.
- [ ] Public scaffold folders contain marker files only, not real project work.
- [ ] Starter ships user-facing standalone scripts for issue creation, issue listing, evidence listing, startup metrics, sprint retro close, and smoke tests.
- [ ] Starter does not ship full development `scripts/lib`, hooks, provider adapters, or internal regression tests.

## Release Identity

- Version: `v0.12.0-rc.6`
- Type: release candidate
- Date: 2026-05-30
- Status before external actions: `pending`

This prepares a public POKit2 starter release candidate. External install QA must run against this artifact before a stable `v0.12.0` claim.

## Artifact

- File: `release/pokit-starter-v0.12.0-rc.6.tar.gz`
- Source boundary: `starter-manifest.yaml` include entries only
- Mapping: `starter/.ai-os/**` -> `.ai-os/**`; `starter/.claude/**` -> `.claude/**`; `starter/scripts/**` -> `scripts/**`
- User runtime: runner, doctor, issue-create, list-issues, list-evidence, measure-startup, sprint-close, starter smoke test
- Public target repository: `dongwonlee222/POKit2`

Recorded immediately before upload:

- SHA-256: `pending`
- Bytes: `pending`
- URL: https://github.com/dongwonlee222/POKit2/releases/tag/v0.12.0-rc.6

## Preflight

- [ ] `node scripts/pokit-create-starter-archive.mjs release/pokit-starter-v0.12.0-rc.6.tar.gz`
- [x] `node scripts/pokit-starter-self-test.mjs`
- [x] Extracted archive runner passes.
- [x] Extracted archive doctor passes.
- [x] Focused starter/public README checks pass.
- [ ] `node --test tests/*.mjs`
- [ ] `node scripts/pokit-doctor.mjs`
- [ ] `git diff --check`
- [x] Archive safety scan finds no private paths, secrets, run logs, event receipts, real issue history, or real sprint memory.

## External Actions

- [ ] Public repository target confirmed: `dongwonlee222/POKit2`
- [ ] No accidental push to private development repo as the public install source.
- [ ] Release candidate tag confirmed.
- [ ] Public README updated.
- [ ] Release archive attached or install path documented.
- [ ] External install test can use the public artifact/path.

## Explicit Non-Actions

- No npm, pip, Homebrew, Docker, or package-registry publish.
- No hosted service launch.
- No claim that Codex, Claude, or Antigravity support is fully proven without fresh runtime proof.
- No stable `v0.12.0` release claim before external install QA.

## GitHub Repository Metadata

Recommended description:

```text
Local-first AI work harness for issue-driven PO/product work.
```

Recommended topics:

```text
ai, product-management, po, agents, local-first, starter, harness, issue-driven
```
