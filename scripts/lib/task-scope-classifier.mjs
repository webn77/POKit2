export const TASK_SCOPE = Object.freeze({
  READ_ONLY: 'read_only',
  WRITE_SCOPED: 'write_scoped',
  UNKNOWN: 'unknown',
});

const EXPLICIT_READ_ONLY = new Set([
  'read_only',
  'read-only',
  'readonly',
]);

const EXPLICIT_WRITE_SCOPED = new Set([
  'write_scoped',
  'write-scoped',
  'write',
  'edit',
  'implementation',
  'code',
]);

const READ_ONLY_RE =
  /\b(read[-_ ]?only|readonly|no edits?|do not edit|don't edit|without editing|return data only)\b|읽기\s*전용|수정하지\s*말|편집하지\s*말/i;

const WRITE_INTENT_RE =
  /\b(write[-_ ]?scoped|write|edit|modify|update|implement|fix|patch|refactor|create|delete|remove|apply|commit|mutation|mutate|change files?)\b|구현|수정|편집|변경|생성|삭제|반영|패치|리팩터/i;

function normalizeScope(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '_');
  if (EXPLICIT_READ_ONLY.has(normalized)) return TASK_SCOPE.READ_ONLY;
  if (EXPLICIT_WRITE_SCOPED.has(normalized)) return TASK_SCOPE.WRITE_SCOPED;
  if (normalized === TASK_SCOPE.UNKNOWN) return TASK_SCOPE.UNKNOWN;
  return null;
}

function taskText(toolInput = {}) {
  const parts = [
    toolInput.description,
    toolInput.prompt,
    toolInput.task,
    toolInput.instructions,
    toolInput.subagent_type,
  ];
  return parts.filter((part) => typeof part === 'string' && part.trim()).join('\n');
}

export function classifyTaskScope(payload = {}) {
  const toolInput = payload?.tool_input && typeof payload.tool_input === 'object'
    ? payload.tool_input
    : payload;

  const explicit = normalizeScope(
    toolInput.task_scope ??
      toolInput.taskScope ??
      toolInput.permission_level ??
      toolInput.permissionLevel ??
      toolInput.scope
  );
  if (explicit) return explicit;

  if (toolInput.can_write === false || toolInput.canWrite === false) {
    return TASK_SCOPE.READ_ONLY;
  }

  if (Array.isArray(toolInput.allowed_paths) && toolInput.allowed_paths.length > 0) {
    return TASK_SCOPE.WRITE_SCOPED;
  }
  if (Array.isArray(toolInput.allowedPaths) && toolInput.allowedPaths.length > 0) {
    return TASK_SCOPE.WRITE_SCOPED;
  }

  const text = taskText(toolInput);
  if (!text) return TASK_SCOPE.UNKNOWN;

  if (WRITE_INTENT_RE.test(text)) return TASK_SCOPE.WRITE_SCOPED;
  if (READ_ONLY_RE.test(text)) return TASK_SCOPE.READ_ONLY;
  return TASK_SCOPE.UNKNOWN;
}

export function isReadOnlyTask(payload = {}) {
  return classifyTaskScope(payload) === TASK_SCOPE.READ_ONLY;
}
