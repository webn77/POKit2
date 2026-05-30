# POKit2

POKit2 is a local-first AI work harness for PO-led product work and PO-led AI product work.

It turns rough requests into issue-driven work, keeps state in your repository, and blocks "done" claims until there is fresh evidence.

```text
request
  -> backlog refinement
  -> Harness Issue
  -> scoped execution
  -> verification evidence
  -> gate decision
  -> memory / handoff
  -> next issue
```

POKit2 is not a hosted dashboard and it is not a package-registry install. The public repository is a sanitized starter kit: it contains the method, harness, seed state, scripts, and setup surfaces needed to start a new project. It does not contain the development repository's real issues, specs, sprint memory, run logs, receipts, private links, or personal paths.

## Quick Install

### Option A. GitHub Release Archive

Use this for a fresh project.

```bash
mkdir my-project
cd my-project

VERSION=v0.12.0-rc.5
curl -L -o pokit-starter.tar.gz \
  "https://github.com/dongwonlee222/POKit2/releases/download/${VERSION}/pokit-starter-${VERSION}.tar.gz"

tar -xzf pokit-starter.tar.gz
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

Expected result:

```text
runner: pass
doctor: pass
active project: common
active issue: none yet
```

### Option B. Clone The Public Starter

Use this if you want the public starter files as a Git repository.

```bash
git clone https://github.com/dongwonlee222/POKit2.git my-project
cd my-project
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

### Option C. Manual Copy

Use manual copy only when you understand the starter boundary.

Copy the public starter files into your project, then run:

```bash
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

Do not copy a development repository's live `.ai-os` directory into a new project. That would copy someone else's issues, memory, run logs, and gate history.

## Runtime Setup

The starter includes repo entrypoints for agent runtimes:

```text
AGENTS.md
CLAUDE.md
ANTIGRAVITY.md
```

It also includes the POKit skill surfaces under `.claude/skills` and `.claude/commands`.

`.claude/commands` and `.claude/skills` are Claude Code's repo-local command and skill surfaces. They are present because Claude Code can discover them directly from the project.

For Codex, install the skills into your Codex skill directory:

```bash
mkdir -p ~/.codex/skills
cp -R .claude/skills/pokit-* ~/.codex/skills/
```

If you use a custom `CODEX_HOME`:

```bash
mkdir -p "$CODEX_HOME/skills"
cp -R .claude/skills/pokit-* "$CODEX_HOME/skills/"
```

Then restart Codex or open a fresh session from the project root.

For Claude Code, keep `.claude/commands` and `.claude/skills` in the repository and open Claude Code from the project root.

For Antigravity, use `ANTIGRAVITY.md` as the entrypoint. Do not assume native POKit skill discovery there until you have runtime-specific proof.

Runtime support should be claimed only after real discovery, trigger, and execution proof. Skill files are setup surfaces; gate completion still requires fresh verification evidence.

## First Run

Start with natural language:

```text
포킷 시작
```

The runner restores:

- active project
- active issue
- gate state
- next action
- startup context budget

POKit2 is an issue-driven local AI harness: durable work starts from a Harness Issue, moves through verification, and only then reaches a gate decision.

The starter begins with the default `common` project and `COM` namespace. Create your first issue without choosing an ID:

```bash
node scripts/pokit-issue-create.mjs --title "첫 작업"
node scripts/pokit-list-issues.mjs
node scripts/pokit-issue-use.mjs COM-001
node scripts/pokit-doctor.mjs
```

To use your own project and issue counter:

```bash
node scripts/pokit-project-create.mjs --key my-project --name "My Project" --namespace MYP
node scripts/pokit-project-use.mjs my-project
node scripts/pokit-issue-create.mjs --title "첫 작업"
node scripts/pokit-issue-use.mjs MYP-001
node scripts/pokit-doctor.mjs
```

Manual `--id` remains available as an explicit override, but the beginner flow should let the active project choose the next issue number.

## POKit Principles

POKit2 favors issue-driven work, issue-per-durable-change, small scoped changes, tests before gate claim, no unrelated refactor, public-safe starter content, and review evidence before completion.

## Philosophy

POKit2 is built around a few rules:

- `.ai-os` is the source of truth.
- Durable work belongs to a Harness Issue.
- A gate is not passed because an agent says it is done.
- Fresh verification evidence is required before completion claims.
- The PO owns scope, approval, and release claims.
- Subagent output is input evidence, not final proof.
- Failure patterns should become future prevention rules.
- Public starter content must stay free of private work history.

The goal is not ceremony. The goal is to keep AI work recoverable, inspectable, and hard to falsely complete.

## The PO Workflow

```text
request -> Backlog Refinement -> first recommended task -> readiness -> issue execution -> gate evidence
```

The PO can always choose "not now" when a recommendation is not ready.

## How POKit2 Works

```text
User
  |
  |  "포킷 시작"
  v
Agent runtime
  |
  |  reads
  v
AGENTS.md
  |
  |  restores
  v
.ai-os/current.md
  |
  |  follows
  v
Harness Issue
  |
  |  verifies
  v
doctor / tests / evals / receipts / metrics / retro / QA
  |
  |  records
  v
memory + handoff
```

## File Structure and Architecture

```text
project/
|-- AGENTS.md
|-- CLAUDE.md
|-- ANTIGRAVITY.md
|-- README.md
|-- ARCHITECTURE.md
|-- RELEASE.md
|-- pokit.config.yaml
|
|-- .claude/
|   |-- commands/
|   `-- skills/
|
|-- scripts/
|   |-- pokit-runner.mjs
|   |-- pokit-doctor.mjs
|   |-- pokit-project-create.mjs
|   |-- pokit-project-use.mjs
|   |-- pokit-issue-create.mjs
|   |-- pokit-issue-use.mjs
|   |-- pokit-list-issues.mjs
|   |-- pokit-list-evidence.mjs
|   |-- pokit-measure-startup.mjs
|   `-- pokit-sprint-close.mjs
|
|-- tests/
|   `-- starter-smoke.test.mjs
|
|-- projects/
|   `-- <project>/
|       `-- issues/
|
|-- docs/
|   `-- <project>/
|
|-- artifacts/
|   `-- <project>/
|
`-- .ai-os/
    |-- current.md
    |-- status-board.md
    |-- issue-index.md
    |-- artifact-index.md
    |-- memory/
    |-- sprints/
    |-- standards/
    `-- projects.yaml
```

Development repositories may use project-owned issue paths such as `projects/<project>/issues/POK-XXX.md`. The sanitized starter ships only empty scaffold markers for `projects/`, `docs/`, `artifacts/`, and `.ai-os/sprints/`; your real issues, documents, and outputs are created after installation.

The starter intentionally does not ship POKit2's full development `scripts/lib` or internal regression suite. It ships standalone user-facing CLI scripts only:

| Command | User Purpose |
|---|---|
| `node scripts/pokit-runner.mjs "포킷 시작"` | Restore current issue and lifecycle card. |
| `node scripts/pokit-doctor.mjs` | Check state, structure, gate, and starter contract drift. |
| `node scripts/pokit-project-create.mjs --key my-project --name "My Project" --namespace MYP` | Create a project with its own namespace, folders, and counter. |
| `node scripts/pokit-project-use.mjs my-project` | Switch the active project. |
| `node scripts/pokit-issue-create.mjs --title "..."` | Create the next issue in the active project and write a local runtime receipt. |
| `node scripts/pokit-issue-use.mjs COM-001` | Make an issue active so runner and doctor use it. |
| `node scripts/pokit-list-issues.mjs` | List local Harness Issues. |
| `node scripts/pokit-list-evidence.mjs` | Inspect local event/receipt evidence. |
| `node scripts/pokit-measure-startup.mjs` | Estimate startup/work-read token budget. |
| `node scripts/pokit-sprint-close.mjs v0.1.0` | Archive handoff and create a retro template. |
| `node --test tests/*.mjs` | Run the starter smoke test, not the private development regression suite. |

## Core Skills

| Skill | Purpose |
|---|---|
| `pokit.backlog` | Turn rough requests into work candidates, readiness, questions, and first recommended issue. |
| `pokit.clarify` | Ask focused questions when acceptance criteria or scope are unclear. |
| `pokit.issue` | Execute one ready Harness Issue with workflow trace, verification, and gate evidence. |
| `pokit.next` | Move from a `gate_passed` issue to the next active issue. |

Slash-command equivalents:

- `/pokit.backlog`
- `/pokit.clarify`
- `/pokit.issue`
- `/pokit.next`

The user-facing flow is intentionally small:

```text
rough request -> Backlog Refinement -> issue execution -> gate -> next issue
```

## Backlog Refinement

Backlog Refinement turns rough requests into work candidates, readiness decisions, and the first recommended task before execution starts.

## Lifecycle Cards and ASCII Visualization

Cards are display-only. They help the PO see current state, next action, and approval boundaries, but they do not approve status transitions, release-scope inclusion, durable work, external writes, or gate pass.

## Core Features

- Issue-driven work with project-owned Harness Issues.
- Natural-language startup and progress phrases.
- Display-only lifecycle cards for PO decisions.
- Definition readiness before execution.
- Workflow Trace for execution evidence.
- Memory and handoff for session recovery.
- Sprint and release scope files for planning.
- Doctor checks for structural and gate drift.
- Receipts for routing, invocation, and release evidence.
- Metrics for token, time, worker, and verification cost analysis.
- Retro loops for issue and sprint learning.
- Optional worker fan-out for parallel subagent work.

## Verification Layers

POKit2 uses several verification layers because each layer catches a different class of failure.

| Layer | What It Protects |
|---|---|
| `doctor` | State, structure, gate, and contract drift. |
| `tests` | Code and documented behavior regressions. |
| `evals` | Agent judgment failures that tests cannot inspect directly. |
| `receipts` | Who/what/when execution evidence: routing, skill invocation, external actions, and release proof. |
| `metrics` | Token, elapsed time, worker usage, rework, and verification-cost measurement. |
| `retro` | Issue and sprint learning: plan-vs-actual, failure patterns, and next-process corrections. |
| `QA` | Install, first-run, and external/manual user validation. |

## Issue-Driven Methodology

A Harness Issue is the unit of durable work.

It usually records:

- problem and goal
- evidence
- acceptance criteria
- QA plan
- gate evidence
- workflow trace
- memory

This gives the PO a simple question at every step: "Is this issue ready, and what evidence says it is done?"

## Parallel Workers And Model Routing

POKit2 can split work into Worker Tasks when the issue is large enough and scopes are disjoint.

```text
main session
  |-- docs_worker
  |-- code_worker
  |-- review_worker
  `-- qa_worker
```

The main session still owns integration, state, verification, metrics, and gate claims. Workers help produce evidence; they do not independently pass gates.

POKit2 can also route worker plans by runtime and model capability. For example, a small issue can stay with a single agent, while larger disjoint work can fan out to multiple workers.

## Memory Model

POKit2 separates memory by purpose:

- `current.md`: the active work surface.
- `status-board.md`: a short status view.
- `memory/session/handoff.md`: recovery context for the next session.
- `memory/session/session-summary.md`: human-readable close snapshot.
- `memory/ai-failures/`: reusable failure patterns and prevention rules.
- `issue-index.md` and `artifact-index.md`: navigable project memory.

The starter includes only seed memory. Real project memory is created by your project after installation.

## Sprint And Release Flow

```text
scope spec
  -> accepted candidates
  -> issue execution
  -> gate evidence
  -> retro / release notes
  -> starter or release artifact
```

Release claims should be explicit. README refresh work does not create a release, tag, upload, package publish, or external deployment. Each release issue should include README freshness in its Acceptance Criteria or Gate section.

## Sanitized Starter Boundary

Included:

- public README and architecture docs
- seed `.ai-os` state
- core standards
- default project registry with `common / COM`
- runner and doctor scripts
- required config
- runtime skill setup surfaces
- public scaffold folders for future project issues, docs, artifacts, and sprint state

Excluded:

- real user-created issues
- real specs and sprint/release work memory
- current development handoff state
- run metrics
- preexisting event receipts from the development repository
- private repo links
- personal paths
- secrets
- `.codex`, local `.claude` settings, `.modu-harness`

After install, your own commands may create local runtime receipts under `.ai-os/events/`; those belong to your project and are not shipped from this development repository.
- release/dist outputs
- full POKit2 development `scripts/lib`
- full internal regression `tests`

This repository is the starter surface, not the private development history.

## Limitations

POKit2 currently does not provide:

- hosted SaaS
- web dashboard
- npm, pip, Homebrew, Docker, or package-registry install
- required Linear, Slack, Jira, Notion, or GitHub adapter
- semantic/vector search as a shipped starter feature
- a claim that every runtime is fully proven without fresh proof artifacts

## For Contributors

Source-repo contributors can run:

```bash
node --test tests/*.mjs
node scripts/pokit-doctor.mjs
git diff --check
```

The starter archive is built from `starter-manifest.yaml` include entries only. `starter/.ai-os/**` maps to `.ai-os/**`, and listed script files map to `scripts/**`.

## More Docs

- `ARCHITECTURE.md`: architecture and packaging boundary
- `RELEASE.md`: release readiness checklist
- `CHANGELOG.md`: version history
- `LICENSE`: MIT license
