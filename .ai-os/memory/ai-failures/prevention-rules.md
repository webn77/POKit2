# Prevention Rules

Initial token: `no-prior-failure`

## FRG-001 Completion claim requires fresh verification

status: active
severity: high
frequency: 0
last_seen: never
triggers: gate_claim, final_done_claim
read_when: before updating gate_state to pass or claiming done

Instruction:

- Run the relevant verification command fresh.
- Record command, exit code, and result.
- Do not use subagent output alone as completion evidence.
