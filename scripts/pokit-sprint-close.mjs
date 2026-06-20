#!/usr/bin/env node

import { appendFile, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rotateRuleSection } from './lib/rule-section.mjs';
import { withStateWriteGuard } from './lib/worktree-locks.mjs';
import { collectSprintFeedbackModel, renderSprintFeedbackCard } from './lib/feedback-card.mjs';
import { parseFrontmatter } from './lib/issue-frontmatter.mjs';
import { checkReleaseGap, renderReleaseGapCard } from './lib/release-gap.mjs';
import { checkReleaseArtifacts, renderArtifactsTable } from './lib/release-artifacts-check.mjs';

const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

function lockHolder() {
  return process.env.POKIT_SESSION_ID ?? `pid-${process.pid}`;
}

async function withAiOsWriteGuard(root, relativePath, reason, fn) {
  return withStateWriteGuard(root, {
    filePath: relativePath,
    holder: lockHolder(),
    reason,
  }, fn);
}

// parseFrontmatter imported from ./lib/issue-frontmatter.mjs (POK-339)

function normalizeVersion(version) {
  if (!version) return undefined;
  const normalized = version.trim();
  if (!VERSION_PATTERN.test(normalized)) {
    throw new Error(`Invalid sprint version: ${version}. Expected vX.Y.Z.`);
  }
  return normalized;
}

function buildCompactedHandoff({
  current,
  sprintVersion,
  archivePath,
  previousArchivePointers = [],
  previousNextAction,
}) {
  const archivePointers = mergeArchivePointers([
    `- ${sprintVersion}: \`${archivePath}\``,
    ...previousArchivePointers,
  ]);

  // AFR-009: next_action is emitted as a single surface inline in the Active Snapshot
  // block — no separate `## Next Action` section. handoff.md must keep exactly one
  // next_action surface to prevent self-drift across sessions.
  const lines = [
    '# Handoff',
    '',
    '## Active Snapshot',
    '',
    `- updated_at: ${current.updated_at ?? 'unknown'}`,
    `- active_project: ${current.active_project ?? 'unknown'}`,
    `- active_issue: ${current.active_issue ?? 'unknown'}`,
    `- gate_state: ${current.gate_state ?? 'unknown'}`,
    `- canonical_state: ${current.canonical_state ?? 'unknown'}`,
    `- active_sprint: ${current.active_sprint ?? sprintVersion}`,
    `- handoff_context: ${current.handoff_context ?? 'sprint-close'}`,
    '',
    `Next action: ${current.next_action ?? previousNextAction ?? 'restore from current state and continue the selected Harness Issue.'}`,
    '',
    '## Sprint Memory',
    '',
    `- Sprint archive: \`${archivePath}\``,
    '- Active handoff was compacted by the manual sprint-close command.',
    '',
    '## Startup Boundary',
    '',
    'Startup reads `AGENTS.md`, `.ai-os/current.md`, and this compact handoff to restore state.',
    'Durable work uses `work_read_order` after explicit approval.',
    '',
    '## Archive Pointer',
    '',
    ...archivePointers,
    '',
  ];

  return `${lines.join('\n')}`;
}

function extractArchivePointers(handoffText) {
  const lines = handoffText.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Archive Pointer');
  if (start === -1) return [];

  const pointers = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trim().startsWith('- ')) pointers.push(line.trim());
  }
  return pointers;
}

function mergeArchivePointers(pointers) {
  const seen = new Set();
  const merged = [];
  for (const pointer of pointers) {
    if (!pointer || seen.has(pointer)) continue;
    seen.add(pointer);
    merged.push(pointer);
  }
  return merged;
}

function extractNextAction(handoffText) {
  const match = handoffText.match(/^Next action:\s*(.+)$/m);
  return match?.[1]?.trim();
}

export async function closeSprint({ root = process.cwd(), sprintVersion, skipNpm = false } = {}) {
  const currentPath = path.join(root, '.ai-os/current.md');
  const handoffPath = path.join(root, '.ai-os/memory/session/handoff.md');

  const [currentText, handoffText] = await Promise.all([
    readFile(currentPath, 'utf8'),
    readFile(handoffPath, 'utf8'),
  ]);

  const current = parseFrontmatter(currentText);
  const version = normalizeVersion(sprintVersion ?? current.active_sprint);
  if (!version) {
    throw new Error('Missing sprint version. Pass vX.Y.Z or set active_sprint in .ai-os/current.md.');
  }

  const archivePath = `.ai-os/memory/session/archive/handoff-${version}.md`;
  const archiveFullPath = path.join(root, archivePath);
  const compacted = buildCompactedHandoff({
    current,
    sprintVersion: version,
    archivePath,
    previousArchivePointers: extractArchivePointers(handoffText),
    previousNextAction: extractNextAction(handoffText),
  });
  const tempHandoffPath = `${handoffPath}.tmp-${process.pid}`;

  await withAiOsWriteGuard(root, archivePath, `archive handoff ${version}`, async () => {
    await mkdir(path.dirname(archiveFullPath), { recursive: true });
    await writeFile(archiveFullPath, handoffText, { encoding: 'utf8', flag: 'wx' }).catch((error) => {
      if (error?.code === 'EEXIST') {
        throw new Error(`Archive already exists: ${archivePath}`);
      }
      throw error;
    });
  });

  await withAiOsWriteGuard(root, '.ai-os/memory/session/handoff.md', `compact handoff ${version}`, async () => {
    await writeFile(tempHandoffPath, compacted, 'utf8');
    await rename(tempHandoffPath, handoffPath);
  });

  // POK-144 v2 retro standard 안내 — retro.md 작성 여부 검증 (warning only, 차단 없음)
  const retroHints = await checkRetroPresence(root, version);

  // POK-134 Rule Section Rotation — current.md `## Rule` 본문 gate 로그 회전.
  // `### Precedents (pinned)` 섹션은 절대 건드리지 않음. archive는 append-only.
  const ruleRotation = await rotateRuleArchive({ root, currentPath, currentText, sprintVersion: version });

  // POK-326 — 사용자 개선 피드백 카드: 스프린트 마감이 기본 표시 시점 (PO 결정 2026-06-10).
  // 카드 생성 실패가 마감 절차를 막지 않는다 — 실패 사유를 카드 자리에 남긴다.
  let feedbackCard;
  try {
    const feedbackModel = await collectSprintFeedbackModel({ root, sprintVersion: version });
    feedbackCard = renderSprintFeedbackCard(feedbackModel);
  } catch (error) {
    feedbackCard = `피드백 카드 생성 실패: ${error.message}`;
  }

  // POK-356 — 릴리즈 갭 자동 표면화: 마감 시 게시 버전 < 마감 스프린트면 경고.
  // 실패가 마감 절차를 막지 않는다.
  let releaseGap = null;
  let releaseGapCard = null;
  try {
    releaseGap = await checkReleaseGap({ root });
    releaseGapCard = renderReleaseGapCard(releaseGap);
  } catch {
    releaseGap = null;
  }

  // POK-378 — 릴리즈 산출물 4종 게이트: 마감 전 4종 완료 여부 실측.
  // npm publish 해당 없는 스프린트는 --skip-npm으로 명시 skip.
  // 미완료 항목이 있으면 경고 카드 출력 (fail-by-default 경고, 마감 절차는 계속).
  let releaseArtifacts = null;
  let releaseArtifactsCard = null;
  let releaseArtifactsMissing = false;
  try {
    const pkgText = await readFile(path.join(root, 'package.json'), 'utf8');
    const pkgVersion = JSON.parse(pkgText).version;
    releaseArtifacts = await checkReleaseArtifacts(pkgVersion);
    if (skipNpm) {
      releaseArtifacts = releaseArtifacts.map(a =>
        a.id === 1 ? { ...a, status: 'published', detail: `skip-npm 선언 — 해당 없는 스프린트` } : a
      );
    }
    const missing = releaseArtifacts.filter(a => a.status !== 'published');
    releaseArtifactsMissing = missing.length > 0;
    if (releaseArtifactsMissing) {
      releaseArtifactsCard = [
        '╭─ ⚠️  릴리즈 산출물 미완료 (POK-378 게이트)',
        '│',
        renderArtifactsTable(releaseArtifacts).split('\n').map(l => `│  ${l}`).join('\n'),
        '│',
        '│  npm publish 해당 없는 스프린트: --skip-npm 플래그 사용',
        '╰─',
      ].join('\n');
    }
  } catch {
    releaseArtifacts = null;
  }

  // POK-369 — event-log git 공유: sprint-close 시 event-log.jsonl을 logs/ 폴더에 복사.
  // event-log.jsonl이 없는 환경(fresh-pull)에서는 조용히 건너뜀.
  let eventLogCopyPath = null;
  try {
    const srcEventLog = path.join(root, '.ai-os/events/event-log.jsonl');
    const logsDir = path.join(root, 'logs');
    await stat(srcEventLog); // 파일 존재 확인 — 없으면 catch로 이동
    await mkdir(logsDir, { recursive: true });
    const destName = `event-log-${version}.jsonl`;
    const destPath = path.join(logsDir, destName);
    await copyFile(srcEventLog, destPath);
    eventLogCopyPath = `logs/${destName}`;
  } catch {
    // event-log 없는 환경(fresh-pull/스타터 번들) — 건너뜀
  }

  return {
    archivePath,
    handoffPath: '.ai-os/memory/session/handoff.md',
    sprintVersion: version,
    retroHints,
    ruleRotation,
    feedbackCard,
    releaseGap,
    releaseGapCard,
    releaseArtifacts,
    releaseArtifactsCard,
    releaseArtifactsMissing,
    eventLogCopyPath,
  };
}

async function rotateRuleArchive({ root, currentPath, currentText, sprintVersion }) {
  const { archiveLines, remainingContent } = rotateRuleSection(currentText, sprintVersion);
  if (archiveLines.length === 0) {
    return { rotated: 0, archivePath: null, message: 'no Rule body gate logs to rotate.' };
  }

  const archiveRelPath = `.ai-os/memory/rule-archive/${sprintVersion}.md`;
  const archiveFullPath = path.join(root, archiveRelPath);
  await mkdir(path.dirname(archiveFullPath), { recursive: true });

  const appendBlock = `\n${archiveLines.join('\n')}\n`;
  await withAiOsWriteGuard(root, archiveRelPath, `update rule archive ${sprintVersion}`, async () => {
    let exists = true;
    try {
      await stat(archiveFullPath);
    } catch (error) {
      if (error?.code === 'ENOENT') exists = false;
      else throw error;
    }

    if (!exists) {
      const header = [
        `# Rule Archive — ${sprintVersion}`,
        '',
        '> Sprint별 archive. Append-only. POK-134 (Rule Section Compaction).',
        '> 정책: .ai-os/standards/rule-section-rotation.md',
        '> 회전: sprint-close 자동 (scripts/pokit-sprint-close.mjs)',
        '',
      ].join('\n');
      await writeFile(archiveFullPath, header, { encoding: 'utf8', flag: 'wx' });
    }
    await appendFile(archiveFullPath, appendBlock, 'utf8');
  });

  // current.md `## Rule` 본문에서 gate 로그 줄 제거 (Precedents 보존).
  const tempCurrentPath = `${currentPath}.tmp-rule-${process.pid}`;
  await withAiOsWriteGuard(root, '.ai-os/current.md', `rotate current rule section ${sprintVersion}`, async () => {
    await writeFile(tempCurrentPath, remainingContent, 'utf8');
    await rename(tempCurrentPath, currentPath);
  });

  return {
    rotated: archiveLines.length,
    archivePath: archiveRelPath,
    message: `${archiveLines.length} Rule body gate log line(s) rotated to ${archiveRelPath}.`,
  };
}

async function checkRetroPresence(root, sprintVersion) {
  const retroPath = path.join(root, 'docs', sprintVersion, 'retro.md');
  try {
    await readFile(retroPath, 'utf8');
    return { retroExists: true, message: `docs/${sprintVersion}/retro.md 존재 — 다음 doctor 실행 시 retro_schema_compliance 검증.` };
  } catch {
    return {
      retroExists: false,
      message: `⚠️ docs/${sprintVersion}/retro.md 미작성. .ai-os/standards/sprint-retro.md (v2 표준) 참고하여 7섹션 회고 작성 권장. 미작성 시 다음 sprint scope spec gate 차단 가능 (POK-144 표준).`,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const skipNpm = args.includes('--skip-npm');
  const sprintVersion = args.find(a => !a.startsWith('--'));
  const result = await closeSprint({ sprintVersion, skipNpm });
  // stdout은 순수 JSON 계약 유지 (기존 CLI 소비자/테스트) — 사람용 카드는 stderr로.
  if (result.feedbackCard) {
    process.stderr.write(`${result.feedbackCard}\n\n`);
  }
  if (result.releaseArtifactsCard) {
    process.stderr.write(`${result.releaseArtifactsCard}\n\n`);
  }
  if (result.eventLogCopyPath) {
    process.stderr.write(`✔ event-log → ${result.eventLogCopyPath} (POK-369: git add 후 커밋하면 팀 공유됩니다)\n\n`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.releaseArtifactsMissing) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
