#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ISSUE_ID_PATTERN, findIssue, listIssueFiles, readRegistry } from './pokit-project-contract.mjs';

const START_READ_ORDER = [
  'AGENTS.md',
  '.ai-os/current.md',
  '.ai-os/memory/session/handoff.md',
];

const WORK_READ_REQUIRED = [
  '.ai-os/status-board.md',
  '.ai-os/failure-index.md',
  '.ai-os/issue-index.md',
  '.ai-os/artifact-index.md',
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

const AUTHORING_RECEIPT_CUTOFF = '2026-05-30';

const SPEC_CODE_SECTIONS = [
  'Brief',
  'Evidence',
  'Acceptance Criteria',
  'Development Plan',
  'Test Plan',
  'Subagent Plan',
  'QA',
  'Gate',
  'Memory',
];

export async function runDoctor({ root = process.cwd() } = {}) {
  const items = [];
  const context = { root, activeIssue: null };

  await checkCurrent(context, items);
  await checkProjectRegistry(context, items);
  await checkSessionFiles(context, items);
  if (context.currentText) await checkReadOrder(context, items);
  await checkStateViewSync(context, items);
  if (context.activeIssue) await checkActiveIssue(context, items);
  await checkDurableBinding(context, items);
  await checkStarterAuthoringEvidence(context, items);
  await checkVersionCompatibility(context, items);

  const summary = summarize(items);
  return {
    status: summary.fail > 0 ? 'fail' : 'pass',
    summary,
    items,
  };
}

async function checkProjectRegistry(context, items) {
  const filePath = '.ai-os/projects.yaml';
  let registry;
  try {
    registry = await readRegistry(context.root);
  } catch (error) {
    fail(items, 'project_registry', filePath, 'Project registry is missing or unreadable.', 'Restore .ai-os/projects.yaml with the common project entry.');
    return;
  }

  if (!Array.isArray(registry.projects) || registry.projects.length === 0) {
    fail(items, 'project_registry', filePath, 'Project registry has no projects.', 'Add at least the common / COM project.');
    return;
  }

  let hasCommon = false;
  for (const project of registry.projects) {
    const valid = /^[a-z][a-z0-9-]*$/.test(project.key ?? '') &&
      /^[A-Z][A-Z0-9]{1,9}$/.test(project.namespace ?? '') &&
      Number.isInteger(Number(project.next_number)) &&
      Number(project.next_number) >= 1;
    if (!valid) {
      fail(items, 'project_registry', filePath, `Invalid project registry entry: ${project.key ?? 'unknown'}.`, 'Use key, name, namespace, and next_number >= 1.');
      return;
    }
    if (project.key === 'common' && project.namespace === 'COM') hasCommon = true;
  }

  if (!hasCommon) {
    fail(items, 'project_registry', filePath, 'Missing default common / COM project.', 'Add the common project with namespace COM.');
    return;
  }

  pass(items, 'project_registry', filePath, 'Project registry is valid.');

  const activeProject = context.currentFrontmatter?.active_project;
  if (activeProject && !registry.projects.some((project) => project.key === activeProject)) {
    fail(items, 'active_project', '.ai-os/current.md', `active_project ${activeProject} is not in the project registry.`, 'Run pokit-project-use with a registered project.');
  } else if (activeProject) {
    pass(items, 'active_project', '.ai-os/current.md', `active_project ${activeProject} exists in the project registry.`);
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
  context.activeIssue = frontmatter.active_issue ?? null;
  pass(items, 'current_exists', filePath, 'current.md exists.');

  for (const key of ['schema_version', 'contract_version', 'active_issue', 'next_action']) {
    if (!(key in frontmatter) || (key !== 'active_issue' && !frontmatter[key])) {
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

async function checkReadOrder(context, items) {
  const startOrder = parseReadOrderSection(context.currentText, 'start_read_order');
  if (arrayEqual(startOrder, START_READ_ORDER)) {
    pass(items, 'start_read_order', '.ai-os/current.md', 'start_read_order is minimal and exact.');
  } else {
    fail(items, 'start_read_order', '.ai-os/current.md', 'start_read_order is not exact.', 'Keep start_read_order limited to AGENTS.md, .ai-os/current.md, and .ai-os/memory/session/handoff.md.');
  }

  const workOrder = parseReadOrderSection(context.currentText, 'work_read_order');
  for (const filePath of WORK_READ_REQUIRED) {
    if (workOrder.includes(filePath)) {
      pass(items, 'work_read_order', filePath, `${filePath} is included.`);
      if (await exists(context.root, filePath)) {
        pass(items, 'work_read_file_exists', filePath, `${filePath} exists.`);
      } else {
        fail(items, 'work_read_file_exists', filePath, `${filePath} is listed but missing.`, `Create or restore ${filePath}.`);
      }
    } else {
      fail(items, 'work_read_order', filePath, `${filePath} is missing from work_read_order.`, `Add ${filePath} to work_read_order.`);
    }
  }

  if (context.activeIssue) {
    const found = await findIssue(context.root, context.activeIssue);
    const activePath = found?.relativePath ?? `.ai-os/${context.activeIssue}.md`;
    if (workOrder.includes(activePath)) {
      pass(items, 'work_read_order', activePath, 'Active issue is included.');
    } else {
      fail(items, 'work_read_order', activePath, 'Active issue is missing from work_read_order.', `Add ${activePath} to work_read_order.`);
    }
  }
}

async function checkActiveIssue(context, items) {
  const found = await findIssue(context.root, context.activeIssue);
  const filePath = found?.relativePath ?? `.ai-os/${context.activeIssue}.md`;
  if (!found) {
    fail(items, 'active_issue_exists', filePath, 'Active issue file is missing.', `Create or restore ${filePath}.`);
    return;
  }

  const issueText = await readFile(path.join(context.root, filePath), 'utf8');
  pass(items, 'active_issue_exists', filePath, 'Active issue exists.');
  const frontmatter = parseFrontmatter(issueText);
  for (const key of ISSUE_FRONTMATTER_KEYS) {
    if (!frontmatter[key]) {
      fail(items, 'active_issue_frontmatter', filePath, `Missing ${key}.`, `Add ${key} to issue frontmatter.`);
    }
  }

  for (const section of SPEC_CODE_SECTIONS) {
    if (hasSection(issueText, section)) {
      pass(items, 'active_issue_section', filePath, `Section exists: ${section}.`);
    } else {
      fail(items, 'active_issue_section', filePath, `Missing section: ${section}.`, `Add ## ${section} to ${filePath}.`);
    }
  }

  checkUnresolvedClarificationMarker(issueText, filePath, items);
}

async function checkStateViewSync(context, items) {
  if (!context.currentFrontmatter) return;

  const statusBoardPath = '.ai-os/status-board.md';
  const issueIndexPath = '.ai-os/issue-index.md';
  const statusBoard = await readOptional(context.root, statusBoardPath);
  const issueIndex = await readOptional(context.root, issueIndexPath);
  const registry = await readRegistry(context.root).catch(() => ({ projects: [] }));
  const activeProjectKey = context.currentFrontmatter.active_project ?? null;
  const activeProject = registry.projects.find((project) => project.key === activeProjectKey) ?? null;
  const activeIssue = context.currentFrontmatter.active_issue ?? null;
  const gateState = context.currentFrontmatter.gate_state ?? null;

  if (statusBoard !== null && activeProject) {
    const expectedProject = `Current project: ${activeProject.key} (${activeProject.namespace})`;
    if (statusBoard.includes(expectedProject)) {
      pass(items, 'state_sync_status_board', statusBoardPath, 'status-board project matches current.md.');
    } else {
      fail(items, 'state_sync_status_board', statusBoardPath, `status-board project does not match active_project ${activeProject.key}.`, 'Run a starter command that syncs state views or repair status-board.md.');
    }

    const expectedIssuePattern = activeIssue
      ? new RegExp(`^Current issue:\\s*${escapeRegExp(activeIssue)}(?:\\s|$)`, 'm')
      : /^Current issue:\s*none\s*$/m;
    if (expectedIssuePattern.test(statusBoard)) {
      pass(items, 'state_sync_status_board', statusBoardPath, 'status-board issue matches current.md.');
    } else {
      fail(items, 'state_sync_status_board', statusBoardPath, `status-board issue does not match active_issue ${activeIssue ?? 'none'}.`, 'Run a starter command that syncs state views or repair status-board.md.');
    }

    if (!gateState || statusBoard.includes(`Gate state: ${gateState}`)) {
      pass(items, 'state_sync_status_board', statusBoardPath, 'status-board gate state matches current.md.');
    } else {
      fail(items, 'state_sync_status_board', statusBoardPath, `status-board gate state does not match ${gateState}.`, 'Run a starter command that syncs state views or repair status-board.md.');
    }
  }

  if (issueIndex !== null && activeIssue) {
    const found = await findIssue(context.root, activeIssue);
    const expectedPath = found?.relativePath ?? null;
    if (expectedPath && issueIndex.includes(`| ${activeIssue} |`) && issueIndex.includes(`\`${expectedPath}\``)) {
      pass(items, 'issue_index_sync', issueIndexPath, 'issue-index lists the active issue.');
    } else {
      fail(items, 'issue_index_sync', issueIndexPath, `issue-index does not list active_issue ${activeIssue}.`, 'Run a starter command that syncs state views or repair issue-index.md.');
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// listIssueFiles throws when the project registry is missing/unreadable
// (already surfaced by checkProjectRegistry). The detection checks must not
// crash runDoctor on that; fall back to an empty list.
async function safeListIssueFiles(root) {
  try {
    return await listIssueFiles(root);
  } catch {
    return [];
  }
}

async function checkDurableBinding(context, items) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  let porcelain = '';
  let headSubject = '';
  try {
    const [statusResult, logResult] = await Promise.all([
      execFileAsync('git', ['status', '--porcelain', '--', '.'], { cwd: context.root }),
      execFileAsync('git', ['log', '-1', '--pretty=%s', '--', '.'], { cwd: context.root }),
    ]);
    porcelain = statusResult.stdout;
    headSubject = logResult.stdout.trim();
  } catch {
    pass(items, 'durable_binding', '.ai-os/current.md', 'git 미가용 — durable 흔적 검사 skip (graceful).');
    return;
  }

  const durableDirty = porcelain
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('??'))
    .length > 0;

  const activeIssue = context.activeIssue || null;

  const tokenRe = new RegExp(ISSUE_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, ''), 'g');

  // Registry may be missing/unreadable (already flagged by checkProjectRegistry).
  // Fall back to no issues → CASE 2 gating off, no crash.
  const issues = await safeListIssueFiles(context.root);

  let failed = false;

  // CASE 1: dirty tree with no active issue
  if (durableDirty && !activeIssue) {
    fail(
      items,
      'durable_binding',
      '.ai-os/current.md',
      '작업트리에 durable 변경이 있는데 active_issue=null — 이슈를 먼저 묶으세요.',
      'node scripts/pokit-issue-create.mjs 후 node scripts/pokit-issue-use.mjs <이슈ID>',
    );
    failed = true;
  }

  // CASE 2: HEAD commit has no issue token (only when issues exist)
  if (issues.length > 0 && headSubject && !headSubject.match(tokenRe)) {
    fail(
      items,
      'durable_binding',
      '.ai-os/current.md',
      `HEAD 커밋이 어떤 이슈에도 안 묶임(토큰 없음): "${headSubject}". 커밋 제목에 이슈 ID를 넣으세요.`,
      '커밋 제목에 이슈 ID(예: feat(COM-001): ...) 포함',
    );
    failed = true;
  }

  if (!failed) {
    pass(items, 'durable_binding', '.ai-os/current.md', 'durable 흔적이 active 이슈에 바인딩됨(또는 클린 트리).');
  }
}

async function checkStarterAuthoringEvidence(context, items) {
  const issues = await safeListIssueFiles(context.root);

  const eventLogText = await readOptional(context.root, '.ai-os/events/event-log.jsonl');
  const authoredSet = new Set();
  if (eventLogText !== null) {
    for (const line of eventLogText.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.event_type === 'issue_authored' && event.issue_id) {
          authoredSet.add(event.issue_id);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  for (const issue of issues) {
    const issueText = await readFile(path.join(context.root, issue.relativePath), 'utf8');
    const frontmatter = parseFrontmatter(issueText);
    const { created_at } = frontmatter;
    const createdDate =
      typeof created_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(created_at)
        ? created_at.slice(0, 10)
        : null;

    if (!createdDate || createdDate < AUTHORING_RECEIPT_CUTOFF) {
      pass(
        items,
        'issue_authoring_evidence',
        issue.relativePath,
        `${issue.id} grandfathered (created_at ${created_at ?? 'missing'} < cutoff ${AUTHORING_RECEIPT_CUTOFF}).`,
      );
      continue;
    }

    if (authoredSet.has(issue.id)) {
      pass(items, 'issue_authoring_evidence', issue.relativePath, `${issue.id} has issue_authored receipt.`);
    } else {
      fail(
        items,
        'issue_authoring_evidence',
        issue.relativePath,
        `${issue.id} created_at>=${AUTHORING_RECEIPT_CUTOFF} 인데 매칭 issue_authored 영수증 없음.`,
        'node scripts/pokit-issue-create.mjs로 생성됐는지 확인',
      );
    }
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

function parseReadOrderSection(text, sectionName) {
  const match = text.match(new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(\\n## |$)`));
  if (!match) return [];
  return [...match[1].matchAll(/^\d+\.\s+`([^`]+)`/gm)].map((entry) => entry[1]);
}

function hasSection(text, section) {
  return new RegExp(`^## ${escapeRegex(section)}\\s*$`, 'm').test(text);
}

function checkUnresolvedClarificationMarker(issueText, filePath, items) {
  const clarifications = readSection(issueText, 'Clarifications');
  if (!clarifications || !clarifications.includes('[NEEDS CLARIFICATION:')) return;

  fail(
    items,
    'unresolved_clarification',
    filePath,
    `${filePath} ## Clarifications contains unresolved [NEEDS CLARIFICATION:] marker.`,
    'Resolve all [NEEDS CLARIFICATION:] items before advancing the active issue.'
  );
}

function readSection(text, section) {
  const match = text.match(new RegExp(`^## ${escapeRegex(section)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'));
  return match?.[1] ?? null;
}

function summarize(items) {
  return items.reduce((summary, item) => {
    summary[item.status] += 1;
    return summary;
  }, { pass: 0, fail: 0, warning: 0 });
}

function pass(items, check, filePath, message) {
  items.push({ status: 'pass', check, path: filePath, message });
}

function fail(items, check, filePath, message, nextAction) {
  items.push({ status: 'fail', check, path: filePath, message, next_action: nextAction });
}

function warning(items, check, filePath, message, nextAction) {
  items.push({ status: 'warning', check, path: filePath, message, next_action: nextAction });
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatResult(result) {
  const statusEmoji = result.status === 'fail' ? '🔴' : result.status === 'pass' ? '✅' : '';
  const lines = [
    `status: ${result.status} ${statusEmoji}`.trimEnd(),
    `pass: ${result.summary.pass}`,
    `fail: ${result.summary.fail}`,
    `warning: ${result.summary.warning}`,
    '',
  ];

  for (const item of result.items) {
    const itemEmoji = item.status === 'fail' ? '🔴' : item.status === 'pass' ? '✅' : '⚠️';
    lines.push(`${itemEmoji} [${item.status}] ${item.check} ${item.path} - ${item.message}`);
    if (item.next_action) lines.push(`  next_action: ${item.next_action}`);
  }

  return lines.join('\n');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const result = await runDoctor({ root: process.cwd() });
  console.log(formatResult(result));
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
