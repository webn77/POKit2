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
