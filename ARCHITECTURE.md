# Architecture

POKit2 is a local-first AI work harness. It keeps issue state, sprint decisions, verification evidence, and memory in repository files instead of hidden chat history.

## Source Of Truth

`.ai-os/` is the source of truth.

```text
.ai-os/
|-- current.md
|-- status-board.md
|-- issue-index.md
|-- artifact-index.md
|-- memory/
|-- sprints/
|-- standards/
`-- POK-001.md
```

Key roles:

- `current.md`: active project, issue, gate state, next action.
- `status-board.md`: compact status surface.
- `issue-index.md`: durable issue index.
- `artifact-index.md`: important output index.
- `memory/session/handoff.md`: recovery context.
- `memory/ai-failures/`: failure memory and prevention rules.
- `standards/`: communication, visualization, agent, artifact, and writing rules.

## Runtime Flow

```text
User says "포킷 시작"
  -> runtime reads AGENTS.md
  -> AGENTS.md points to .ai-os/current.md
  -> runner restores active issue and gate state
  -> durable work starts only through a Harness Issue
  -> doctor/tests/evals/receipts/metrics/retro/QA provide evidence
  -> gate evidence and handoff are recorded
```

The starter begins at `POK-001`. A real project should rename the namespace and replace the seed issue with its own first issue.

## Issue Flow

```text
Backlog Refinement
  -> definition readiness
  -> issue execution
  -> verification evidence
  -> gate decision
  -> next issue
```

The main session owns state, integration, verification, metrics, and gate claims. Subagents and workers can produce scoped evidence, but they do not pass gates by themselves.

## Skills And Commands

The starter includes skill and command setup surfaces under `.claude/`.

```text
.claude/
|-- commands/
|   |-- pokit.backlog.md
|   |-- pokit.clarify.md
|   |-- pokit.issue.md
|   `-- pokit.next.md
|
`-- skills/
    |-- pokit-backlog/
    |-- pokit-clarify/
    |-- pokit-issue/
    `-- pokit-next/
```

For Codex, copy `.claude/skills/pokit-*` into `~/.codex/skills/` or `$CODEX_HOME/skills/`.

`.claude/commands` and `.claude/skills` are Claude Code's repo-local discovery surfaces. Codex uses copied skill directories, and Antigravity currently uses `ANTIGRAVITY.md` as its entrypoint unless fresh runtime proof shows native skill discovery.

## Project Scaffold

The starter includes public-safe empty scaffold folders:

```text
projects/
docs/
artifacts/
.ai-os/sprints/
```

These folders are for user-created issues, project documents, generated artifacts, and sprint state after installation. They must not contain development-repo work history in the public starter.

## Starter Runtime Surface

The public starter ships standalone user-facing scripts:

```text
scripts/
|-- pokit-runner.mjs
|-- pokit-doctor.mjs
|-- pokit-issue-create.mjs
|-- pokit-list-issues.mjs
|-- pokit-list-evidence.mjs
|-- pokit-measure-startup.mjs
`-- pokit-sprint-close.mjs

tests/
`-- starter-smoke.test.mjs
```

The development repository has many more `scripts/lib` modules, hooks, adapters, and regression tests. Those are POKit2 development machinery, not required starter payload. Public starter commands are kept standalone so a new user can run doctor, smoke test, evidence listing, metrics measurement, and retro setup without inheriting internal work history.

## Root Folder Policy

Top-level folders are intentional contract surfaces:

- `.githooks/`: local git hook entrypoints for commit, push, and gate hygiene.
- `bin/`: installable CLI entrypoint.
- `contracts/`: durable repository contracts referenced by contract tests.
- `issues/`: project-local starter/runtime issue scaffold for non-dev projects.
- `.pokit/`: local runtime state such as config, sessions, locks, project state, and handoff mirrors. This directory may exist during development but its runtime files are not source artifacts and must stay ignored unless a public example is explicitly whitelisted.

## Verification Layers

POKit2 uses multiple verification layers:

| Layer | Purpose |
|---|---|
| doctor | Structural, state, gate, and contract checks. |
| tests | Regression checks for scripts and documented behavior. |
| evals | Agent judgment checks. |
| receipts | Routing, skill invocation, external action, and release proof evidence. |
| metrics | Token, elapsed time, worker usage, rework, and verification-cost measurement. |
| retro | Issue and sprint learning, plan-vs-actual, failure patterns, and process corrections. |
| QA | Install, first-run, and external/manual user validation. |

## Packaging Boundary

`starter-manifest.yaml` is the public starter packaging boundary. Packaging is include-only.

- Files listed in `include:` are copied.
- `starter/.ai-os/**` is materialized as `.ai-os/**`.
- Public scaffold marker files are materialized under `projects/`, `docs/`, `artifacts/`, and `.ai-os/sprints/`.
- Root development `.ai-os/**` is never copied into the public starter.
- Real issues, specs, sprint memory, run logs, event receipts, private links, personal paths, secrets, local runtime settings, release outputs, and distribution artifacts are excluded.
- Full development `scripts/lib`, hooks, provider adapters, and internal regression tests are excluded unless promoted to a public standalone user command.

## Starter Versus Development Repository

The public POKit2 repository is a starter kit, not the development-history repository.

Included:

- method and harness docs
- seed `.ai-os` state
- first issue seed
- public runtime entrypoints
- core scripts
- skill setup surfaces

Excluded:

- Dongwon's real issue history
- real sprint/release memory
- live handoff/current state
- run metrics and event receipts
- private development repo links
- local agent settings and development-only harness folders

## Release Boundary

A README update or starter archive is not itself a release claim.

Release claims require:

- current release issue
- archive path
- checksum and byte size
- starter self-test
- doctor pass
- diff check
- explicit external action evidence when publishing

External install QA runs after the public starter release candidate is prepared.
