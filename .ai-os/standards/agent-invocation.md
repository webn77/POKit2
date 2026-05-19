# Agent Invocation Standard

- Main agent owns intent, scope, approval boundary, and final judgment.
- Subagent output is input evidence, not completion proof.
- Read-only review is safe for early discovery.
- Write-scoped work must declare allowed files.
- Global state and final gate claims stay with the main agent.

## MVP Subtask Boundary

MVP supports `subtask_id` in subagent result payloads. Folder-based `subissue.yaml` remains future scope until a later Harness Issue adds it.

## Runtime Safety

```yaml
subagent_runtime_safety:
  default_wait_seconds: 60
  max_wait_seconds: 180
  close_subagent: "Stop waiting when the max wait is reached, the result is no longer needed, or local verification can replace it."
  retry_with_narrower_scope: "Retry once only with a smaller, concrete task and an explicit output contract."
  local_verification_replacement: "Use direct file inspection, command output, or reproduced checks when they prove the same claim."
  fallback_record_required_fields:
    - reason_for_fallback
    - elapsed_wait_or_timeout_marker
    - replacement_verification_command
    - root_cause_category
    - residual_risk
  root_cause_categories:
    - prompt_scope_too_broad
    - tool_runtime_delay
    - unclear_completion_condition
    - long_running_command
    - missing_output_contract
    - unknown
```
