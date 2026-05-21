#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDoctor } from './pokit-doctor.mjs';

const POKIT_PHRASES = [
  '$pokit',
  'POKit 시작',
  'POKit 시작하자',
  '포킷 시작',
  '오늘 뭐 하지',
  '이슈로 잡아줘',
  '완료 가능한지 봐줘',
];

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

export function classifyPokitCommand(phrase) {
  const raw = typeof phrase === 'string' ? phrase.trim() : '';
  const lower = raw.toLocaleLowerCase('ko-KR');

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

export function resolveIssuePath(issueId) {
  if (!/^[A-Z][A-Z0-9]*-\d{3}$/.test(issueId ?? '')) {
    throw new Error(`Invalid POKit issue id: ${issueId}`);
  }

  return `.ai-os/${issueId}.md`;
}

export async function runPreflight({ root = process.cwd(), phrase = '$pokit' } = {}) {
  const currentText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
  const current = parseFrontmatter(currentText);
  const activeIssue = current.active_issue ?? null;
  const issuePath = activeIssue ? resolveIssuePath(activeIssue) : null;
  const issue = issuePath ? await readIssueFrontmatter(root, issuePath) : {};
  const doctorResult = await runDoctor({ root });
  const failures = doctorResult.items.filter((item) => item.status === 'fail');
  const warnings = doctorResult.items.filter((item) => item.status === 'warning');
  const nextAction = failures.find((item) => item.next_action)?.next_action
    ?? current.next_action
    ?? warnings.find((item) => item.next_action)?.next_action
    ?? null;
  const command = classifyPokitCommand(phrase);
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
        message: '"진행"이라고 말하면 시작합니다.',
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
  return JSON.stringify({
    status: result.status,
    command: result.command,
    activeIssue: result.activeIssue,
    issuePath: result.issuePath,
    runnerAssignment: result.runnerAssignment,
    lifecycleCard: result.lifecycleCard,
    summary: result.doctor.summary,
    nextAction: result.nextAction,
  }, null, 2);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const phrase = process.argv.slice(2).join(' ') || '$pokit';
  const result = await runPreflight({ root: process.cwd(), phrase });
  console.log(formatPreflight(result));
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
