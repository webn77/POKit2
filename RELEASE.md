# Release Checklist

## Release Identity

- Version: `v0.1.0`
- Type: stable
- Date: 2026-05-19
- Status before external actions: `prerelease_published`

This promotes the public `v0.1.0-rc.1` starter-only prerelease to stable `v0.1.0`.

## Artifact

- File: `release/pokit-starter-v0.1.0.tar.gz`
- Byte size: `15492`
- SHA-256: `844b548a8ff920850d911f2e0e4991103c7b9c10ea5acd07407107826a730d9d`
- Source boundary: `starter-manifest.yaml` include entries only
- Mapping: `starter/.ai-os/**` -> `.ai-os/**`; `starter/scripts/**` -> `scripts/**`

The checksum and byte size must be reverified again immediately before upload.

## Preflight

- [x] `node scripts/pokit-doctor.mjs`
- [x] `node scripts/pokit-starter-self-test.mjs`
- [x] `node --test tests/pokit-starter.test.mjs tests/starter-bundle.test.mjs tests/release-governance.test.mjs`
- [x] `shasum -a 256 release/pokit-starter-v0.1.0.tar.gz`
- [x] Stable archive contents match mapped manifest output
- [x] Final stable archive safety scan finds no private paths, secrets, run logs, event receipts, or production history

## External Actions

- [x] Stable promotion commit scope confirmed
- [x] GitHub remote target confirmed: `dongwonlee222/POKit2`
- [x] No existing remote `v0.1.0` tag or GitHub release before creation
- [x] Tag name confirmed: `v0.1.0`
- [x] Branch pushed to approved remote
- [x] Tag pushed to approved remote
- [x] GitHub release created with title `POKit Starter v0.1.0`
- [x] GitHub release is not marked prerelease
- [x] Archive uploaded to the GitHub release
- [x] Checksum visible in release notes

## Explicit Non-actions

- No package registry publish unless separately confirmed.
- No full development repo publish.
- No hosted service launch.
- No external adapter launch.
- No `released` state claim before remote, tag, release, and upload evidence exists.

## GitHub Repository Metadata

Recommended description:

```text
Local-first PM/PO AI Harness using .ai-os as source of truth.
```

Recommended topics:

```text
ai, product-management, po, agent, local-first, starter, harness
```
