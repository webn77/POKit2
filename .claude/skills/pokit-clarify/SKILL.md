# pokit-clarify

Use this skill when issue requirements, acceptance criteria, or gate expectations are ambiguous.

## Contract

- Read `.ai-os/current.md` first.
- Prefer the smallest useful clarification.
- Mark unresolved ambiguity with `[NEEDS CLARIFICATION:]`.
- Do not execute unclear work as if it were ready.
- Run doctor after updating issue text.
- Public contract tokens: `pokit.clarify`, `pokit.backlog`, `pokit.issue`, `[NEEDS CLARIFICATION:]`, `Verification`, `gate evidence`.

## Workflow

1. Inspect the active issue and nearby status files.
2. Identify unclear nouns, missing owners, missing evidence, vague verbs, or untestable acceptance criteria.
3. Ask focused questions or propose precise wording.
4. Update the issue only after user approval.
5. Run `node scripts/pokit-doctor.mjs`.
6. Do not route to `pokit.issue` until required clarification is resolved; use `pokit.backlog` for definition changes.

## Output

Return:

- clarified scope
- remaining ambiguity, if any
- verification evidence
- next recommended skill
- gate evidence boundary
