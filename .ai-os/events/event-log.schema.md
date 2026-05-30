# Event Log Schema

This is a starter schema scaffold, not an event receipt. Starter archives must
not include source-project runtime receipts.

When real project events exist, write JSONL receipts to `event-log.jsonl` with
one JSON object per line.

Common receipt fields:

- `event_type`
- `event_name`
- `issue_id`
- `emitted_at`
- `provider`
- `payload`

Supported public receipt names:

- `routing_decision`: proves the agent selected the public skill surface before
  durable work. Payload should include `selected_skill`, `request_class`, and
  `decision_source`.
- `issue_execution_entered`: proves `/pokit.issue` execution flow was entered
  before implementation.
- `post_runner_execution_lock`: proves `b` / `자동` approval locked the active
  issue into execution mode. Payload should include `mode`,
  `worker_authorization`, and `selected_option`.
- `issue_authored`: proves `/pokit.backlog` authored or changed an issue after
  PO approval.
