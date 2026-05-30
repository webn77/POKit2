# /pokit.backlog

Use this command when a request needs issue creation, grooming, definition refinement, acceptance criteria, or readiness changes.

Recommended flow:

1. Read `.ai-os/current.md`.
2. Inspect the relevant issue or create a recommendation.
3. Explain the proposed issue change before mutating files.
4. Apply only the approved change.
5. Run `node scripts/pokit-doctor.mjs`.

Backlog work prepares issues. It does not claim execution gates.

Public contract tokens: `pokit.backlog`, `pokit.issue`, `routing_decision`, `PO approval`, `mutation receipt`, `Verification`, `gate evidence`.

Before durable mutation, confirm PO approval and leave a mutation receipt for issue creation, issue modification, grooming, definition changes, or readiness transitions.
