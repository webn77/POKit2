# /pokit.clarify

Use this command when an issue has unclear scope, vague acceptance criteria, or unresolved decisions.

Recommended flow:

1. Read `.ai-os/current.md`.
2. Mark unclear requirements with `[NEEDS CLARIFICATION:]`.
3. Ask the smallest useful question set.
4. Update the issue only after the answer is clear.
5. Run `node scripts/pokit-doctor.mjs`.

Clarification work reduces ambiguity before execution starts.

Public contract tokens: `pokit.clarify`, `pokit.backlog`, `pokit.issue`, `[NEEDS CLARIFICATION:]`, `Verification`, `gate evidence`.

Use `pokit.backlog` for approved definition changes and return to `pokit.issue` only after blocking ambiguity is resolved.
