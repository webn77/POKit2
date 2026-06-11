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

POKit2 is not a hosted dashboard and it is not a package-registry install. It is shipped as an installable starter archive: unpack it into a fresh project, run the local starter scripts, and keep the resulting state inside that project. The public repository is a sanitized starter kit: it contains the method, harness, seed state, scripts, and setup surfaces needed to start a new project. It does not contain the development repository's real issues, specs, sprint memory, run logs, receipts, private links, or personal paths.

## Quick Install

### Option A. npx One-Line Installer (Recommended)

The fastest way to install the v0.18.0 starter into a fresh project:

```bash
mkdir my-project && cd my-project
npx github:dongwonlee222/POKit2
```

This installs all starter files into the current directory. If any file already exists, the installer stops without overwriting anything — use `--force` only when you intentionally want to overwrite. After install, run the doctor to confirm the setup:

```bash
node scripts/pokit-doctor.mjs
```

Then open the project in Claude Code and start with:

```text
포킷 시작
```

### Option B. Local v0.18 Starter Archive

Use this when you have this repository locally and want to install the current v0.18 starter into a fresh project.

```bash
mkdir my-project
tar -xzf /path/to/pokit2/release/pokit-starter-v0.18.0.tar.gz -C my-project

cd my-project
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
node --test tests/starter-smoke.test.mjs
```

Expected result:

```text
runner: pass
doctor: pass
starter smoke: pass
active project: common
active issue: none yet
```

### Option C. GitHub Release Archive

Use this after a v0.18 GitHub release has been explicitly published.

```bash
mkdir my-project
cd my-project

VERSION=v0.18.0
curl -L -o pokit-starter.tar.gz \
  "https://github.com/dongwonlee222/POKit2/releases/download/${VERSION}/pokit-starter-${VERSION}.tar.gz"

tar -xzf pokit-starter.tar.gz
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

As of the v0.18 release, the archive exists at `release/pokit-starter-v0.18.0.tar.gz` and is published through the public GitHub release after PO approval.

### Option D. Clone The Public Starter

Use this after the public repository has been updated to the desired release.

```bash
git clone https://github.com/dongwonlee222/POKit2.git my-project
cd my-project
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

### Option E. Manual Copy

Use manual copy only when you understand the starter boundary.

Copy the public starter files into your project, then run:

```bash
node scripts/pokit-runner.mjs "포킷 시작"
node scripts/pokit-doctor.mjs
```

Do not copy a development repository's live `.ai-os` directory into a new project. That would copy someone else's issues, memory, run logs, and gate history.

### Optional Local CLI Link

If you are working from a source checkout and want the `pokit` command locally, link the package from the repository root:

```bash
npm link
pokit doctor
```

This is local-only convenience. It is not an npm package-registry publish.

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

New to POKit? Start with the beginner onboarding docs:

- [POKit 개념 한눈에 보기](docs/onboarding/pokit-concepts-for-users.md)
- [POKit 흐름 한 장](docs/onboarding/pokit-flow-overview.md)

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

From there, the normal work loop is:

```text
포킷 시작
  -> create or select an issue
  -> ask the agent to refine or execute
  -> verify with doctor/tests/smoke
  -> pass the gate only after evidence exists
  -> move to the next issue
```

The source repository also has a richer local `pokit` package surface for development and smoke testing. The public starter archive intentionally ships standalone starter scripts first; package-registry publishing remains out of scope until separately approved.

## Concept Quick Map

| Concept | What it means for a user |
|---|---|
| Project | A named work area with its own issue counter and folders. The starter begins with `common / COM`. |
| Issue | The unit of durable work: goal, scope, acceptance criteria, verification, and gate evidence. |
| Session | One agent run or work attempt against an issue. Multiple sessions can exist conceptually, but integration remains explicit. |
| Worktree | An isolated Git checkout for parallel or non-main work. The public starter explains the model; advanced worktree orchestration is a source-repo/development surface. |
| Integration | The main session reviews and accepts/rejects work before state or gate claims move forward. |
| Overview | A read-only project/status view. In the starter, use `current.md`, `status-board.md`, and `pokit-list-issues`; source-repo overview tooling is not claimed as a packaged public command until it is shipped. |
| Push confirmation | POKit does not automatically publish or push. External writes, tags, GitHub releases, and package publishing need explicit PO approval. |
| Session guidance card | After startup or at each step, the runner prints a guidance card (work / integration / status) showing where you are and what to do next. Cards are display-only; they do not approve transitions. |
| Safe-step automation (🟢/🔴) | Reversible, evidence-leaving steps (code change, verify, commit) proceed automatically 🟢. Risky or external steps (push, gate pass) always require your explicit approval 🔴. Push always needs PO confirmation. |
| Starter safety floor | The starter now ships an active-issue guard: if you try to make a durable file change without an active issue, the action is blocked and a draft issue card is offered automatically. Works with any issue-id prefix, not just `COM-`. Installed via `install-safety-floor-settings.mjs` using non-destructive merge. |
| Targeted preflight | Issue execution now checks the active issue shape before worker fan-out, so malformed Worker Tasks or missing execution sections fail early. |
| Automation MVP | Local automations can be registered, previewed, dry-run once with a receipt, and disabled. Fully unattended schedules and release/push actions remain out of scope. |
| Config/state boundary | Project config, local secrets, user defaults, project state, and issue numbering are separated so automation and scripts do not treat state files as config. |
| Multi-session coordination | When multiple worktrees or sessions are open, `/pokit.next` is registry-aware and will not double-claim a candidate another session is already working on. Sessions auto-register on startup. Commit/push guards are role-based; local hooks are advisory (bypassable with `--no-verify`); authoritative enforcement is server-side. |
| Antigravity runtime | POKit's four `/pokit.*` skills can be emulated on the Antigravity runtime via a `define_subagent`-based contract. Entry point is `ANTIGRAVITY.md`. Official Antigravity runtime support is currently deferred (smoke-tested PASS; full runtime-proof artifacts not yet captured). Do not assume native skill discovery there until runtime-specific proof exists. |

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
|   |-- skills/
|   `-- settings.json
|
|-- scripts/
|   |-- pokit-runner.mjs
|   |-- pokit-doctor.mjs
|   |-- pokit-project-create.mjs
|   |-- pokit-project-use.mjs
|   |-- pokit-issue-create.mjs
|   |-- pokit-issue-use.mjs
|   |-- pokit-list-issues.mjs
|   |-- pokit-list-evidence-raw.mjs
|   |-- pokit-measure-startup.mjs
|   |-- pokit-sprint-close.mjs
|   |-- active-issue-guard.mjs
|   |-- install-safety-floor-settings.mjs
|   `-- hooks/
|       |-- require-active-issue-before-mutation.mjs
|       `-- session-start.mjs
|
|-- tests/
|   |-- starter-smoke.test.mjs
|   `-- pokit-doctor-binding.test.mjs
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
| `node scripts/pokit-list-evidence-raw.mjs` | Inspect local event/receipt evidence (raw dump). |
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
- local agent settings and development-only harness folders

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
