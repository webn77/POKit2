import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { recordIssueMetrics, issueMetricsPath } from './issue-metrics.mjs';
import { collectMainSessionTokens } from './main-token-collector.mjs';
import { resolveActiveIssuePath } from './issue-paths.mjs';
import { assertIssueId, isIssueId } from './issue-id.mjs';
import { emitProgress } from './event-log.mjs';

const execFileAsync = promisify(execFile);

export async function recordIssueCompletionMetrics(options = {}) {
  return recordIssueMetrics({
    root: options.root ?? process.cwd(),
    date: options.date,
    issueId: options.issueId,
    startedAt: options.startedAt,
    endedAt: options.endedAt,
    sessionCount: options.sessionCount,
    changedFiles: options.changedFiles,
    changedLines: options.changedLines,
    subagentCount: options.subagentCount,
    acTotal: options.acTotal,
    acPassed: options.acPassed,
    reworkCount: options.reworkCount,
    testFailBeforeCommit: options.testFailBeforeCommit,
    afrTriggered: options.afrTriggered,
    gateReopenCount: options.gateReopenCount,
    verificationFailures: options.verificationFailures,
    inputTokens: options.inputTokens,
    outputTokens: options.outputTokens,
    totalTokens: options.totalTokens,
    startupTokenCount: options.startupTokenCount,
    workReadTokenCount: options.workReadTokenCount,
    totalSessionInput: options.totalSessionInput,
    verificationFullSuiteRuns: options.verificationFullSuiteRuns,
    verificationDurationMs: options.verificationDurationMs,
    mainTotalTokens: options.mainTotalTokens,
    mainTokensCollected: options.mainTokensCollected,
    subagents: options.subagents,
    dryRun: options.dryRun,
  });
}

function issueStartMarkerPath(date, issueId) {
  return `.ai-os/runs/${date}/${issueId}/started-at.json`;
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function recordIssueStartMarker({ root = process.cwd(), date, issueId, nowMs } = {}) {
  const d = date ?? todayUtcDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  if (!isIssueId(issueId)) return;
  const filePath = issueStartMarkerPath(d, assertIssueId(issueId));
  const fullPath = path.join(root, filePath);
  try {
    await readFile(fullPath, 'utf8');
    return;
  } catch {
    // ENOENT expected on first write; continue.
  }
  const ms = typeof nowMs === 'number' ? nowMs : Date.now();
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify({ started_at_ms: ms })}\n`, 'utf8');
}

export async function readIssueStartMarker({ root = process.cwd(), date, issueId } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  if (!isIssueId(issueId)) return null;
  const filePath = issueStartMarkerPath(date, assertIssueId(issueId));
  const fullPath = path.join(root, filePath);
  try {
    const text = await readFile(fullPath, 'utf8');
    const obj = JSON.parse(text);
    const ms = Number(obj.started_at_ms);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

async function readIssueStartMarkerAcrossDates({ root = process.cwd(), date, issueId } = {}) {
  for (const markerDate of markerDateCandidates(date)) {
    const markerMs = await readIssueStartMarker({ root, date: markerDate, issueId });
    if (markerMs !== null) return { markerMs, markerDate };
  }
  return { markerMs: null, markerDate: null };
}

function markerDateCandidates(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return [];
  const dates = [date];
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return dates;
  for (const offset of [-1, 1]) {
    const next = new Date(parsed.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    if (!dates.includes(next)) dates.push(next);
  }
  return dates;
}

// POK-325 — full prior metrics.json read. Returns the parsed record or null.
// Used to PRESERVE previously recorded values on a gate-pass re-run: a manual
// record (e.g. --ac-total at the first gate-pass) must not be clobbered back to
// schema defaults when the command runs again without those flags.
export async function readPriorIssueMetrics({ root = process.cwd(), date, issueId } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  if (!isIssueId(issueId)) return null;
  const fullPath = path.join(root, issueMetricsPath(date, assertIssueId(issueId)));
  try {
    const obj = JSON.parse(await readFile(fullPath, 'utf8'));
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

export async function readPriorMetricsTimes({ root = process.cwd(), date, issueId } = {}) {
  const obj = await readPriorIssueMetrics({ root, date, issueId });
  if (!obj) return { startedAt: 0, endedAt: 0 };
  const startedAt = Number(obj.started_at);
  const endedAt = Number(obj.ended_at);
  return {
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0,
    endedAt: Number.isFinite(endedAt) && endedAt > 0 ? endedAt : 0,
  };
}

export async function readLastDurableChangeMs({ root = process.cwd(), runGit } = {}) {
  const run =
    runGit ??
    (async (args) => {
      const { stdout } = await execFileAsync('git', args, { cwd: root });
      return stdout;
    });
  try {
    const stdout = await run(['log', '-1', '--format=%ct']);
    const seconds = Number(String(stdout).trim());
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.trunc(seconds * 1000);
  } catch {
    return null;
  }
}

export async function readGitChangeStats({ root = process.cwd(), runGit } = {}) {
  const run =
    runGit ??
    (async (args) => {
      const { stdout } = await execFileAsync('git', args, { cwd: root });
      return stdout;
    });
  try {
    const stdout = await run(['diff', '--numstat', 'HEAD']);
    let changedFiles = 0;
    let changedLines = 0;
    for (const line of String(stdout).split('\n')) {
      if (!line.trim()) continue;
      const [addedRaw, deletedRaw] = line.split(/\s+/, 3);
      const added = Number(addedRaw);
      const deleted = Number(deletedRaw);
      changedFiles += 1;
      if (Number.isFinite(added)) changedLines += Math.max(0, Math.trunc(added));
      if (Number.isFinite(deleted)) changedLines += Math.max(0, Math.trunc(deleted));
    }
    const untracked = await run(['ls-files', '--others', '--exclude-standard']);
    for (const filePath of String(untracked).split('\n').map((line) => line.trim()).filter(Boolean)) {
      changedFiles += 1;
      try {
        const text = await readFile(path.join(root, filePath), 'utf8');
        changedLines += text.split('\n').filter((line, index, lines) => index < lines.length - 1 || line.length > 0).length;
      } catch {
        // Binary or unreadable untracked files still count as changed files.
      }
    }
    return { changedFiles, changedLines };
  } catch {
    return { changedFiles: 0, changedLines: 0 };
  }
}

export async function resolveGatePassMetricsOptions({
  root = process.cwd(),
  metricsOptions = {},
  issueId,
  runGit,
  date = todayUtcDate(),
} = {}) {
  const normalizedIssueId = assertIssueId(issueId);
  const resolved = { ...metricsOptions, issueId: normalizedIssueId };
  const resolvedMarkerDate = resolved.date ?? date;

  if (resolved.startedAt === undefined && resolved.endedAt === undefined) {
    const prior = await readPriorMetricsTimes({ root, date: resolvedMarkerDate, issueId: normalizedIssueId });
    if (prior.startedAt > 0 && prior.endedAt > 0) {
      resolved.startedAt = prior.startedAt;
      resolved.endedAt = prior.endedAt;
    } else {
      const { markerMs } = await readIssueStartMarkerAcrossDates({ root, date: resolvedMarkerDate, issueId: normalizedIssueId });
      if (markerMs !== null) {
        resolved.startedAt = markerMs;
        const lastChangeMs = await readLastDurableChangeMs({ root, runGit });
        if (lastChangeMs !== null && lastChangeMs >= markerMs) {
          resolved.endedAt = lastChangeMs;
        }
      }
    }
  }

  // POK-325 — preserve previously recorded values before any auto-derivation.
  // Precedence per field: explicit CLI flag > meaningful prior recorded value >
  // auto-derived > schema default. "Meaningful" = non-zero numeric / true boolean /
  // non-empty subagents — a prior 0/false is the 미수집 default, not a measurement,
  // so auto-derivation may still fill it.
  const prior = await readPriorIssueMetrics({ root, date: resolvedMarkerDate, issueId: normalizedIssueId });
  if (prior) {
    applyPriorMetrics(resolved, prior);
  }

  // POK-325 — per-field independent fill (was a single AND condition, which
  // skipped auto-derivation entirely when only ONE of the two was provided).
  if (resolved.changedFiles === undefined || resolved.changedLines === undefined) {
    const stats = await readGitChangeStats({ root, runGit });
    if (resolved.changedFiles === undefined) resolved.changedFiles = stats.changedFiles;
    if (resolved.changedLines === undefined) resolved.changedLines = stats.changedLines;
  }

  if (resolved.subagentCount === undefined) {
    const traceWorkerCount = await deriveWorkerCountFromIssueTrace({ root, issueId: normalizedIssueId });
    if (traceWorkerCount > 0) resolved.subagentCount = traceWorkerCount;
  }

  if (resolved.subagents === undefined && Number(resolved.subagentCount) > 0) {
    resolved.subagents = buildUnknownSubagents(resolved.subagentCount);
  }

  // POK-344 (POK-259 흡수) — main 세션 토큰을 transcript에서 사후 집계한다.
  // 실제 runner 실행(POKIT_SESSION_ID 존재)에서만 동작 — 유닛테스트는 env 미설정이라
  // 기존 미수집(0/false) 기본값을 그대로 유지한다(회귀 방지). 명시 CLI 값 또는 유의미한
  // 직전 수집값(applyPriorMetrics에서 collected:true)이 있으면 건드리지 않는다.
  // 측정 불가(transcript 없음/식별 불가)는 collected:false로 — 가짜 0 금지.
  if (resolved.mainTokensCollected === undefined && process.env.POKIT_SESSION_ID) {
    try {
      const mainUsage = await collectMainSessionTokens({ cwd: root });
      if (mainUsage.main_tokens_collected) {
        resolved.mainTotalTokens = mainUsage.main_total_tokens;
        resolved.mainTokensCollected = true;
      } else {
        // POK-354: 배선 전 호출 또는 transcript 미가용 — 침묵 대신 경고.
        process.stderr.write(
          `warn: main_tokens_collected=false (transcript 미가용 또는 배선 순서 문제 — POKIT_SESSION_ID=${process.env.POKIT_SESSION_ID})\n`
        );
      }
      emitProgress('metrics_collected', String(options.issueId ?? ''));
    } catch {
      // 수집 실패는 미수집으로 — 완료 흐름을 막지 않는다.
    }
  }

  return resolved;
}

// POK-325 — option key ↔ persisted metric key pairs eligible for prior-value
// preservation. started_at/ended_at are handled by the dedicated freeze logic above.
const PRIOR_NUMERIC_FIELDS = Object.freeze([
  ['sessionCount', 'session_count'],
  ['changedFiles', 'changed_files'],
  ['changedLines', 'changed_lines'],
  ['subagentCount', 'subagent_count'],
  ['acTotal', 'ac_total'],
  ['acPassed', 'ac_passed'],
  ['reworkCount', 'rework_count'],
  ['gateReopenCount', 'gate_reopen_count'],
  ['verificationFailures', 'verification_failures'],
  ['inputTokens', 'input_tokens'],
  ['outputTokens', 'output_tokens'],
  ['totalTokens', 'total_tokens'],
  ['startupTokenCount', 'startup_token_count'],
  ['workReadTokenCount', 'work_read_token_count'],
  ['totalSessionInput', 'total_session_input'],
  ['verificationFullSuiteRuns', 'verification_full_suite_runs'],
  ['verificationDurationMs', 'verification_duration_ms'],
]);

const PRIOR_BOOLEAN_FIELDS = Object.freeze([
  ['testFailBeforeCommit', 'test_fail_before_commit'],
  ['afrTriggered', 'afr_triggered'],
]);

function applyPriorMetrics(resolved, prior) {
  for (const [optionKey, metricKey] of PRIOR_NUMERIC_FIELDS) {
    if (resolved[optionKey] !== undefined) continue;
    const value = Number(prior[metricKey]);
    if (Number.isFinite(value) && value > 0) resolved[optionKey] = value;
  }
  for (const [optionKey, metricKey] of PRIOR_BOOLEAN_FIELDS) {
    if (resolved[optionKey] === undefined && prior[metricKey] === true) {
      resolved[optionKey] = true;
    }
  }
  // main-session tokens: collected=true is a real measurement (POK-230) — keep it.
  if (resolved.mainTotalTokens === undefined && prior.main_tokens_collected === true) {
    resolved.mainTotalTokens = Number(prior.main_total_tokens) || 0;
    resolved.mainTokensCollected = true;
  }
  // per-agent attribution: real prior entries beat the unknown-placeholder derivation.
  if (resolved.subagents === undefined && Array.isArray(prior.subagents) && prior.subagents.length > 0) {
    resolved.subagents = prior.subagents;
    // Keep count/array consistent: without this, a prior record carrying subagents
    // but subagent_count 0 would let the trace-derivation below set a different count.
    if (resolved.subagentCount === undefined) {
      resolved.subagentCount = prior.subagents.length;
    }
  }
}

function buildUnknownSubagents(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return Array.from({ length: n }, () => ({
    model: 'unknown',
    worker_type: 'unknown',
    total_tokens: 0,
  }));
}

async function deriveWorkerCountFromIssueTrace({ root = process.cwd(), issueId } = {}) {
  let issuePath;
  try {
    issuePath = await resolveActiveIssuePath(root, assertIssueId(issueId));
  } catch {
    return 0;
  }
  let text;
  try {
    text = await readFile(path.join(root, issuePath), 'utf8');
  } catch {
    return 0;
  }
  const trace = text.match(/(?:^|\n)## Workflow Trace\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  const workers = trace.match(/^Workers:\s*([^\n]+)/im)?.[1]?.trim() ?? '';
  if (!workers || /^none\b|^pending\b/i.test(workers)) return 0;
  return workers
    .split(/;|,/)
    .map((item) => item.trim())
    .filter((item) => item && !/\bpending\b/i.test(item)).length;
}
