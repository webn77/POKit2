#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appendIssueAuthoredReceipt,
  buildIssueAuthoredReceipt,
  createIssue,
} from './lib/issue-create.mjs';
import {
  allocateIssueId,
  ensureProjectState,
  readProjectState,
  renderProjectViews,
} from './lib/project-state.mjs';
import { withStateWriteGuard } from './lib/worktree-locks.mjs';
import { emptySkeletonBody } from './lib/issue-sections.mjs';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function lockHolder() {
  return process.env.POKIT_SESSION_ID ?? `pid-${process.pid}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const id = args['id'];
  const title = args['title'];
  const issueType = args['type'] ?? 'implementation';
  const authoringPath = args['authoring-path'] ?? 'pokit.backlog';
  const reason = args['reason'] ?? null;
  const created_at = args['created-at'] ?? today();
  const bodyFile = args['body-file'] ?? null;

  if (!title) {
    process.stderr.write('Error: --title is required\n');
    process.exit(1);
  }

  // Resolve project root early so we can read current.md for project default.
  // 글로벌 설치 토폴로지에서 스크립트 위치는 본체(패키지) — 프로젝트는 cwd 기준.
  const root = args['root'] ? path.resolve(args['root']) : process.cwd();

  // --project 미지정 시 .ai-os/current.md의 active_project를 기본값으로 사용.
  // .ai-os/current.md가 없는 fresh workspace(스타터/테스트)는 'common'으로 폴백.
  let resolvedProject = args['project'];
  if (!resolvedProject) {
    try {
      const currentMd = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
      const match = currentMd.match(/^active_project:\s*(.+)$/m);
      if (match) resolvedProject = match[1].trim();
    } catch {
      // .ai-os/current.md 없음 → 아래 폴백 적용
    }
    if (!resolvedProject) resolvedProject = 'common';
  }

  const project = resolvedProject;

  let body = '';
  if (bodyFile) {
    try {
      body = await readFile(bodyFile, 'utf8');
    } catch (err) {
      process.stderr.write(`Error: cannot read body file: ${err.message}\n`);
      process.exit(1);
    }
  }

  try {
    if (!id) {
      // POK-335 길목 가드: .ai-os/current.md를 SSoT로 쓰는 repo에서는
      // 자동ID 경로(createProjectLocalIssue)가 .pokit/project-state.json을 만들고
      // active_issue를 조용히 바꾸는 상태모델 충돌을 일으키므로 차단한다.
      //
      // 차단 조건:
      //   (a) .ai-os/current.md가 파일로 존재하고 (기존 동작 보존)
      //   (b) active_issue: null/none 이 명시적으로 있으면 스타터 초기 상태로 허용
      //       → active_issue 키가 없거나, 실제 이슈 ID가 잡혀 있으면 차단
      //
      // fresh 스타터 workspace(.ai-os/current.md 부재)는 기존 동작 보존.
      let shouldBlock = false;
      try {
        const st = await stat(path.join(root, '.ai-os/current.md'));
        if (st.isFile()) {
          const currentMdText = await readFile(path.join(root, '.ai-os/current.md'), 'utf8');
          const match = currentMdText.match(/^active_issue:\s*(.*)$/m);
          if (match) {
            const val = match[1].trim();
            // active_issue 키가 있고 값이 null/none이면 스타터 초기 상태 → 허용
            if (val === '' || val.toLowerCase() === 'null' || val.toLowerCase() === 'none') {
              shouldBlock = false;
            } else {
              // 실제 이슈 ID가 잡혀 있음 → 차단
              shouldBlock = true;
            }
          } else {
            // active_issue 키가 없음 → .ai-os/current.md는 있지만 active_issue 미설정 → 차단
            shouldBlock = true;
          }
        }
      } catch {
        // .ai-os/current.md 없음 또는 stat 실패 → shouldBlock = false → 자동 번호 허용
      }
      if (shouldBlock) {
        process.stderr.write(
          [
            'Error: 이 저장소에서는 --id 없이 이슈를 만들 수 없습니다.',
            '이 저장소는 .ai-os/current.md로 작업 상태를 관리합니다. --id 없는 자동 번호 경로는',
            '별도 상태 파일(.pokit/project-state.json)을 만들고 active_issue를 조용히 바꾸므로 차단됩니다.',
            '사용법: node scripts/pokit-issue-create.mjs --id POK-XXX --title "제목"',
            '(.ai-os/current.md의 active_issue가 null/none이거나 파일이 없는 환경에서는 --id 없이 자동 번호 할당이 계속 동작합니다.)',
          ].join('\n') + '\n',
        );
        process.exit(1);
      }
      const result = await createProjectLocalIssue({
        root,
        title,
        issueType,
        authoringPath,
        reason,
        body,
        created_at,
        projectKey: resolvedProject,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const { cardPath, receipt } = await createIssue({
      root,
      id,
      title,
      issueType,
      project,
      authoringPath,
      reason: reason ?? null,
      body,
      created_at,
    });

    const summary = {
      cardPath: path.relative(root, cardPath),
      content_hash: receipt.content_hash,
      issue_id: receipt.issue_id,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

async function createProjectLocalIssue({
  root,
  title,
  issueType,
  authoringPath,
  reason,
  body,
  created_at,
  projectKey,
}) {
  await ensureProjectState(root);
  const { issueId, project } = await allocateIssueId(root, projectKey);
  // POK-316: write to the system-wide convention projects/<key>/issues/, not the
  // stray root issues/. This also makes the existing-card check below catch real
  // collisions, since it now stats the real location.
  const cardPath = path.join(root, 'projects', project.key, 'issues', `${issueId}.md`);

  let exists = false;
  try {
    await stat(cardPath);
    exists = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  if (exists) throw new Error(`Card already exists: ${cardPath}`);

  const safeTitle = title.trim();
  const frontmatter = [
    '---',
    'schema_version: 0.1.0',
    `id: ${issueId}`,
    `namespace: ${project.prefix}`,
    `project: ${project.key}`,
    `project_prefix: ${project.prefix}`,
    `title: ${safeTitle}`,
    `issue_type: ${issueType}`,
    'canonical_state: backlog',
    'gate_state: pending',
    'status: candidate',
    'definition_readiness: draft',
    `authoring_path: ${authoringPath}`,
    'authoring_contract_version: project-local-backlog-v1',
    `created_at: ${created_at}`,
    `updated_at: ${created_at}`,
    '---',
  ].join('\n');
  // POK-349: emit the full required-section skeleton from the single source
  // (issue-sections.mjs) — empty headers, no fake fill. A `_No brief provided._`
  // placeholder would let the doctor's header-presence check pass while masking an
  // unfilled thinking slot; the readiness content check refuses placeholders, so
  // the honest default is blank headers the groomer fills in.
  const bodySection = body || emptySkeletonBody(issueType);
  const cardContent = `${frontmatter}\n\n# ${issueId} ${safeTitle}${bodySection}\n`;

  await withStateWriteGuard(root, {
    filePath: path.relative(root, cardPath),
    holder: lockHolder(),
    reason: `create project-local issue ${issueId}`,
  }, async () => {
    await mkdir(path.dirname(cardPath), { recursive: true });
    await writeFile(cardPath, cardContent, { encoding: 'utf8', flag: 'wx' });
  });

  const receipt = buildIssueAuthoredReceipt({
    id: issueId,
    title: safeTitle,
    created_at,
    provider: 'codex',
    authoring_path: authoringPath,
    reason,
  });
  await appendIssueAuthoredReceipt(root, receipt);

  const { config, projectState, seq } = await readProjectState(root);
  projectState.active_issue = issueId;
  projectState.gate_state = 'pending';
  projectState.next_action = project.key === 'common'
    ? 'Create or continue a common project issue'
    : `Create or continue an issue in ${project.key}`;
  projectState.updated_at = new Date().toISOString();
  await withStateWriteGuard(root, {
    filePath: '.pokit/project-state.json',
    holder: lockHolder(),
    reason: `activate project-local issue ${issueId}`,
  }, async () => {
    await writeFile(path.join(root, '.pokit/project-state.json'), `${JSON.stringify(projectState, null, 2)}\n`, 'utf8');
  });
  await renderProjectViews(root, {
    config,
    projectState,
    seq,
    activeProject: project,
  });

  return {
    id: issueId,
    cardPath: path.relative(root, cardPath),
    content_hash: receipt.content_hash,
    project,
  };
}

// Guard: only run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
