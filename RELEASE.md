# Release Checklist

## Release Identity

- Version: `v0.1.0-rc.1`
- Type: release candidate
- Date: 2026-05-19
- Status before external actions: `release_candidate`

This is not stable `v0.1.0`.

## Artifact

- File: `release/pokit-starter-v0.1.0-rc.1.tar.gz`
- Byte size: `14967`
- SHA-256: `7f8f1ea98065564f5eda9201d15a5983acd6ac6f7efc932f76d6625cf2698ac9`
- Source boundary: `starter-manifest.yaml` include entries only
- Mapping: `starter/.ai-os/**` -> `.ai-os/**`; `starter/scripts/**` -> `scripts/**`

The checksum and byte size must be reverified again immediately before upload.

## Preflight

- [ ] `node scripts/pokit-doctor.mjs`
- [ ] `node scripts/pokit-starter-self-test.mjs`
- [ ] `node --test tests/pokit-starter.test.mjs tests/starter-bundle.test.mjs tests/release-governance.test.mjs`
- [ ] `shasum -a 256 release/pokit-starter-v0.1.0-rc.1.tar.gz`

## External Actions

- [ ] First Git commit scope confirmed
- [ ] Tag name confirmed: `v0.1.0-rc.1`
- [ ] GitHub remote target confirmed
- [ ] Branch pushed to approved remote
- [ ] Tag pushed to approved remote
- [ ] GitHub release created with title `POKit Starter v0.1.0-rc.1`
- [ ] Archive uploaded to the GitHub release
- [ ] Checksum visible in release notes

## Explicit Non-actions

- No package registry publish unless separately confirmed.
- No final `v0.1.0` promotion in this release candidate.
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
