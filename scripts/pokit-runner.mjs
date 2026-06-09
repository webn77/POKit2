#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDoctor } from './pokit-doctor.mjs';
// 정확 패턴 통일(자릿수/접두)은 후속 SSoT 작업; 여기선 기존 prefix-agnostic 패턴 재사용
import { findIssue, ISSUE_ID_PATTERN } from './pokit-project-contract.mjs';
import { hasActiveIssue, renderDraftCard } from './active-issue-guard.mjs';

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
// like '고' never match as a substring of ordinary conversation.
// Ported verbatim from scripts/pokit-runner.mjs lines 61-75.
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

const TRANSITION_REQUEST_PHRASES = [
  '/pokit.next',
  '다음으로',
  '1번',
  '제안대로',
  '바로 이어',
  '이어서 진행',
  '다음 진행해줘',
];

// Ported verbatim from scripts/pokit-runner.mjs lines 92-99.
const EXECUTION_MODE_SELECTIONS = Object.freeze({
  a: Object.freeze({ mode: 'manual-confirm', worker_authorization: 'not_required' }),
  '수동': Object.freeze({ mode: 'manual-confirm', worker_authorization: 'not_required' }),
  b: Object.freeze({ mode: 'automatic', worker_authorization: 'authorized' }),
  '자동': Object.freeze({ mode: 'automatic', worker_authorization: 'authorized' }),
  c: Object.freeze({ mode: 'stop', worker_authorization: 'not_required' }),
  '중단': Object.freeze({ mode: 'stop', worker_authorization: 'not_required' }),
});

const RUNNER_COMMAND_CONTRACTS = Object.freeze({
  '/pokit add': Object.freeze([
    'command',
    'requested_action',
    'target_project',
    'proposed_issue',
    'lifecycle_card',
    'rendered_lifecycle_card',
    'approval_required',
  ]),
  '/pokit dispatch': Object.freeze([
    'command',
    'target_issue',
    'runner_assignment',
    'lifecycle_card',
    'rendered_lifecycle_card',
    'approval_required',
  ]),
  '/pokit gate': Object.freeze([
    'command',
    'target_issue',
    'required_evidence',
    'lifecycle_card',
    'rendered_lifecycle_card',
    'approval_required',
  ]),
});

const ASSIGNMENT_BY_AGENT_PROFILE = Object.freeze({
  planner: Object.freeze({
    worker_kind: 'planner_worker',
    difficulty: 'standard',
    model_tier: 'strong',
    runtime_preference: 'auto',
    provider_model_source: 'config_resolved_only',
    permission_level: 'propose_only',
  }),
  coder: Object.freeze({
    worker_kind: 'implementation_worker',
    difficulty: 'standard',
    model_tier: 'standard',
    runtime_preference: 'auto',
    provider_model_source: 'config_resolved_only',
    permission_level: 'write_scoped',
  }),
  reviewer: Object.freeze({
    worker_kind: 'review_worker',
    difficulty: 'standard',
    model_tier: 'strong',
    runtime_preference: 'auto',
    provider_model_source: 'config_resolved_only',
    permission_level: 'read_only',
  }),
  'data-analyst': Object.freeze({
    worker_kind: 'data_worker',
    difficulty: 'standard',
    model_tier: 'standard',
    runtime_preference: 'auto',
    provider_model_source: 'config_resolved_only',
    permission_level: 'read_only',
  }),
});

const DEFAULT_ASSIGNMENT = Object.freeze({
  worker_kind: 'main_session',
  difficulty: 'standard',
  model_tier: 'standard',
  runtime_preference: 'auto',
  provider_model_source: 'config_resolved_only',
  permission_level: 'main_only',
});

export function matchesPokitPhrase(phrase) {
  if (typeof phrase !== 'string') return false;
  const normalized = phrase.trim();
  return POKIT_PHRASES.some((entry) => entry.toLocaleLowerCase('ko-KR') === normalized.toLocaleLowerCase('ko-KR'));
}

// Ported from scripts/pokit-runner.mjs lines 208-213.
function matchesExecutionRequestPhrase(text) {
  const normalized = text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  return EXECUTION_REQUEST_PHRASES.some(
    (entry) => entry.toLocaleLowerCase('ko-KR').replace(/\s+/g, '') === normalized,
  );
}

function matchesTransitionRequestPhrase(text) {
  const normalized = text.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  return TRANSITION_REQUEST_PHRASES.some(
    (entry) => entry.toLocaleLowerCase('ko-KR').replace(/\s+/g, '') === normalized,
  );
}

export function classifyPokitCommand(phrase) {
  const raw = typeof phrase === 'string' ? phrase.trim() : '';
  const lower = raw.toLocaleLowerCase('ko-KR');

  if (matchesTransitionRequestPhrase(raw)) {
    return {
      kind: 'transition_request',
      command: raw,
      raw,
      mutates_state: false,
      requires_human_approval: true,
      output_fields: [
        'command',
        'active_issue',
        'issue_path',
        'next_transition_card',
        'approval_required',
      ],
    };
  }

  // Ported from scripts/pokit-runner.mjs lines 227-262.
  // Plain execution-approval synonyms (e.g. "진행해줘", "고", "고고").
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

  // A leading "<ISSUE-ID> " token only NAMES the execution target; the execution
  // synonym must still be recognized in the remainder (e.g. "<ISSUE-ID> 진행하자",
  // "GG-001 고"). Uses ISSUE_ID_PATTERN (prefix-agnostic) per AC3.
  // Generalised from scripts/pokit-runner.mjs lines 246-263 (was /^(POK-\d{3})\s+/).
  // Strip ^ and $ anchors from ISSUE_ID_PATTERN.source before embedding in target regex.
  const issueIdInner = ISSUE_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');
  const targetMatch = raw.match(new RegExp(`^(${issueIdInner})\\s+(.+)$`, 'i'));
  if (targetMatch && matchesExecutionRequestPhrase(targetMatch[2])) {
    return {
      kind: 'execution_request',
      command: raw,
      raw,
      target_issue: targetMatch[1].toUpperCase(),
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

  // Ported from scripts/pokit-runner.mjs lines 265-286.
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
        'approval_required',
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
      'rendered_lifecycle_card',
      'approval_required',
    ],
  };
}

export async function resolveIssuePath(issueId, root = process.cwd()) {
  if (!ISSUE_ID_PATTERN.test(issueId ?? '')) {
    throw new Error(`Invalid POKit issue id: ${issueId}`);
  }
  return (await findIssue(root, issueId))?.relativePath ?? `.ai-os/${issueId}.md`;
}

export async function runPreflight({ root = process.cwd(), phrase = '$pokit' } = {}) {
  const command = classifyPokitCommand(phrase);

  // ── D3: execution_request + no active_issue → blocking_draft card ──────────
  // ── AC3: execution_request + active_issue exists → pre_execution_preview card ──
  if (command.kind === 'execution_request' || command.kind === 'transition_request') {
    const activeExists = await hasActiveIssue(root);
    if (!activeExists) {
      const workSummary = command.target_issue
        ? `${command.target_issue} 실행 요청`
        : phrase;
      const draftCardText = renderDraftCard({}, workSummary);
      const blockingCard = buildBlockingDraftCardFields({ workSummary, draftCardText });
      const renderedBlockingCard = renderBlockingDraftCard({ blockingCard });
      return {
        status: 'ok',
        phraseMatched: false,
        command,
        activeIssue: null,
        issuePath: null,
        runnerAssignment: null,
        lifecycleCard: blockingCard,
        renderedLifecycleCard: renderedBlockingCard,
        doctor: null,
        counts: null,
        warnings: [],
        failures: [],
        nextAction: '이슈 생성 후 실행하세요: node scripts/pokit-issue-create.mjs --title "<제목>"',
      };
    } else {
      const currentText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
      const current = parseFrontmatter(currentText);
      const activeIssue = current.active_issue ?? null;
      const issuePath = activeIssue ? await resolveIssuePath(activeIssue, root) : null;
      let issueText = '';
      let issue = {};
      if (issuePath) {
        try {
          issueText = await readFile(path.join(root, issuePath), 'utf8');
          issue = parseFrontmatter(issueText);
        } catch {
          // File may not exist yet; proceed with empty issue.
        }
      }
      const gateState = current.gate_state ?? issue.gate_state ?? null;
      if (gateState === 'gate_passed' || command.kind === 'transition_request') {
        const nextCard = buildNextTransitionRequiredCardFields({
          activeIssue,
          issue,
          gateState,
          command,
        });
        const renderedNextCard = renderNextTransitionRequiredCard({ nextCard });
        return {
          status: 'ok',
          phraseMatched: false,
          command,
          activeIssue,
          issuePath,
          runnerAssignment: resolveRunnerAssignment(issue),
          lifecycleCard: nextCard,
          renderedLifecycleCard: renderedNextCard,
          doctor: null,
          counts: null,
          warnings: [],
          failures: [],
          nextAction: nextCard.fields?.next_step ?? null,
        };
      }
      // AC3: active issue exists and is not gate_passed → return pre-execution preview card (a/b/c selection)
      const previewCard = buildPreExecutionPreviewCardFields({ activeIssue, issue, issueText });
      const renderedPreExecutionPreviewCard = renderPreExecutionPreviewCard({ previewCard });
      return {
        status: 'ok',
        phraseMatched: false,
        command,
        activeIssue,
        issuePath,
        runnerAssignment: resolveRunnerAssignment(issue),
        lifecycleCard: previewCard,
        renderedLifecycleCard: renderedPreExecutionPreviewCard,
        renderedPreExecutionPreviewCard,
        doctor: null,
        counts: null,
        warnings: [],
        failures: [],
        nextAction: 'a) 수동  b) 자동  c) 중단 중 하나를 선택하세요.',
      };
    }
  }

  // ── D6: execution_mode_selection → reasoning checklist card ────────────────
  if (command.kind === 'execution_mode_selection') {
    const currentText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
    const current = parseFrontmatter(currentText);
    const activeIssue = current.active_issue ?? null;
    const issuePath = activeIssue ? await resolveIssuePath(activeIssue, root) : null;
    const issue = issuePath ? await readIssueFrontmatter(root, issuePath) : {};
    const gateState = current.gate_state ?? issue.gate_state ?? null;

    if (gateState === 'gate_passed') {
      const nextCard = buildNextTransitionRequiredCardFields({
        activeIssue,
        issue,
        gateState,
        command,
      });
      const renderedNextCard = renderNextTransitionRequiredCard({ nextCard });
      return {
        status: 'ok',
        phraseMatched: false,
        command,
        activeIssue,
        issuePath,
        runnerAssignment: resolveRunnerAssignment(issue),
        lifecycleCard: nextCard,
        renderedLifecycleCard: renderedNextCard,
        doctor: null,
        counts: null,
        warnings: [],
        failures: [],
        nextAction: nextCard.fields?.next_step ?? null,
      };
    }

    const checklistCard = buildExecutionReasoningChecklistFields({
      command,
      activeIssue,
      gateState,
      issueStatus: issue.status ?? current.status ?? null,
      issue,
    });
    const renderedChecklist = checklistCard
      ? renderExecutionReasoningChecklistCard({ checklist: checklistCard })
      : undefined;

    return {
      status: 'ok',
      phraseMatched: false,
      command,
      activeIssue,
      issuePath,
      runnerAssignment: resolveRunnerAssignment(issue),
      lifecycleCard: checklistCard,
      renderedLifecycleCard: renderedChecklist,
      doctor: null,
      counts: null,
      warnings: [],
      failures: [],
      nextAction: checklistCard?.fields?.next_step ?? null,
    };
  }

  // ── startup_trigger / runner_command / unknown → existing startup card ──────
  const currentText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
  const current = parseFrontmatter(currentText);
  const activeIssue = current.active_issue ?? null;
  const issuePath = activeIssue ? await resolveIssuePath(activeIssue, root) : null;
  const issue = issuePath ? await readIssueFrontmatter(root, issuePath) : {};
  const doctorResult = await runDoctor({ root });
  const failures = doctorResult.items.filter((item) => item.status === 'fail');
  const warnings = doctorResult.items.filter((item) => item.status === 'warning');
  const nextAction = failures.find((item) => item.next_action)?.next_action
    ?? current.next_action
    ?? warnings.find((item) => item.next_action)?.next_action
    ?? null;
  const runnerAssignment = resolveRunnerAssignment(issue);
  const lifecycleCard = buildStartupLifecycleCardFields({
    activeIssue,
    status: doctorResult.status,
    project: current.active_project ?? issue.project ?? null,
    gateState: current.gate_state ?? issue.gate_state ?? null,
    issueStatus: issue.status ?? current.status ?? null,
    nextAction,
  });

  return {
    status: doctorResult.status,
    phraseMatched: matchesPokitPhrase(phrase),
    command,
    activeIssue,
    issuePath,
    runnerAssignment,
    lifecycleCard,
    doctor: {
      summary: doctorResult.summary,
      items: doctorResult.items,
    },
    counts: doctorResult.summary,
    warnings,
    failures,
    nextAction,
  };
}

export function resolveRunnerAssignment(issueFrontmatter = {}) {
  const assignment = ASSIGNMENT_BY_AGENT_PROFILE[issueFrontmatter.agent_profile] ?? DEFAULT_ASSIGNMENT;
  return {
    ...assignment,
    main_agent_required_actions: [
      'validate_scope',
      'approve_or_apply_outputs',
      'verify_before_gate_claim',
    ],
  };
}

export function buildStartupLifecycleCardFields({
  activeIssue = null,
  status = null,
  project = null,
  gateState = null,
  issueStatus = null,
  nextAction = null,
} = {}) {
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
        issue: activeIssue,
        state: [issueStatus, gateState ? `gate ${gateState}` : null].filter(Boolean).join(' / ') || status,
        next: nextAction,
      },
      input_waiting: {
        message: activeIssue
          ? '"진행"이라고 말하면 시작합니다.'
          : '먼저 node scripts/pokit-issue-create.mjs --title "첫 작업" 으로 첫 이슈를 만드세요.',
        guard: '확인 전에는 이슈 생성, 파일 수정, 게이트 실행을 하지 않습니다.',
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

// ── Blocking-draft card (D3) ─────────────────────────────────────────────────

function buildBlockingDraftCardFields({ workSummary = '', draftCardText = '' } = {}) {
  return {
    card_type: 'blocking_draft',
    display_only: true,
    approval_required: true,
    approves_durable_work: false,
    block_message: '실행 전에 이슈를 먼저 묶어야 합니다.',
    work_summary: workSummary,
    draft_card_text: draftCardText,
  };
}

function renderBlockingDraftCard({ blockingCard = {} } = {}) {
  const draftText = blockingCard.draft_card_text ?? '';
  return draftText;
}

function buildNextTransitionRequiredCardFields({
  activeIssue = null,
  issue = {},
  gateState = null,
  command = {},
} = {}) {
  const passed = gateState === 'gate_passed';
  return {
    card_type: 'next_transition_required',
    title: passed ? '⚠️ 다음 이슈 전환 필요' : '⚠️ pokit-next 실행 조건 미충족',
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
        title: issue.title ?? null,
        gate_state: gateState,
      },
      request: command.raw ?? command.command ?? null,
      message: passed
        ? '완료된 이슈에는 pokit.issue 실행 preview나 b 실행 모드를 다시 열지 않습니다.'
        : '현재 이슈가 gate_passed가 아니라서 pokit-next로 전환할 수 없습니다.',
      next_step: passed
        ? '다음 이슈를 선택한 뒤 node scripts/pokit-issue-use.mjs <ISSUE-ID>로 전환하세요.'
        : '현재 이슈를 먼저 완료하거나 /pokit.issue 실행 preview로 돌아가세요.',
    },
  };
}

function renderNextTransitionRequiredCard({ nextCard = {} } = {}) {
  const fields = nextCard.fields ?? {};
  const current = fields.current ?? {};
  return stripRightSideBorders([
    `╭─ ${nextCard.title ?? '⚠️ 다음 이슈 전환 필요'}`,
    '│',
    '│ 현재',
    `│   이슈      ${valueOrFallback(current.issue)}`,
    `│   제목      ${valueOrFallback(current.title)}`,
    `│   게이트    ${valueOrFallback(current.gate_state)}`,
    '│',
    '│ 라우팅',
    `│   요청      ${valueOrFallback(fields.request)}`,
    `│   판단      ${valueOrFallback(fields.message)}`,
    '│',
    '├─ 다음',
    `│   pokit-next: ${valueOrFallback(fields.next_step)}`,
    '╰─',
  ].join('\n'));
}

// ── Pre-execution preview card (D6, ported from dev runner lines 690-737) ────

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
          ?? issue.goal
          ?? firstBriefSentence(issueText)
          ?? '현재 이슈의 목적과 완료 기준을 확인한 뒤 실행을 시작한다.',
        user_improvement: extractPoSummaryLine(issueText, '끝나면 뭐가 달라지는가')
          ?? '사용자는 실행 전에 자동/수동 실행을 고를 수 있다.',
        before: firstBriefSentence(issueText)
          ?? '진행 요청 이후 실행 절차와 증거 기준이 흐려질 수 있다.',
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

// Inline renderer — ported from scripts/lib/lifecycle-card-renderer.mjs lines 47-70.
function renderPreExecutionPreviewCard({ previewCard = {} } = {}) {
  const current = previewCard.fields?.current ?? {};
  const preview = previewCard.fields?.preview ?? {};
  const inputWaiting = previewCard.fields?.input_waiting ?? {};

  return stripRightSideBorders([
    '╭─ ⚠️ POKit2 실행 전 확인',
    '│',
    '│ 이슈',
    `│   번호      ${valueOrFallback(current.issue)}`,
    `│   제목      ${valueOrFallback(current.title)}`,
    '│',
    '│ 미리보기',
    `│   목적      ${valueOrFallback(preview.purpose)}`,
    `│   사용자 개선 ${valueOrFallback(preview.user_improvement)}`,
    `│   이전 문제 ${valueOrFallback(preview.before)}`,
    `│   이후 해결 ${valueOrFallback(preview.after)}`,
    '│',
    '├─ 선택',
    `│   ${valueOrFallback(inputWaiting.message, 'a) 수동  b) 자동  c) 중단')}`,
    `│   ${valueOrFallback(inputWaiting.guard, '선택 전에는 파일 수정, 게이트 통과, 외부 쓰기를 하지 않습니다.')}`,
    '╰─',
  ].join('\n'));
}

// ── Execution reasoning checklist card (D6, ported from dev runner 739-776) ──

function buildExecutionReasoningChecklistFields({
  command,
  activeIssue = null,
  gateState = null,
  issueStatus = null,
  issue = {},
} = {}) {
  if (command?.kind !== 'execution_mode_selection' || command.mode === 'stop') return undefined;

  const workerTasksNeed = issue.worker_tasks
    ?? (Number(issue.produces?.length ?? 0) >= 3 ? 'recommended' : 'evaluate-before-dispatch');
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
      post_change_review_plan: 'review_worker 실행 또는 narrow skip 사유 기록',
      verification_plan: 'focused tests, doctor, and risk-appropriate suite before gate',
      next_step: '/pokit.issue Step 1 Pre-verification',
    },
  };
}

// Inline renderer — ported from scripts/lib/lifecycle-card-renderer.mjs lines 72-109.
// Note: safe_step_plan is a dev-only feature; starter omits it (Type C boundary).
function renderExecutionReasoningChecklistCard({ checklist = {} } = {}) {
  const fields = checklist.fields ?? {};

  return stripRightSideBorders([
    '╭─ 🧠 POKit2 실행 추론 체크',
    '│',
    '│ 승인',
    `│   경로      ${valueOrFallback(fields.selected_skill)}`,
    `│   이슈      ${valueOrFallback(fields.active_issue)}`,
    `│   게이트    ${valueOrFallback(fields.gate_state)}`,
    `│   승인 입력 ${valueOrFallback(fields.execution_approval)}`,
    `│   모드      ${formatExecutionMode(fields.mode)}`,
    '│',
    '│ 작업 방식',
    `│   워커 권한 ${formatWorkerAuthorization(fields.worker_authorization)}`,
    `│   워커 판단 ${formatWorkerAvailability(fields.worker_availability)}`,
    `│   fallback ${valueOrFallback(fields.fallback_reason)}`,
    '│',
    '├─ 실행 전 계획',
    `│   리뷰      ${valueOrFallback(fields.post_change_review_plan)}`,
    `│   검증      ${valueOrFallback(fields.verification_plan)}`,
    `│   다음      ${valueOrFallback(fields.next_step)}`,
    '╰─',
  ].join('\n'));
}

// ── Startup card renderer (unchanged from original) ──────────────────────────

async function readIssueFrontmatter(root, issuePath) {
  try {
    return parseFrontmatter(await readFile(path.join(root, issuePath), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result = {};
  let pendingKey = null;
  for (const line of match[1].split('\n')) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyValue) {
      pendingKey = keyValue[1];
      result[pendingKey] = normalizeValue(keyValue[2]);
      continue;
    }

    const listValue = line.match(/^\s*-\s*(.+)$/);
    if (listValue && pendingKey) {
      if (!Array.isArray(result[pendingKey])) result[pendingKey] = [];
      result[pendingKey].push(normalizeValue(listValue[1]));
    }
  }

  return result;
}

function normalizeValue(value) {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (trimmed === 'null') return null;
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function formatPreflight(result) {
  // Choose the appropriate rendered card based on what runPreflight returned.
  const renderedLifecycleCard = result.renderedLifecycleCard
    ?? renderStartupLifecycleCard(result.lifecycleCard);
  return JSON.stringify({
    status: result.status,
    command: result.command,
    activeIssue: result.activeIssue,
    issuePath: result.issuePath,
    runnerAssignment: result.runnerAssignment,
    lifecycleCard: result.lifecycleCard,
    renderedLifecycleCard,
    summary: result.doctor?.summary ?? null,
    nextAction: result.nextAction,
  }, null, 2);
}

function renderStartupLifecycleCard(lifecycleCard) {
  const current = lifecycleCard?.fields?.current ?? {};
  const input = lifecycleCard?.fields?.input_waiting ?? {};
  return [
    '╭─ 🚀 POKit2 세션 시작',
    '│',
    '│ 접속',
    `│   모드    ${lifecycleCard?.mode ?? '상태 확인'}`,
    '│',
    '│ 현재 진행',
    `│   프로젝트  ${current.project ?? 'unknown'}`,
    `│   이슈      ${current.issue ?? 'none'}`,
    `│   상태      ${current.state ?? 'unknown'}`,
    `│   다음      ${current.next ?? '-'}`,
    '│',
    '├─ 입력 대기',
    `│   ${input.message ?? '-'}`,
    `│   ${input.guard ?? '-'}`,
    '╰─',
  ].join('\n');
}

// ── Shared render helpers ─────────────────────────────────────────────────────

const RIGHT_SIDE_BORDERS = /[┐┤┘]/g;

function stripRightSideBorders(value) {
  return value.replace(RIGHT_SIDE_BORDERS, '');
}

function valueOrFallback(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function formatExecutionMode(value) {
  if (value === 'automatic') return '자동';
  if (value === 'manual-confirm') return '수동 확인';
  return valueOrFallback(value);
}

function formatWorkerAuthorization(value) {
  if (value === 'authorized') return '허용됨';
  if (value === 'not_required') return '필요 없음';
  return valueOrFallback(value);
}

function formatWorkerAvailability(value) {
  if (value === 'dispatch_allowed') return 'fan-out 가능';
  if (value === 'not_authorized') return '권한 없음';
  return valueOrFallback(value);
}

// ── Issue text helpers (for preview card field extraction) ───────────────────

function extractPoSummaryLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^- \\*\\*${escaped}\\*\\*:\\s*(.+)$`, 'm');
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function firstBriefSentence(text) {
  const brief = text.match(/(?:^|\n)## Brief\n+([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
  if (!brief) return null;
  return brief.split(/\n\n|(?<=\.)\s+/).map((part) => part.trim()).find(Boolean) ?? null;
}

function firstMarkdownHeading(text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const phrase = process.argv.slice(2).join(' ') || '$pokit';
  const result = await runPreflight({ root: process.cwd(), phrase });
  console.log(formatPreflight(result));
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
