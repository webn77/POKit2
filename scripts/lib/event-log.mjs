import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// POK-207 — generic event-log primitives for the issue_execution_entered receipt.
// Mirrors the issue_authored receipt pattern (scripts/lib/issue-create.mjs) but for
// a different event class: proof that the RUNNER (not the agent's prose) entered the
// pokit-issue execution flow for an issue. This is the all-runtime floor (layer ②)
// that backs the Workflow Trace "Skill invocation: pokit-issue" claim — the runner
// writes it, so the agent cannot self-claim a flow that never ran.
//
// Honest boundary (POK-207 AC5): a single-identity agent could forge this line before
// doctor runs. The receipt + doctor cross-check is tamper-EVIDENT (raises forgery to an
// explicit, detectable act), NOT a security wall.

export const EVENT_LOG_REL = '.ai-os/events/event-log.jsonl';

// POK-354: 주요 단계 진행 마커. POKIT_SESSION_ID가 있으면 stderr에 출력해
// 실행 채널(텔레그램 등)이 진행 상황을 감지할 수 있게 한다.
export function emitProgress(step, detail = '') {
  if (!process.env.POKIT_SESSION_ID) return;
  const msg = detail ? `[pokit:progress] ${step}: ${detail}` : `[pokit:progress] ${step}`;
  process.stderr.write(`${msg}\n`);
}
export const EXECUTION_ENTERED_EVENT = 'issue_execution_entered';
export const ISSUE_PREFLIGHT_PASS_EVENT = 'issue_preflight_pass';
export const POST_RUNNER_EXECUTION_LOCK_EVENT = 'post_runner_execution_lock';
export const ROUTING_DECISION_EVENT = 'routing_decision';
export const SKILL_EXECUTION_CHECKPOINT_EVENT = 'skill_execution_checkpoint';
export const POKIT_ISSUE_SKILL_CHECKPOINT_STEPS = Object.freeze([
  'pre_runner',
  'post_runner_plan',
  'post_change_review',
  'verification_ready',
]);
const RECEIPT_SCHEMA_VERSION = '0.1.0';

/**
 * Build an issue_execution_entered receipt object (does not write to disk).
 * @param {object} opts
 * @param {string} opts.issueId - e.g. 'POK-207'
 * @param {string} [opts.provider] - runtime provider (claude_code/codex/antigravity/unknown)
 * @param {string} [opts.emittedAt] - ISO timestamp (injectable for tests)
 */
export function buildIssueExecutionEnteredReceipt({ issueId, provider = 'unknown', emittedAt }) {
  const emitted_at = emittedAt ?? new Date().toISOString();
  return {
    event_type: EXECUTION_ENTERED_EVENT,
    event_name: EXECUTION_ENTERED_EVENT,
    issue_id: issueId,
    emitted_at,
    provider,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: EXECUTION_ENTERED_EVENT,
      issue_id: issueId,
    },
  };
}

/**
 * Append a JSON event line to <root>/.ai-os/events/event-log.jsonl (append-only audit).
 */
export async function appendEvent(root, event) {
  const logPath = path.join(root, EVENT_LOG_REL);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}

/**
 * Build + append an issue_execution_entered receipt for an issue.
 * Returns the receipt that was written.
 */
export async function appendIssueExecutionEnteredReceipt(root, { issueId, provider, emittedAt } = {}) {
  if (!/^POK-\d{3}$/.test(issueId ?? '')) return null;
  const receipt = buildIssueExecutionEnteredReceipt({ issueId, provider, emittedAt });
  await appendEvent(root, receipt);
  return receipt;
}

export function buildIssuePreflightPassReceipt({
  issueId,
  provider = 'unknown',
  emittedAt,
  checks = [],
}) {
  const emitted_at = emittedAt ?? new Date().toISOString();
  return {
    event_type: ISSUE_PREFLIGHT_PASS_EVENT,
    event_name: ISSUE_PREFLIGHT_PASS_EVENT,
    issue_id: issueId,
    emitted_at,
    provider,
    checks,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: ISSUE_PREFLIGHT_PASS_EVENT,
      issue_id: issueId,
      checks,
    },
  };
}

export async function appendIssuePreflightPassReceipt(root, {
  issueId,
  provider,
  emittedAt,
  checks,
} = {}) {
  if (!/^POK-\d{3}$/.test(issueId ?? '')) return null;
  const receipt = buildIssuePreflightPassReceipt({
    issueId,
    provider,
    emittedAt,
    checks,
  });
  await appendEvent(root, receipt);
  return receipt;
}

export function buildPostRunnerExecutionLockReceipt({
  issueId,
  provider = 'unknown',
  mode,
  workerAuthorization,
  selectedOption,
  emittedAt,
}) {
  const emitted_at = emittedAt ?? new Date().toISOString();
  return {
    event_type: POST_RUNNER_EXECUTION_LOCK_EVENT,
    event_name: POST_RUNNER_EXECUTION_LOCK_EVENT,
    issue_id: issueId,
    emitted_at,
    provider,
    mode,
    worker_authorization: workerAuthorization,
    selected_option: selectedOption,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: POST_RUNNER_EXECUTION_LOCK_EVENT,
      issue_id: issueId,
      mode,
      worker_authorization: workerAuthorization,
      selected_option: selectedOption,
    },
  };
}

export async function appendPostRunnerExecutionLockReceipt(root, {
  issueId,
  provider,
  mode,
  workerAuthorization,
  selectedOption,
  emittedAt,
} = {}) {
  if (!/^POK-\d{3}$/.test(issueId ?? '')) return null;
  if (!['automatic', 'manual-confirm'].includes(mode)) return null;
  const receipt = buildPostRunnerExecutionLockReceipt({
    issueId,
    provider,
    mode,
    workerAuthorization,
    selectedOption,
    emittedAt,
  });
  await appendEvent(root, receipt);
  return receipt;
}

export function buildSkillExecutionCheckpointReceipt({
  issueId,
  selectedSkill = 'pokit.issue',
  step,
  provider = 'unknown',
  emittedAt,
  payload = {},
}) {
  const emitted_at = emittedAt ?? new Date().toISOString();
  return {
    event_type: SKILL_EXECUTION_CHECKPOINT_EVENT,
    event_name: SKILL_EXECUTION_CHECKPOINT_EVENT,
    issue_id: issueId,
    emitted_at,
    provider,
    selected_skill: selectedSkill,
    step,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: SKILL_EXECUTION_CHECKPOINT_EVENT,
      issue_id: issueId,
      selected_skill: selectedSkill,
      step,
      ...payload,
    },
  };
}

export async function appendSkillExecutionCheckpointReceipt(root, {
  issueId,
  selectedSkill,
  step,
  provider,
  emittedAt,
  payload,
} = {}) {
  if (!/^POK-\d{3}$/.test(issueId ?? '')) return null;
  if (!['pokit.issue', 'pokit.backlog', 'pokit.project'].includes(selectedSkill ?? 'pokit.issue')) return null;
  if (typeof step !== 'string' || step.trim().length === 0) return null;
  const receipt = buildSkillExecutionCheckpointReceipt({
    issueId,
    selectedSkill: selectedSkill ?? 'pokit.issue',
    step,
    provider,
    emittedAt,
    payload,
  });
  await appendEvent(root, receipt);
  return receipt;
}

/**
 * Build a routing_decision receipt object (does not write to disk).
 * This is the layer ① proof: the agent selected the POKit skill route before
 * asking the runner or authoring scripts to do durable work.
 */
export function buildRoutingDecisionReceipt({
  issueId,
  selectedSkill,
  requestClass,
  decisionReason,
  decisionSource = 'llm_selected_skill',
  provider = 'unknown',
  emittedAt,
}) {
  const emitted_at = emittedAt ?? new Date().toISOString();
  return {
    event_type: ROUTING_DECISION_EVENT,
    event_name: ROUTING_DECISION_EVENT,
    issue_id: issueId,
    emitted_at,
    provider,
    selected_skill: selectedSkill,
    request_class: requestClass,
    decision_source: decisionSource,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: ROUTING_DECISION_EVENT,
      issue_id: issueId,
      selected_skill: selectedSkill,
      request_class: requestClass,
      decision_reason: decisionReason,
      decision_source: decisionSource,
    },
  };
}

/**
 * Build + append a routing_decision receipt for an issue.
 * Returns the receipt that was written.
 */
export async function appendRoutingDecisionReceipt(root, {
  issueId,
  selectedSkill,
  requestClass,
  decisionReason,
  decisionSource,
  provider,
  emittedAt,
} = {}) {
  if (!/^POK-\d{3}$/.test(issueId ?? '')) return null;
  if (!['pokit.backlog', 'pokit.issue', 'pokit.project'].includes(selectedSkill)) return null;
  if (typeof requestClass !== 'string' || requestClass.length === 0) return null;
  if (typeof decisionReason !== 'string' || decisionReason.trim().length === 0) return null;
  const receipt = buildRoutingDecisionReceipt({
    issueId,
    selectedSkill,
    requestClass,
    decisionReason,
    decisionSource,
    provider,
    emittedAt,
  });
  await appendEvent(root, receipt);
  return receipt;
}

/**
 * Load the set of issue ids that have at least one issue_execution_entered receipt.
 * @returns {Promise<Set<string>>}
 */
export async function loadIssueExecutionEnteredIds(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Set();
    throw err;
  }

  const ids = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === EXECUTION_ENTERED_EVENT || event.event_name === EXECUTION_ENTERED_EVENT) &&
        typeof event.issue_id === 'string'
      ) {
        ids.add(event.issue_id);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return ids;
}

export async function loadPostRunnerExecutionLockIds(root) {
  const byIssue = await loadPostRunnerExecutionLockMap(root);
  return new Set(byIssue.keys());
}

export async function loadIssuePreflightPassMap(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    throw err;
  }

  const byIssue = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === ISSUE_PREFLIGHT_PASS_EVENT || event.event_name === ISSUE_PREFLIGHT_PASS_EVENT) &&
        typeof event.issue_id === 'string'
      ) {
        if (!byIssue.has(event.issue_id)) byIssue.set(event.issue_id, []);
        byIssue.get(event.issue_id).push(event);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  for (const receipts of byIssue.values()) {
    receipts.sort((a, b) => String(a.emitted_at ?? '').localeCompare(String(b.emitted_at ?? '')));
  }
  return byIssue;
}

export async function loadPostRunnerExecutionLockMap(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    throw err;
  }

  const byIssue = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === POST_RUNNER_EXECUTION_LOCK_EVENT || event.event_name === POST_RUNNER_EXECUTION_LOCK_EVENT) &&
        typeof event.issue_id === 'string'
      ) {
        if (!byIssue.has(event.issue_id)) byIssue.set(event.issue_id, []);
        byIssue.get(event.issue_id).push(event);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  for (const receipts of byIssue.values()) {
    receipts.sort((a, b) => String(a.emitted_at ?? '').localeCompare(String(b.emitted_at ?? '')));
  }
  return byIssue;
}

/**
 * Load routing_decision receipts grouped by issue id.
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function loadRoutingDecisionMap(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    throw err;
  }

  const byIssue = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === ROUTING_DECISION_EVENT || event.event_name === ROUTING_DECISION_EVENT) &&
        typeof event.issue_id === 'string'
      ) {
        const receipt = normalizeRoutingDecision(event);
        if (!byIssue.has(event.issue_id)) byIssue.set(event.issue_id, []);
        byIssue.get(event.issue_id).push(receipt);
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return byIssue;
}

/**
 * Load skill_execution_checkpoint receipts grouped by issue id.
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function loadSkillExecutionCheckpointMap(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Map();
    throw err;
  }

  const byIssue = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === SKILL_EXECUTION_CHECKPOINT_EVENT || event.event_name === SKILL_EXECUTION_CHECKPOINT_EVENT) &&
        typeof event.issue_id === 'string'
      ) {
        const receipt = normalizeSkillExecutionCheckpoint(event);
        if (!byIssue.has(event.issue_id)) byIssue.set(event.issue_id, []);
        byIssue.get(event.issue_id).push(receipt);
      }
    } catch {
      // Skip malformed lines.
    }
  }

  for (const receipts of byIssue.values()) {
    receipts.sort((a, b) => String(a.emitted_at ?? '').localeCompare(String(b.emitted_at ?? '')));
  }
  return byIssue;
}

export function hasRoutingDecisionReceipt(routingDecisionMap, issueId, {
  selectedSkill,
  requestClass,
  decisionSource = 'llm_selected_skill',
} = {}) {
  const receipts = routingDecisionMap?.get?.(issueId) ?? [];
  return receipts.some((receipt) => {
    if (selectedSkill && receipt.selected_skill !== selectedSkill) return false;
    if (requestClass && receipt.request_class !== requestClass) return false;
    if (decisionSource && receipt.decision_source !== decisionSource) return false;
    return true;
  });
}

function normalizeRoutingDecision(event) {
  return {
    ...event,
    selected_skill: event.selected_skill ?? event.payload?.selected_skill,
    request_class: event.request_class ?? event.payload?.request_class,
    decision_source: event.decision_source ?? event.payload?.decision_source,
  };
}

function normalizeSkillExecutionCheckpoint(event) {
  return {
    ...event,
    selected_skill: event.selected_skill ?? event.payload?.selected_skill,
    step: event.step ?? event.payload?.step,
  };
}
