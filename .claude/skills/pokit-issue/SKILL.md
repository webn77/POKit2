# pokit-issue

Use this skill when the active issue is ready and the user explicitly approves execution.

## Contract

- Read `.ai-os/current.md` before durable work.
- Execute only the active issue.
- Do not create, groom, or redefine issues from this skill.
- Keep the main session responsible for state, integration, verification, and gate claims.
- Use workers or subagents only for scoped evidence, not final gate decisions.
- Do not claim done without verification evidence.
- Public contract tokens: `pokit.issue`, `pokit.backlog`, `routing_decision`, `Execution approval`, `Worker authorization`, `Worker Tasks`, `fan-out`, `Workflow Trace`, `Fallback reason`, `Post-change review`, `Review findings`, `Verification`, `gate evidence`.

## Workflow

1. Confirm active issue and gate state from `.ai-os/current.md`.
2. Run `node scripts/pokit-runner.mjs "진행해줘"` for a preview when useful.
3. After `b` or `자동`, treat the input as `Execution approval` and record `Worker authorization`.
4. Decide whether `Worker Tasks` and worker `fan-out` are needed. Worker authorization is not proof that workers actually ran; it only records permission. Do not claim automatic subagent spawn unless a supported runtime adapter exists and leaves execution evidence. If no supported runtime adapter is available, record `Workers: none (narrow fallback)` and `Fallback reason`.
5. Implement the issue in the smallest coherent change.
6. Run `Post-change review` and resolve `Review findings`.
7. Run focused tests or checks.
8. Run `node scripts/pokit-doctor.mjs`.
9. Update issue/status/memory surfaces only when the `Workflow Trace`, `Verification`, and gate evidence support it.

Workflow Trace minimum:

```text
Workers: <worker list> OR Workers: none (narrow fallback)
Fallback reason: <required if no workers>
Post-change review: review_worker
Review findings: none | fixed | deferred-with-reason
```

## Verification Layers

- doctor: structural and state checks
- tests: regression checks
- evals: judgment or workflow scenarios when applicable
- receipts: routing, release, or audit evidence when applicable
- QA: manual or external install checks when applicable

## Output

Return:

- changed files
- verification commands and result
- gate status
- next action
