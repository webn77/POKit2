#!/usr/bin/env node
import {
  ensureWorkReadOrderEntry,
  findIssue,
  parseArgs,
  parseFrontmatter,
  readCurrent,
  syncStarterStateViews,
  updateCurrent,
} from './pokit-project-contract.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const issueId = args._?.[0] ?? args.id;
const root = process.cwd();

if (!issueId) {
  console.error('Usage: node scripts/pokit-issue-use.mjs COM-001');
  process.exit(1);
}

try {
  const found = await findIssue(root, issueId);
  if (!found) throw new Error(`Issue not found: ${issueId}`);
  const { frontmatter: current } = await readCurrent(root);
  const currentIssue = current.active_issue ?? null;
  const currentGateState = current.gate_state ?? 'idle';
  if (currentIssue && currentIssue !== issueId && currentGateState !== 'gate_passed') {
    throw new Error(
      `Cannot switch from active issue ${currentIssue} to ${issueId} while gate_state is ${currentGateState}. ` +
      'Finish the current issue and set gate_state to gate_passed first.'
    );
  }
  const text = await readFile(path.join(root, found.relativePath), 'utf8');
  const fm = parseFrontmatter(text);
  await updateCurrent(root, {
    active_project: fm.project ?? found.project?.key ?? 'common',
    active_issue: issueId,
    gate_state: fm.gate_state ?? 'pending',
    next_action: `${issueId} 실행 준비`,
    updated_at: new Date().toISOString().slice(0, 10),
  });
  await ensureWorkReadOrderEntry(root, found.relativePath);
  await syncStarterStateViews(root);
  console.log(JSON.stringify({ status: 'pass', active_issue: issueId, path: found.relativePath }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
