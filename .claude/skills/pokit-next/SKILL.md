# pokit-next

Use this skill when the current issue has passed its gate and the user wants to continue to the next issue.

## Contract

- Read `.ai-os/current.md` first.
- Move only after gate evidence exists.
- `node scripts/pokit-issue-use.mjs` blocks switching away from a non-gate_passed active issue, so transition wording must not imply bypassing the guard.
- Preserve user-created issue state.
- Keep next issue selection explainable.
- Public contract tokens: `pokit.next`, `pokit.issue`, `pokit.backlog`, `gate_passed`, `Verification`, `gate evidence`.

## Workflow

1. Confirm the current gate is passed (`gate_passed`).
2. Inspect the issue index or sprint plan.
3. Select the next ready issue.
4. Update `.ai-os/current.md` and status surfaces.
5. Run `node scripts/pokit-doctor.mjs`.
6. Present the new active issue and next action.
7. Hand execution back to `pokit.issue`; use `pokit.backlog` if the next candidate needs definition changes.

## Output

Return:

- previous issue
- new active issue
- why it was selected
- verification result
