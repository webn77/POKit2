# /pokit.issue

Use this command when the active issue is ready for execution and the user explicitly approves progress.

Recommended flow:

1. Read `.ai-os/current.md`.
2. Confirm the active issue and gate state.
3. Run `node scripts/pokit-runner.mjs "진행해줘"` for the execution preview.
4. Implement the approved issue.
5. Run `node scripts/pokit-doctor.mjs` and focused verification before claiming completion.

Issue execution owns implementation and gate evidence. It does not create or groom new issue definitions.

Public contract tokens: `pokit.issue`, `pokit.backlog`, `routing_decision`, `Execution approval`, `Worker authorization`, `Worker Tasks`, `fan-out`, `Workflow Trace`, `Fallback reason`, `Post-change review`, `Review findings`, `Verification`, `gate evidence`.

After `b` or `자동`, record execution evidence before implementation:

```text
Execution approval: b
Mode: automatic
Worker authorization: authorized
Workers: <worker list> OR Workers: none (narrow fallback)
Fallback reason: <required if no workers>
Post-change review: review_worker
Review findings: none | fixed | deferred-with-reason
```
