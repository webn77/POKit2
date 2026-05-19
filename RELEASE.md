# Release Checklist

## Release Identity

- Version: `v0.1.0`
- Type: stable
- Date: 2026-05-19
- Status before external actions: `prerelease_published`

This promotes the public `v0.1.0-rc.1` starter-only prerelease to stable `v0.1.0`.

## Artifact

- File: `release/pokit-starter-v0.1.0.tar.gz`
- Byte size: `15010`
- SHA-256: `153b189483d0625031d097468356706629412fdecdd5bb942f442025389d1565`
- Source boundary: `starter-manifest.yaml` include entries only
- Mapping: `starter/.ai-os/**` -> `.ai-os/**`; `starter/scripts/**` -> `scripts/**`

The checksum and byte size must be reverified again immediately before upload.

## Preflight

- [ ] `node scripts/pokit-doctor.mjs`
- [ ] `node scripts/pokit-starter-self-test.mjs`
- [ ] `node --test tests/pokit-starter.test.mjs tests/starter-bundle.test.mjs tests/release-governance.test.mjs`
- [ ] `shasum -a 256 release/pokit-starter-v0.1.0.tar.gz`
- [ ] Stable archive contents match mapped manifest output
- [ ] Final stable archive safety scan finds no private paths, secrets, run logs, event receipts, or production history

## External Actions

- [ ] Stable promotion commit scope confirmed
- [ ] GitHub remote target confirmed: `dongwonlee222/POKit2`
- [ ] No existing remote `v0.1.0` tag or GitHub release before creation
- [ ] Tag name confirmed: `v0.1.0`
- [ ] Branch pushed to approved remote
- [ ] Tag pushed to approved remote
- [ ] GitHub release created with title `POKit Starter v0.1.0`
- [ ] GitHub release is not marked prerelease
- [ ] Archive uploaded to the GitHub release
- [ ] Checksum visible in release notes

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
