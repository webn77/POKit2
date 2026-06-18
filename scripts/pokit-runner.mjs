#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGroupedBacklog, renderGroupedBacklogCard } from './lib/derived-index.mjs';
import { aggregateDeferredLedger, renderDeferredLedgerCard } from './pokit-deferred-ledger.mjs';
import { checkReleaseGap, renderReleaseGapCard } from './lib/release-gap.mjs';
import { resolveAgentProfileDispatch } from './lib/agent-profile-dispatcher.mjs';
import { emitProgress } from './lib/event-log.mjs';
import {
  ASSIGNMENT_BY_AGENT_PROFILE,
  DEFAULT_ASSIGNMENT,
  MAIN_AGENT_REQUIRED_ACTIONS,
} from './lib/assignment-model-tiers.mjs';
import { detectProvider } from './lib/hook-emit.mjs';
import {
  appendIssueExecutionEnteredReceipt,
  appendPostRunnerExecutionLockReceipt,
  appendSkillExecutionCheckpointReceipt,
  loadSkillExecutionCheckpointMap,
} from './lib/event-log.mjs';
import { buildSafeStepPlan } from './lib/safe-step-policy.mjs';
import { classifyCommitStatus } from './lib/commit-status.mjs';
import { buildCompleteCardFields, runCompleteCommand } from './lib/complete-card.mjs';
export { buildCompleteCardFields, runCompleteCommand };
export { deriveIssueDurationFromCard, parseFrontmatterTimestamp } from './lib/issue-duration.mjs';
import { issueMetricsPath } from './lib/issue-metrics.mjs';
export {
  recordIssueCompletionMetrics,
  recordIssueStartMarker,
  readIssueStartMarker,
  readPriorMetricsTimes,
  readLastDurableChangeMs,
  readGitChangeStats,
} from './lib/gate-pass-metrics.mjs';
import {
  recordIssueCompletionMetrics,
  recordIssueStartMarker,
} from './lib/gate-pass-metrics.mjs';
import { runGatePassCommand, parseMetricsArgs, parseBoolFlagValue } from './lib/gate-pass-orchestrator.mjs';
export { runGatePassCommand, parseMetricsArgs, parseBoolFlagValue };
// POK-327 — 실패 기록·이어가기: record-failure 명령 + 시작 카드 실패 안내.
import { parseFailureContext, buildFailureNoticeFields, recordFailureContext } from './lib/failure-context.mjs';
// POK-353 — loop 첫 적용: 자율 이음새 체이닝 + 멈춤조건 4종.
import { runLoopTick } from './lib/loop-chaining.mjs';
export { parseFailureContext, buildFailureNoticeFields, recordFailureContext };
// POK-325 — friction-automation chokepoints: transition card-status sync +
// definition-change issue_authored reissue, both runner-owned subcommands.
import { runTransitionStatusCommand } from './lib/issue-status-sync.mjs';
export { runTransitionStatusCommand, syncIssueCardStatus } from './lib/issue-status-sync.mjs';
import { reissueIssueAuthoredReceipt } from './lib/issue-create.mjs';
export { reissueIssueAuthoredReceipt };
import {
  renderCompleteCard,
  renderExecutionReasoningChecklistCard,
  renderPreExecutionPreviewCard,
  renderStartupLifecycleCard,
} from './lib/lifecycle-card-renderer.mjs';
import { resolveActiveIssuePath } from './lib/issue-paths.mjs';
import { assertIssueId, extractIssueId, isIssueId, ISSUE_ID_SOURCE } from './lib/issue-id.mjs';
import { readActiveIssueForWorktree } from './lib/worktree-active-issue.mjs';
import { plainifyUserText } from './lib/user-text.mjs';
import { acquireIssueLock, releaseLock } from './lib/worktree-locks.mjs';
import { ensureCurrentSession, listActiveIssueClaims, readTaskSession } from './lib/worktree-sessions.mjs';
import { listProposedUpdates } from './lib/proposed-updates.mjs';
import {
  buildTaskSessionGuidanceCard,
  buildIntegrationGuidanceCard,
  buildSessionStatusCard,
  renderSessionGuidanceCard,
} from './lib/session-guidance-cards.mjs';
import { measureStartup } from './pokit-measure-startup.mjs';
import { parseFrontmatter } from './lib/issue-frontmatter.mjs';

const POKIT_PHRASES = [
  '$pokit',
  'POKit 시작',
  'POKit 시작하자',
  '포킷 시작',
  '오늘 뭐 하지',
  '이슈로 잡아줘',
  '완료 가능한지 봐줘',
];

// SSoT for execution-approval synonyms: `.ai-os/standards/agent-invocation.md`
// (`authorized_phrases`). These are matched as whole-input phrases after
// lowercasing and internal-whitespace normalization, so single-syllable entries
// like '고' never match as a substring of ordinary conversation. Review-intent
// phrases ("확인해줘", "검토해줘", "봐줘") are deliberately excluded — they do not
// approve execution.
const EXECUTION_REQUEST_PHRASES = [
  '진행해줘',
  '그럽시다',
  '시작합니다',
  '진행합시다',
  '진행하자',
  '진행하자고',
  '진행시켜',
  '가자',
  '고',
  '고고',
  '해보자',
  '해보자고',
  '오케이 해줘',
];

// POK-246 (AC3) — "지금 뭐 하면 돼?" natural-language status query. Matched as a
// whole input after whitespace normalization so it never fires as a substring of
// ordinary conversation.
const SESSION_STATUS_PHRASES = [
  '지금 뭐 하면 돼',
  '지금 뭐 하면 돼?',
  '지금 뭐 하면 되',
  '지금 뭐 하면 되지',
  '지금 뭐 하지',
  '지금 뭐 해야 돼',
  '뭐 하면 돼',
  '뭐 하면 돼?',
  '지금 뭐하면돼',
];

const BACKLOG_VIEW_PHRASES = [
  '백로그',
  '남은항목',
  '남은 항목',
];

const EXECUTION_MODE_SELECTIONS = Object.freeze({
  a: Object.freeze({ mode: 'manual-confirm', worker_authorization: 'not_required' }),
  '수동': Object.freeze({ mode: 'manual-confirm', worker_authorization: 'not_required' }),
  b: Object.freeze({ mode: 'automatic', worker_authorization: 'authorized' }),
  '자동': Object.freeze({ mode: 'automatic', worker_authorization: 'authorized' }),
  c: Object.freeze({ mode: 'stop', worker_authorization: 'not_required' }),
  '중단': Object.freeze({ mode: 'stop', worker_authorization: 'not_required' }),
});

const VALID_POST_RUNNER_WORKER_DECISIONS = new Set(['fan-out', 'fallback']);
const VALID_POST_RUNNER_FALLBACK_REASONS = new Set([
  'worker-unavailable',
  'global-state-only',
  'cross-file-invariant',
  'trivial-scope',
]);

const RUNNER_COMMAND_CONTRACTS = Object.freeze({
  '/pokit add': Object.freeze([
    'command',
    'requested_action',
    'target_project',
    'proposed_issue',
    'lifecycle_card',
    'approval_required',
  ]),
  '/pokit dispatch': Object.freeze([
    'command',
    'target_issue',
    'runner_assignment',
    'lifecycle_card',
    'approval_required',
  ]),
  '/pokit gate': Object.freeze([
    'command',
    'target_issue',
    'required_evidence',
    'lifecycle_card',
    'approval_required',
  ]),
});

const STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY = Object.freeze({
  level: 'startup_or_transition',
  reason: 'Startup and transition only need lightweight state recovery before durable work.',
  required_checks: Object.freeze([
    Object.freeze({ id: 'read_current_state', label: 'current state', evidence: 'command_summary' }),
    Object.freeze({ id: 'resolve_active_issue_path', label: 'active issue', evidence: 'command_summary' }),
    Object.freeze({ id: 'measure_startup_budget', label: 'startup budget', evidence: 'compact_evidence' }),
  ]),
  optional_checks: Object.freeze([
    Object.freeze({ id: 'focused_runner_test', trigger: 'runner behavior changed' }),
    Object.freeze({ id: 'git_diff_check', trigger: 'durable files changed during transition' }),
  ]),
  forbidden_by_default: Object.freeze([
    Object.freeze({ id: 'doctor', unless: 'gate claim or explicit audit' }),
    Object.freeze({ id: 'full_tests', unless: 'shared executable behavior changed' }),
    Object.freeze({ id: 'full_doctor_log', unless: 'investigating doctor failure' }),
    Object.freeze({ id: 'broad_evals', unless: 'targeted agent-behavior risk is under review' }),
  ]),
  po_evidence_mode: 'compact',
  stale_evidence_policy: 'not_applicable',
  consumer: 'runner',
});

export function matchesPokitPhrase(phrase) {
  if (typeof phrase !== 'string') return false;
  const normalized = phrase.trim();
  return POKIT_PHRASES.some((entry) => entry.toLocaleLowerCase('ko-KR') === normalized.toLocaleLowerCase('ko-KR'));
}

function matchesExecutionRequestPhrase(text) {
  const normalized = text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  return EXECUTION_REQUEST_PHRASES.some(
    (entry) => entry.toLocaleLowerCase('ko-KR').replace(/\s+/g, '') === normalized,
  );
}

function matchesSessionStatusPhrase(text) {
  const normalized = text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '').replace(/\?+$/, '');
  return SESSION_STATUS_PHRASES.some(
    (entry) => entry.toLocaleLowerCase('ko-KR').replace(/\s+/g, '').replace(/\?+$/, '') === normalized,
  );
}

function matchesBacklogViewPhrase(text) {
  const normalized = text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  return BACKLOG_VIEW_PHRASES.some(
    (entry) => entry.toLocaleLowerCase('ko-KR').replace(/\s+/g, '') === normalized,
  );
}

export function classifyPokitCommand(phrase) {
  const raw = typeof phrase === 'string' ? phrase.trim() : '';
  const lower = raw.toLocaleLowerCase('ko-KR');
  const normalizedApproval = lower.replace(/\s+/g, '');

  if (matchesExecutionRequestPhrase(raw)) {
    return {
      kind: 'execution_request',
      command: raw,
      raw,
      mutates_state: false,
      requires_human_approval: true,
      output_fields: [
        'command',
        'active_issue',
        'issue_path',
        'pre_execution_preview_card',
        'approval_required',
      ],
    };
  }

  // A leading issue id only NAMES the execution target; the execution synonym
  // must still be recognized in the remainder (e.g. "POK-233 진행하자").
  const targetMatch = raw.match(new RegExp(`^(${ISSUE_ID_SOURCE})\\s+(.+)$`, 'i'));
  if (targetMatch && matchesExecutionRequestPhrase(targetMatch[2])) {
    return {
      kind: 'execution_request',
      command: raw,
      raw,
      target_issue: assertIssueId(targetMatch[1]),
      mutates_state: false,
      requires_human_approval: true,
      output_fields: [
        'command',
        'active_issue',
        'issue_path',
        'pre_execution_preview_card',
        'approval_required',
      ],
    };
  }

  const selectedMode = EXECUTION_MODE_SELECTIONS[lower];
  if (selectedMode) {
    return {
      kind: 'execution_mode_selection',
      command: raw,
      raw,
      selected_option: lower,
      mode: selectedMode.mode,
      worker_authorization: selectedMode.worker_authorization,
      mutates_state: false,
      requires_human_approval: true,
      output_fields: [
        'command',
        'selected_option',
        'mode',
        'worker_authorization',
        'execution_reasoning_checklist',
        'post_runner_execution_lock',
        'approval_required',
      ],
    };
  }

  if (matchesSessionStatusPhrase(raw)) {
    return {
      kind: 'session_status',
      command: raw,
      raw,
      mutates_state: false,
      requires_human_approval: false,
      output_fields: [
        'command',
        'session_guidance_card',
        'rendered_session_guidance_card',
      ],
    };
  }

  if (matchesBacklogViewPhrase(raw)) {
    return {
      kind: 'backlog_view',
      command: raw,
      raw,
      mutates_state: false,
      requires_human_approval: false,
      output_fields: [
        'command',
        'backlog_card',
        'rendered_backlog_card',
        'deferred_ledger',
        'rendered_deferred_ledger_card',
      ],
    };
  }

  for (const [command, outputFields] of Object.entries(RUNNER_COMMAND_CONTRACTS)) {
    if (lower === command || lower.startsWith(`${command} `)) {
      return {
        kind: 'runner_command',
        command,
        raw,
        mutates_state: false,
        requires_human_approval: true,
        output_fields: [...outputFields],
      };
    }
  }

  return {
    kind: matchesPokitPhrase(raw) ? 'startup_trigger' : 'unknown',
    command: raw || '$pokit',
    raw,
    mutates_state: false,
    requires_human_approval: true,
    output_fields: [
      'command',
      'active_issue',
      'issue_path',
      'runner_assignment',
      'lifecycle_card',
      'approval_required',
    ],
  };
}

export function resolveVerificationIntensity({ command, gateState, issueStatus } = {}) {
  const commandKind = typeof command === 'string' ? command : command?.kind;
  const isStartupOrTransition =
    commandKind === 'startup_trigger' ||
    gateState === 'gate_passed' ||
    issueStatus === 'gate_passed';

  if (isStartupOrTransition) {
    return {
      ...STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY,
      required_checks: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.required_checks.map((check) => ({ ...check })),
      optional_checks: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.optional_checks.map((check) => ({ ...check })),
      forbidden_by_default: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.forbidden_by_default.map((check) => ({ ...check })),
    };
  }

  return {
    ...STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY,
    required_checks: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.required_checks.map((check) => ({ ...check })),
    optional_checks: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.optional_checks.map((check) => ({ ...check })),
    forbidden_by_default: STARTUP_OR_TRANSITION_VERIFICATION_INTENSITY.forbidden_by_default.map((check) => ({ ...check })),
  };
}

export async function resolveIssuePath(issueId, root = process.cwd()) {
  if (!isIssueId(issueId)) {
    throw new Error(`Invalid POKit issue id: ${issueId}`);
  }
  return resolveActiveIssuePath(root, assertIssueId(issueId));
}

// Frontmatter parsing surfaces bare `active_issue: null` (and `none`/empty/`~`)
// as truthy strings. Normalize those nullish tokens to real null so bootstrap
// starters (no active issue) don't crash resolveIssuePath. SSoT for "no active issue".
const NULLISH_ISSUE_TOKENS = new Set(['null', 'none', '~', '']);

export function normalizeActiveIssue(value) {
  if (value == null) return null;
  return NULLISH_ISSUE_TOKENS.has(String(value).trim().toLowerCase()) ? null : value;
}

// POK-246 (AC1/AC2/AC3/AC6) — the runner (runner_contract_calculator) COMPUTES and
// PUBLISHES the session guidance card; the skill/main only displays and acts. Returns
// null when there is no session context and no pending proposals (the normal
// single-session dev case), so the runner's existing output is unchanged there.
//   - inside a task session (POKIT_SESSION_ID points at a real session) → task-session card (AC1)
//   - "지금 뭐 하면 돼?" status query → status card for the detected role (AC3)
//   - integration/main context with pending proposed updates → integration card (AC2)
export async function resolveSessionGuidanceCard({
  root = process.cwd(),
  command = null,
  activeIssue = null,
  sessionId = process.env.POKIT_SESSION_ID ?? null,
} = {}) {
  let session = null;
  if (sessionId && /^ses_\w+/.test(sessionId)) {
    try {
      session = await readTaskSession(root, sessionId);
    } catch {
      session = null;
    }
  }

  let pendingProposals = [];
  if (isIssueId(activeIssue)) {
    try {
      const updates = await listProposedUpdates(root, { issueId: activeIssue });
      pendingProposals = updates.filter((update) => update?.state === 'proposed');
    } catch {
      pendingProposals = [];
    }
  }

  if (command?.kind === 'session_status') {
    return buildSessionStatusCard({ session, proposedUpdates: pendingProposals });
  }
  if (session && session.role === 'task_session') {
    return buildTaskSessionGuidanceCard(session);
  }
  if (pendingProposals.length > 0) {
    return buildIntegrationGuidanceCard({ issueId: activeIssue, proposedUpdates: pendingProposals });
  }
  return null;
}

const execAsync = promisify(execFile);

/**
 * POK-368: startup 트리거 시 git fetch + pull --ff-only 선행 실행.
 * 성공 시 변경 있으면 배너 반환, 없으면 null.
 * 실패 시 에러 메시지 반환 (카드 렌더링 blocking 안 함).
 */
export async function syncGitIfStartup(root) {
  try {
    await execAsync('git', ['fetch', 'origin'], { cwd: root });
    const { stdout } = await execAsync('git', ['pull', '--ff-only'], { cwd: root });
    const changed = stdout && !stdout.includes('Already up to date');
    return changed ? `[git sync] 최신 상태 반영됨: ${stdout.trim().split('\n')[0]}` : null;
  } catch (e) {
    return `[git sync] 동기화 실패 (로컬 상태로 계속): ${e.message.split('\n')[0]}`;
  }
}

// POK-056 startup budget: lightweight state recovery only — no doctor scan, no full test, no gate evidence.
export async function runPreflight({ root = process.cwd(), phrase = '$pokit' } = {}) {
  const previousSessionId = process.env.POKIT_SESSION_ID;
  let injectedSessionId = false;
  const currentPath = '.ai-os/current.md';
  const currentText = await readFile(path.join(root, currentPath), 'utf8');
  const current = parseFrontmatter(currentText);
  let activeIssue = normalizeActiveIssue(current.active_issue);
  try {
    const worktreeActive = await readActiveIssueForWorktree(root);
    activeIssue = normalizeActiveIssue(worktreeActive.activeIssue) ?? activeIssue;
  } catch {
    // Keep tracked current.md fallback.
  }
  const issuePath = activeIssue ? await resolveIssuePath(activeIssue, root) : null;
  const issueText = issuePath ? await readOptionalIssueText(root, issuePath) : '';
  const issue = issueText ? parseFrontmatter(issueText) : {};
  const releaseScope = await readReleaseScope(root, current.active_sprint);
  const contextBudget = await measureStartup({ root });
  const status = current.gate_state ?? 'unknown';
  const nextAction = current.next_action ?? issue.next_action ?? null;
  const command = classifyPokitCommand(phrase);
  const runnerAssignment = resolveRunnerAssignment(issue);

  // POK-368: startup 트리거 시 git 동기화 선행 (non-startup 명령은 skip)
  let gitSyncBanner = null;
  if (command.kind === 'startup_trigger') {
    gitSyncBanner = await syncGitIfStartup(root);
  }

  let hasGitMetadata = false;
  try {
    await stat(path.join(root, '.git'));
    hasGitMetadata = true;
  } catch {
    hasGitMetadata = false;
  }
  if (hasGitMetadata && isIssueId(activeIssue) && !process.env.POKIT_SESSION_ID) {
    try {
      const ensured = await ensureCurrentSession(root, {
        project: current.active_project ?? issue.project ?? 'pokit',
        issueId: activeIssue,
        engine: detectProvider(),
        reason: `runner preflight for ${activeIssue}`,
      });
      process.env.POKIT_SESSION_ID = ensured.session.session_id;
      injectedSessionId = previousSessionId === undefined;
    } catch {
      // Session wiring is advisory during lightweight startup; command handling
      // still renders the normal lifecycle card and doctor surfaces drift later.
    }
  }
  // POK-246 — additive session guidance card (null in the normal single-session case).
  let sessionGuidanceCard = null;
  let renderedSessionGuidanceCard;
  try {
    sessionGuidanceCard = await resolveSessionGuidanceCard({ root, command, activeIssue });
    if (sessionGuidanceCard) {
      renderedSessionGuidanceCard = renderSessionGuidanceCard(sessionGuidanceCard);
    }
  } catch {
    // Never break startup on a guidance-card failure (additive surface).
    sessionGuidanceCard = null;
    renderedSessionGuidanceCard = undefined;
  }
  const verificationIntensity = resolveVerificationIntensity({
    command,
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
  });
  const lifecycleCard = buildStartupLifecycleCardFields({
    activeIssue,
    status,
    project: current.active_project ?? issue.project ?? null,
    sprint: current.active_sprint ?? null,
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
    nextAction,
    candidateQueue: releaseScope.candidateQueue,
    candidateCount: releaseScope.candidateCount,
    contextBudget,
    failureContext: parseFailureContext(current.failure_context),
  });
  const renderedLifecycleCard = [
    gitSyncBanner,
    renderStartupLifecycleCard({ lifecycleCard }),
  ].filter(Boolean).join('\n');
  const preExecutionPreviewCard = command.kind === 'execution_request' && allowsPreExecutionPreview({
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
  })
    ? buildPreExecutionPreviewCardFields({ activeIssue, issue, issueText })
    : undefined;
  const renderedPreExecutionPreviewCard = preExecutionPreviewCard
    ? renderPreExecutionPreviewCard({ previewCard: preExecutionPreviewCard })
    : undefined;
  const executionAllowed = allowsPreExecutionPreview({
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
  });
  const executionReasoningChecklist = executionAllowed ? buildExecutionReasoningChecklist({
    command,
    activeIssue,
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
    issue,
  }) : undefined;
  const renderedExecutionReasoningChecklist = executionReasoningChecklist
    ? renderExecutionReasoningChecklistCard({ checklist: executionReasoningChecklist })
    : undefined;
  let postRunnerExecutionLock = null;
  let skillExecutionCheckpoint = null;
  // POK-198 — AC1: capture real wall-clock start at execution-approval (chokepoint).
  // Guard: only on execution_request AND when there is a valid active issue.
  // Try/catch so a marker write failure never breaks the preview card output.
  if (command.kind === 'execution_request' && executionAllowed && isIssueId(activeIssue)) {
    try {
      await recordIssueStartMarker({
        root,
        date: todayUtcDateRunner(),
        issueId: activeIssue,
        nowMs: Date.now(),
      });
    } catch {
      // Intentionally silent — marker write failure must not break startup card.
    }
    // POK-207 (AC1, layer ②) — the RUNNER emits the issue_execution_entered receipt
    // so the Workflow Trace "Skill invocation: pokit-issue" claim is backed by proof
    // that the execution flow actually ran, not self-claimed prose. All-runtime floor.
    try {
      await appendIssueExecutionEnteredReceipt(root, {
        issueId: activeIssue,
        provider: detectProvider(),
      });
    } catch {
      // Intentionally silent — receipt write failure must not break startup card.
    }
    try {
      skillExecutionCheckpoint = await appendSkillExecutionCheckpointReceipt(root, {
        issueId: activeIssue,
        selectedSkill: 'pokit.issue',
        step: 'pre_runner',
        provider: detectProvider(),
        payload: {
          command: command.raw,
          gate_state: current.gate_state ?? issue.gate_state ?? null,
          issue_status: issue.status ?? current.status ?? null,
        },
      });
    } catch {
      // Intentionally silent — preview remains available; doctor catches missing chain before gate.
    }
  }

  if (
    command.kind === 'execution_mode_selection' &&
    command.mode !== 'stop' &&
    executionAllowed &&
    isIssueId(activeIssue)
  ) {
    try {
      await recordIssueStartMarker({
        root,
        date: todayUtcDateRunner(),
        issueId: activeIssue,
        nowMs: Date.now(),
      });
    } catch {
      // Intentionally silent — gate metrics/doctor surface missing markers later.
    }
    const postRunnerPlanPayload = buildPostRunnerPlanPayload({
      command,
      activeIssue,
      issue,
    });
    validatePostRunnerPlanPayload(postRunnerPlanPayload);
    const issueLock = await acquireIssueLock(root, {
      issueId: activeIssue,
      holder: process.env.POKIT_SESSION_ID ?? `runner-${process.pid}`,
      reason: `execute ${activeIssue}`,
    });
    if (!issueLock.acquired) {
      throw new Error(issueLock.message);
    }
    postRunnerExecutionLock = await appendPostRunnerExecutionLockReceipt(root, {
      issueId: activeIssue,
      provider: detectProvider(),
      mode: command.mode,
      workerAuthorization: command.worker_authorization,
      selectedOption: command.selected_option,
    });
    if (!postRunnerExecutionLock) {
      throw new Error(`post_runner_execution_lock was not recorded for ${activeIssue}`);
    }
    // POK-354: 실행 승인 후 진행 시작 마커
    emitProgress('execution_started', activeIssue);
    skillExecutionCheckpoint = await appendSkillExecutionCheckpointReceipt(root, {
      issueId: activeIssue,
      selectedSkill: 'pokit.issue',
      step: 'post_runner_plan',
      provider: detectProvider(),
      payload: postRunnerPlanPayload,
    });
    if (!skillExecutionCheckpoint) {
      throw new Error(`skill_execution_checkpoint post_runner_plan was not recorded for ${activeIssue}`);
    }
  }

  let backlogCard = null;
  let renderedBacklogCard = undefined;
  // POK-343: deferred carry-over ledger auto-surfaces at the backlog/kickoff
  // chokepoint so re-prioritization starts from machine aggregation, not memory.
  let deferredLedger = null;
  let renderedDeferredLedgerCard = undefined;
  if (command.kind === 'backlog_view') {
    try {
      backlogCard = await buildGroupedBacklog(root, {
        sprint: current.active_sprint ?? null,
      });
      renderedBacklogCard = renderGroupedBacklogCard(backlogCard);
    } catch {
      // Never break the runner on a backlog view failure.
      backlogCard = null;
      renderedBacklogCard = undefined;
    }
    try {
      deferredLedger = await aggregateDeferredLedger(root);
      renderedDeferredLedgerCard = renderDeferredLedgerCard(deferredLedger);
    } catch {
      // Never break the runner on a ledger failure.
      deferredLedger = null;
      renderedDeferredLedgerCard = undefined;
    }
  }

  // POK-356: 릴리즈 갭 자동 표면화 — backlog_view(킥오프) 경로에서 표시.
  let releaseGap = null;
  let renderedReleaseGapCard = undefined;
  if (command.kind === 'backlog_view') {
    try {
      releaseGap = await checkReleaseGap({ root });
      renderedReleaseGapCard = renderReleaseGapCard(releaseGap) ?? undefined;
    } catch {
      releaseGap = null;
    }
  }

  const result = {
    status,
    phraseMatched: matchesPokitPhrase(phrase),
    command,
    activeIssue,
    issuePath,
    runnerAssignment,
    verificationIntensity,
    lifecycleCard,
    renderedLifecycleCard,
    preExecutionPreviewCard,
    renderedPreExecutionPreviewCard,
    executionReasoningChecklist,
    renderedExecutionReasoningChecklist,
    postRunnerExecutionLock,
    skillExecutionCheckpoint,
    sessionGuidanceCard,
    renderedSessionGuidanceCard,
    backlogCard,
    renderedBacklogCard,
    deferredLedger,
    renderedDeferredLedgerCard,
    releaseGap,
    renderedReleaseGapCard,
    nextAction,
    gitSyncBanner,
  };
  if (injectedSessionId) {
    delete process.env.POKIT_SESSION_ID;
  } else if (previousSessionId !== undefined) {
    process.env.POKIT_SESSION_ID = previousSessionId;
  }
  return result;
}

function allowsPreExecutionPreview({ gateState = null, issueStatus = null } = {}) {
  return ['pending', 'in_progress'].includes(gateState) ||
    (gateState == null && ['pending', 'in_progress'].includes(issueStatus));
}

export function resolveRunnerAssignment(issueFrontmatter = {}) {
  const assignment = ASSIGNMENT_BY_AGENT_PROFILE[issueFrontmatter.agent_profile] ?? DEFAULT_ASSIGNMENT;
  const dispatch = issueFrontmatter.agent_profile
    ? resolveAgentProfileDispatch(issueFrontmatter.agent_profile)
    : { permission_level: DEFAULT_ASSIGNMENT.permission_level };

  return {
    ...assignment,
    permission_level: dispatch.permission_level,
    main_agent_required_actions: [...MAIN_AGENT_REQUIRED_ACTIONS],
  };
}

export function buildStartupLifecycleCardFields({
  activeIssue = null,
  status = null,
  project = null,
  sprint = null,
  gateState = null,
  issueStatus = null,
  nextAction = null,
  candidateQueue = [],
  candidateCount = null,
  contextBudget = null,
  failureContext = null,
} = {}) {
  // POK-327 — 실패 기록이 현재 이슈의 것일 때만 시작 카드에 안내한다
  // (전환 뒤 남은 다른 이슈의 기록으로 오안내하지 않음).
  const failureNotice = failureContext && failureContext.issue === activeIssue
    ? buildFailureNoticeFields(failureContext)
    : null;
  const inputWaiting = buildStartupInputWaiting(gateState, candidateQueue[0], failureNotice);
  return {
    card_type: 'session_start',
    title: '🚀 POKit2 세션 시작',
    timestamp_format: 'YYYY-MM-DD HH:mm KST',
    mode: '상태 확인',
    display_only: true,
    approval_required: true,
    approval_boundary: '확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
    approves_status_transition: false,
    approves_release_scope_inclusion: false,
    approves_durable_work: false,
    approves_external_write: false,
    approves_gate_pass: false,
    fields: {
      access: ['timestamp', 'mode'],
      current: {
        project,
        sprint: plainifyUserText(formatSprintLine(sprint, candidateCount)),
        issue: activeIssue,
        state: plainifyUserText(formatStartupState(gateState ?? status, issueStatus)),
        recent_decision: plainifyUserText(formatRecentDecision(activeIssue, candidateQueue)),
        next: plainifyUserText(nextAction),
      },
      context: {
        line: formatStartupContextLine(contextBudget),
      },
      ...(failureNotice ? { failure_notice: failureNotice } : {}),
      input_waiting: {
        ...inputWaiting,
      },
    },
    boundaries: [
      'status transition requires explicit human approval',
      'release-scope inclusion requires explicit human approval',
      'durable work requires explicit human approval',
      'external write requires explicit human approval',
      'gate pass requires fresh verification and explicit main-agent gate action',
    ],
  };
}

function buildStartupInputWaiting(gateState, nextCandidate = null, failureNotice = null) {
  // POK-327 — 실패 기록이 있으면 "이어서 재시도" 경로를 우선 안내한다 (완료 상태 제외).
  if (failureNotice && gateState !== 'gate_passed') {
    return {
      message: failureNotice.resume_message,
      guard: '애매하면 /pokit.clarify 로 AC/범위를 먼저 정리합니다. 확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
    };
  }
  if (gateState === 'gate_passed') {
    const target = parseCandidateId(nextCandidate) ?? '다음 후보';
    return {
      message: `"진행해줘" → /pokit.next 로 ${target} 전환.`,
      guard: '애매하면 /pokit.clarify 로 AC/범위를 먼저 정리합니다. 확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
    };
  }
  if (gateState === 'pending') {
    return {
      message: '"진행해줘" → /pokit.issue 로 현재 이슈 실행.',
      guard: '애매하면 /pokit.clarify 로 AC/범위를 먼저 정리합니다. 확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
    };
  }
  return {
    message: '현재 상태가 애매하면 /pokit.clarify 로 먼저 정리합니다.',
    guard: '확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
  };
}

export function buildPreExecutionPreviewCardFields({
  activeIssue = null,
  issue = {},
  issueText = '',
} = {}) {
  return {
    card_type: 'pre_execution_preview',
    title: '⚠️ POKit2 실행 전 확인',
    display_only: true,
    approval_required: true,
    approves_status_transition: false,
    approves_release_scope_inclusion: false,
    approves_durable_work: false,
    approves_external_write: false,
    approves_gate_pass: false,
    fields: {
      current: {
        issue: activeIssue ?? issue.id ?? null,
        title: issue.title ?? firstMarkdownHeading(issueText),
      },
      preview: {
        purpose: extractPoSummaryLine(issueText, '왜 하는가')
          ?? firstBriefSentence(issueText)
          ?? koreanPoLine(
            issue.goal,
            '현재 이슈의 목적과 완료 기준을 확인한 뒤 실행을 시작한다.'
          ),
        user_improvement: extractPoSummaryLine(issueText, '끝나면 뭐가 달라지는가') ?? defaultUserImprovement(),
        before: koreanPoLine(
          firstBriefSentence(issueText),
          null,
          null,
          '진행 요청 이후 실행 절차와 증거 기준이 흐려질 수 있다.'
        ),
        after: '선택 이후 /pokit.issue Step 1 사전 확인으로 진입한다.',
      },
      input_waiting: {
        message: 'a) 수동  b) 자동  c) 중단',
        guard: '선택 전에는 파일 수정, 게이트 통과, 외부 쓰기를 하지 않습니다.',
      },
      selection: {
        a: { mode: 'manual-confirm', worker_authorization: 'not_required' },
        b: { mode: 'automatic', worker_authorization: 'authorized' },
        c: { mode: 'stop', worker_authorization: 'not_required' },
      },
    },
  };
}

function buildExecutionReasoningChecklist({
  command,
  activeIssue = null,
  gateState = null,
  issueStatus = null,
  issue = {},
} = {}) {
  if (command?.kind !== 'execution_mode_selection' || command.mode === 'stop') return undefined;

  const workerTasksNeed = issue.worker_tasks ?? (Number(issue.produces?.length ?? 0) >= 3 ? 'recommended' : 'evaluate-before-dispatch');
  const fallbackReason = command.worker_authorization === 'authorized'
    ? '해당 없음'
    : '워커 권한 필요';

  return {
    card_type: 'execution_reasoning_checklist',
    title: 'POKit2 실행 추론 체크',
    display_only: true,
    fields: {
      selected_skill: 'pokit.issue',
      active_issue: activeIssue,
      gate_state: gateState,
      issue_status: issueStatus,
      execution_approval: command.raw,
      mode: command.mode,
      worker_authorization: command.worker_authorization,
      worker_tasks_need: workerTasksNeed,
      worker_availability: command.worker_authorization === 'authorized' ? 'dispatch_allowed' : 'not_authorized',
      fallback_reason: fallbackReason,
      // POK-247 (AC1/AC5/AC6) — the runner classifies the upcoming steps as 🟢 auto vs
      // 🔴 human-confirm and publishes the plan on the card; the skill/main acts on it.
      safe_step_plan: buildSafeStepPlan(),
      post_change_review_plan: 'review_worker 실행 또는 narrow skip 사유 기록',
      verification_plan: 'focused tests, doctor, and risk-appropriate suite before gate',
      next_step: '/pokit.issue Step 1 Pre-verification',
    },
  };
}

export function buildPostRunnerPlanPayload({
  command,
  activeIssue = null,
  issue = {},
} = {}) {
  const workerTasksNeed = issue.worker_tasks ?? (Number(issue.produces?.length ?? 0) >= 3 ? 'recommended' : 'evaluate-before-dispatch');
  const workerDecision = command?.worker_authorization === 'authorized' && workerTasksNeed !== 'not_required'
    ? 'fan-out'
    : 'fallback';
  const fallbackReason = workerDecision === 'fallback'
    ? resolvePostRunnerFallbackReason({ command, workerTasksNeed })
    : undefined;

  const payload = {
    selected_skill: 'pokit.issue',
    selected_option: command?.selected_option,
    mode: command?.mode,
    worker_authorization: command?.worker_authorization,
    active_issue: activeIssue,
    worker_tasks_need: workerTasksNeed,
    worker_decision: workerDecision,
    post_change_review_plan: 'review_worker',
    verification_plan: 'focused tests + doctor + risk-appropriate suite',
  };
  if (fallbackReason) payload.fallback_reason = fallbackReason;
  return payload;
}

function resolvePostRunnerFallbackReason({ command, workerTasksNeed } = {}) {
  if (workerTasksNeed === 'not_required') return 'trivial-scope';
  if (command?.worker_authorization !== 'authorized') return 'worker-unavailable';
  return 'cross-file-invariant';
}

export function validatePostRunnerPlanPayload(payload = {}) {
  const required = [
    'selected_skill',
    'mode',
    'worker_authorization',
    'active_issue',
    'worker_decision',
    'post_change_review_plan',
    'verification_plan',
  ];
  for (const field of required) {
    if (payload[field] == null || payload[field] === '') {
      throw new Error(`post_runner_plan payload missing ${field}`);
    }
  }
  if (payload.selected_skill !== 'pokit.issue') {
    throw new Error(`post_runner_plan payload selected_skill must be pokit.issue`);
  }
  if (!VALID_POST_RUNNER_WORKER_DECISIONS.has(payload.worker_decision)) {
    throw new Error(`post_runner_plan payload worker_decision must be fan-out or fallback`);
  }
  if (payload.worker_decision === 'fallback') {
    if (!payload.fallback_reason) {
      throw new Error(`post_runner_plan payload fallback_reason is required when worker_decision is fallback`);
    }
    if (!VALID_POST_RUNNER_FALLBACK_REASONS.has(payload.fallback_reason)) {
      throw new Error(`post_runner_plan payload fallback_reason is invalid: ${payload.fallback_reason}`);
    }
  }
  return true;
}

function formatSprintLine(sprint, candidateCount) {
  if (!sprint) return null;
  if (Number.isInteger(candidateCount)) return `${sprint} (mid-sprint, candidates 잔여 ${candidateCount})`;
  return sprint;
}

function formatRecentDecision(activeIssue, candidateQueue = []) {
  const next = candidateQueue.map(parseCandidateId).find((id) => id && id !== activeIssue);
  if (activeIssue && next) return `${activeIssue} 먼저, ${next} 이후`;
  return activeIssue ? `${activeIssue} 진행` : null;
}

function formatStartupState(gateState, issueStatus) {
  const parts = [];
  if (gateState) parts.push(`gate_state: ${gateState}`);
  if (issueStatus) parts.push(`status: ${issueStatus}`);
  return parts.join(' / ') || null;
}

function formatStartupContextLine(contextBudget) {
  if (!contextBudget) return null;
  const startup = Number(contextBudget.startup_token_count) || 0;
  const expectedWork = Number(contextBudget.work_read_token_count) || 0;
  return `시작 ${formatTokenK(startup)} / 작업 0 / 예상 +${formatTokenK(expectedWork)}`;
}

function formatTokenK(value) {
  return `${(value / 1000).toFixed(1)}k`;
}

function parseCandidateId(candidate) {
  return extractIssueId(candidate);
}

function extractPoSummaryLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^- \\*\\*${escaped}\\*\\*:\\s*(.+)$`, 'm');
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function koreanPoLine(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (/[가-힣]/.test(trimmed)) return trimmed;
  }
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() ?? '';
}

function firstBriefSentence(text) {
  const brief = text.match(/(?:^|\n)## Brief\n+([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
  if (!brief) return null;
  return brief.split(/\n\n|(?<=\.)\s+/).map((part) => part.trim()).find(Boolean) ?? null;
}

function firstMarkdownHeading(text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function defaultUserImprovement() {
  return '사용자는 실행 전에 자동/수동 실행을 고를 수 있다.';
}

// POK-141 — parseFrontmatterTimestamp and deriveIssueDurationFromCard have
// been moved to ./lib/issue-duration.mjs (POK-196). They are re-exported above
// to preserve the existing export surface.

function todayUtcDateRunner() {
  return new Date().toISOString().slice(0, 10);
}

async function readIssueFrontmatter(root, issuePath) {
  try {
    return parseFrontmatter(await readIssueText(root, issuePath));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function readIssueText(root, issuePath) {
  return readFile(path.join(root, issuePath), 'utf8');
}

async function readOptionalIssueText(root, issuePath) {
  try {
    return await readIssueText(root, issuePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

// POK-202: read a card's gate_state without trusting release-scope.yaml status cache.
// Returns the gate_state string (e.g. 'gate_passed', 'pending') or null if unknown/missing.
async function readCardGateState(root, issueId) {
  try {
    const cardPath = await resolveActiveIssuePath(root, issueId);
    if (!cardPath) return null;
    const text = await readOptionalIssueText(root, cardPath);
    if (!text) return null;
    const fm = parseFrontmatter(text);
    return fm.gate_state ?? null;
  } catch {
    return null;
  }
}

export async function readReleaseScope(root, sprint) {
  if (!sprint) return { candidateQueue: [], candidateCount: null };
  try {
    const text = await readFile(path.join(root, '.ai-os/sprints', sprint, 'release-scope.yaml'), 'utf8');
    // POK-202: an entry is a live candidate iff it has a lifecycle status (status != null,
    // which excludes deferred/reason-only entries) AND its card's gate_state !== 'gate_passed'.
    // The yaml status VALUE is no longer trusted to decide done-ness — the CARD decides.
    const allEntries = parseAcceptedCandidates(text).filter((e) => e.status != null);
    const entriesWithState = await Promise.all(
      allEntries.map(async (entry) => ({
        entry,
        gateState: await readCardGateState(root, entry.id),
      }))
    );
    let entries = entriesWithState
      .filter(({ gateState }) => gateState !== 'gate_passed')
      .map(({ entry }) => entry);
    if (entries.length === 0) entries = parseCandidateDecisionGateEntries(text);
    const claimMap = await readClaimMap(root);
    const withClaims = entries.map((entry) => ({
      ...entry,
      claim: claimMap.get(entry.id) ?? null,
    }));
    const orderedEntries = [
      ...withClaims.filter((entry) => !entry.claim),
      ...withClaims.filter((entry) => entry.claim),
    ];
    return {
      candidateQueue: orderedEntries.map((entry, index) => formatCandidateQueueLine(entry, index)),
      candidateCount: orderedEntries.length,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { candidateQueue: [], candidateCount: null };
    throw error;
  }
}

async function readClaimMap(root) {
  try {
    const claims = await listActiveIssueClaims(root);
    const map = new Map();
    for (const claim of claims) {
      if (!map.has(claim.issue_id)) map.set(claim.issue_id, claim);
    }
    return map;
  } catch {
    return new Map();
  }
}

function formatCandidateQueueLine(entry, index) {
  const suffix = entry.claim ? ' — 다른 세션 진행 중/점유' : '';
  return `${index + 1}) ${entry.id} — ${entry.title}${suffix}`;
}

function parseAcceptedCandidates(text) {
  const accepted = text.match(/(?:^|\n)accepted:\n([\s\S]*?)(?=\n(?:triage|out_of_scope|gate_conditions):|$)/)?.[1] ?? '';
  const chunks = accepted.split(/\n\s*-\s+id:\s*/).slice(1);
  return chunks.map((chunk) => {
    const id = chunk.match(/^([A-Z]+-\d{3})/)?.[1] ?? null;
    const title = chunk.match(/\n\s+title:\s*"?([^"\n]+)"?/)?.[1] ?? null;
    const status = chunk.match(/\n\s+status:\s*([A-Za-z0-9_-]+)/)?.[1] ?? null;
    return { id, title, status };
  }).filter((entry) => entry.id);
}

function parseCandidateDecisionGateEntries(text) {
  const gateBlock = text.match(/(?:^|\n)candidate_decision_gate:\n([\s\S]*?)(?=\n(?:deferred|retro_action_mapping|gate_conditions):|$)/)?.[1] ?? '';
  const decideBlock = gateBlock.match(/(?:^|\n)\s+decide:\n([\s\S]*?)(?=\n\s+[A-Za-z0-9_-]+:|\n[A-Za-z0-9_-]+:|$)/)?.[1] ?? '';
  const ids = Array.from(
    decideBlock.matchAll(new RegExp(`^\\s*-\\s+(${ISSUE_ID_SOURCE})\\s*$`, 'gim')),
    (match) => assertIssueId(match[1])
  );
  if (ids.length === 0) return [];

  const titleById = new Map();
  for (const entry of parseScopedIssueList(text, 'candidates')) titleById.set(entry.id, entry.title);
  for (const entry of parseScopedIssueList(text, 'accepted')) titleById.set(entry.id, entry.title);

  return ids.map((id) => ({
    id,
    title: titleById.get(id) ?? 'candidate decision gate',
    status: 'candidate_decision',
  }));
}

function parseScopedIssueList(text, sectionName) {
  const body = text.match(new RegExp(`(?:^|\\n)${sectionName}:\\n([\\s\\S]*?)(?=\\n[A-Za-z0-9_-]+:|$)`))?.[1] ?? '';
  const chunks = body.split(/\n\s*-\s+id:\s*/).slice(1);
  return chunks.map((chunk) => {
    const id = chunk.match(/^([A-Z]+-\d{3})/)?.[1] ?? null;
    const title = chunk.match(/\n\s+title:\s*"?([^"\n]+)"?/)?.[1] ?? null;
    return { id, title };
  }).filter((entry) => entry.id);
}

// parseFrontmatter imported from ./lib/issue-frontmatter.mjs (POK-339)

// POK-271 — buildCompleteCardFields and runCompleteCommand have been moved to
// ./lib/complete-card.mjs (POK-307). They are re-exported above to preserve
// the existing export surface.

function formatPreflight(result) {
  return JSON.stringify({
    status: result.status,
    command: result.command,
    activeIssue: result.activeIssue,
    issuePath: result.issuePath,
    runnerAssignment: result.runnerAssignment,
    verification_intensity: result.verificationIntensity,
    lifecycleCard: result.lifecycleCard,
    renderedLifecycleCard: result.renderedLifecycleCard,
    preExecutionPreviewCard: result.preExecutionPreviewCard,
    renderedPreExecutionPreviewCard: result.renderedPreExecutionPreviewCard,
    executionReasoningChecklist: result.executionReasoningChecklist,
    renderedExecutionReasoningChecklist: result.renderedExecutionReasoningChecklist,
    postRunnerExecutionLock: result.postRunnerExecutionLock,
    sessionGuidanceCard: result.sessionGuidanceCard,
    renderedSessionGuidanceCard: result.renderedSessionGuidanceCard,
    backlogCard: result.backlogCard,
    renderedBacklogCard: result.renderedBacklogCard,
    deferredLedger: result.deferredLedger,
    renderedDeferredLedgerCard: result.renderedDeferredLedgerCard,
    nextAction: result.nextAction,
  }, null, 2);
}

// POK-353 — loop 한 틱: 멈춤조건 4종 평가 → 걸리면 사람 호출 카드, 아니면 두 자율
// 이음새(다음후보·retro 표면화) 연속 출력. 큐/집계/게이트분류는 기존 메커니즘에 위임.
export async function runLoopTickCommand(args = [], { root = process.cwd() } = {}) {
  const poHalt = args.includes('--po-halt');
  let gateFailReason = null;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--gate-fail' && args[index + 1] !== undefined) {
      gateFailReason = args[index + 1];
      index += 1;
    }
  }
  const currentText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
  const current = parseFrontmatter(currentText);
  const activeIssue = current.active_issue ?? null;

  const releaseScope = await readReleaseScope(root, current.active_sprint);
  const candidateCount = releaseScope.candidateCount;

  // 반복 상한 신호: failure_context.attempt(자동 누적)가 현재 active issue 것일 때만.
  const failure = parseFailureContext(current.failure_context);
  const reopenAttempt = failure && failure.issue === activeIssue ? failure.attempt : 0;

  // 두 자율 이음새 렌더 (위임 호출).
  const candidateCard =
    releaseScope.candidateQueue && releaseScope.candidateQueue.length
      ? ['╭─ 🔭 다음 후보', '│', ...releaseScope.candidateQueue.map((line) => `│   ${line}`), '╰─'].join('\n')
      : null;
  const deferredLedger = await aggregateDeferredLedger(root);
  const retroCard = renderDeferredLedgerCard(deferredLedger);

  const tick = runLoopTick({
    stopInputs: { poHalt, gateFailReason, reopenAttempt, candidateCount },
    candidateCard,
    retroCard,
  });
  return { ...tick, activeIssue, candidateCount, reopenAttempt };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const args = process.argv.slice(2);
  if (args[0] === 'metrics') {
    // POK-206 — INTENTIONAL asymmetry: the low-level `metrics` subcommand records
    // exactly what is passed (explicit flags / card-derive) and does NOT apply the
    // gate-pass idempotent freeze or marker read. `gate-pass` is the issue-completion
    // chokepoint that owns marker/freeze; `metrics` is a manual tool. It still honors
    // --dry-run (parsed into options) for a non-destructive preview.
    const result = await recordIssueCompletionMetrics({
      root: process.cwd(),
      ...parseMetricsArgs(args),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (args[0] === 'gate-pass') {
    const result = await runGatePassCommand(args, { root: process.cwd(), date: todayUtcDateRunner() });
    process.exitCode = result.ok ? 0 : 1;
  } else if (args[0] === 'complete') {
    // POK-271 (AC1) — runner-owned complete card output.
    const result = await runCompleteCommand(args, { root: process.cwd() });
    process.exitCode = result.ok ? 0 : 1;
  } else if (args[0] === 'transition-status') {
    // POK-325 — pokit-next transition chokepoint: sync the target issue card's
    // frontmatter status so preflight does not block on a stale card.
    const result = await runTransitionStatusCommand(args, { root: process.cwd() });
    process.exitCode = result.ok ? 0 : 1;
  } else if (args[0] === 'record-failure') {
    // POK-327 — 검증 실패 기록 chokepoint: 단계·원인·시도 횟수를 current.md
    // failure_context에 구조화 기록한다. 기록은 이 러너 명령으로만 발행한다.
    const issueId = args[1];
    let stage = 'other';
    let reason = '';
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] === '--stage' && args[index + 1] !== undefined) {
        stage = args[index + 1];
        index += 1;
      } else if (args[index] === '--reason' && args[index + 1] !== undefined) {
        reason = args[index + 1];
        index += 1;
      }
    }
    if (!isIssueId(issueId)) {
      console.error(`error: record-failure requires issue id (got: ${issueId ?? '<missing>'})`);
      process.exitCode = 1;
    } else {
      const result = await recordFailureContext({ root: process.cwd(), issueId, stage, reason });
      console.log(JSON.stringify(result));
      process.exitCode = result.ok ? 0 : 1;
    }
  } else if (args[0] === 'reissue-authored') {
    // POK-325 — definition-change chokepoint: re-emit the issue_authored receipt
    // after a title edit so doctor's content-hash check passes again.
    const issueId = args[1];
    let reason = 'definition_change_reissue';
    for (let index = 2; index < args.length; index += 1) {
      if (args[index] === '--reason' && args[index + 1] !== undefined) {
        reason = args[index + 1];
        index += 1;
      }
    }
    try {
      const cardPath = await resolveActiveIssuePath(process.cwd(), issueId);
      const result = await reissueIssueAuthoredReceipt({ root: process.cwd(), cardPath, reason });
      console.log(JSON.stringify(result));
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      console.error(`error: reissue_authored_failed — ${error.message}`);
      process.exitCode = 1;
    }
  } else if (args[0] === 'loop-tick') {
    // POK-353 — loop 자율 틱: 멈춤조건 평가 후 체이닝 또는 사람 호출 카드 출력.
    const result = await runLoopTickCommand(args.slice(1), { root: process.cwd() });
    console.log(result.card);
    process.exitCode = 0;
  } else {
    const phrase = args.join(' ') || '$pokit';
    const result = await runPreflight({ root: process.cwd(), phrase });
    console.log(formatPreflight(result));
    process.exitCode = result.status === 'fail' ? 1 : 0;
  }
}
