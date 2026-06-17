import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { EVENT_NAME, buildAfterGatePassPayload } from './hook-emit.mjs';
import { extractIssueId, ISSUE_ID_SOURCE } from './issue-id.mjs';
import { emitProgress } from './event-log.mjs';

const exec = promisify(execFile);

export function extractGatePassedIssueId(subject) {
  const text = String(subject ?? '');
  const gateMatch = text.match(/gate_passed/i);
  if (!gateMatch) return null;

  const beforeGate = text.slice(0, gateMatch.index);
  const beforeTokens = beforeGate.match(new RegExp(ISSUE_ID_SOURCE, 'gi'))?.map((token) => token.toUpperCase()) ?? [];
  if (beforeTokens.length > 0) return beforeTokens.at(-1);

  return extractIssueId(text.slice(gateMatch.index + gateMatch[0].length));
}

export async function fetchLatestCommitSubject({ root = process.cwd() } = {}) {
  const { stdout } = await exec('git', ['log', '-1', '--pretty=format:%s'], { cwd: root });
  return stdout.trim();
}

export async function fetchRecentCommitSubjects({ root = process.cwd(), limit = 20 } = {}) {
  const { stdout } = await exec('git', ['log', `-${limit}`, '--pretty=format:%s'], { cwd: root });
  return stdout.split('\n').filter(Boolean);
}

export async function appendAfterGatePassEvent({
  root = process.cwd(),
  issueId,
  now,
  env = process.env,
} = {}) {
  const payload = buildAfterGatePassPayload({ issueId, env, now });
  const emittedAt = payload.emitted_at;

  // Idempotency guard: emit at most once per (issue_id, gate_state).
  // gate_state is hardcoded to 'gate_passed' in buildAfterGatePassPayload,
  // so this is effectively once-per-issue-forever (AC4).
  const existingEvents = await readAfterGatePassEvents({ root });
  const alreadyEmitted = existingEvents.some(
    (event) =>
      String(event.issue_id).toUpperCase() === String(payload.issue_id).toUpperCase() &&
      event.gate_state === payload.gate_state
  );
  if (alreadyEmitted) {
    return {
      event_type: EVENT_NAME,
      event_name: EVENT_NAME,
      issue_id: payload.issue_id,
      emitted: false,
      reason: 'already_emitted',
    };
  }

  const receipt = {
    event_type: EVENT_NAME,
    event_name: EVENT_NAME,
    issue_id: payload.issue_id,
    created_at: emittedAt.slice(0, 10),
    emitted_at: emittedAt,
    provider: payload.provider,
    gate_state: payload.gate_state,
    status: payload.status,
    payload,
  };

  const logPath = path.join(root, '.ai-os/events/event-log.jsonl');
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(receipt)}\n`, 'utf8');
  return receipt;
}

export async function runPostCommitHook({
  root = process.cwd(),
  subjectProvider = null,
  now,
  env = process.env,
  stderr = process.stderr,
} = {}) {
  let subject;
  try {
    subject = subjectProvider
      ? await subjectProvider()
      : await fetchLatestCommitSubject({ root });
  } catch (error) {
    stderr.write(`warn: after_gate_pass_hook_subject_unavailable ${error.message}\n`);
    return { ok: true, emitted: false, reason: 'subject_unavailable' };
  }

  const issueId = extractGatePassedIssueId(subject);
  if (!issueId) return { ok: true, emitted: false, reason: 'not_gate_passed_commit', subject };

  const receipt = await appendAfterGatePassEvent({ root, issueId, now, env });
  if (receipt.emitted === false) {
    return { ok: true, emitted: false, reason: receipt.reason, issueId, subject };
  }
  // POK-354: gate_pass 커밋 완료 진행 마커
  emitProgress('gate_pass_committed', issueId);
  return { ok: true, emitted: true, issueId, subject, receipt };
}

export async function readAfterGatePassEvents({ root = process.cwd() } = {}) {
  const logPath = path.join(root, '.ai-os/events/event-log.jsonl');
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if ((event.event_type === EVENT_NAME || event.event_name === EVENT_NAME) && event.issue_id) {
        events.push(event);
      }
    } catch {
      // Event-log JSON validity is checked elsewhere; ignore malformed rows here.
    }
  }
  return events;
}

export function findMissingAfterGatePassEvents({ commits = [], events = [] } = {}) {
  const eventIssueIds = new Set(events.map((event) => String(event.issue_id).toUpperCase()));
  const missing = [];
  const seen = new Set();

  for (const subject of commits ?? []) {
    const issueId = extractGatePassedIssueId(subject);
    if (!issueId || seen.has(issueId)) continue;
    seen.add(issueId);
    if (!eventIssueIds.has(issueId)) missing.push({ issueId, subject });
  }

  return missing;
}

export async function backfillAfterGatePassEvents({
  root = process.cwd(),
  commits = null,
  limit = 20,
  now,
  env = process.env,
} = {}) {
  const recentCommits = commits ?? await fetchRecentCommitSubjects({ root, limit });
  const events = await readAfterGatePassEvents({ root });
  const missing = findMissingAfterGatePassEvents({ commits: recentCommits, events });
  const receipts = [];

  for (const item of missing) {
    receipts.push(await appendAfterGatePassEvent({ root, issueId: item.issueId, now, env }));
  }

  return {
    backfilledIssueIds: receipts.map((receipt) => receipt.issue_id),
    receipts,
  };
}
