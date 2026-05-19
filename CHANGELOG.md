# Changelog

## [Unreleased]

- Stable `v0.1.0` release is not yet cut.
- Package registry publish is not included.

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
