# Writing Style Standard

## Language Policy

```yaml
language_policy:
  internal_contract: en
  file_names: en
  frontmatter_keys: en
  enum_values: en
  user_facing_response: ko-KR
  user_facing_artifacts: ko-KR
  default_locale: ko-KR
```

## Rules

- Use English for machine-validated structure.
- Use Korean for PO-facing explanations, decisions, summaries, reports, and chat responses.
- Avoid company-internal names, local absolute paths, private SaaS assumptions, or personal workflow assumptions in public starter content.
- Write starter text so a new PO can copy it into a fresh project and understand the next action without prior context.
