# /pokit.next

Use this command after the current issue has passed its gate and the user asks to continue.

Recommended flow:

1. Read `.ai-os/current.md`.
2. Confirm `gate_state` is passed.
3. Select the next ready issue from the issue index or sprint plan.
4. Update `.ai-os/current.md` and status surfaces.
5. Run `node scripts/pokit-doctor.mjs`.

Next work changes focus. It does not bypass gate evidence.

Public contract tokens: `pokit.next`, `pokit.issue`, `pokit.backlog`, `gate_passed`, `Verification`, `gate evidence`.

Only transition after `gate_passed`; once the new active issue is selected, execution belongs to `pokit.issue`.
