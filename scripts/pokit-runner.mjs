#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDoctor } from './pokit-doctor.mjs';

const POKIT_PHRASES = [
  '$pokit',
  'POKit 시작',
  'POKit 시작하자',
  '오늘 뭐 하지',
  '이슈로 잡아줘',
  '완료 가능한지 봐줘',
];

export function matchesPokitPhrase(phrase) {
  if (typeof phrase !== 'string') return false;
  const normalized = phrase.trim();
  return POKIT_PHRASES.some((entry) => entry.toLocaleLowerCase('ko-KR') === normalized.toLocaleLowerCase('ko-KR'));
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
  const doctorResult = await runDoctor({ root });
  const failures = doctorResult.items.filter((item) => item.status === 'fail');
  const warnings = doctorResult.items.filter((item) => item.status === 'warning');
  const nextAction = failures.find((item) => item.next_action)?.next_action
    ?? current.next_action
    ?? warnings.find((item) => item.next_action)?.next_action
    ?? null;

  return {
    status: doctorResult.status,
    phraseMatched: matchesPokitPhrase(phrase),
    activeIssue,
    issuePath,
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
    activeIssue: result.activeIssue,
    issuePath: result.issuePath,
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
