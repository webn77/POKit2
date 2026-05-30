#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIssue, readRegistry } from './pokit-project-contract.mjs';

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

  if (!frontmatter['prevention-rule-ref']) {
    fail(items, 'failure_read_gate', filePath, 'Missing prevention-rule-ref.', 'Add prevention-rule-ref or no-prior-failure fallback.');
  } else {
    pass(items, 'failure_read_gate', filePath, 'prevention-rule-ref exists.');
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
  const lines = [
    `status: ${result.status}`,
    `pass: ${result.summary.pass}`,
    `fail: ${result.summary.fail}`,
    `warning: ${result.summary.warning}`,
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
  const result = await runDoctor({ root: process.cwd() });
  console.log(formatResult(result));
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
