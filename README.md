# POKit Starter

POKit helps AI-assisted product work survive beyond chat history.

Start with natural language. Keep the source of truth in your repo. Stop AI from claiming "done" without evidence.

POKit is a local-first AI Harness for PMs and POs working with Codex, Claude, or Antigravity. It turns requests like "POKit 시작하자", "이 고민을 이슈로 잡아줘", and "완료 가능한지 확인해줘" into a repo-native workflow where issues, evidence, QA, gates, memory, and next actions live under `.ai-os`.

No hosted dashboard, no required SaaS account, no CLI to learn first. Copy the starter into a project, ask naturally, and let `.ai-os` become the source of truth.

## Why POKit

AI product work often breaks in the same places:

- The previous session's context disappears into chat history.
- A todo is checked off, but the real issue state is unclear.
- "Done" means the agent said so, not that evidence was checked.
- The same AI mistake repeats because it never became a prevention rule.
- A PO wants structure without setting up Linear, Slack, GitHub automation, or a hosted tool first.

POKit exists to make that work recoverable, verifiable, and ready for the next session.

```text
Natural language request
  -> Harness Issue
  -> Scoped work
  -> Evidence
  -> Gate
  -> Memory / handoff
  -> Next session can recover
```

## Quick Start

POKit Starter v0.5.0 is distributed as a starter archive. It is not an npm, pip, Homebrew, Docker, or package-registry install.

### Option A: GitHub UI

1. Open the [v0.5.0 release](https://github.com/dongwonlee222/POKit2/releases/tag/v0.5.0).
2. Download `pokit-starter-v0.5.0.tar.gz`.
3. Extract it into a fresh project folder.
4. Ask your agent: `POKit 시작하자`.

### Option B: macOS / Linux

```bash
mkdir my-project
cd my-project
curl -L -o pokit-starter-v0.5.0.tar.gz \
  https://github.com/dongwonlee222/POKit2/releases/download/v0.5.0/pokit-starter-v0.5.0.tar.gz
tar -xzf pokit-starter-v0.5.0.tar.gz
pokit="$PWD"
node scripts/pokit-runner.mjs "$pokit"
node scripts/pokit-doctor.mjs
```

### Option C: Windows PowerShell

```powershell
mkdir my-project
cd my-project
Invoke-WebRequest `
  -Uri "https://github.com/dongwonlee222/POKit2/releases/download/v0.5.0/pokit-starter-v0.5.0.tar.gz" `
  -OutFile "pokit-starter-v0.5.0.tar.gz"
tar -xzf pokit-starter-v0.5.0.tar.gz
$env:pokit = (Get-Location).Path
node scripts/pokit-runner.mjs $env:pokit
node scripts/pokit-doctor.mjs
```

Use PowerShell, not Command Prompt. Modern Windows includes `tar`; if it is missing, extract the archive with 7-Zip and then run the Node checks from the extracted folder.

### Option D: Clone Source Repo

```bash
git clone https://github.com/dongwonlee222/POKit2.git my-project
cd my-project
```

Use clone only if you want the source repository docs and release history. For normal starter use, prefer the release archive.

Expected result:

```text
runner: pass
doctor: pass
active issue: POK-001
```

## Runtime Setup

POKit works from the repo entrypoints (`AGENTS.md`, `CLAUDE.md`, `ANTIGRAVITY.md`) and can also use runtime-specific skills.

### Codex

To make Codex and Codex subagents automatically recognize `pokit-issue`, install a Codex-facing skill:

```bash
mkdir -p ~/.codex/skills/pokit-issue
cp .claude/skills/pokit-issue/SKILL.md ~/.codex/skills/pokit-issue/SKILL.md
```

Then restart Codex or open a fresh `codex exec` session and ask:

```text
POK-100 시작
```

Codex should report that it will use `pokit-issue`. See `docs/runtime/codex.md` for verification and troubleshooting.

## How It Works

```text
You
 |
 |  "POKit 시작하자"
 v
Codex / Claude / Antigravity
 |
 |  reads startup rules
 v
AGENTS.md
 |
 |  points to
 v
.ai-os/current.md
 |
 |  restores
 v
active issue + gate state + next action
 |
 |  works through
 v
.ai-os/POK-001.md
 |
 |  verifies with
 v
runner / doctor / gate evidence
 |
 |  leaves
 v
handoff for the next session
```

## What You Get

```text
project/
|-- AGENTS.md
|     Agent startup rule: read .ai-os/current.md first
|
|-- CLAUDE.md
|     Claude Code entrypoint: imports AGENTS.md
|
|-- ANTIGRAVITY.md
|     Antigravity entrypoint: imports AGENTS.md
|
|-- README.md
|-- ARCHITECTURE.md
|
|-- scripts/
|   |-- pokit-runner.mjs    Startup/state preflight
|   `-- pokit-doctor.mjs    Structure and contract checks
|
`-- .ai-os/
    |-- current.md          Active issue, gate state, next action
    |-- status-board.md     Small human-readable status board
    |-- issue-index.md      Harness Issue list
    |-- artifact-index.md   Important docs and release artifacts
    |-- POK-001.md          First Harness Issue example
    |
    |-- standards/          Communication, artifacts, agents, writing
    |
    `-- memory/
        |-- session/
        |   `-- handoff.md  Recovery note for the next session
        |
        `-- ai-failures/
            |-- failure-index.md style router
            `-- prevention-rules.md
```

## What's New in v0.2.0

v0.2.0 adds PO decision-tracking surfaces while keeping the natural-language entrypoint and `.ai-os` source-of-truth principles unchanged.

### Lifecycle Cards

Five PO/PM response moments now render as open-right ASCII cards:

- `🚀 시작 / 이어서` — session start, restores active issue and next action.
- `🔄 진행` — work in progress.
- `✅ 완료` — work or gate pass, with changes and verification.
- `⚠️ 확인 필요` — blocked, needs approval.
- `🧭 종료` — session close with handoff.

Cards are **display-only**. A card never approves status transitions, includes work in `release-scope.yaml`, or marks a gate passed.

### Sprint Backlog and Release Scope

```text
.ai-os/sprints/<sprint>/
  release-scope.yaml   accepted project-owned issue membership (source of truth)
  backlog.md           read-only derived view grouped by project + status
```

Status enum: `scoped / candidate / accepted / in_progress / gate_passed / dropped`. Issue-and-todo dual lists are replaced with a single POK + status model.

### Agent Profile Dispatcher

POK frontmatter `agent_profile` (`planner / coder / reviewer / data-analyst`) maps to permission level and worker assignment at runtime. Permission, worker kind, and model tier are dispatcher outputs, not POK source-of-truth.

### Runner Commands

Display-only command contracts:

- `/pokit add` — propose a new issue (lifecycle card output).
- `/pokit dispatch <POK-XXX>` — request runner assignment for an issue.
- `/pokit gate <POK-XXX>` — request gate evidence summary.

Commands surface proposed actions. Approval remains with the human PO.

### Startup IO Budget

`runPreflight` now reads ≤5 files at startup (down from ~125). Doctor remains authoritative for explicit CLI, pre-commit, CI, and gate-claim invocations.

### Failure Memory and Test Brittleness

- AFR-003 catches stale derived artifacts (backlog, release-scope, spec, roadmap, session memory) after gate-passed work.
- AFR-004 catches hardcoded active-issue references in tests. The `tests/lib/test-fixtures.mjs` helper provides dynamic reads so gate advances do not break the suite.

## Core Loop

```text
Start
  |
  v
Read .ai-os context
  |
  v
Pick or create a Harness Issue
  |
  v
Do scoped work
  |
  v
Record evidence
  |
  v
Run gate check
  |
  +-- fail --> report blocker + next action
  |
  +-- pass --> update memory + handoff
  |
  v
Next session can recover
```

## Core Rules

- `.ai-os` is the source of truth.
- Durable work needs a Harness Issue.
- Completion claims need fresh verification evidence.
- Subagent output is input evidence, not final proof.
- Failure patterns should become prevention rules for future runs.
- Public starter content must not include secrets, personal paths, private company assumptions, production history, run logs, or event receipts.

Code management rules:

- issue-per-durable-change: code, docs, contract, and release work belong to one Harness Issue.
- small scoped changes: keep each change reviewable.
- tests before gate claim: verify before saying a behavior, contract, or release is done.
- no unrelated refactor: avoid cleanup that is not needed for the active issue.
- public-safe starter content: keep starter files free of secrets, private paths, company assumptions, production history, run logs, and event receipts.
- review evidence before completion: delegated agent output is evidence, not the final completion proof.

## Boundaries

POKit Starter is intentionally small.

Included:

- Local-first `.ai-os` starter structure
- Natural-language startup path for Codex/Claude/Antigravity
- Single-file Harness Issue example
- Runner and doctor helper scripts
- Session handoff and failure-memory entry point
- Lifecycle card response standard (v0.2.0)
- Sprint backlog and release-scope artifacts (v0.2.0)
- Agent profile dispatcher and runner command contracts (v0.2.0)

Not included:

- Hosted SaaS
- Web dashboard
- Required Linear, GitHub, Slack, Jira, or Notion integration
- Package registry distribution
- Semantic search
- Automatic multi-agent orchestration
- First-class epic artifact support

## Development

If you have cloned the source repository, run the full test suite and doctor check with:

```bash
npm test
npm run doctor
```

These commands require Node.js 18+ and no additional dependencies. The test suite runs 240+ unit tests with the built-in `node:test` runner. CI runs the same commands on every push and pull request.

Branch protection note: to require CI passage before merging, enable branch protection rules in GitHub → Settings → Branches → Require status checks → select the `test` job.

**starter-manifest decision (POK-073):** `package.json` is not included in the starter distribution. Starter users may already have a `package.json` in their project; including one would risk overwriting it on update. The `npm test` / `npm run doctor` scripts are documented here and in `ARCHITECTURE.md` for contributors and source-repo users only.

## More Docs

- `ARCHITECTURE.md`: structure, runtime flow, and packaging boundary
- `docs/runtime/codex.md`: Codex skill setup and verification
- `CHANGELOG.md`: public version history
- `RELEASE.md`: stable release checklist and evidence
- `LICENSE`: MIT license
