# Failure Index

Normal before-work routing reads this router first. Read `ai-failure-log.md` only when creating, auditing, or deprecating rules.

Required token for first issue type: `no-prior-failure`.

Prevention rules: `.ai-os/memory/ai-failures/prevention-rules.md`
AI failure log: `.ai-os/memory/ai-failures/ai-failure-log.md`

## Router

| Trigger | Rule | Status | Severity | Read When | Frequency | Last Seen |
|---|---|---|---|---|---:|---|
| gate_claim | FRG-001 | active | high | before updating gate_state to pass or claiming done | 0 | never |
