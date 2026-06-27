#!/usr/bin/env node
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentHash, loadIssueAuthoredReceiptSet } from './lib/issue-create.mjs';
import {
  hasRoutingDecisionReceipt,
  loadIssueExecutionEnteredIds,
  loadIssuePreflightPassMap,
  loadPostRunnerExecutionLockMap,
  loadRoutingDecisionMap,
  loadSkillExecutionCheckpointMap,
  POKIT_ISSUE_SKILL_CHECKPOINT_STEPS,
} from './lib/event-log.mjs';
import { deriveStatus, isValidStatus } from './lib/status-enum.mjs';
import { validateOptionalFields } from './lib/optional-fields.mjs';
import { verifyFailureMemoryConsistency } from './lib/failure-memory.mjs';
import { listIssueFiles, resolveActiveIssuePath } from './lib/issue-paths.mjs';
import { parseFrontmatter, resolveIssueSprint } from './lib/issue-frontmatter.mjs';
import { listUserStateFiles } from './lib/user-state.mjs';
import { extractIssueId, isIssueId, ISSUE_ID_SOURCE } from './lib/issue-id.mjs';
import {
  requiredSectionsFor,
  READINESS_CONTENT_SECTIONS,
  readinessContentGaps,
  gateContentGaps,
  evaluatedGateContentSections,
} from './lib/issue-sections.mjs';
import { findVagueLanguage } from './lib/vague-language.mjs';
import { runSubIssueChecks } from './lib/sub-issue-check.mjs';
import { countGateLogs } from './lib/rule-section.mjs';
import { resolveDoctorGuidance } from './lib/doctor-messages.mjs';
import { assertPublicConfigHasNoSecrets, resolvePackageRoot } from './lib/pokit-config.mjs';
import {
  findMissingAfterGatePassEvents,
  readAfterGatePassEvents,
} from './lib/after-gate-pass-natural-hook.mjs';
import { classifyCommitStatus } from './lib/commit-status.mjs';
import { listActiveIssueClaims } from './lib/worktree-sessions.mjs';
import { buildEvidenceIndex } from './lib/derived-index.mjs';
import { verifyRetroSchema, retroPathFor, isTransitionalImmune } from './lib/retro-schema.mjs';
import {
  checkLifecycleCardSchemas,
} from './lib/doctor-lifecycle-card.mjs';
export { validateLifecycleCardOutput } from './lib/doctor-lifecycle-card.mjs';
import {
  VALID_FALLBACK_REASON_ENUM,
  checkWorkflowTraceWorkerEvidence,
  checkWorkflowTracePostChangeReviewEvidence,
} from './lib/doctor-workflow-trace.mjs';
import {
  checkV010MetricsEvidence,
  checkGateEvidenceGitTracking,
} from './lib/doctor-metrics-gate.mjs';
import {
  checkPokitVersionDrift,
  checkSchemaVersionKnown,
  KNOWN_SCHEMA_VERSIONS,
} from './lib/topology-version-guard.mjs';

const START_READ_ORDER = [
  'AGENTS.md',
  '.ai-os/current.md',
  '.ai-os/memory/session/handoff.md',
  '.ai-os/standards/startup-communication.md',
];

const WORK_READ_REQUIRED = [
  '.ai-os/status-board.md',
  '.ai-os/failure-index.md',
  '.ai-os/memory-index.md',
  '.ai-os/standards/communication.md',
  '.ai-os/standards/visualization.md',
  '.ai-os/standards/agent-invocation.md',
  '.ai-os/standards/artifact-standard.md',
  '.ai-os/standards/writing-style.md',
];

const ISSUE_FRONTMATTER_KEYS = [
  'id',
  'namespace',
  'issue_type',
  'canonical_state',
  'gate_state',
  'schema_version',
];

// SPEC_CODE_SECTIONS / GENERAL_SECTIONS now come from ./lib/issue-sections.mjs
// (POK-349 single source) — shared with the issue-create generator so the
// required-section list and the generated skeleton cannot drift apart.

const POKIT_ISSUE_SKILL_CONTRACT_TOKENS = [
  'needs_subagent_authorization',
  'b) 자동',
  'Workflow Trace',
  'worker-unavailable',
  'Post-change Review Gate',
  'review findings',
  'issue definition edits',
  'readiness transitions',
  'routing_decision',
  'selected_skill',
  'node scripts/pokit-routing-decision.mjs',
  '/pokit.backlog',
];

const POKIT_ISSUE_COMMAND_CONTRACT_TOKENS = [
  'Workflow Trace',
  'metrics.json',
  'Post-change review:',
  'Review findings:',
  'issue definition edits',
  'readiness transitions',
  '/pokit.backlog',
];

const POKIT_BACKLOG_BOUNDARY_CONTRACT_TOKENS = [
  'main_session_owns',
  'subagent_may',
  'subagent_must_not',
  'subagent_unavailable_fallback',
  'fallback_reason',
  'approval_before_mutation',
  'draft -> review -> recommendation card -> PO approval -> main creation',
  'Backlog Refinement',
  '작업 후보',
  '준비 상태',
  '먼저 할 일',
  '확인 질문',
  'issue modification',
  'grooming',
  'definition changes',
  'readiness transitions',
  'routing_decision',
  'selected_skill',
  'node scripts/pokit-routing-decision.mjs',
];

const CODEX_INSTALLED_SKILL_CONTRACTS = [
  {
    name: 'pokit-issue',
    repoPath: '.claude/skills/pokit-issue/SKILL.md',
    installedPath: 'skills/pokit-issue/SKILL.md',
    displayPath: '~/.codex/skills/pokit-issue/SKILL.md',
    tokens: POKIT_ISSUE_SKILL_CONTRACT_TOKENS,
  },
  {
    name: 'pokit-backlog',
    repoPath: '.claude/skills/pokit-backlog/SKILL.md',
    installedPath: 'skills/pokit-backlog/SKILL.md',
    displayPath: '~/.codex/skills/pokit-backlog/SKILL.md',
    tokens: POKIT_BACKLOG_BOUNDARY_CONTRACT_TOKENS,
  },
];

const LEGACY_DURATION_ZERO_METRICS_PATHS = new Set([
  '.ai-os/runs/2026-05-26/POK-145/metrics.json',
  '.ai-os/runs/2026-05-26/POK-155/metrics.json',
]);

// POK-204: issue_authored receipt cutoff — cards created on/after this date must have a receipt.
// Enforcement starts the day the chokepoint lands (2026-05-30). All existing issue cards were
// created on/before 2026-05-29, so they grandfather (created_at < cutoff) and doctor stays fail-0;
// new cards from today onward (created_at >= cutoff) must carry a matching issue_authored receipt.
const AUTHORING_RECEIPT_CUTOFF = '2026-05-30';

// POK-207 — a gate_passed card claiming "Skill invocation: pokit-issue" must be backed
// by an issue_execution_entered receipt (runner-emitted, layer ②). Cutoff is one day
// LATER than the authoring cutoff because the receipt mechanism is NEW: every card that
// executed on/before 2026-05-30 (incl. POK-204/205/206/207) predates it and CANNOT be
// backfilled a receipt (POK-180 no-backfill). Those grandfather (created_at < cutoff);
// cards created 2026-05-31 onward must carry a matching execution_entered receipt.
const SKILL_INVOCATION_RECEIPT_CUTOFF = '2026-05-31';

// POK-209 — routing_decision is the layer ① receipt: the agent selected the
// POKit skill route before runner/script execution. It starts at the same future
// cutoff as POK-207's execution receipt so already-started cards are not backfilled.
const ROUTING_DECISION_RECEIPT_CUTOFF = '2026-05-31';

// POK-349 — readiness section-content check binds cards created on/after the
// v0.20 generation, where the issue-create generator emits the full section
// skeleton. Earlier cards are grandfathered.
const READINESS_CONTENT_CUTOFF = '2026-06-12';

// POK-350 — gate-time execution-output content check binds cards created on/after
// this date (today's natural-path boundary). Every card already at gate_passed was
// created on/before 2026-06-14, so all are grandfathered and the rule applies only
// to cards that reach the gate from here forward.
const GATE_CONTENT_CUTOFF = '2026-06-15';

// POK-216 — ordered runtime proof that pokit.issue stayed in control through
// runner approval, planning, review, and verification. Issue-number cutoff avoids
// retroactive failure for already gated cards that predate the checkpoint chain.
const SKILL_CHECKPOINT_CHAIN_CUTOFF_ISSUE = 216;

// POK-217 — the post_runner_plan checkpoint is not just a marker anymore. From
// this issue onward it must carry the minimal implementation permission plan.
const POST_RUNNER_PLAN_PAYLOAD_CUTOFF_ISSUE = 217;

// POK-228 — back-fill detection (AC6). A checkpoint receipt emitted STRICTLY AFTER
// the issue's after_gate_pass event is a back-fill smell (the POK-222 incident:
// gate reverted to pending, then checkpoints emitted after the fact). Detection
// reuses the SKILL_CHECKPOINT_CHAIN_CUTOFF_ISSUE floor (only checked-chain issues
// have receipts to anchor against). To avoid retroactively breaking already-gated
// cards that predate this check, only issues strictly newer than POK-228 hard-fail;
// issues at/before POK-228 are flagged as a tamper-EVIDENT warning instead.
const CHECKPOINT_BACKFILL_HARD_FAIL_CUTOFF_ISSUE = 229;

// POK-289 — fan-out claim reconciliation starts at the issue where the rule lands.
// Older cards may have hand-written Workers lines or legacy metrics defaults that are
// intentionally not backfilled; POK-289+ must keep Workflow Trace and metrics aligned.
const FANOUT_METRICS_CONSISTENCY_CUTOFF_ISSUE = 289;

export async function runDoctor({
  root = process.cwd(),
  staleDays = 30,
  commitsProvider = null,
  afterGatePassEventsProvider = null,
  currentMdProvider = null,
  handoffProvider = null,
  installedSkillProvider = null,
  packageRoot = null,
} = {}) {
  const items = [];
  // packageRoot: 도구 소유 파일(standards, templates, commands)의 글로벌 설치 본체 위치.
  // - 명시적으로 전달될 때만 fallback이 활성화됨 (null이면 fallback 비활성).
  // - CLI 진입부에서 resolvePackageRoot()를 전달.
  // - 테스트가 packageRoot를 전달하지 않으면 기존 동작 그대로 (변화 없음).
  const context = { root, packageRoot, activeIssue: null, activeLayer: null };

  await checkCurrent(context, items);
  await checkSessionFiles(context, items);

  if (context.currentText) {
    await checkReadOrder(context, items);
  }

  if (context.activeIssue) {
    await checkActiveIssue(context, items);
  }

  await checkWorkflowTrace(context.root, items);
  await checkBacklogAuthoredIssues(context.root, items);
  await checkReadinessSectionContentAll(context.root, items);
  await checkGateContentSectionAll(context.root, items);
  await checkV010MetricsEvidence(context.root, items, { pass, fail });
  await checkGateEvidenceGitTracking(context.root, items, { pass, fail });
  await checkPokitConfigSecretBoundary(context.root, items);
  await checkStarterFullNpmTestEvidence(context.root, items);
  await checkExtractedStarterReleaseEvidence(context.root, items);
  await checkSubIssuesNotRequiredEvidence(context.root, items);
  await checkUnresolvedClarifications(context.root, items);
  await checkACQuality(context.root, items);
  await checkEnshrinementPolicy(context.root, items);
  await checkNarrowFallbackJustification(context.root, items);
  await checkTemplateSources(context.root, items);
  await checkPokitIssueCommandDrift(context.root, items);
  await checkPokitBacklogBoundaryDrift(context.root, items, { packageRoot: context.packageRoot });

  await checkStatusEnum(context.root, items);
  await checkOptionalFields(context.root, items);
  await checkCandidateRouted(context.root, items);
  await checkDependsOnCycles(context.root, items);
  checkLifecycleCardSchemas(items, { pass, fail });
  await checkFailureMemoryConsistency(context, items);
  await checkVersionCompatibility(context, items);
  await checkInternalSkills(context, items);
  await checkCodexInstalledSkillDrift(context, items, { installedSkillProvider });
  await checkEvidenceIndexFreshness(context.root, items);
  await checkStaleArtifacts(context.root, items, { staleDays });
  await checkNetGrowth(context.root, items);
  await checkSprintClose(context.root, items);
  await checkSprintScopeFirst(context.root, items);
  await checkReleaseScopeStatusVsFrontmatter(context.root, items);
  await checkRetroSchemaCompliance(context, items);
  await checkSubIssues(context.root, items);
  await checkActiveIssuePreflightReceipt(context, items);
  await checkActiveGatePassedCommitClosure(context, items);
  await checkAllRunMetrics(context.root, items);
  await checkGateClaimFrontmatterConsistency(context, items, { commitsProvider });
  await checkAfterGatePassHookConsistency(context, items, { commitsProvider, afterGatePassEventsProvider });
  await checkNextActionConsistency(context, items, { currentMdProvider, handoffProvider });
  await checkIssueAuthoringEvidence(context.root, items);
  checkRuleSectionSize(context, items);
  await checkCoverageHonesty(context.root, items);
  await checkPokitVersionDriftDoctor(context, items);
  await checkUserStateSlots(context, items);

  const summary = summarize(items);
  return {
    status: summary.fail > 0 ? 'fail' : 'pass',
    summary,
    items,
  };
}

// POK-371: 멀티유저 상태 파일 분리(A형) 검증. `.ai-os/current-<user>.md` 슬롯이
// 존재하면 각 파일이 active_issue·gate_state·next_action을 모두 갖고 gate_state가
// 유효 enum인지 유저별로 검증한다. 유저 파일이 없으면(단일유저) pass-skip.
const USER_STATE_GATE_ENUM = new Set([
  'pending', 'in_progress', 'gate_passed', 'passed', 'failed', 'blocked', 'dropped', 'idle', 'none',
]);

export async function checkUserStateSlots(context, items) {
  // listUserStateFiles는 내부에서 모든 에러를 흡수해 throw하지 않는다.
  const userFiles = await listUserStateFiles(context.root);
  if (userFiles.length === 0) {
    pass(items, 'user_state_slots', '.ai-os', '유저별 상태 파일 없음 — 단일유저 모드 (skip).');
    return;
  }

  for (const uf of userFiles) {
    const text = await readOptional(context.root, uf.relPath);
    if (text === null) {
      fail(items, 'user_state_slots', uf.relPath,
        `${uf.file} 읽기 실패.`, '유저 상태 파일이 존재하지만 읽을 수 없습니다.');
      continue;
    }
    const fm = parseFrontmatter(text);
    const missing = ['active_issue', 'gate_state', 'next_action'].filter((k) => {
      const v = fm[k];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    });
    if (missing.length > 0) {
      fail(items, 'user_state_slots', uf.relPath,
        `${uf.file} 필수 필드 누락: ${missing.join(', ')}.`,
        '유저별 current 파일에 active_issue·gate_state·next_action를 모두 채우세요.');
      continue;
    }
    const gate = String(fm.gate_state).trim().toLowerCase();
    if (!USER_STATE_GATE_ENUM.has(gate)) {
      fail(items, 'user_state_slots', uf.relPath,
        `${uf.file} gate_state "${fm.gate_state}"가 유효 enum이 아님.`,
        `gate_state는 ${[...USER_STATE_GATE_ENUM].join('/')} 중 하나여야 합니다.`);
      continue;
    }
    pass(items, 'user_state_slots', uf.relPath,
      `${uf.file} 슬롯 정합 (active_issue=${fm.active_issue}, gate_state=${gate}).`);
  }
}

// POK-204: every issue card whose created_at >= AUTHORING_RECEIPT_CUTOFF must have a
// matching issue_authored receipt in event-log.jsonl (id + content_hash match).
// Cards predating the cutoff are grandfathered (pass/skip).
export async function checkIssueAuthoringEvidence(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  // POK-364: 이벤트로그가 없는 머신(fresh-pull/스타터 번들)에서는 과거 영수증 부재를 미수집으로 처리.
  const eventLogPresent = await isEventLogPresent(projectRoot);
  const receiptSet = await loadIssueAuthoredReceiptSet(projectRoot);

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    const id = frontmatter.id ?? name.replace('.md', '');
    const title = frontmatter.title ?? '';
    const rawCreatedAt = frontmatter.created_at;
    // Only a plain YYYY-MM-DD(...) string is a usable date. Anything else — missing,
    // empty (normalizeValue('') → boolean true), or malformed — grandfathers cleanly.
    const createdDate =
      typeof rawCreatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawCreatedAt)
        ? rawCreatedAt.slice(0, 10)
        : null;

    // Grandfather cards predating the chokepoint, or without a usable created_at.
    if (!createdDate || createdDate < AUTHORING_RECEIPT_CUTOFF) {
      pass(items, 'issue_authoring_evidence', filePath, `${id} grandfathered (created_at ${rawCreatedAt ?? 'missing'} < cutoff ${AUTHORING_RECEIPT_CUTOFF}).`);
      continue;
    }

    // Hash from the raw created_at string (full fidelity matches what the create-script hashed).
    const expectedHash = computeContentHash({ id, title, created_at: rawCreatedAt });
    const receiptKey = `${id}::${expectedHash}`;

    if (receiptSet.has(receiptKey)) {
      pass(items, 'issue_authoring_evidence', filePath, `${id} has matching issue_authored receipt (hash ${expectedHash}).`);
    } else if (!eventLogPresent) {
      // POK-364: 이벤트로그 없는 환경 — 영수증 부재는 미수집(환경성), fail 아님.
      uncollected(items, 'issue_authoring_evidence', filePath, `${id} 이벤트로그 없는 환경 — issue_authored 영수증 미수집 (fresh-pull/스타터 번들).`);
    } else {
      fail(
        items,
        'issue_authoring_evidence',
        filePath,
        `${id} created_at>=${AUTHORING_RECEIPT_CUTOFF} 인데 매칭 issue_authored 영수증 없음 — pokit-issue-create로 생성됐는지 확인`,
        'scripts/pokit-issue-create.mjs'
      );
    }
  }
}

async function checkAfterGatePassHookConsistency(context, items, {
  commitsProvider = null,
  afterGatePassEventsProvider = null,
} = {}) {
  const commits = commitsProvider
    ? await commitsProvider()
    : await fetchRecentCommitSubjects(context.root, 20);
  if (!commits || commits.length === 0) return;

  // POK-364: 이벤트로그 없는 환경 — after_gate_pass 영수증 부재는 미수집(환경성).
  if (!afterGatePassEventsProvider && !(await isEventLogPresent(context.root))) {
    uncollected(items, 'after_gate_pass_hook_consistency', '.ai-os/events/event-log.jsonl',
      '이벤트로그 없는 환경 — after_gate_pass 이벤트 미수집 (fresh-pull/스타터 번들).');
    return;
  }

  const events = afterGatePassEventsProvider
    ? await afterGatePassEventsProvider()
    : await readAfterGatePassEvents({ root: context.root });
  const missing = findMissingAfterGatePassEvents({ commits, events });

  if (missing.length === 0) {
    pass(items, 'after_gate_pass_hook_consistency', '.ai-os/events/event-log.jsonl', 'Recent gate_passed commits have after_gate_pass events.');
    return;
  }

  fail(
    items,
    'after_gate_pass_hook_consistency',
    '.ai-os/events/event-log.jsonl',
    `Missing after_gate_pass event(s): ${missing.map((item) => item.issueId).join(', ')}.`,
    'Install hooks with `npm run hooks:install` and backfill missing after_gate_pass receipts before gate.'
  );
}

async function checkTemplateSources(projectRoot, items) {
  const templateDir = '.ai-os/templates/commands';
  if (!await exists(projectRoot, templateDir)) return;

  for (const name of ['backlog.md', 'issue.md', 'clarify.md']) {
    const filePath = `${templateDir}/${name}`;
    if (await exists(projectRoot, filePath)) {
      pass(items, 'template_source', filePath, `${filePath} exists.`);
    } else {
      warning(items, 'template_source', filePath, `${filePath} is missing.`, 'Restore the template source or check .ai-os/templates/commands/.');
    }
  }
}

async function checkPokitIssueCommandDrift(projectRoot, items) {
  const templatePath = '.ai-os/templates/commands/issue.md';
  const commandPath = '.claude/commands/pokit.issue.md';
  const [templateText, commandText] = await Promise.all([
    readOptional(projectRoot, templatePath),
    readOptional(projectRoot, commandPath),
  ]);

  if (templateText === null || commandText === null) return;

  const missing = POKIT_ISSUE_COMMAND_CONTRACT_TOKENS.filter((token) =>
    templateText.includes(token) && !commandText.includes(token)
  );

  if (missing.length > 0) {
    fail(items, 'pokit_issue_command_drift', commandPath,
      `/pokit.issue command is missing canonical template token(s): ${missing.join(', ')}.`,
      `Run pokit sync or update ${commandPath} from ${templatePath}.`
    );
    return;
  }

  pass(items, 'pokit_issue_command_drift', commandPath, '/pokit.issue command shares required canonical template tokens.');
}

async function checkPokitBacklogBoundaryDrift(projectRoot, items, { packageRoot = null } = {}) {
  const templatePath = '.ai-os/templates/commands/backlog.md';
  const commandPath = '.claude/commands/pokit.backlog.md';
  const skillPath = '.claude/skills/pokit-backlog/SKILL.md';

  // 도구 소유 파일: packageRoot가 전달된 경우에만 starter/ fallback 적용.
  // null이면 기존 동작 유지 (테스트 호환성).
  // 반환: { text: string|null, fromFallback: boolean }
  async function readWithFallback(relPath) {
    const text = await readOptional(projectRoot, relPath);
    if (text !== null) return { text, fromFallback: false };
    // packageRoot 하에서 두 경로로 fallback.
    // null이면 fallback 비활성 — 기존 동작 유지.
    if (packageRoot) {
      for (const candidate of [
        path.join(packageRoot, relPath),
        path.join(packageRoot, 'starter', relPath),
      ]) {
        try {
          const fallbackText = await readFile(candidate, 'utf8');
          return { text: fallbackText, fromFallback: true };
        } catch {
          // try next candidate
        }
      }
    }
    return { text: null, fromFallback: false };
  }

  const surfaceResults = await Promise.all([
    readWithFallback(templatePath),
    readWithFallback(commandPath),
    readWithFallback(skillPath),
  ]);
  const surfaces = [
    [templatePath, surfaceResults[0].text],
    [commandPath, surfaceResults[1].text],
    [skillPath, surfaceResults[2].text],
  ];
  // 모든 비-null 표면이 fallback에서 왔으면 fresh 프로젝트 — 내용 검사 없이 pass
  const nonNullSurfaces = surfaces.filter(([, text]) => text !== null);
  const allFromFallback = nonNullSurfaces.length > 0 &&
    surfaceResults.every((r) => r.text === null || r.fromFallback);

  if (surfaces.every(([, text]) => text === null)) return;

  // fresh/partial 프로젝트: 비-null 표면 중 하나라도 packageRoot fallback에서 온 경우,
  // 소유 경계 기준으로 "도구가 정상 설치됨"으로 pass 처리. 내용 검사는 로컬 수정 감지용.
  // (모든 표면이 projectRoot에 있을 때만 로컬 커스터마이징 드리프트를 체크한다.)
  if (allFromFallback || surfaceResults.some((r) => r.fromFallback && r.text !== null)) {
    for (const [filePath, text] of surfaces) {
      if (text === null) continue;
      pass(items, 'pokit_backlog_boundary_drift', filePath, '/pokit.backlog surface exists (tool-owned, partial or full fallback from package root).');
    }
    return;
  }

  // 도구 소유 표면(templatePath)은 fresh 프로젝트에 없을 수 있음 — 소유 경계 기준으로
  // command/skill만 있는 경우도 정상이므로 templatePath만 없으면 token 체크만 진행.
  const templateText = surfaces[0][1];
  const commandText = surfaces[1][1];
  const templateMissing = templateText === null;

  const missingSurfaces = surfaces.filter(([filePath, text]) => {
    if (text !== null) return false;
    // template은 fresh 프로젝트에서 없어도 됨 — command/skill 중 하나라도 있으면 스킵
    if (filePath === templatePath && (commandText !== null || surfaces[2][1] !== null)) return false;
    return true;
  });
  if (missingSurfaces.length > 0) {
    for (const [filePath] of missingSurfaces) {
      fail(
        items,
        'pokit_backlog_boundary_drift',
        filePath,
        '/pokit.backlog surface is missing.',
        'Restore the template, Claude command, and pokit-backlog skill before claiming backlog routing support.'
      );
    }
    return;
  }

  let failed = false;
  for (const [filePath, text] of surfaces) {
    if (text === null) continue; // 위에서 허용된 missing surface (templatePath)
    const missing = POKIT_BACKLOG_BOUNDARY_CONTRACT_TOKENS.filter((token) => !text.includes(token));
    if (missing.length === 0) {
      pass(items, 'pokit_backlog_boundary_drift', filePath, '/pokit.backlog surface preserves main/subagent boundary tokens.');
      continue;
    }

    failed = true;
    fail(
      items,
      'pokit_backlog_boundary_drift',
      filePath,
      `/pokit.backlog surface is missing boundary token(s): ${missing.join(', ')}.`,
      'Keep the template, Claude command, and pokit-backlog skill aligned on main ownership, subagent limits, fallback evidence, and approval-before-mutation.'
    );
  }

  if (failed) return;

  // template-command 동등 체크: template이 있을 때만 수행
  if (!templateMissing && templateText !== commandText) {
    fail(
      items,
      'pokit_backlog_boundary_drift',
      commandPath,
      '/pokit.backlog Claude command differs from the canonical template.',
      `Sync ${commandPath} from ${templatePath}.`
    );
  }
}

async function checkWorkflowTrace(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  // POK-364: 이벤트로그 없는 환경 여부 — 영수증 의존 검사를 미수집으로 분기.
  const eventLogPresent = await isEventLogPresent(projectRoot);

  // POK-207/209 — load once; cross-checked against each card's skill-routing claim.
  const executionEnteredIds = await loadIssueExecutionEnteredIds(projectRoot);
  const postRunnerExecutionLockMap = await loadPostRunnerExecutionLockMap(projectRoot);
  const routingDecisionMap = await loadRoutingDecisionMap(projectRoot);
  const skillExecutionCheckpointMap = await loadSkillExecutionCheckpointMap(projectRoot);

  // POK-228 AC6 — back-fill detection inputs: gate-pass anchors + reopen evidence.
  const backfillInputs = await loadCheckpointBackfillInputs(projectRoot);

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (frontmatter.gate_state !== 'gate_passed') continue;

    const sprint = frontmatter.sprint;
    const hasTrace = hasSection(text, 'Workflow Trace');

    if (isSprintV010OrLater(sprint)) {
      if (!hasTrace) {
        fail(items, 'workflow_trace', filePath,
          `gate-passed ${sprint} issue is missing ## Workflow Trace section.`,
          'Add ## Workflow Trace with execution approval, mode, worker authorization, Workers, fallback evidence if needed, and metrics evidence before gate.'
        );
        continue;
      }

      pass(items, 'workflow_trace', filePath, 'v0.10+ gate-passed issue has ## Workflow Trace section.');
      // POK-328 — workflow_trace_execution_lock(카드 자기신고 문구) 검사 폐지:
      // post_runner_execution_lock 영수증이 1차 증거이고 checkpoint chain 검사가 이미 강제한다.
      // POK-364: 이벤트로그 없는 환경 — 영수증 의존 검사를 미수집으로 처리.
      if (!eventLogPresent) {
        if (requiresPokitIssueSkillInvocationEvidence(filePath, frontmatter)) {
          uncollected(items, 'workflow_trace_skill_invocation', filePath,
            `${frontmatter.id ?? filePath} 이벤트로그 없는 환경 — skill_invocation 영수증 미수집 (fresh-pull/스타터 번들).`);
          uncollected(items, 'workflow_trace_skill_checkpoint_chain', filePath,
            `${frontmatter.id ?? filePath} 이벤트로그 없는 환경 — checkpoint chain 미수집 (fresh-pull/스타터 번들).`);
          uncollected(items, 'workflow_trace_checkpoint_backfill', filePath,
            `${frontmatter.id ?? filePath} 이벤트로그 없는 환경 — checkpoint backfill 검사 미수집 (fresh-pull/스타터 번들).`);
        }
      } else {
        checkWorkflowTraceSkillInvocationEvidence(text, filePath, frontmatter, items, executionEnteredIds, routingDecisionMap);
        checkWorkflowTraceSkillCheckpointChain(filePath, frontmatter, items, skillExecutionCheckpointMap, postRunnerExecutionLockMap);
        checkCheckpointBackfill(filePath, frontmatter, items, {
          skillExecutionCheckpointMap,
          ...backfillInputs,
        });
      }
      checkWorkflowTraceWorkerEvidence(text, filePath, items, { pass, fail });
      await checkWorkflowTraceFanoutMetricsConsistency(projectRoot, text, filePath, frontmatter, items);
      checkWorkflowTracePostChangeReviewEvidence(text, filePath, frontmatter, items, { pass, fail });
      continue;
    }

    if (sprint !== 'v0.6.0') continue;

    if (hasTrace) {
      pass(items, 'workflow_trace', filePath, '## Workflow Trace section is present.');
    } else {
      warning(items, 'workflow_trace', filePath,
        'gate-passed v0.6.0 issue is missing ## Workflow Trace section.',
        'Add ## Workflow Trace to record pokit-issue execution evidence per POK-113.'
      );
    }
  }
}

function checkWorkflowTraceSkillCheckpointChain(
  filePath,
  frontmatter,
  items,
  skillExecutionCheckpointMap = new Map(),
  postRunnerExecutionLockMap = new Map()
) {
  const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  if (!id || !isIssueNumberAtLeast(id, SKILL_CHECKPOINT_CHAIN_CUTOFF_ISSUE)) return;
  if (!requiresPokitIssueSkillInvocationEvidence(filePath, frontmatter)) return;

  const receipts = (skillExecutionCheckpointMap.get(id) ?? [])
    .filter((receipt) => receipt.selected_skill === 'pokit.issue');
  const steps = receipts.map((receipt) => receipt.step).filter(Boolean);
  const missing = POKIT_ISSUE_SKILL_CHECKPOINT_STEPS.filter((step) => !steps.includes(step));

  if (missing.length > 0) {
    fail(items, 'workflow_trace_skill_checkpoint_chain', filePath,
      `${id} is missing pokit.issue skill_execution_checkpoint steps: ${missing.join(', ')}.`,
      `Record ordered checkpoints before gate: ${POKIT_ISSUE_SKILL_CHECKPOINT_STEPS.join(' -> ')}.`
    );
    return;
  }

  const latestLock = (postRunnerExecutionLockMap.get(id) ?? []).at(-1) ?? null;
  const latestLockAt = latestLock?.emitted_at ? String(latestLock.emitted_at) : null;
  const postLockReceipts = latestLockAt
    ? receipts.filter((receipt) => String(receipt.emitted_at ?? '') >= latestLockAt)
    : receipts;
  const postLockSteps = postLockReceipts.map((receipt) => receipt.step).filter(Boolean);
  const postRunnerPlan = postLockReceipts.find((receipt) => receipt.step === 'post_runner_plan') ?? null;
  const postRunnerPlanAt = String(postRunnerPlan?.emitted_at ?? '');
  const hasPreRunnerBeforeLatestPlan = receipts.some((receipt) =>
    receipt.step === 'pre_runner' &&
    postRunnerPlanAt &&
    String(receipt.emitted_at ?? '') <= postRunnerPlanAt
  );
  const postLockIndexes = ['post_runner_plan', 'post_change_review', 'verification_ready']
    .map((step) => postLockSteps.indexOf(step));
  const postLockMissing = postLockIndexes.some((index) => index < 0);
  const ordered = !postLockMissing &&
    hasPreRunnerBeforeLatestPlan &&
    postLockIndexes.every((index, position) => position === 0 || index > postLockIndexes[position - 1]);
  if (!ordered) {
    fail(items, 'workflow_trace_skill_checkpoint_chain', filePath,
      `${id} pokit.issue skill_execution_checkpoint chain is out of order or not tied to the latest post_runner_execution_lock: ${steps.join(' -> ')}.`,
      `Expected order with latest lock: pre_runner -> post_runner_execution_lock -> post_runner_plan -> post_change_review -> verification_ready.`
    );
    return;
  }

  if (isIssueNumberAtLeast(id, POST_RUNNER_PLAN_PAYLOAD_CUTOFF_ISSUE)) {
    const payloadProblem = validatePostRunnerPlanCheckpointPayload(postRunnerPlan?.payload ?? {});
    if (payloadProblem) {
      fail(items, 'workflow_trace_post_runner_plan_payload', filePath,
        `${id} post_runner_plan checkpoint payload is incomplete: ${payloadProblem}.`,
        'Record selected_skill, worker_decision/fallback_reason, post_change_review_plan, and verification_plan before implementation approval.'
      );
      return;
    }
  }

  pass(items, 'workflow_trace_skill_checkpoint_chain', filePath,
    `${id} pokit.issue checkpoint chain is complete: ${POKIT_ISSUE_SKILL_CHECKPOINT_STEPS.join(' -> ')}.`);
}

/**
 * POK-228 AC6 — gather back-fill detection inputs once per doctor run.
 * Returns the maps consumed by checkCheckpointBackfill:
 *   - afterGatePassByIssue: issue id -> after_gate_pass events (gate-pass anchors)
 *   - gateReopenCountByIssue: issue id -> metrics.json gate_reopen_count
 *   - afrIssueIds: set of issue ids with an AFR / failure-index entry, or
 *                  metrics.json afr_triggered === true
 */
async function loadCheckpointBackfillInputs(projectRoot) {
  const afterGatePassByIssue = new Map();
  let gateEvents = [];
  try {
    gateEvents = await readAfterGatePassEvents({ root: projectRoot });
  } catch {
    gateEvents = [];
  }
  for (const event of gateEvents) {
    const id = String(event.issue_id ?? '').toUpperCase();
    if (!id) continue;
    if (!afterGatePassByIssue.has(id)) afterGatePassByIssue.set(id, []);
    afterGatePassByIssue.get(id).push(event);
  }

  // AFR / failure-index textual references (issue id appearing in either file).
  const afrIssueIds = new Set();
  for (const rel of ['.ai-os/failure-index.md', '.ai-os/memory/ai-failures/ai-failure-log.md']) {
    const text = await readOptional(projectRoot, rel);
    if (!text) continue;
    for (const match of text.matchAll(/POK-\d{3}/g)) {
      afrIssueIds.add(match[0].toUpperCase());
    }
  }

  // Per-issue gate_reopen_count + afr_triggered from metrics.json.
  const gateReopenCountByIssue = new Map();
  for (const id of afterGatePassByIssue.keys()) {
    const metricsPath = await findIssueMetricsPath(projectRoot, id);
    if (!metricsPath) continue;
    const metricsText = await readOptional(projectRoot, metricsPath);
    if (!metricsText) continue;
    let metrics;
    try {
      metrics = JSON.parse(metricsText);
    } catch {
      continue;
    }
    const reopen = Number(metrics.gate_reopen_count);
    gateReopenCountByIssue.set(id, Number.isFinite(reopen) ? reopen : 0);
    if (metrics.afr_triggered === true) afrIssueIds.add(id);
  }

  return { afterGatePassByIssue, gateReopenCountByIssue, afrIssueIds };
}

/**
 * POK-228 AC6 — pure back-fill detector (guard-ladder Rung 3: tamper-EVIDENT).
 *
 * Anchors causality on the after_gate_pass EVENT (a factual emitted_at), NOT on
 * inferred timestamp ordering of the checkpoint chain. If any pokit.issue
 * skill_execution_checkpoint receipt was emitted STRICTLY AFTER the latest
 * after_gate_pass event for the issue, that receipt could only have been written
 * once the gate was already passed — i.e. the chain was back-filled after the fact.
 *
 * A back-fill is LEGITIMATE only when the run records a genuine reopen:
 * gate_reopen_count > 0 AND a corresponding AFR / failure-index entry exists.
 * Otherwise it is an unjustified back-fill and is flagged.
 *
 * @param {object} args
 * @param {string} args.id                       issue id (POK-XXX)
 * @param {Array<{step?:string,emitted_at?:string}>} args.receipts  pokit.issue checkpoint receipts
 * @param {Array<{emitted_at?:string}>} args.afterGatePassEvents     after_gate_pass events for this issue
 * @param {number} args.gateReopenCount          metrics.json gate_reopen_count (0 if absent)
 * @param {boolean} args.afrPresent              an AFR / failure-index entry exists for this issue
 * @returns {{ verdict: 'pass'|'fail'|'warn', reason: string, postGateReceipts: Array }}
 */
export function detectCheckpointBackfill({
  id,
  receipts = [],
  afterGatePassEvents = [],
  gateReopenCount = 0,
  afrPresent = false,
} = {}) {
  const gateStamps = afterGatePassEvents
    .map((event) => String(event?.emitted_at ?? ''))
    .filter(Boolean)
    .sort();
  const latestGateAt = gateStamps.at(-1) ?? null;

  // No gate-pass anchor yet → nothing to compare against (not a back-fill signal).
  if (!latestGateAt) {
    return { verdict: 'pass', reason: 'no_gate_pass_anchor', postGateReceipts: [] };
  }

  const postGateReceipts = receipts.filter(
    (receipt) => receipt && String(receipt.emitted_at ?? '') > latestGateAt
  );

  if (postGateReceipts.length === 0) {
    return { verdict: 'pass', reason: 'all_receipts_before_gate_pass', postGateReceipts: [] };
  }

  // Post-gate-pass receipts exist. Legitimate only with a recorded reopen + AFR.
  const legitimateReopen = gateReopenCount > 0 && afrPresent === true;
  if (legitimateReopen) {
    return { verdict: 'pass', reason: 'legitimate_reopen', postGateReceipts };
  }

  return { verdict: 'fail', reason: 'unjustified_backfill', postGateReceipts };
}

/**
 * POK-228 AC6 — doctor wiring for back-fill detection. Reuses the existing
 * checkpoint-chain cutoff floor so only checked-chain issues are inspected. The
 * verdict is escalated to a hard `fail` only for issues strictly newer than
 * POK-228; issues at/before the cutoff are flagged as a `warning` so the check
 * does not retroactively break already-gated cards (e.g. POK-222).
 */
function checkCheckpointBackfill(
  filePath,
  frontmatter,
  items,
  {
    skillExecutionCheckpointMap = new Map(),
    afterGatePassByIssue = new Map(),
    gateReopenCountByIssue = new Map(),
    afrIssueIds = new Set(),
  } = {}
) {
  const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  if (!id || !isIssueNumberAtLeast(id, SKILL_CHECKPOINT_CHAIN_CUTOFF_ISSUE)) return;
  if (!requiresPokitIssueSkillInvocationEvidence(filePath, frontmatter)) return;

  const receipts = (skillExecutionCheckpointMap.get(id) ?? [])
    .filter((receipt) => receipt.selected_skill === 'pokit.issue');
  const afterGatePassEvents = afterGatePassByIssue.get(id) ?? [];
  const gateReopenCount = gateReopenCountByIssue.get(id) ?? 0;
  const afrPresent = afrIssueIds.has(id);

  const result = detectCheckpointBackfill({
    id,
    receipts,
    afterGatePassEvents,
    gateReopenCount,
    afrPresent,
  });

  if (result.verdict === 'pass') {
    // Only emit an explicit pass for issues that actually had a gate-pass anchor
    // and clean receipts (keeps the report signal meaningful, not noisy).
    if (result.reason === 'all_receipts_before_gate_pass' || result.reason === 'legitimate_reopen') {
      const detail = result.reason === 'legitimate_reopen'
        ? `${id} has post-gate-pass checkpoints justified by gate_reopen_count>0 + AFR entry.`
        : `${id} checkpoint chain was recorded before after_gate_pass (no back-fill).`;
      pass(items, 'workflow_trace_checkpoint_backfill', filePath, detail);
    }
    return;
  }

  // result.verdict === 'fail' (unjustified back-fill).
  const lateSteps = result.postGateReceipts
    .map((receipt) => receipt.step)
    .filter(Boolean)
    .join(', ') || '(steps unlabeled)';
  const message =
    `${id} has skill_execution_checkpoint receipt(s) emitted AFTER its after_gate_pass event ` +
    `(post-gate-pass back-fill: ${lateSteps}) without a recorded reopen.`;
  const remediation =
    'gate-revert 후 back-fill은 금지. 정당한 reopen이면 gate_reopen_count 증가 + AFR 기록 필요. ' +
    '(A back-filled checkpoint chain after gate-pass is banned. A legitimate reopen requires ' +
    'gate_reopen_count > 0 in metrics.json plus a corresponding AFR / failure-index entry.)';

  if (isIssueNumberAtLeast(id, CHECKPOINT_BACKFILL_HARD_FAIL_CUTOFF_ISSUE)) {
    fail(items, 'workflow_trace_checkpoint_backfill', filePath, message, remediation);
  } else {
    warning(items, 'workflow_trace_checkpoint_backfill', filePath,
      `${message} Flagged as warning for pre-POK-229 issue (not retroactively failed).`,
      remediation);
  }
}

function validatePostRunnerPlanCheckpointPayload(payload = {}) {
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
    if (payload[field] == null || payload[field] === '') return `missing ${field}`;
  }
  if (payload.selected_skill !== 'pokit.issue') return 'selected_skill must be pokit.issue';
  if (!['fan-out', 'fallback'].includes(payload.worker_decision)) {
    return 'worker_decision must be fan-out or fallback';
  }
  if (payload.worker_decision === 'fallback') {
    if (!payload.fallback_reason) return 'missing fallback_reason';
    if (!['worker-unavailable', 'global-state-only', 'cross-file-invariant', 'trivial-scope'].includes(payload.fallback_reason)) {
      return `invalid fallback_reason ${payload.fallback_reason}`;
    }
  }
  return null;
}

async function checkBacklogAuthoredIssues(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  // POK-364: 이벤트로그 없는 환경 — routing_decision 영수증 부재는 미수집.
  const eventLogPresent = await isEventLogPresent(projectRoot);
  const routingDecisionMap = await loadRoutingDecisionMap(projectRoot);

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (!isBacklogAuthoredIssue(frontmatter)) continue;

    checkBacklogIssueContract(frontmatter, filePath, items);
    if (!eventLogPresent) {
      // POK-364: 이벤트로그 없는 환경 — routing_decision 검사 미수집으로 처리.
      const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? filePath;
      uncollected(items, 'backlog_routing_decision', filePath,
        `${id} 이벤트로그 없는 환경 — routing_decision 영수증 미수집 (fresh-pull/스타터 번들).`);
    } else {
      checkBacklogRoutingDecisionEvidence(frontmatter, filePath, items, routingDecisionMap);
    }
    checkWorkerTaskTerminology(text, filePath, items);
    checkWorkerTaskWorkflowTrace(text, filePath, items);
  }
}

function isBacklogAuthoredIssue(frontmatter) {
  if (!isSprintV010OrLater(frontmatter.sprint)) return false;
  return frontmatter.authoring_path === 'pokit.backlog' ||
    frontmatter.authoring_contract_version === 'backlog-flow-mvp-v1';
}

function checkBacklogIssueContract(frontmatter, filePath, items) {
  const readiness = frontmatter.definition_readiness;
  const executable = readiness === 'pass' || ['accepted', 'in_progress'].includes(frontmatter.status);
  const required = executable
    ? ['goal', 'produces', 'consumes', 'recommended_order', 'graph_root']
    : ['goal', 'produces', 'consumes'];
  const missing = required.filter((field) => fieldIsMissing(frontmatter[field]));

  if (missing.length === 0) {
    pass(items, 'backlog_issue_contract', filePath, 'backlog-authored issue preserves required graph contract fields.');
    return;
  }

  const message = `backlog-authored ${readiness === 'draft' ? 'draft' : 'ready/executable'} issue is missing: ${missing.join(', ')}.`;
  if (readiness === 'draft' && !executable) {
    warning(
      items,
      'backlog_issue_contract',
      filePath,
      message,
      'Add goal, produces, and consumes so the draft can be reviewed without guessing.'
    );
    return;
  }

  fail(
    items,
    'backlog_issue_contract',
    filePath,
    message,
    'Add the missing Backlog Flow graph contract fields before routing this issue to /pokit.issue.'
  );
}

// POK-349 — readiness content-satisfaction. checkBacklogIssueContract escalates
// required FRONTMATTER fields once a card is ready/executable; this is the body
// counterpart on the same axis. When definition_readiness: pass, the grooming-
// thinking sections (Brief / Evidence / Acceptance Criteria / Gate) must hold real
// content, not a bare header or a `(실행 시 채움)` placeholder. The auto-emitted
// empty skeleton (issue-create) is the natural-path partner of this guard: the
// generator drops the blank headers, this check refuses to let them stay blank
// under a ready stamp. Execution-filled sections stay placeholder-OK at ready;
// their gate-time content check is POK-350.
//
// Runs over ALL issue files (not the backlog-authored subset) so v0.20 candidate
// cards that carry only sprint_candidate — and so fail isBacklogAuthoredIssue's
// raw frontmatter.sprint test — are still covered. Scope is held by the
// created_at cutoff + definition_readiness gate inside checkReadinessSectionContent.
async function checkReadinessSectionContentAll(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;
  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    checkReadinessSectionContent(frontmatter, text, filePath, items);
  }
}

function checkReadinessSectionContent(frontmatter, text, filePath, items) {
  const ready = frontmatter.definition_readiness === 'pass'
    || ['accepted', 'in_progress'].includes(frontmatter.status);
  if (!ready) return;

  // Bind the new natural-path card flow, not retroactively the repo's history
  // (가드는 길목에). Cards created before the generator emits the full skeleton are
  // grandfathered — same approach as the routing_decision / authoring receipts.
  const createdAt = typeof frontmatter.created_at === 'string'
    ? frontmatter.created_at.slice(0, 10)
    : null;
  if (!createdAt || createdAt < READINESS_CONTENT_CUTOFF) {
    pass(items, 'readiness_section_content', filePath,
      `${frontmatter.id ?? filePath} grandfathered (created_at ${frontmatter.created_at ?? 'missing'} < cutoff ${READINESS_CONTENT_CUTOFF}); readiness section-content not retroactively required.`);
    return;
  }

  const gaps = readinessContentGaps(text);
  if (gaps.length === 0) {
    pass(items, 'readiness_section_content', filePath,
      `ready card has real content in readiness sections: ${READINESS_CONTENT_SECTIONS.join(', ')}.`);
    return;
  }

  fail(items, 'readiness_section_content', filePath,
    `definition_readiness: pass but these sections are empty/placeholder: ${gaps.join(', ')}.`,
    `Fill ${gaps.join(', ')} with real content during grooming before stamping the card ready (empty headers and (실행 시 채움) placeholders do not count).`
  );
}

// POK-350 — gate-time content check. The execution-output mirror of
// checkReadinessSectionContent, on the same single-source axis (issue-sections.mjs).
// Required-section PRESENCE is checked at transition (checkActiveIssue); the
// execution-output receipts' CONTENT is required only here, when a card CLAIMS the
// gate. A freshly-transitioned pending card with empty QA / Gate / Evidence
// (verification) therefore never fails — the check is skipped until gate_state
// becomes gate_passed (POK-350 AC3: 전환 직후 빈칸 허용 / 합격 시점 충족 요구).
async function checkGateContentSectionAll(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;
  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    checkGateContent(frontmatter, text, filePath, items);
  }
}

function checkGateContent(frontmatter, text, filePath, items) {
  // Gate-time, not transition-time: only a card that claims gate_passed must back
  // its execution-output sections with real receipts. Pending/verification_ready
  // cards are intentionally untouched here.
  if (frontmatter.gate_state !== 'gate_passed') return;

  // Bind the new natural-path flow, not the repo's history (가드는 길목에). Cards
  // created before the gate-content rule existed are grandfathered — same approach
  // as READINESS_CONTENT_CUTOFF and the routing/authoring receipts.
  const createdAt = typeof frontmatter.created_at === 'string'
    ? frontmatter.created_at.slice(0, 10)
    : null;
  if (!createdAt || createdAt < GATE_CONTENT_CUTOFF) {
    pass(items, 'gate_section_content', filePath,
      `${frontmatter.id ?? filePath} grandfathered (created_at ${frontmatter.created_at ?? 'missing'} < cutoff ${GATE_CONTENT_CUTOFF}); gate section-content not retroactively required.`);
    return;
  }

  const gaps = gateContentGaps(text);
  if (gaps.length === 0) {
    pass(items, 'gate_section_content', filePath,
      `gate_passed card has real execution-output content: ${evaluatedGateContentSections(text).join(', ')}.`);
    return;
  }

  fail(items, 'gate_section_content', filePath,
    `gate_state: gate_passed but these execution-output sections are empty/placeholder/unchecked: ${gaps.join(', ')}.`,
    `Fill ${gaps.join(', ')} with real execution receipts before claiming gate_passed (QA needs at least one checked item; (실행 후 박제) placeholders and empty headers do not count).`
  );
}

function checkBacklogRoutingDecisionEvidence(frontmatter, filePath, items, routingDecisionMap) {
  const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  const rawCreatedAt = typeof frontmatter.created_at === 'string' ? frontmatter.created_at : null;
  const createdDate = rawCreatedAt && /^\d{4}-\d{2}-\d{2}/.test(rawCreatedAt)
    ? rawCreatedAt.slice(0, 10)
    : null;

  if (!createdDate || createdDate < ROUTING_DECISION_RECEIPT_CUTOFF) {
    pass(items, 'backlog_routing_decision', filePath,
      `${id ?? filePath} grandfathered (created_at ${rawCreatedAt ?? 'missing'} < cutoff ${ROUTING_DECISION_RECEIPT_CUTOFF}); backlog authoring routing receipt not required.`);
    return;
  }

  if (id && hasRoutingDecisionReceipt(routingDecisionMap, id, {
    selectedSkill: 'pokit.backlog',
    requestClass: 'issue_authoring',
    decisionSource: 'llm_selected_skill',
  })) {
    pass(items, 'backlog_routing_decision', filePath,
      `${id} backlog authoring backed by routing_decision receipt (LLM selected pokit.backlog).`);
    return;
  }

  fail(items, 'backlog_routing_decision', filePath,
    `${id ?? filePath} is backlog-authored but lacks routing_decision receipt for selected_skill=pokit.backlog/request_class=issue_authoring.`,
    'Before issue creation, call `node scripts/pokit-routing-decision.mjs --issue <POK-###> --selected-skill pokit.backlog --request-class issue_authoring --decision-reason "<why this is backlog authoring>"`.'
  );
}

function fieldIsMissing(value) {
  if (value === undefined || value === null || value === true) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim().length === 0;
}

function checkWorkerTaskTerminology(text, filePath, items) {
  const subIssues = sectionText(text, 'Sub-issues');
  if (!subIssues) return;
  if (!/worker[_ -]?type|Worker Task|permission_level|allowed_paths/i.test(subIssues)) return;

  warning(
    items,
    'worker_task_terminology',
    filePath,
    'New backlog-authored issue uses Sub-issues wording for worker dispatch; use ## Worker Tasks for dispatch and child issues for independent graph nodes.',
    'Rename in-issue dispatch decomposition to ## Worker Tasks, or create child issues with graph_root/depends_on when independent gate history is needed.'
  );
}

function checkWorkerTaskWorkflowTrace(text, filePath, items) {
  if (!hasWorkerTaskDeclaration(text)) return;

  const trace = sectionText(text, 'Workflow Trace');
  if (hasWorkerDispatchOrFallback(trace)) {
    pass(items, 'worker_task_workflow_trace', filePath, 'Worker task declaration is linked to Workflow Trace dispatch or fallback evidence.');
    return;
  }

  warning(
    items,
    'worker_task_workflow_trace',
    filePath,
    'Worker task declaration is missing Workflow Trace Workers or Fallback linkage.',
    'Add `Workers: <worker list>` or `Workers: none (narrow fallback)` plus `Fallback reason:` in ## Workflow Trace.'
  );
}

function hasWorkerTaskDeclaration(text) {
  const workerTasks = sectionText(text, 'Worker Tasks');
  return /worker[_ -]?type|allowed_paths|expected_output/i.test(workerTasks);
}

function hasWorkerDispatchOrFallback(trace) {
  if (!trace) return false;
  if (/Workers:\s*(?!\s*$).+/i.test(trace)) return true;
  return /Fallback reason:\s*(?!\s*$).+/i.test(trace);
}

export function checkWorkflowTraceSkillInvocationEvidence(
  text,
  filePath,
  frontmatter,
  items,
  executionEnteredIds = new Set(),
  routingDecisionMap = new Map()
) {
  if (!requiresPokitIssueSkillInvocationEvidence(filePath, frontmatter)) return;

  const trace = sectionText(text, 'Workflow Trace');
  const invocationMatch = trace.match(/^Skill invocation:\s*pokit-issue\b/im);
  if (!invocationMatch) {
    fail(items, 'workflow_trace_skill_invocation', filePath,
      'Workflow Trace is missing `Skill invocation: pokit-issue` evidence.',
      'Add `Skill invocation: pokit-issue` before execution approval evidence so manual SKILL.md reading is distinguishable from a declared skill workflow run.'
    );
    return;
  }

  // POK-207 — the text line alone is self-claimable. For cards created on/after the
  // cutoff, require a matching issue_execution_entered receipt (runner-emitted, layer ②);
  // pre-cutoff cards grandfather (receipts are a new mechanism, no backfill — POK-180).
  const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  const rawCreatedAt = typeof frontmatter.created_at === 'string' ? frontmatter.created_at : null;
  const createdDate = rawCreatedAt && /^\d{4}-\d{2}-\d{2}/.test(rawCreatedAt)
    ? rawCreatedAt.slice(0, 10)
    : null;

  if (!createdDate || createdDate < SKILL_INVOCATION_RECEIPT_CUTOFF) {
    pass(items, 'workflow_trace_skill_invocation', filePath,
      `${id ?? filePath} grandfathered (created_at ${rawCreatedAt ?? 'missing'} < cutoff ${SKILL_INVOCATION_RECEIPT_CUTOFF}); text-only Skill invocation accepted.`);
    return;
  }

  if (id && executionEnteredIds.has(id)) {
    pass(items, 'workflow_trace_skill_invocation', filePath,
      `${id} Skill invocation backed by issue_execution_entered receipt (runner flow proof).`);
  } else {
    fail(items, 'workflow_trace_skill_invocation', filePath,
      `${id ?? filePath} claims "Skill invocation: pokit-issue" (created_at>=${SKILL_INVOCATION_RECEIPT_CUTOFF}) but no matching issue_execution_entered receipt exists — text alone is self-claimable.`,
      'Run the issue through the runner (execution_request) so it emits an issue_execution_entered receipt to .ai-os/events/event-log.jsonl, instead of hand-writing the Skill invocation line.'
    );
    return;
  }

  if (!createdDate || createdDate < ROUTING_DECISION_RECEIPT_CUTOFF) return;

  if (id && hasRoutingDecisionReceipt(routingDecisionMap, id, {
    selectedSkill: 'pokit.issue',
    requestClass: 'issue_execution',
    decisionSource: 'llm_selected_skill',
  })) {
    pass(items, 'workflow_trace_skill_routing_decision', filePath,
      `${id} Skill invocation backed by routing_decision receipt (LLM selected pokit.issue before runner).`);
    return;
  }

  fail(items, 'workflow_trace_skill_routing_decision', filePath,
    `${id ?? filePath} has runner execution proof but no prior routing_decision receipt for selected_skill=pokit.issue/request_class=issue_execution.`,
    'Before runner execution, call `node scripts/pokit-routing-decision.mjs --issue <POK-###> --selected-skill pokit.issue --request-class issue_execution --decision-reason "<why this is issue execution>"`.'
  );
}

function requiresPokitIssueSkillInvocationEvidence(filePath, frontmatter) {
  const id = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  const issueNumber = id?.match(/POK-(\d{3})/) ? Number(id.match(/POK-(\d{3})/)[1]) : 0;
  return isSprintAtLeast(frontmatter.sprint, 12) || (frontmatter.sprint === 'v0.11.0' && issueNumber >= 177);
}

async function checkWorkflowTraceFanoutMetricsConsistency(projectRoot, text, filePath, frontmatter, items) {
  const issueId = frontmatter.id ?? filePath.match(/POK-\d{3}/)?.[0] ?? null;
  if (!issueId) return;
  if (!isIssueNumberAtLeast(issueId, FANOUT_METRICS_CONSISTENCY_CUTOFF_ISSUE)) return;

  const trace = sectionText(text, 'Workflow Trace');
  const workersMatch = trace.match(/Workers:\s*([^\n]+)/i);
  if (!workersMatch) return;

  const workersValue = workersMatch[1].trim();
  const claimsNoWorkers = /^none\b/i.test(workersValue);
  const metricsPath = await findIssueMetricsPath(projectRoot, issueId);
  const metricsResult = metricsPath ? await readIssueMetricsJson(projectRoot, metricsPath) : { ok: false, missing: true };
  const metrics = metricsResult.ok ? metricsResult.metrics : null;
  const subagentCount = metrics?.subagent_count;
  const hasNumericSubagentCount = typeof subagentCount === 'number' && Number.isInteger(subagentCount) && subagentCount >= 0;

  if (metricsPath && !metricsResult.ok) {
    fail(items, 'workflow_trace_fanout_metrics_consistency', metricsPath,
      `${issueId} metrics.json cannot be used for fan-out consistency: ${metricsResult.reason}.`,
      'Write valid metrics JSON with numeric subagent_count before relying on Workflow Trace fan-out evidence.'
    );
    return;
  }

  if (metrics && !hasNumericSubagentCount) {
    fail(items, 'workflow_trace_fanout_metrics_consistency', metricsPath,
      `${issueId} metrics.json is missing numeric subagent_count.`,
      'Set subagent_count to a non-negative integer that matches Workers evidence.'
    );
    return;
  }

  if (claimsNoWorkers) {
    if (hasNumericSubagentCount && subagentCount > 0) {
      fail(items, 'workflow_trace_fanout_metrics_consistency', metricsPath,
        `${issueId} Workflow Trace says Workers: none, but metrics subagent_count is ${subagentCount}.`,
        'Align Workflow Trace with actual worker execution, or correct metrics to subagent_count: 0 for fallback runs.'
      );
      return;
    }

    pass(items, 'workflow_trace_fanout_metrics_consistency', filePath,
      `${issueId} fallback worker trace is consistent with metrics.`);
    return;
  }

  if (hasNumericSubagentCount && subagentCount > 0) {
    pass(items, 'workflow_trace_fanout_metrics_consistency', metricsPath,
      `${issueId} Workers claim is backed by metrics subagent_count ${subagentCount}.`);
    return;
  }

  const explicitEvidence = await findExplicitWorkerEvidenceSource(projectRoot, trace);
  if (explicitEvidence.ok) {
    pass(items, 'workflow_trace_fanout_metrics_consistency', filePath,
      `${issueId} Workers claim has explicit worker evidence source.`);
    return;
  } else if (explicitEvidence.present) {
    fail(items, 'workflow_trace_fanout_metrics_consistency', filePath,
      `${issueId} explicit worker evidence is not usable: ${explicitEvidence.reason}.`,
      'Use a real evidence path that exists, or a non-placeholder subtask_id/evidence source.'
    );
    return;
  }

  fail(items, 'workflow_trace_fanout_metrics_consistency', metricsPath ?? filePath,
    `${issueId} Workflow Trace claims Workers: ${workersValue}, but no metrics/evidence confirms subagent execution.`,
    'Record metrics subagent_count > 0 or add explicit worker evidence before claiming non-empty Workers.'
  );
}

async function findExplicitWorkerEvidenceSource(projectRoot, trace) {
  const match = trace.match(/^(Worker evidence|Evidence source|Subtask evidence|Task evidence|Subtask id|subtask_id):\s*([^\n]+)/im);
  if (!match) return { present: false, ok: false };

  const label = match[1].toLowerCase();
  const value = match[2].trim();
  if (!value || /^(?:none|null|n\/a|na|<.*>)$/i.test(value) || /\b(?:todo|tbd|pending|unknown)\b/i.test(value)) {
    return { present: true, ok: false, reason: `${match[1]} is a placeholder` };
  }

  if (label === 'subtask id' || label === 'subtask_id') {
    return { present: true, ok: true };
  }

  const pathMatch = value.match(/(?:^|\s)(\.ai-os\/[^\s,;]+|projects\/[^\s,;]+|docs\/[^\s,;]+|scripts\/[^\s,;]+|tests\/[^\s,;]+)/);
  if (!pathMatch) {
    return { present: true, ok: true };
  }

  const evidencePath = pathMatch[1].replace(/[.)\]]+$/, '');
  if (await exists(projectRoot, evidencePath)) return { present: true, ok: true };
  return { present: true, ok: false, reason: `evidence path does not exist: ${evidencePath}` };
}

async function readIssueMetricsJson(projectRoot, metricsPath) {
  const metricsText = await readOptional(projectRoot, metricsPath);
  if (metricsText === null) return { ok: false, reason: 'metrics file is missing' };
  try {
    return { ok: true, metrics: JSON.parse(metricsText) };
  } catch {
    return { ok: false, reason: 'metrics JSON is invalid' };
  }
}

/**
 * Extracts the change scope (file path prefixes) for an issue card.
 * Prefers `conflict_scope: files:` block in the frontmatter raw text,
 * then falls back to the union of `allowed_paths:` arrays in the
 * Worker Tasks YAML code block in the body.
 * Returns an array of path strings, or [] if none found.
 */
async function extractIssueScope(root, issueId) {
  const issuePath = await resolveActiveIssuePath(root, issueId);
  if (!issuePath) return [];
  const text = await readOptional(root, issuePath);
  if (!text) return [];

  // Try conflict_scope.files from frontmatter raw text.
  // Matches: "conflict_scope:\n  files:\n    - path\n    - path"
  // Uses (?=^[^\s]) to stop at the next non-indented line (handles --- and other keys).
  const conflictScopeMatch = text.match(/^conflict_scope:\s*\n([\s\S]*?)(?=^[^\s])/m);
  if (conflictScopeMatch) {
    const filesMatch = conflictScopeMatch[1].match(/^\s{1,4}files:\s*\n([\s\S]*?)(?=^\s{0,4}[A-Za-z]|(?![\s\S]))/m);
    if (filesMatch) {
      const paths = [];
      for (const line of filesMatch[1].split('\n')) {
        const m = line.match(/^\s*-\s+(.+)$/);
        if (m) paths.push(m[1].trim());
      }
      if (paths.length > 0) return paths;
    }
  }

  // Fall back to union of allowed_paths from Worker Tasks YAML blocks.
  const paths = [];
  // Match yaml code blocks in the body.
  const yamlBlockRe = /```yaml\n([\s\S]*?)```/g;
  let blockMatch;
  while ((blockMatch = yamlBlockRe.exec(text)) !== null) {
    const block = blockMatch[1];
    // Within each block, find allowed_paths: followed by - item lines.
    const allowedMatch = block.match(/^[ \t]*allowed_paths:\s*\n([\s\S]*?)(?=^[ \t]*[A-Za-z]|(?![\s\S]))/m);
    if (allowedMatch) {
      for (const line of allowedMatch[1].split('\n')) {
        const m = line.match(/^\s*-\s+(.+)$/);
        if (m) paths.push(m[1].trim());
      }
    }
  }
  return paths;
}

/**
 * Returns true if `filePath` is within `scope` (exact match or under a scope prefix path).
 */
function isInScope(filePath, scope) {
  return scope.some((s) => filePath === s || filePath.startsWith(`${s}/`));
}

async function checkActiveGatePassedCommitClosure(context, items) {
  const activeIssue = context.currentFrontmatter?.active_issue;
  const gateState = context.currentFrontmatter?.gate_state;
  if (!activeIssue || gateState !== 'gate_passed') return;
  if (!await isGitWorkTree(context.root)) return;

  const commitStatus = await classifyCommitStatus({ root: context.root });

  // Determine if there are OTHER active claims (multi-session scenario).
  let otherClaims = [];
  try {
    const allClaims = await listActiveIssueClaims(context.root);
    otherClaims = allClaims.filter((c) => c.issue_id !== activeIssue);
  } catch {
    // Registry unavailable → treat as single-session.
    otherClaims = [];
  }

  if (otherClaims.length > 0) {
    // Multi-session: scope the residue check to the active issue's own change scope.
    const scope = await extractIssueScope(context.root, activeIssue);
    if (scope.length > 0) {
      // Only dirty_paths that fall within this issue's scope matter.
      const scopedDirty = commitStatus.dirty_paths.filter((p) => isInScope(p, scope));
      if (scopedDirty.length > 0) {
        fail(items, 'post_gate_commit_closure', '.ai-os/current.md',
          `${activeIssue} is gate_passed but commit-required changes remain in its scope: ${scopedDirty.join(', ')}.`,
          'Commit scoped changes or record an explicit deferral before treating the issue as closed.'
        );
        return;
      }
      pass(items, 'post_gate_commit_closure', '.ai-os/current.md',
        `${activeIssue} is gate_passed; no scoped residue (multi-session, ${otherClaims.length} other active claim(s)).`);
      return;
    }
    // Scope undeterminable → fall through to whole-tree check (do not silently pass).
  }

  // Single-session (or scope undeterminable): keep the existing whole-tree strict behavior.
  if (commitStatus.status === 'commit_needed') {
    fail(items, 'post_gate_commit_closure', '.ai-os/current.md',
      `${activeIssue} is gate_passed but commit-required changes remain: ${commitStatus.summary}.`,
      'Commit tracked/staged changes or record an explicit deferral before treating the issue as closed.'
    );
    return;
  }

  if (commitStatus.status === 'local_only') {
    pass(items, 'post_gate_commit_closure', '.ai-os/current.md',
      `${activeIssue} is gate_passed; only local runtime untracked paths remain (${commitStatus.local_only_untracked.length}).`);
    return;
  }

  if (commitStatus.status === 'clean') {
    pass(items, 'post_gate_commit_closure', '.ai-os/current.md',
      `${activeIssue} is gate_passed and git status is clean.`);
  }
}

function isSprintV015OrLater(sprint) {
  const match = String(sprint ?? '').match(/^v0\.(\d+)\.0$/);
  if (!match) return false;
  return Number(match[1]) >= 15;
}

async function checkStarterFullNpmTestEvidence(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const issueId = name.replace('.md', '');
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (frontmatter.gate_state !== 'gate_passed') continue;
    if (!isSprintV010OrLater(frontmatter.sprint)) continue;

    const metrics = await readIssueMetrics(projectRoot, issueId);
    if (!metrics) continue;

    const changedPaths = normalizeChangedPaths(metrics);
    const starterPaths = changedPaths.filter(isStarterRelatedPath);
    if (starterPaths.length === 0) continue;

    if (hasFullNpmTestEvidence(text, metrics)) {
      pass(items, 'starter_full_npm_test_evidence', filePath,
        `${issueId} starter-related changes include full npm test evidence.`);
      continue;
    }

    if (hasFullNpmTestSkipReason(text, metrics)) {
      pass(items, 'starter_full_npm_test_evidence', filePath,
        `${issueId} starter-related changes include explicit full npm test skip reason.`);
      continue;
    }

    fail(items, 'starter_full_npm_test_evidence', filePath,
      `${issueId} changed starter-related path(s) without full npm test evidence: ${starterPaths.join(', ')}.`,
      'Run full `npm test` and record the command/result in gate evidence, or record `Full npm test skip reason:`.'
    );
  }
}

async function checkExtractedStarterReleaseEvidence(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const issueId = name.replace('.md', '');
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (frontmatter.gate_state !== 'gate_passed') continue;
    if (frontmatter.issue_type !== 'release') continue;
    if (!isSprintV015OrLater(frontmatter.sprint)) continue;

    if (hasExtractedStarterEvidence(text)) {
      pass(items, 'extracted_starter_release_evidence', filePath,
        `${issueId} release gate records extracted starter verification evidence.`);
      continue;
    }

    fail(items, 'extracted_starter_release_evidence', filePath,
      `${issueId} release gate is missing extracted starter verification evidence.`,
      'Record extracted runner, doctor, starter smoke, and public-safe grep evidence before release gate.'
    );
  }
}

async function checkPokitConfigSecretBoundary(projectRoot, items) {
  const relPath = '.pokit/config.json';
  const trackedSecretEnvFiles = await listTrackedPokitSecretEnvFiles(projectRoot);
  for (const trackedPath of trackedSecretEnvFiles) {
    fail(items, 'pokit_config_secret_boundary', trackedPath,
      `${trackedPath} is tracked by git but project secret env files must stay untracked.`,
      'Remove the secret env file from git tracking and keep only `.pokit/.env.example` if an example is needed.'
    );
  }

  const text = await readOptional(projectRoot, relPath);
  if (text === null) return;

  let config;
  try {
    config = JSON.parse(text);
  } catch {
    fail(items, 'pokit_config_secret_boundary', relPath,
      '.pokit/config.json is not valid JSON.',
      'Fix the project config JSON before relying on the config resolver.'
    );
    return;
  }

  try {
    assertPublicConfigHasNoSecrets(config, relPath);
  } catch (err) {
    fail(items, 'pokit_config_secret_boundary', relPath,
      err.message,
      'Move secrets to `.pokit/.env` or runtime environment variables; keep `.pokit/config.json` public-safe.'
    );
    return;
  }

  pass(items, 'pokit_config_secret_boundary', relPath, '.pokit/config.json contains no secret-like keys.');
}

async function listTrackedPokitSecretEnvFiles(projectRoot) {
  if (!await isGitWorkTree(projectRoot)) return [];
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['ls-files', '--', '.pokit/.env', '.pokit/.env.*'], { cwd: projectRoot });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line !== '.pokit/.env.example');
  } catch {
    return [];
  }
}

async function findIssueMetricsPath(projectRoot, issueId) {
  const runsRoot = path.join(projectRoot, '.ai-os/runs');
  let dateEntries;
  try {
    dateEntries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const dateEntry of dateEntries) {
    if (!dateEntry.isDirectory()) continue;
    const relPath = `.ai-os/runs/${dateEntry.name}/${issueId}/metrics.json`;
    if (await exists(projectRoot, relPath)) return relPath;
  }
  return null;
}

async function isGitWorkTree(projectRoot) {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function normalizeChangedPaths(metrics) {
  for (const key of ['changed_paths', 'changedPaths', 'changed_files_list', 'touched_paths']) {
    const value = metrics?.[key];
    if (Array.isArray(value)) {
      return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function isStarterRelatedPath(filePath) {
  const normalized = String(filePath).replaceAll('\\', '/');
  return normalized === 'starter-manifest.yaml' ||
    normalized.startsWith('starter/') ||
    normalized.includes('/starter/') ||
    /(^|\/)starter[-_]/i.test(normalized) ||
    /(^|\/)pokit-(create-starter-archive|starter-self-test|generate-starter)/.test(normalized);
}

function hasFullNpmTestEvidence(text, metrics) {
  const command = String(metrics?.verification_full_suite_command ?? metrics?.full_test_command ?? '').trim();
  const status = String(metrics?.verification_full_suite_status ?? metrics?.full_test_status ?? '').trim().toLowerCase();
  const exitCode = metrics?.verification_full_suite_exit_code ?? metrics?.full_test_exit_code;
  if (command === 'npm test' && (status === 'pass' || status === 'passed' || exitCode === 0)) return true;

  return /(?:Full npm test|full `npm test`|npm test):[^\n]*(?:pass|passed|exit(?:_code)?\s*[:=]\s*0)/i.test(text) ||
    /(?:^|\n)[^\n]*npm test[^\n]*(?:pass|passed|exit(?:_code)?\s*[:=]\s*0)/i.test(sectionText(text, 'Gate'));
}

function hasFullNpmTestSkipReason(text, metrics) {
  const reason = metrics?.verification_full_suite_skip_reason ?? metrics?.full_npm_test_skip_reason;
  if (typeof reason === 'string' && reason.trim().length > 0) return true;
  return /(?:Full npm test skip reason|npm test skip reason):\s*\S/i.test(text);
}

function hasExtractedStarterEvidence(text) {
  const evidenceText = [
    sectionText(text, 'Evidence'),
    sectionText(text, 'QA'),
    sectionText(text, 'Gate'),
  ].join('\n');

  return /extracted starter|extracted archive|추출본/i.test(evidenceText) &&
    /pokit-runner\.mjs|runner evidence|runner/i.test(evidenceText) &&
    /pokit-doctor\.mjs|doctor evidence|doctor/i.test(evidenceText) &&
    /starter smoke|starter-smoke|smoke/i.test(evidenceText) &&
    /public-safe|public safe|grep/i.test(evidenceText);
}

async function checkSubIssuesNotRequiredEvidence(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const issueId = name.replace('.md', '');
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (!isSprintV010OrLater(frontmatter.sprint)) continue;
    if (frontmatter.gate_state !== 'gate_passed') continue;
    if (!/sub_issues:\s*not_required|not_required/i.test(sectionText(text, 'Sub-issues'))) continue;

    const acCount = countAcceptanceCriteria(text);
    const metrics = await readIssueMetrics(projectRoot, issueId);
    const broadByMetrics = metrics && (
      Number(metrics.changed_files) >= 4 ||
      Number(metrics.changed_lines) >= 200 ||
      Number(metrics.subagent_count) >= 2
    );
    const needsException = acCount >= 5 || broadByMetrics;
    if (!needsException) {
      pass(items, 'sub_issues_not_required_evidence', filePath, 'sub_issues: not_required is below broad-scope thresholds.');
      continue;
    }

    if (/Sub-issues exception:|PO exception:|sub_issues_exception:/i.test(text)) {
      pass(items, 'sub_issues_not_required_evidence', filePath, 'sub_issues: not_required has explicit exception evidence.');
      continue;
    }

    fail(items, 'sub_issues_not_required_evidence', filePath,
      `sub_issues: not_required conflicts with broad-scope threshold (AC count ${acCount}).`,
      'Add sub-issue decomposition, read-only preflight evidence, or explicit PO exception.'
    );
  }
}

async function readIssueMetrics(projectRoot, issueId) {
  const metricsPath = await findIssueMetricsPath(projectRoot, issueId);
  if (!metricsPath) return null;
  const text = await readOptional(projectRoot, metricsPath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function checkUnresolvedClarifications(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const clarificationsStart = text.indexOf('\n## Clarifications');
    if (clarificationsStart === -1) continue;
    const sectionBody = text.slice(clarificationsStart + 1);
    const nextSection = sectionBody.match(/\n## /);
    const clarificationsText = nextSection ? sectionBody.slice(0, nextSection.index) : sectionBody;
    if (!clarificationsText.includes('[NEEDS CLARIFICATION:')) continue;

    const frontmatter = parseFrontmatter(text);
    if (frontmatter.gate_state === 'gate_passed') {
      fail(
        items,
        'unresolved_clarification',
        filePath,
        `${filePath} has gate_state: gate_passed but ## Clarifications still contains [NEEDS CLARIFICATION:] marker.`,
        'Resolve all [NEEDS CLARIFICATION:] items in ## Clarifications before marking gate_passed.'
      );
    } else {
      warning(
        items,
        'unresolved_clarification',
        filePath,
        `${filePath} ## Clarifications contains unresolved [NEEDS CLARIFICATION:] marker.`,
        'Resolve all [NEEDS CLARIFICATION:] items before advancing gate_state.'
      );
    }
  }
}

async function checkACQuality(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (!isSprintV07OrLater(frontmatter.sprint)) continue;

    // AC 섹션만 추출
    const acStart = text.indexOf('\n## Acceptance Criteria');
    if (acStart === -1) continue;
    const acBody = text.slice(acStart + 1);
    const nextSection = acBody.match(/\n## /);
    const acText = nextSection ? acBody.slice(0, nextSection.index) : acBody;

    const found = findVagueLanguage(acText);
    if (found.length > 0) {
      fail(
        items,
        'ac_vague_language',
        filePath,
        `AC contains vague language: ${found.join(', ')}.`,
        'Replace vague terms with measurable, independently verifiable criteria.'
      );
    } else {
      pass(items, 'ac_vague_language', filePath, 'AC has no vague language patterns.');
    }
  }
}

function isSprintV07OrLater(sprint) {
  if (!sprint || typeof sprint !== 'string') return false;
  const match = sprint.match(/^v(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 0 || minor >= 7;
}

function isSprintV09OrLater(sprint) {
  if (!sprint || typeof sprint !== 'string') return false;
  const match = sprint.match(/^v(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 0 || minor >= 9;
}

function isSprintV010OrLater(sprint) {
  if (!sprint || typeof sprint !== 'string') return false;
  const match = sprint.match(/^v(\d+)\.(\d+)/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  return major > 0 || minor >= 10;
}

async function checkNarrowFallbackJustification(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (!isSprintV09OrLater(frontmatter.sprint)) continue;
    if (frontmatter.gate_state !== 'gate_passed') continue;
    if (!hasSection(text, 'Workflow Trace')) continue;

    const traceStart = text.indexOf('\n## Workflow Trace');
    const body = text.slice(traceStart + 1);
    const nextSection = body.match(/\n## /);
    const trace = nextSection ? body.slice(0, nextSection.index) : body;

    const workersMatch = trace.match(/Workers:\s*([^\n]+)/);
    if (!workersMatch) continue;
    const workersValue = workersMatch[1].trim();
    if (!/^none\s*\(narrow fallback\)/i.test(workersValue)) continue;

    const reasonMatch = trace.match(/Fallback reason:\s*([^\n]+)/);
    if (!reasonMatch) {
      warning(items, 'narrow_fallback_unjustified', filePath,
        'narrow fallback Workflow Trace에 Fallback reason 라인이 없습니다.',
        'Add `Fallback reason: <enum>` per POK-152. Valid enum: worker-unavailable | global-state-only | cross-file-invariant | trivial-scope.'
      );
      continue;
    }
    const reason = reasonMatch[1].trim();
    if (!VALID_FALLBACK_REASON_ENUM.includes(reason)) {
      warning(items, 'narrow_fallback_unjustified', filePath,
        `Fallback reason "${reason}" is not one of: ${VALID_FALLBACK_REASON_ENUM.join(' | ')}.`,
        'Replace free-text fallback reason with the POK-152 enum value.'
      );
      continue;
    }

    if (reason === 'cross-file-invariant') {
      const invariantMatch = trace.match(/Invariant:\s*([^\n]+)/);
      if (!invariantMatch || invariantMatch[1].trim().length === 0) {
        warning(items, 'narrow_fallback_unjustified', filePath,
          'cross-file-invariant fallback reason requires `Invariant: <한 줄>` line.',
          'Add an `Invariant:` line describing the shared invariant that prevents fan-out.'
        );
        continue;
      }
    }

    pass(items, 'narrow_fallback_unjustified', filePath,
      `narrow fallback reason "${reason}" is justified.`);
  }
}

async function checkEnshrinementPolicy(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    if (!isSprintV09OrLater(frontmatter.sprint)) continue;
    if (frontmatter.issue_type !== 'spec' && frontmatter.issue_type !== 'contract') continue;
    if (frontmatter.gate_state !== 'gate_passed') continue;

    if (!hasSection(text, 'Enshrinement Policy Check')) {
      warning(
        items,
        'enshrinement_policy',
        filePath,
        'missing ## Enshrinement Policy Check section.',
        'Add the section per .ai-os/standards/enshrinement-policy.md (3원칙 A/B/C + Count: N/3).'
      );
      continue;
    }

    const sectionStart = text.indexOf('\n## Enshrinement Policy Check');
    const body = text.slice(sectionStart + 1);
    const nextSection = body.match(/\n## /);
    const sectionText = nextSection ? body.slice(0, nextSection.index) : body;

    const countMatch = sectionText.match(/Count:\s*(\d+)\s*\/\s*3/);
    if (!countMatch) {
      warning(
        items,
        'enshrinement_policy',
        filePath,
        'Enshrinement Policy Check section is missing `Count: N/3 satisfied` line.',
        'Add `Count: N/3 satisfied` per .ai-os/standards/enshrinement-policy.md.'
      );
      continue;
    }

    const count = parseInt(countMatch[1], 10);
    const hasException = /Policy exception:/.test(sectionText);
    if (count < 2 && !hasException) {
      warning(
        items,
        'enshrinement_policy',
        filePath,
        `Enshrinement Policy Count ${count}/3 < 2 and Policy exception line is missing.`,
        'Either satisfy ≥2 principles or add `Policy exception: <PO 사유>` line.'
      );
    } else {
      pass(items, 'enshrinement_policy', filePath, `Enshrinement Policy Check OK (Count ${count}/3${hasException ? ' + exception' : ''}).`);
    }
  }
}

async function checkCurrent(context, items) {
  const filePath = '.ai-os/current.md';
  const currentText = await readOptional(context.root, filePath);
  if (currentText === null) {
    fail(items, 'current_exists', filePath, 'Missing current work surface.', 'Create or restore .ai-os/current.md.');
    return;
  }

  context.currentText = currentText;
  const frontmatter = parseFrontmatter(currentText);
  context.currentFrontmatter = frontmatter;
  // active_issue가 "null"/"none" 문자열인 경우 실제 null로 정규화 (fresh 스타터 초기 상태).
  const rawActiveIssue = frontmatter.active_issue ?? null;
  const normalizedActiveIssue =
    (rawActiveIssue === null || rawActiveIssue === true ||
     (typeof rawActiveIssue === 'string' &&
      (rawActiveIssue.trim() === '' || rawActiveIssue.trim().toLowerCase() === 'null' ||
       rawActiveIssue.trim().toLowerCase() === 'none')))
      ? null
      : rawActiveIssue;
  context.activeIssue = normalizedActiveIssue;
  try {
    const { readActiveIssueForWorktree } = await import('./lib/worktree-active-issue.mjs');
    const worktreeResult = await readActiveIssueForWorktree(context.root);
    const worktreeIssue = worktreeResult.activeIssue;
    // worktree 결과도 null/none 정규화
    const normalizedWorktreeIssue =
      (worktreeIssue === null || worktreeIssue === undefined ||
       (typeof worktreeIssue === 'string' &&
        (worktreeIssue.trim() === '' || worktreeIssue.trim().toLowerCase() === 'null' ||
         worktreeIssue.trim().toLowerCase() === 'none')))
        ? null
        : worktreeIssue;
    context.activeIssue = normalizedWorktreeIssue ?? context.activeIssue;
  } catch {
    // Keep tracked current.md fallback.
  }

  pass(items, 'current_exists', filePath, 'current.md exists.');

  for (const key of ['schema_version', 'contract_version', 'active_issue', 'next_action']) {
    if (key === 'active_issue') {
      // active_issue가 null/none/미존재인 경우: fresh 초기 상태로 pass 허용.
      // 실제 이슈 ID가 잡혀 있으면 기존대로 필수 체크.
      const val = frontmatter[key];
      const isInitialState = val === null || val === undefined || val === true ||
        (typeof val === 'string' && (val.trim() === '' || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'none'));
      if (isInitialState) {
        // fresh 초기 상태: 이슈 카드가 하나도 없는지 확인 후 pass
        const { files: issueFiles } = await listIssueFiles(context.root).catch(() => ({ files: [] }));
        if (issueFiles.length === 0) {
          pass(items, 'current_frontmatter', filePath, 'active_issue is null (fresh initial state — no issues yet).');
        } else {
          // 이슈가 있는데 active_issue가 null이면 경고 (fail 아님 — PO가 의도적으로 비울 수 있음)
          pass(items, 'current_frontmatter', filePath, 'active_issue is null (issues exist but none active).');
        }
      } else if (!val) {
        fail(items, 'current_frontmatter', filePath, `Missing ${key}.`, `Add ${key} to current.md frontmatter.`);
      } else {
        // 실제 이슈 ID — 기존 pass (필드가 있음)
        pass(items, 'current_frontmatter', filePath, `${key} is set to ${val}.`);
      }
      continue;
    }
    if (!frontmatter[key]) {
      fail(items, 'current_frontmatter', filePath, `Missing ${key}.`, `Add ${key} to current.md frontmatter.`);
    }
  }
}

async function checkSessionFiles(context, items) {
  for (const filePath of [
    '.ai-os/status-board.md',
    '.ai-os/failure-index.md',
    '.ai-os/memory/session/handoff.md',
  ]) {
    if (await exists(context.root, filePath)) {
      pass(items, 'session_restore', filePath, `${filePath} exists.`);
    } else {
      fail(items, 'session_restore', filePath, `${filePath} is missing.`, `Create or restore ${filePath}.`);
    }
  }
}

// fresh 프로젝트(starter)의 start_read_order 최소 집합 — startup-communication.md 없는 3-항목 버전.
const START_READ_ORDER_FRESH = Object.freeze([
  'AGENTS.md',
  '.ai-os/current.md',
  '.ai-os/memory/session/handoff.md',
]);

/**
 * 도구 소유 파일(standards, templates, commands)이 projectRoot에 없으면
 * packageRoot/starter/(글로벌 설치 본체의 스타터 시드)에서 존재 확인하는 fallback 헬퍼.
 *
 * fallback 대상: packageRoot/starter/<relPath> — 글로벌 패키지의 스타터 번들에서 찾음.
 * projectRoot가 packageRoot와 같은 경우(개발 레포)이더라도:
 *   - starter/ 서브경로는 projectRoot에 없으므로 동작 변화 없음.
 * 테스트 fixture(임시 dir)에서도 삭제된 파일은 starter/에도 없을 때만 fail — 의도적 삭제 테스트는 그대로.
 * 단, starter/에는 있는 표준 파일들은 글로벌 패키지에서 찾을 수 있으므로 pass 허용.
 */
async function toolFileExistsWithFallback(projectRoot, packageRoot, relPath) {
  if (await exists(projectRoot, relPath)) return { found: true, source: 'project' };
  // fallback: packageRoot 하에서 두 경로로 찾기 (소유 경계 기준).
  //   1. packageRoot/<relPath>         — .ai-os/standards/ 등 (npm files에 직접 포함)
  //   2. packageRoot/starter/<relPath> — .claude/commands/, .claude/skills/ 등 (starter/ 번들)
  // packageRoot가 null이면 fallback 비활성 — 기존 동작 유지 (테스트 호환성 보장).
  if (packageRoot) {
    for (const candidate of [
      path.join(packageRoot, relPath),
      path.join(packageRoot, 'starter', relPath),
    ]) {
      try {
        await stat(candidate);
        return { found: true, source: 'package' };
      } catch {
        // try next candidate
      }
    }
  }
  return { found: false, source: null };
}

async function checkReadOrder(context, items) {
  const startOrder = parseReadOrderSection(context.currentText, 'start_read_order');
  if (arrayEqual(startOrder, START_READ_ORDER)) {
    pass(items, 'start_read_order', '.ai-os/current.md', 'start_read_order is minimal and exact.');
  } else if (arrayEqual(startOrder, START_READ_ORDER_FRESH)) {
    // fresh 프로젝트(startup-communication.md 아직 없음): starter 최소 집합 허용
    pass(items, 'start_read_order', '.ai-os/current.md', 'start_read_order is fresh initial state (3-entry starter set).');
  } else {
    fail(
      items,
      'start_read_order',
      '.ai-os/current.md',
      `Expected ${START_READ_ORDER.join(', ')} but found ${startOrder.join(', ') || 'none'}.`,
      'Keep start_read_order limited to AGENTS.md, .ai-os/current.md, .ai-os/memory/session/handoff.md, and .ai-os/standards/startup-communication.md.'
    );
  }

  const workOrder = parseReadOrderSection(context.currentText, 'work_read_order');
  for (const filePath of WORK_READ_REQUIRED) {
    if (workOrder.includes(filePath)) {
      pass(items, 'work_read_order', filePath, `${filePath} is included.`);
      // 도구 소유 파일: projectRoot에 없으면 packageRoot에서 fallback 확인
      const { found, source } = await toolFileExistsWithFallback(context.root, context.packageRoot, filePath);
      if (found) {
        pass(items, 'work_read_file_exists', filePath, source === 'package'
          ? `${filePath} exists in package root (tool-owned, not yet copied to project).`
          : `${filePath} exists.`);
      } else {
        fail(items, 'work_read_file_exists', filePath, `${filePath} is listed but missing.`, `Create or restore ${filePath}.`);
      }
    } else {
      fail(items, 'work_read_order', filePath, `${filePath} is missing from work_read_order.`, `Add ${filePath} to work_read_order.`);
    }
  }

  if (context.activeIssue) {
    const activePath = await resolveActiveIssuePath(context.root, context.activeIssue);
    if (workOrder.includes(activePath)) {
      pass(items, 'work_read_order', activePath, 'Active issue is included.');
    } else {
      fail(items, 'work_read_order', activePath, 'Active issue is missing from work_read_order.', `Add ${activePath} to work_read_order.`);
    }
  }
}

async function checkActiveIssue(context, items) {
  const filePath = await resolveActiveIssuePath(context.root, context.activeIssue);
  const issueText = await readOptional(context.root, filePath);
  if (issueText === null) {
    fail(items, 'active_issue_exists', filePath, 'Active issue file is missing.', `Create or restore ${filePath}.`);
    return;
  }

  pass(items, 'active_issue_exists', filePath, 'Active issue exists.');
  const frontmatter = parseFrontmatter(issueText);
  context.activeLayer = frontmatter.active_layer ?? null;

  for (const key of ISSUE_FRONTMATTER_KEYS) {
    if (!frontmatter[key]) {
      fail(items, 'active_issue_frontmatter', filePath, `Missing ${key}.`, `Add ${key} to issue frontmatter.`);
    }
  }

  const requiredSections = requiredSectionsFor(frontmatter.issue_type);

  for (const section of requiredSections) {
    if (hasSection(issueText, section)) {
      pass(items, 'active_issue_section', filePath, `Section exists: ${section}.`);
    } else {
      fail(items, 'active_issue_section', filePath, `Missing section: ${section}.`, `Add ## ${section} to ${filePath}.`);
    }
  }

  checkSubagentPermission(issueText, context, filePath, items);
}

function checkSubagentPermission(issueText, context, filePath, items) {
  if (context.activeLayer !== 'L1') return;

  const permissionMatches = [...issueText.matchAll(/permission_level:\s*([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  if (permissionMatches.length === 0) {
    fail(items, 'subagent_permission', filePath, 'L1 subagent permission declaration is missing.', 'Declare permission_level: read_only in the Subagent Plan.');
    return;
  }

  for (const permission of permissionMatches) {
    if (permission === 'read_only') {
      pass(items, 'subagent_permission', filePath, 'L1 read_only subagent permission is allowed.');
    } else if (['write_scoped', 'propose_only'].includes(permission)) {
      fail(items, 'subagent_permission', filePath, `L1 rejects ${permission}.`, 'Use read_only in L1 or upgrade the layer before write-scoped subagents.');
    }
  }
}

async function checkStatusEnum(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) {
    warning(items, 'status_enum', dir, 'No issue files found.', 'Ensure issue directory exists.');
    return;
  }
  const legacyLimit = 35;

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    const issueNum = parseInt(name.replace('POK-', '').replace('.md', ''), 10);
    const derived = deriveStatus(frontmatter);

    if (derived === null) {
      if (issueNum <= legacyLimit) {
        fail(items, 'status_enum', filePath, `Cannot derive status: canonical_state=${frontmatter.canonical_state ?? 'missing'}.`, 'Add a known canonical_state or a status field.');
      } else {
        warning(items, 'status_enum', filePath, 'status field is missing.', 'Add status field with a valid enum value.');
      }
    } else if (!isValidStatus(derived)) {
      fail(items, 'status_enum', filePath, `Invalid status value: ${derived}.`, `Use one of: candidate, accepted, in_progress, gate_passed, deferred, dropped.`);
    } else {
      pass(items, 'status_enum', filePath, `status=${derived}.`);
    }
  }
}

async function checkOptionalFields(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;
  const existingIds = new Set(issueFiles.map((name) => name.replace('.md', '')));

  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;

    const frontmatter = parseFrontmatter(text);
    const currentId = name.replace('.md', '');
    const result = validateOptionalFields(frontmatter, { currentId, knownIds: existingIds });

    for (const msg of result.errors) {
      fail(items, 'optional_fields', filePath, msg, 'Fix per POK-038 contract.');
    }
    for (const msg of result.warnings) {
      warning(items, 'optional_fields', filePath, msg, 'Review per POK-038 contract.');
    }
    if (result.errors.length === 0 && result.warnings.length === 0) {
      pass(items, 'optional_fields', filePath, 'optional fields OK.');
    }
  }
}

async function checkCandidateRouted(projectRoot, items) {
  // POK-137: candidate 카드는 frontmatter sprint: 필드 보유 필수 (warn).
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;
  const sprintRe = /^(v\d+\.\d+\.\d+|backlog)$/;
  for (const name of issueFiles) {
    const filePath = `${dir}/${name}`;
    const text = await readOptional(projectRoot, filePath);
    if (text === null) continue;
    const fm = parseFrontmatter(text);
    if (fm.status !== 'candidate') continue;
    const sprint = fm.sprint;
    if (!sprint) {
      warning(items, 'candidate_unrouted', filePath, 'candidate card is missing sprint: field.', 'Add sprint: v<MAJOR>.<MINOR>.<PATCH> or sprint: backlog per .ai-os/standards/backlog-routing.md.');
    } else if (!sprintRe.test(String(sprint))) {
      warning(items, 'candidate_unrouted', filePath, `sprint: ${sprint} is not a valid routing value.`, 'Use sprint: v<MAJOR>.<MINOR>.<PATCH> or sprint: backlog.');
    } else {
      pass(items, 'candidate_unrouted', filePath, `routed to ${sprint}.`);
    }
  }
}

async function checkDependsOnCycles(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  // Build directed graph: id → [depends_on IDs]
  const graph = {};
  for (const name of issueFiles) {
    const id = name.replace('.md', '');
    const text = await readOptional(projectRoot, `${dir}/${name}`);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    const deps = Array.isArray(frontmatter['depends_on']) ? frontmatter['depends_on'] : [];
    graph[id] = deps.filter((dep) => isIssueId(dep));
  }

  const cyclePath = findCycle(graph);
  if (cyclePath) {
    const cycleStr = cyclePath.join(' → ');
    fail(items, 'depends_on_cycle', `${dir}/`, `depends_on cycle detected: ${cycleStr}`, 'Break the cycle by removing one depends_on reference.');
  } else {
    pass(items, 'depends_on_cycle', `${dir}/`, 'No depends_on cycle found.');
  }
}

function findCycle(graph) {
  const visited = new Set();
  const stack = new Set();

  function dfs(node, path) {
    visited.add(node);
    stack.add(node);

    for (const neighbor of graph[node] ?? []) {
      if (!visited.has(neighbor)) {
        const result = dfs(neighbor, [...path, neighbor]);
        if (result) return result;
      } else if (stack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        return [...path.slice(cycleStart), neighbor];
      }
    }

    stack.delete(node);
    return null;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      const result = dfs(node, [node]);
      if (result) return result;
    }
  }
  return null;
}

async function checkFailureMemoryConsistency(context, items) {
  const logPath = '.ai-os/memory/ai-failures/ai-failure-log.md';
  const rulesPath = '.ai-os/memory/ai-failures/prevention-rules.md';

  const [logText, rulesText] = await Promise.all([
    readOptional(context.root, logPath),
    readOptional(context.root, rulesPath),
  ]);

  if (logText === null || rulesText === null) return;

  const result = verifyFailureMemoryConsistency({ failureLogText: logText, preventionRulesText: rulesText });

  if (!result.valid) {
    for (const err of result.errors) {
      fail(items, 'failure_memory_consistency', logPath, err, 'Add the missing prevention rule or correct the failure log reference.');
    }
  } else {
    pass(items, 'failure_memory_consistency', logPath, 'ai-failure-log rule references are consistent with prevention-rules.md.');
  }
}


async function checkVersionCompatibility(context, items) {
  const filePath = 'pokit.config.yaml';
  const configText = await readOptional(context.root, filePath);
  if (configText === null) {
    warning(items, 'version_compatibility', filePath, 'pokit.config.yaml is missing.', 'Fallback to current.md schema_version and contract_version.');
    return;
  }

  for (const key of ['starter_version', 'contract_version', 'schema_version']) {
    if (new RegExp(`${key}:\\s*[^\\n]+`).test(configText)) {
      pass(items, 'version_compatibility', filePath, `${key} is present.`);
    } else {
      fail(items, 'version_compatibility', filePath, `${key} is missing.`, `Add ${key} to pokit_version.`);
    }
  }

  for (const key of ['skill_version', 'runner_version', 'generated_shim_version']) {
    if (new RegExp(`${key}:\\s*null`).test(configText)) {
      warning(items, 'version_compatibility', filePath, `${key} is null in starter-only mode.`, `Install ${key.replace('_version', '')} when leaving starter-only mode.`);
    }
  }

  if (/destructive_update_allowed:\s*false/.test(configText)) {
    pass(items, 'destructive_update', filePath, 'destructive_update_allowed is false.');
  } else {
    fail(items, 'destructive_update', filePath, 'destructive_update_allowed is not false.', 'Set destructive_update_allowed: false.');
  }
}

async function checkInternalSkills(context, items) {
  const skillsDir = path.join(context.root, '.claude/skills');
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = `.claude/skills/${entry.name}`;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      warning(
        items,
        'internal_skill',
        entryPath,
        'flat skill markdown file found; internal skills must use directory/SKILL.md structure.',
        `Move ${entryPath} to .claude/skills/${entry.name.replace(/\.md$/, '')}/SKILL.md with required frontmatter.`
      );
      continue;
    }

    if (!entry.isDirectory()) continue;

    const skillPath = `${entryPath}/SKILL.md`;
    const skillText = await readOptional(context.root, skillPath);
    if (skillText === null) continue;

    const frontmatter = parseFrontmatter(skillText);
    let valid = true;
    if (!frontmatter.name) {
      valid = false;
      warning(items, 'internal_skill', skillPath, 'missing required name frontmatter.', 'Add name: <kebab-case-name> to the skill frontmatter.');
    }
    if (!frontmatter.description) {
      valid = false;
      warning(items, 'internal_skill', skillPath, 'missing required description frontmatter.', 'Add description: with explicit TRIGGER/SKIP rules.');
    }
    if (valid) {
      pass(items, 'internal_skill', skillPath, 'internal skill has directory structure and required frontmatter.');
    }
  }
}

async function checkCodexInstalledSkillDrift(context, items, { installedSkillProvider = null } = {}) {
  for (const contract of CODEX_INSTALLED_SKILL_CONTRACTS) {
    const repoSkillText = await readOptional(context.root, contract.repoPath);
    if (repoSkillText === null) continue;

    let installedSkillText = null;
    let installedSkillPath = contract.displayPath;

    if (installedSkillProvider) {
      const provided = await installedSkillProvider(contract.name);
      if (typeof provided === 'string') {
        installedSkillText = provided;
        installedSkillPath = `provider:codex-installed-skill:${contract.name}`;
      } else if (provided && typeof provided === 'object') {
        installedSkillText = provided[contract.name] ?? provided[contract.installedPath] ?? null;
        installedSkillPath = `provider:codex-installed-skill:${contract.name}`;
      }
    } else if (process.env.HOME) {
      const absolutePath = path.join(process.env.HOME, '.codex', contract.installedPath);
      try {
        installedSkillText = await readFile(absolutePath, 'utf8');
        installedSkillPath = absolutePath;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    if (installedSkillText === null) {
      // POK-334 — 부재는 "이 머신에 Codex 미설치"이지 drift가 아니다. fail로 두면
      // CI 러너·새 사용자 등 ~/.codex 없는 모든 환경에서 doctor가 무조건 죽는
      // 환경 결합 가드가 된다 (POK-328 죽은-가드 패턴의 역방향: 늘 우는 경보).
      // 설치 사본이 존재하는데 토큰이 어긋나는 경우만 fail로 유지한다.
      warning(items, 'codex_installed_skill_drift', installedSkillPath,
        `Installed Codex ${contract.name} skill not found on this machine — drift check skipped (Codex runtime support cannot be claimed here).`,
        'Run `node scripts/pokit-sync.mjs` to install repo-local POKit skills into Codex before claiming runtime support.'
      );
      continue;
    }

    const repoTokens = contract.tokens.filter((token) => repoSkillText.includes(token));
    const missing = repoTokens.filter((token) => !installedSkillText.includes(token));
    if (missing.length > 0) {
      fail(items, 'codex_installed_skill_drift', installedSkillPath,
        `Installed Codex ${contract.name} skill is missing repo contract token(s): ${missing.join(', ')}.`,
        'Reinstall or sync the Codex skill from the repo-local SKILL.md before claiming runtime support.'
      );
      continue;
    }

    if (repoTokens.length > 0) {
      pass(items, 'codex_installed_skill_drift', installedSkillPath, `Installed Codex ${contract.name} skill has required repo contract tokens.`);
    }
  }
}

// parseFrontmatter imported from ./lib/issue-frontmatter.mjs (POK-339)

function parseReadOrderSection(text, sectionName) {
  const match = text.match(new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(\\n## |$)`));
  if (!match) return [];

  return [...match[1].matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((entry) => entry[1]);
}

function sectionText(text, section) {
  const heading = text.match(new RegExp(`^## ${escapeRegex(section)}\\s*$`, 'm'));
  if (!heading) return '';
  const bodyStart = heading.index + heading[0].length;
  const rest = text.slice(bodyStart);
  const nextHeading = rest.match(/\n##\s+/);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

function countAcceptanceCriteria(text) {
  const acText = sectionText(text, 'Acceptance Criteria');
  return acText
    .split('\n')
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line))
    .length;
}

function hasSection(text, section) {
  return new RegExp(`^## ${escapeRegex(section)}\\s*$`, 'm').test(text);
}

// POK-328 (레버 1) — 검사들의 검사. 건너뜀(skip)은 소리가 나지 않는다: 필드명 변경 등으로
// 검사의 대상 술어가 조용히 깨지면, 대상이 분명히 존재하는데도 그 검사는 항목을 하나도
// 안 남기고 doctor는 "이상 없음"이라 보고한다 (v010_metrics_evidence가 sprint→
// sprint_candidate 개명으로 한 버전 내내 죽어 있던 실사례). 대상 수를 독립 계산해서
// "대상 > 0인데 검사 항목 0개"를 죽은 검사로 fail 처리한다.
export async function checkCoverageHonesty(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  let gatePassedV010 = 0;
  let authoredAfterCutoff = 0;
  for (const name of issueFiles) {
    const text = await readOptional(projectRoot, `${dir}/${name}`);
    if (text === null) continue;
    const frontmatter = parseFrontmatter(text);
    const sprint = resolveIssueSprint(frontmatter);
    const sprintMatch = String(sprint).match(/^v(\d+)\.(\d+)/);
    const v010Plus = sprintMatch && (Number(sprintMatch[1]) > 0 || Number(sprintMatch[2]) >= 10);
    if (frontmatter.gate_state === 'gate_passed' && v010Plus) gatePassedV010 += 1;
    const createdAt = String(frontmatter.created_at ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt) && createdAt >= AUTHORING_RECEIPT_CUTOFF) {
      authoredAfterCutoff += 1;
    }
  }

  // 검사 id ↔ 독립 계산한 대상 수. 대상 술어와 검사의 방문 술어가 1:1인 검사만 등록한다
  // (조건부 방문 검사를 넣으면 거짓 경보가 난다).
  const expectations = [
    ['v010_metrics_evidence', gatePassedV010],
    ['workflow_trace', gatePassedV010],
    ['issue_authoring_evidence', authoredAfterCutoff],
  ];

  for (const [checkId, targetCount] of expectations) {
    if (targetCount === 0) continue;
    const visited = items.filter((item) => item.check === checkId).length;
    if (visited === 0) {
      fail(items, 'check_coverage', `doctor:${checkId}`,
        `${checkId} 검사가 대상 ${targetCount}건이 있는데 항목을 0개 남김 — 죽은 검사(대상 술어 불일치) 의심.`,
        `Inspect the ${checkId} target predicate (field rename? cutoff drift?) — a check that visits nothing protects nothing.`
      );
    } else {
      pass(items, 'check_coverage', `doctor:${checkId}`,
        `${checkId} 검사가 대상 ${targetCount}건 중 ${visited}건을 점검 (살아있음).`);
    }
  }
}

// POK-340 — 토폴로지 버전 드리프트 검사.
//
// 규칙:
//   - .ai-os/current.md frontmatter에 pokit_version 필드가 없으면 pass
//     (토폴로지 이전 프로젝트 / 이 dev 레포 — doctor가 이 레포에서 계속 green이어야 함).
//   - 있는데 package.json version과 다르면 fail + "pokit update 실행" 안내.
//   - schema_version이 KNOWN_SCHEMA_VERSIONS 밖이면 fail + 마이그레이션 안내.
async function checkPokitVersionDriftDoctor(context, items) {
  const filePath = '.ai-os/current.md';
  const currentMdText = context.currentText;
  if (!currentMdText) return; // checkCurrent가 이미 fail 기록 — 여기서는 생략

  // 패키지 버전 읽기
  let packageVersion = '0.0.0';
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    packageVersion = pkg.version ?? '0.0.0';
  } catch {
    // package.json 없을 경우 무시 — 0.0.0으로 드리프트 비교
  }

  // schema_version 검사
  const { known, schemaVersion } = checkSchemaVersionKnown({ currentMdText });
  if (!known) {
    fail(
      items,
      'pokit_version_drift',
      filePath,
      `알 수 없는 schema_version: ${schemaVersion} (지원: ${KNOWN_SCHEMA_VERSIONS.join(', ')})`,
      'docs/v0.19.0/topology-spec.md §4 마이그레이션 가이드를 확인하세요.'
    );
    return;
  }

  // pokit_version 드리프트 검사
  const { status, projectVersion } = checkPokitVersionDrift({ currentMdText, packageVersion });
  if (status === 'absent') {
    // pokit_version 필드 없음 — 토폴로지 이전 프로젝트, pass
    pass(items, 'pokit_version_drift', filePath, 'pokit_version 필드 없음 — 토폴로지 이전 프로젝트 (pass).');
  } else if (status === 'match') {
    pass(items, 'pokit_version_drift', filePath, `본체 v${packageVersion} ↔ 프로젝트 기록 v${projectVersion} 일치.`);
  } else {
    fail(
      items,
      'pokit_version_drift',
      filePath,
      `본체 v${packageVersion} ↔ 프로젝트 기록 v${projectVersion} 불일치 — pokit update 실행.`,
      'pokit update (또는 node scripts/pokit-update.mjs --yes) 를 실행해 버전 기록을 갱신하세요.'
    );
  }
}

function summarize(items) {
  return items.reduce(
    (summary, item) => {
      summary[item.status] = (summary[item.status] ?? 0) + 1;
      return summary;
    },
    { pass: 0, fail: 0, warning: 0, uncollected: 0 }
  );
}

function pass(items, check, filePath, message) {
  items.push({ status: 'pass', check, path: filePath, message });
}

function fail(items, check, filePath, message, nextAction) {
  items.push({ status: 'fail', check, path: filePath, message, next_action: nextAction ?? resolveDoctorGuidance({ check, message }) });
}

function warning(items, check, filePath, message, nextAction) {
  items.push({ status: 'warning', check, path: filePath, message, next_action: nextAction ?? resolveDoctorGuidance({ check, message }) });
}

// POK-364: 이벤트로그 없는 환경(fresh-pull/스타터 번들)에서 영수증 부재를 fail 대신 미수집으로 표시.
function uncollected(items, check, filePath, message) {
  items.push({ status: 'uncollected', check, path: filePath, message });
}

// POK-364: 이벤트로그 파일이 이 머신에 존재하는지 확인. 없으면 fresh-checkout 환경.
async function isEventLogPresent(projectRoot) {
  try {
    await access(path.join(projectRoot, '.ai-os/events/event-log.jsonl'));
    return true;
  } catch {
    return false;
  }
}

// POK-134 Rule Section Compaction — `## Rule` 본문 POK gate 로그 줄 수 임계 가드.
// 회전 정책: .ai-os/standards/rule-section-rotation.md
//   - > 30: fail (즉시 sprint-close 또는 수동 회전 필요)
//   - > 20: warning (sprint-close 임박 신호)
//   - ≤ 20: pass
// `### Precedents (pinned)` 섹션은 카운트 제외 (영구 pin).
function checkRuleSectionSize(context, items) {
  if (!context.currentText) return;
  const filePath = '.ai-os/current.md';
  const count = countGateLogs(context.currentText);

  if (count > 30) {
    fail(
      items,
      'rule_section_size',
      filePath,
      `## Rule 본문 POK gate 로그 ${count} 줄 — 임계 30 초과.`,
      'Run sprint-close to rotate Rule body to .ai-os/memory/rule-archive/<sprint>.md (per .ai-os/standards/rule-section-rotation.md).'
    );
  } else if (count > 20) {
    warning(
      items,
      'rule_section_size',
      filePath,
      `## Rule 본문 POK gate 로그 ${count} 줄 — 임계 20 초과 (회전 권장).`,
      'Plan a sprint-close rotation to .ai-os/memory/rule-archive/<sprint>.md soon.'
    );
  } else {
    pass(items, 'rule_section_size', filePath, `## Rule 본문 POK gate 로그 ${count} 줄 (≤ 20).`);
  }
}

async function checkSprintClose(projectRoot, items) {
  const currentText = await readOptional(projectRoot, '.ai-os/current.md');
  if (!currentText) return;

  const frontmatter = parseFrontmatter(currentText);
  const activeSprint = frontmatter.active_sprint;
  if (!activeSprint) return;

  const scopeText = await readOptional(projectRoot, `.ai-os/sprints/${activeSprint}/release-scope.yaml`);
  if (!scopeText) return;

  const archivePath = `.ai-os/memory/session/archive/handoff-${activeSprint}.md`;
  if (await exists(projectRoot, archivePath)) return;

  const hasActiveCandidate = scopeText.includes('status: candidate');
  if (hasActiveCandidate) return;
  if (hasUnresolvedCandidateDecisionGate(scopeText)) return;

  warning(
    items,
    'sprint_close',
    archivePath,
    `Sprint ${activeSprint} appears complete but handoff archive is missing.`,
    `Run: npm run sprint-close ${activeSprint}`
  );
}

function hasUnresolvedCandidateDecisionGate(scopeText) {
  const gateBlock = scopeText.match(/(?:^|\n)candidate_decision_gate:\n([\s\S]*?)(?=\n(?:deferred|retro_action_mapping|gate_conditions):|$)/)?.[1] ?? '';
  const decideBlock = gateBlock.match(/(?:^|\n)\s+decide:\n([\s\S]*?)(?=\n\s+[A-Za-z0-9_-]+:|\n[A-Za-z0-9_-]+:|$)/)?.[1] ?? '';
  return new RegExp(`^\\s*-\\s+${ISSUE_ID_SOURCE}`, 'm').test(decideBlock);
}

async function checkSprintScopeFirst(projectRoot, items) {
  const currentText = await readOptional(projectRoot, '.ai-os/current.md');
  if (!currentText) return;

  const current = parseFrontmatter(currentText);
  const activeSprint = current.active_sprint;
  if (!isSprintAtLeast(activeSprint, 10)) return;

  const scopePath = `.ai-os/sprints/${activeSprint}/release-scope.yaml`;
  const scopeText = await readOptional(projectRoot, scopePath);
  if (!scopeText) {
    fail(
      items,
      'sprint_scope_first',
      scopePath,
      `${activeSprint} release-scope.yaml is missing.`,
      'Create the sprint scope spec and release-scope.yaml before selecting feature/implementation issues.'
    );
    return;
  }

  const scopeIssue = scopeText.match(new RegExp(`^scope_spec_issue:\\s*(${ISSUE_ID_SOURCE})`, 'm'))?.[1] ?? null;
  if (!scopeIssue) {
    fail(
      items,
      'sprint_scope_first',
      scopePath,
      `${activeSprint} release-scope.yaml is missing scope_spec_issue.`,
      'Add scope_spec_issue: POK-XXX and make that issue the first accepted sprint item.'
    );
    return;
  }

  const firstAccepted = scopeText.match(new RegExp(`^accepted:\\s*\\n\\s*-\\s*id:\\s*(${ISSUE_ID_SOURCE})`, 'm'))?.[1] ?? null;
  if (firstAccepted !== scopeIssue) {
    fail(
      items,
      'sprint_scope_first',
      scopePath,
      `First accepted issue is ${firstAccepted ?? 'missing'}, not scope_spec_issue ${scopeIssue}.`,
      'Move the sprint scope spec to the first accepted entry.'
    );
  }

  const issuePath = await resolveActiveIssuePath(projectRoot, scopeIssue);
  const issueText = await readOptional(projectRoot, issuePath);
  if (!issueText) {
    fail(
      items,
      'sprint_scope_first',
      issuePath,
      `Scope spec issue ${scopeIssue} is missing.`,
      `Create ${issuePath} before starting ${activeSprint}.`
    );
    return;
  }

  const issue = parseFrontmatter(issueText);
  const title = issue.title ?? issueText.match(/^#\s+(.+)$/m)?.[1] ?? '';
  if (issue.issue_type !== 'spec' || !title.includes(`${activeSprint} Scope Spec`)) {
    fail(
      items,
      'sprint_scope_first',
      issuePath,
      `${scopeIssue} is not a valid ${activeSprint} Scope Spec issue.`,
      'Set issue_type: spec and title containing "<sprint> Scope Spec".'
    );
  }

  if (current.active_issue !== scopeIssue && issue.gate_state !== 'gate_passed') {
    fail(
      items,
      'sprint_scope_first',
      '.ai-os/current.md',
      `${activeSprint} active_issue is ${current.active_issue}, but scope spec ${scopeIssue} is not gate_passed.`,
      `Start ${activeSprint} with ${scopeIssue}; only select later issues after the scope spec gate passes.`
    );
    return;
  }

  pass(items, 'sprint_scope_first', scopePath, `${activeSprint} starts from scope spec ${scopeIssue}.`);
}

// POK-202: guard — yaml status cache must agree with card gate_state on gate_passed-ness.
async function checkReleaseScopeStatusVsFrontmatter(projectRoot, items) {
  const currentText = await readOptional(projectRoot, '.ai-os/current.md');
  if (!currentText) return;

  const current = parseFrontmatter(currentText);
  const activeSprint = current.active_sprint;
  if (!activeSprint) return;

  const scopePath = `.ai-os/sprints/${activeSprint}/release-scope.yaml`;
  const scopeText = await readOptional(projectRoot, scopePath);
  if (!scopeText) return;

  // Parse all entries that have a status: field (accepted + candidates sections).
  // Regex captures each `- id: POK-XXX` block and the `status:` value that follows it.
  // POK-202 review (HIGH): allow the block's final line to end at EOF (no trailing
  // newline) so a drift on the LAST entry is never silently missed.
  const entryPattern = new RegExp(`^\\s*-\\s+id:\\s*(${ISSUE_ID_SOURCE})[^\\n]*\\n((?:\\s{4}[^\\n]*(?:\\n|$))*)`, 'gm');
  const entries = [];
  for (const match of scopeText.matchAll(entryPattern)) {
    const id = match[1];
    const block = match[2] ?? '';
    const statusMatch = block.match(/^\s+status:\s*([A-Za-z0-9_-]+)/m);
    if (statusMatch) entries.push({ id, status: statusMatch[1] });
  }

  for (const { id, status } of entries) {
    const issuePath = await resolveActiveIssuePath(projectRoot, id);
    const issueText = issuePath ? await readOptional(projectRoot, issuePath) : null;
    if (!issueText) {
      // POK-202 review (MEDIUM): a missing card cannot verify a done-claim. If the
      // yaml asserts gate_passed but no card backs it, warn (drift could be hidden).
      // A non-gate_passed status with a missing card is legitimate (e.g. forwarded /
      // cross-sprint id with no local card) → skip silently.
      if (status === 'gate_passed') {
        warning(
          items,
          'release_scope_status_vs_frontmatter',
          scopePath,
          `${id}: release-scope.yaml status "gate_passed" but the issue card could not be read — done-claim is unverifiable.`,
          `Confirm ${id} card exists at projects/pokit/issues/${id}.md and its gate_state, or correct the yaml id/status.`
        );
      }
      continue;
    }

    const fm = parseFrontmatter(issueText);
    const gateState = fm.gate_state ?? null;

    const yamlDone = status === 'gate_passed';
    const cardDone = gateState === 'gate_passed';

    if (yamlDone !== cardDone) {
      fail(
        items,
        'release_scope_status_vs_frontmatter',
        scopePath,
        `${id}: release-scope.yaml status "${status}" conflicts with card gate_state "${gateState}". ` +
          `Update the yaml status cache to match the card SSoT.`,
        `Edit ${scopePath} — set ${id} status to match card gate_state: ${gateState ?? 'pending'}.`
      );
    } else {
      pass(
        items,
        'release_scope_status_vs_frontmatter',
        scopePath,
        `${id}: yaml status "${status}" agrees with card gate_state "${gateState}" on gate_passed-ness.`
      );
    }
  }
}

async function checkEvidenceIndexFreshness(projectRoot, items) {
  const filePath = '.ai-os/events/evidence-index.json';
  const text = await readOptional(projectRoot, filePath);
  if (!text) return;

  let existing;
  try {
    existing = JSON.parse(text);
  } catch {
    warning(
      items,
      'evidence_index_freshness',
      filePath,
      'evidence-index.json is not valid JSON.',
      'Regenerate with: node scripts/pokit-list-evidence.mjs --write'
    );
    return;
  }

  const generatedAt = existing.generated_at ?? new Date(0).toISOString();
  const expected = await buildEvidenceIndex(projectRoot, { generatedAt });
  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    warning(
      items,
      'evidence_index_freshness',
      filePath,
      'evidence-index.json differs from current event/provider/runtime/metrics evidence.',
      'Regenerate with: node scripts/pokit-list-evidence.mjs --write'
    );
    return;
  }

  pass(items, 'evidence_index_freshness', filePath, 'evidence-index.json matches current derived evidence.');
}

async function checkStaleArtifacts(projectRoot, items, { staleDays = 30 } = {}) {
  const docsDir = path.join(projectRoot, 'docs');
  let entries;
  try {
    entries = await readdir(docsDir, { recursive: true });
  } catch {
    return;
  }

  const now = Date.now();
  const staleMs = staleDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const relPath = path.join('docs', entry);
    const fullPath = path.join(projectRoot, relPath);
    try {
      const fileStats = await stat(fullPath);
      if (!fileStats.isFile()) continue;
      const ageMs = now - fileStats.mtimeMs;
      if (ageMs > staleMs) {
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        warning(items, 'stale_artifact', relPath, `not modified in ${ageDays} days (threshold: ${staleDays}).`, 'Review and archive or update this artifact.');
      } else {
        pass(items, 'stale_artifact', relPath, `modified within ${staleDays}-day window.`);
      }
    } catch {
      // skip inaccessible files
    }
  }
}

async function checkNetGrowth(projectRoot, items) {
  let execFileAsync;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    execFileAsync = promisify(execFile);
  } catch {
    return;
  }

  try {
    const since = '30 days ago';
    const gitOpts = { cwd: projectRoot };

    const [addedResult, deletedResult] = await Promise.all([
      execFileAsync('git', ['log', `--since=${since}`, '--diff-filter=A', '--name-only', '--format=', '--', 'docs/', 'contracts/'], gitOpts),
      execFileAsync('git', ['log', `--since=${since}`, '--diff-filter=D', '--name-only', '--format=', '--', 'docs/', 'contracts/'], gitOpts),
    ]);

    const added = addedResult.stdout.trim().split('\n').filter(Boolean).length;
    const deleted = deletedResult.stdout.trim().split('\n').filter(Boolean).length;
    const netGrowth = added - deleted;

    const msg = `Sprint net growth (30d): +${added} created, -${deleted} deleted, net +${netGrowth}.`;
    if (netGrowth > 10) {
      warning(items, 'net_growth', 'docs/', msg + ' Consider archiving stale artifacts.', 'Archive or delete artifacts that are no longer active.');
    } else {
      pass(items, 'net_growth', 'docs/', msg);
    }
  } catch {
    // git not available or not a repository — skip silently
  }
}

async function checkRetroSchemaCompliance(context, items) {
  const root = context.root;
  const activeSprint = context.currentFrontmatter?.active_sprint;
  if (!activeSprint) return;

  // 본 sprint 진행 중이면 — 검증 면제. retro는 sprint-close 후 작성.
  // 직전 sprint의 retro만 검증.
  const prevSprint = derivePrevSprint(activeSprint);
  if (!prevSprint) return;

  if (isTransitionalImmune(prevSprint)) {
    pass(items, 'retro_schema_compliance', `docs/${prevSprint}/retro.md`,
      `Transitional immune sprint (${prevSprint}) — backfill 금지 정책으로 회고 부재 면제.`);
    return;
  }

  const retroPath = retroPathFor(root, prevSprint);
  const result = await verifyRetroSchema(retroPath, {});

  if (result.ok) {
    pass(items, 'retro_schema_compliance', `docs/${prevSprint}/retro.md`,
      `9섹션 + 1:1 매핑 표 + 계획 대비 실제 delta 표 통과${result.warnings.length ? ` (warnings: ${result.warnings.join(', ')})` : ''}.`);
    return;
  }

  // skip_reason 경로 — scope spec issue frontmatter 확인은 후속 sprint 적용 (v0.10+).
  // v0.9 자기 sprint 자신의 retro 부재는 sprint-close 시점 검증으로 분리.
  // 본 sprint 진행 중에는 directives만 출력.
  for (const failKey of result.fails) {
    warning(items, 'retro_schema_compliance', `docs/${prevSprint}/retro.md`,
      `${failKey} — v2 표준 위반 (sprint-close 시 sprint-retro.md 작성 필요).`);
  }
  for (const warnKey of result.warnings) {
    warning(items, 'retro_schema_compliance', `docs/${prevSprint}/retro.md`, warnKey);
  }
}

function derivePrevSprint(activeSprint) {
  const match = activeSprint.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  if (minor === 0) {
    if (major === 0) return null;
    return null;  // major 경계는 단순화 — v0.10의 prev는 v0.9.0
  }
  return `v${major}.${minor - 1}.0`;
}

async function checkSubIssues(projectRoot, items) {
  const { dir, files: issueFiles } = await listIssueFiles(projectRoot);
  if (issueFiles.length === 0) return;

  const { results } = await runSubIssueChecks(projectRoot, dir, issueFiles);
  for (const r of results) items.push(r);
}

async function checkActiveIssuePreflightReceipt(context, items) {
  const id = context.activeIssue;
  if (!isIssueId(id)) return;

  const filePath = await resolveActiveIssuePath(context.root, id);
  const issueText = await readOptional(context.root, filePath);
  if (issueText === null) return;

  const issue = parseFrontmatter(issueText);
  if (!['pending', 'in_progress'].includes(issue.gate_state)) return;
  if (!isIssueNumberAtLeast(id, 281)) return;

  const lockMap = await loadPostRunnerExecutionLockMap(context.root);
  const locks = lockMap.get(id) ?? [];
  if (locks.length === 0) {
    pass(items, 'issue_preflight_receipt', filePath, `${id} has not reached post-runner execution lock yet; targeted preflight receipt not required.`);
    return;
  }

  const preflightMap = await loadIssuePreflightPassMap(context.root);
  const receipts = preflightMap.get(id) ?? [];
  const latestLockAt = String(locks.at(-1)?.emitted_at ?? '');
  const hasAfterLatestLock = receipts.some((receipt) => String(receipt.emitted_at ?? '') >= latestLockAt);
  if (hasAfterLatestLock) {
    pass(items, 'issue_preflight_receipt', filePath, `${id} has issue_preflight_pass receipt after the latest post_runner_execution_lock.`);
    return;
  }

  fail(
    items,
    'issue_preflight_receipt',
    filePath,
    `${id} has post_runner_execution_lock but no issue_preflight_pass receipt after it.`,
    `Run node scripts/pokit-issue-preflight.mjs --issue ${id} before worker dispatch.`
  );
}

function isLegacyDurationZeroAccepted(projectRoot, metricsPath, metrics) {
  const relPath = path.relative(projectRoot, metricsPath).split(path.sep).join('/');
  return LEGACY_DURATION_ZERO_METRICS_PATHS.has(relPath) &&
    metrics.duration_zero_policy === 'legacy_accepted' &&
    typeof metrics.duration_zero_reason === 'string' &&
    metrics.duration_zero_reason.trim().length > 0;
}

async function checkMetrics(projectRoot, metricsPath, items) {
  let text;
  try {
    text = await readFile(metricsPath, 'utf8');
  } catch {
    return;
  }

  let metrics;
  try {
    metrics = JSON.parse(text);
  } catch {
    return;
  }

  if (metrics.duration_ms === 0 && !isLegacyDurationZeroAccepted(projectRoot, metricsPath, metrics)) {
    const adjacentMarker = await findAdjacentStartMarker(projectRoot, metricsPath);
    if (adjacentMarker) {
      fail(
        items,
        'metrics_duration_zero_adjacent_marker',
        metricsPath,
        `duration_ms is 0 but a start marker exists at ${adjacentMarker}; gate-pass likely missed a cross-date marker.`,
        'Re-run gate-pass after preserving or passing the marker start time so duration_ms records the real measured wall-clock duration.'
      );
      return;
    }
    warning(
      items,
      'metrics_duration_zero',
      metricsPath,
      "duration_ms is 0 (측정 안 함) — no start time was captured or derivable for this issue",
      'A real run captures wall-clock via the start marker written at execution-approval (runPreflight execution_request). 0 means the work duration was not measured, not that the issue was instant.'
    );
  }

  // POK-141 — token 3필드는 optional 강등. metrics_tokens_missing 체크 제거.
  // 새 budget/efficiency 가드는 해당 필드가 존재하는 경우(>= 0.3.0)에만 트리거.
  if (Object.prototype.hasOwnProperty.call(metrics, 'startup_token_count')) {
    const startup = Number(metrics.startup_token_count) || 0;
    if (startup > 15000) {
      fail(
        items,
        'startup_token_budget',
        metricsPath,
        `startup_token_count=${startup} > 15000 (fail) — start_read_order 슬림화 필요`,
        'Reduce files in .ai-os/current.md start_read_order, or compact handoff.md.'
      );
    } else if (startup > 10000) {
      warning(
        items,
        'startup_token_budget',
        metricsPath,
        `startup_token_count=${startup} > 10000 (warn) — start_read_order 비대`,
        'Consider compacting startup reads to stay under 10000 input tokens.'
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(metrics, 'work_read_token_count')) {
    const work = Number(metrics.work_read_token_count) || 0;
    if (work > 20000) {
      warning(
        items,
        'work_read_token_budget',
        metricsPath,
        `work_read_token_count=${work} > 20000 (warn) — work_read_order 비대`,
        'Consider grep-first navigation rather than full reads of large standards.'
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(metrics, 'verification_full_suite_runs')) {
    const runs = Number(metrics.verification_full_suite_runs) || 0;
    if (runs > 2) {
      warning(
        items,
        'verification_efficiency',
        metricsPath,
        `verification_full_suite_runs=${runs} > 2 — Step 7 비효율 (grep first 권장)`,
        'Run targeted node --test for changed files before running the full suite.'
      );
    }
  }
}

async function findAdjacentStartMarker(projectRoot, metricsPath) {
  const relPath = path.relative(projectRoot, metricsPath).split(path.sep).join('/');
  const match = relPath.match(new RegExp(`^\\.ai-os\\/runs\\/(\\d{4}-\\d{2}-\\d{2})\\/(${ISSUE_ID_SOURCE})\\/metrics\\.json$`));
  if (!match) return null;
  const [, date, issueId] = match;
  for (const markerDate of adjacentMetricDates(date)) {
    if (markerDate === date) continue;
    const markerPath = path.join(projectRoot, '.ai-os/runs', markerDate, issueId, 'started-at.json');
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      const markerMs = Number(marker.started_at_ms);
      if (Number.isFinite(markerMs) && markerMs > 0) {
        return path.relative(projectRoot, markerPath).split(path.sep).join('/');
      }
    } catch {
      // Missing or invalid adjacent marker is not evidence of a cross-date miss.
    }
  }
  return null;
}

function adjacentMetricDates(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return [];
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return [date];
  return [date, -1, 1].map((entry) => {
    if (entry === date) return date;
    return new Date(parsed.getTime() + entry * 86_400_000).toISOString().slice(0, 10);
  });
}

async function checkAllRunMetrics(projectRoot, items) {
  const runsDir = path.join(projectRoot, '.ai-os/runs');
  let dateDirs;
  try {
    dateDirs = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dateEntry of dateDirs) {
    if (!dateEntry.isDirectory()) continue;
    const datePath = path.join(runsDir, dateEntry.name);
    let issueDirs;
    try {
      issueDirs = await readdir(datePath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const issueEntry of issueDirs) {
      if (!issueEntry.isDirectory()) continue;
      const metricsPath = path.join(datePath, issueEntry.name, 'metrics.json');
      await checkMetrics(projectRoot, metricsPath, items);
    }
  }
}

// POK-135 AFR-007 — gate-claim in commit must match POK card frontmatter.
// Default scan range: 20 most recent commits.
// commitsProvider is injectable for testability (synthetic commit subjects).
async function checkGateClaimFrontmatterConsistency(context, items, { commitsProvider } = {}) {
  const commits = commitsProvider
    ? await commitsProvider()
    : await fetchRecentCommitSubjects(context.root, 20);

  if (!commits || commits.length === 0) return; // not a git repo / git unavailable

  const seen = new Set();

  for (const subject of commits) {
    const issueId = extractGatePassedIssueId(subject);
    if (!issueId) continue;
    if (seen.has(issueId)) continue;
    seen.add(issueId);

    const filePath = await resolveActiveIssuePath(context.root, issueId);
    if (!filePath) continue;
    const text = await readOptional(context.root, filePath);
    if (text === null) continue; // missing file — likely typo or unrelated POK id; skip

    const frontmatter = parseFrontmatter(text);
    if (frontmatter.gate_state === 'gate_passed') {
      pass(
        items,
        'gate_claim_vs_frontmatter_consistency',
        filePath,
        `Commit "${subject}" matches ${issueId} frontmatter gate_state: gate_passed.`
      );
    } else {
      fail(
        items,
        'gate_claim_vs_frontmatter_consistency',
        filePath,
        `Commit "${subject}" claims ${issueId} gate_passed but ${filePath} frontmatter has gate_state: ${frontmatter.gate_state ?? 'missing'}.`,
        `Update ${issueId} frontmatter (gate_state / status / canonical_state) to match the commit claim, or amend the claim.`
      );
    }
  }
}

function extractGatePassedIssueId(subject) {
  const gateMatch = String(subject).match(/gate_passed/i);
  if (!gateMatch) return null;

  const beforeGate = String(subject).slice(0, gateMatch.index);
  const beforeTokens = beforeGate.match(new RegExp(ISSUE_ID_SOURCE, 'gi'))?.map((token) => token.toUpperCase()) ?? [];
  if (beforeTokens.length > 0) return beforeTokens.at(-1);

  const afterGate = String(subject).slice(gateMatch.index + gateMatch[0].length);
  return extractIssueId(afterGate);
}

// POK-138 AFR-009 — handoff.md must keep exactly one next_action surface.
// Primary axis (fail): current.md frontmatter active_issue vs handoff Active Snapshot
//   "- active_issue:" value.
// Secondary axis (warn): first POK-XXX token in current.md frontmatter next_action vs
//   handoff Active Snapshot inline "Next action:" line.
// Structural guard (fail): a "## Next Action" heading must NOT exist anywhere in
//   handoff.md — its presence is a revived duplicate surface.
// currentMdProvider / handoffProvider are injectable for testability (in-memory string).
async function checkNextActionConsistency(context, items, {
  currentMdProvider = null,
  handoffProvider = null,
} = {}) {
  const currentPath = '.ai-os/current.md';
  const handoffPath = '.ai-os/memory/session/handoff.md';

  const currentText = currentMdProvider
    ? await currentMdProvider()
    : await readOptional(context.root, currentPath);
  const handoffText = handoffProvider
    ? await handoffProvider()
    : await readOptional(context.root, handoffPath);

  if (currentText === null || handoffText === null) return;

  if (/^##\s+Next Action\s*$/m.test(handoffText)) {
    fail(
      items,
      'next_action_consistency',
      handoffPath,
      'handoff.md contains a `## Next Action` heading — duplicate next_action surface revived (AFR-009).',
      'Remove the `## Next Action` section. handoff.md keeps a single next_action surface inline in the Active Snapshot block.'
    );
  }

  const currentFm = parseFrontmatter(currentText);
  const currentActiveIssue = currentFm.active_issue ?? null;
  const currentNextAction = currentFm.next_action ?? null;

  const snapshotMatch = handoffText.match(/##\s+Active Snapshot\s*\n([\s\S]*?)(?=\n##\s+|$)/);
  const snapshotBlock = snapshotMatch ? snapshotMatch[1] : '';

  const handoffActiveIssueMatch = snapshotBlock.match(/^\s*-\s+active_issue:\s*(\S+)/m);
  const handoffActiveIssue = handoffActiveIssueMatch ? handoffActiveIssueMatch[1] : null;

  const handoffNextActionLineMatch = snapshotBlock.match(/^Next action:\s*(.+)$/m);
  const handoffNextActionLine = handoffNextActionLineMatch ? handoffNextActionLineMatch[1] : null;

  if (currentActiveIssue && handoffActiveIssue) {
    if (currentActiveIssue === handoffActiveIssue) {
      pass(
        items,
        'next_action_consistency',
        handoffPath,
        `Active issue token matches (${currentActiveIssue}) across current.md and handoff Active Snapshot.`
      );
    } else {
      fail(
        items,
        'next_action_consistency',
        handoffPath,
        `current.md active_issue=${currentActiveIssue} but handoff Active Snapshot active_issue=${handoffActiveIssue}.`,
        'Update handoff.md Active Snapshot `- active_issue:` to match current.md, or correct current.md frontmatter.'
      );
    }
  }

  const currentToken = extractIssueId(currentNextAction);
  const handoffToken = extractIssueId(handoffNextActionLine);

  if (currentToken && handoffToken) {
    if (currentToken !== handoffToken) {
      warning(
        items,
        'next_action_consistency',
        handoffPath,
        `current.md next_action token ${currentToken} differs from handoff Next action token ${handoffToken}.`,
        'Re-sync the Active Snapshot `Next action:` line with current.md `next_action` (POK token must match).'
      );
    }
  } else if (currentToken || handoffToken) {
    warning(
      items,
      'next_action_consistency',
      handoffPath,
      `Only one side carries a POK token in next_action (current=${currentToken ?? 'none'}, handoff=${handoffToken ?? 'none'}).`,
      'During issue transition, ensure both surfaces drop or carry the same POK token.'
    );
  }
}

async function fetchRecentCommitSubjects(root, n) {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const { stdout } = await exec('git', ['log', `-${n}`, '--pretty=format:%s'], { cwd: root });
    return stdout.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

async function readOptional(root, filePath) {
  try {
    return await readFile(path.join(root, filePath), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(root, filePath) {
  try {
    await access(path.join(root, filePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function arrayEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSprintAtLeast(sprint, minimumMinor) {
  const match = String(sprint ?? '').match(/^v0\.(\d+)\.0$/);
  return match ? Number(match[1]) >= minimumMinor : false;
}

function isIssueNumberAtLeast(issueId, minimumNumber) {
  const match = String(issueId ?? '').match(/^POK-(\d{3})$/);
  return match ? Number(match[1]) >= minimumNumber : false;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatResult(result) {
  const lines = [
    `status: ${result.status}`,
    `pass: ${result.summary.pass}`,
    `fail: ${result.summary.fail}`,
    `warning: ${result.summary.warning}`,
    `uncollected: ${result.summary.uncollected ?? 0}`,
    '',
  ];

  for (const item of result.items) {
    lines.push(`[${item.status}] ${item.check} ${item.path} - ${item.message}`);
    if (item.next_action) lines.push(`  next_action: ${item.next_action}`);
  }

  return lines.join('\n');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const result = await runDoctor({ root: process.cwd(), packageRoot: resolvePackageRoot() });
  console.log(formatResult(result));
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
