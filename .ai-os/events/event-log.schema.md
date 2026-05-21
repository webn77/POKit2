# Event Log Schema

This is a starter schema scaffold, not an event receipt.

When real project events exist, write JSONL receipts to `event-log.jsonl` with one JSON object per line.

Required fields:

- `event_type`
- `issue_id`
- `run_id`
- `created_at`
- `summary`

Starter archives must not include source-project event receipts.
