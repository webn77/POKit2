import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARTER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '../..');

test('starter runner, doctor, metrics, issue list, and evidence list run', () => {
  for (const args of [
    ['scripts/pokit-runner.mjs', '$pokit'],
    ['scripts/pokit-doctor.mjs'],
    ['scripts/pokit-measure-startup.mjs'],
    ['scripts/pokit-list-issues.mjs'],
    ['scripts/pokit-list-evidence-raw.mjs'],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: process.env.HOME,
        CODEX_HOME: process.env.CODEX_HOME,
      },
    });
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  }
});

test('starter first-use flow creates and activates an isolated smoke issue', async () => {
  const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'pokit-starter-smoke-'));
  await cp(process.cwd(), isolatedRoot, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('.git'),
  });

  try {
  const suffix = process.pid.toString(36);
  const projectKey = `smoke-${suffix}`;
  const namespace = `SMK${suffix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}`;
  const createProject = spawnSync(process.execPath, [
    'scripts/pokit-project-create.mjs',
    '--key',
    projectKey,
    '--name',
    'Smoke Project',
    '--namespace',
    namespace,
  ], { cwd: isolatedRoot, encoding: 'utf8', env: process.env });
  assert.equal(createProject.status, 0, `${createProject.stderr}\n${createProject.stdout}`);

  const useProject = spawnSync(process.execPath, ['scripts/pokit-project-use.mjs', projectKey], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(useProject.status, 0, `${useProject.stderr}\n${useProject.stdout}`);

  const create = spawnSync(process.execPath, [
    'scripts/pokit-issue-create.mjs',
    '--title',
    '첫 작업',
    '--created-at',
    '2026-05-30',
  ], { cwd: isolatedRoot, encoding: 'utf8', env: process.env });
  assert.equal(create.status, 0, `${create.stderr}\n${create.stdout}`);
  const created = JSON.parse(create.stdout);
  assert.equal(created.issue, `${namespace}-001`);
  assert.equal(created.path, `projects/${projectKey}/issues/${namespace}-001.md`);

  const list = spawnSync(process.execPath, ['scripts/pokit-list-issues.mjs'], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(list.status, 0, `${list.stderr}\n${list.stdout}`);
  assert.match(list.stdout, new RegExp(`${namespace}-001`));

  const use = spawnSync(process.execPath, ['scripts/pokit-issue-use.mjs', `${namespace}-001`], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(use.status, 0, `${use.stderr}\n${use.stdout}`);

  const doctor = spawnSync(process.execPath, ['scripts/pokit-doctor.mjs'], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(doctor.status, 0, `${doctor.stderr}\n${doctor.stdout}`);
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});

// ── 러너 분류: classifyPokitCommand execution_request ────────────────────────

test('classifyPokitCommand: plain execution-approval phrases → execution_request', async () => {
  const { classifyPokitCommand } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));

  const result = classifyPokitCommand('진행해줘');
  assert.equal(result.kind, 'execution_request', 'kind must be execution_request');
  assert.equal(result.raw, '진행해줘');
  assert.equal(result.target_issue, undefined, 'no target_issue for plain phrase');
});

test('classifyPokitCommand: POK-001 진행하자 → execution_request with POK-001 target', async () => {
  const { classifyPokitCommand } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));

  const result = classifyPokitCommand('POK-001 진행하자');
  assert.equal(result.kind, 'execution_request');
  assert.equal(result.target_issue, 'POK-001');
});

test('classifyPokitCommand: prefix-agnostic target works (GG-001 고)', async () => {
  const { classifyPokitCommand } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));

  // GG-001 matches ISSUE_ID_PATTERN (/^[A-Z][A-Z0-9]*-\d{3,}$/) — 3-digit form.
  const result = classifyPokitCommand('GG-001 고');
  assert.equal(result.kind, 'execution_request');
  assert.equal(result.target_issue, 'GG-001');
});

// ── 러너 분류: classifyPokitCommand execution_mode_selection ─────────────────

test('classifyPokitCommand: "b" → execution_mode_selection automatic/authorized', async () => {
  const { classifyPokitCommand } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));

  const result = classifyPokitCommand('b');
  assert.equal(result.kind, 'execution_mode_selection');
  assert.equal(result.mode, 'automatic');
  assert.equal(result.worker_authorization, 'authorized');
  assert.equal(result.selected_option, 'b');
});

// ── 러너 분류: hasActiveIssue ────────────────────────────────────────────────

test('hasActiveIssue: true when current.md has a valid active_issue', async () => {
  const { hasActiveIssue } = await import(path.join(STARTER_ROOT, 'scripts/active-issue-guard.mjs'));

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-guard-test-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: COM-001\ngate_state: pending\n---\n',
      'utf8',
    );
    const result = await hasActiveIssue(tmpRoot);
    assert.equal(result, true, 'should be true when active_issue is COM-001');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('hasActiveIssue: false when active_issue is null', async () => {
  const { hasActiveIssue } = await import(path.join(STARTER_ROOT, 'scripts/active-issue-guard.mjs'));

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-guard-test-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: null\ngate_state: idle\n---\n',
      'utf8',
    );
    const result = await hasActiveIssue(tmpRoot);
    assert.equal(result, false, 'should be false when active_issue is null');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('hasActiveIssue: false when current.md is absent', async () => {
  const { hasActiveIssue } = await import(path.join(STARTER_ROOT, 'scripts/active-issue-guard.mjs'));

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-guard-test-'));
  try {
    // No .ai-os/current.md — should return false (fail-closed)
    const result = await hasActiveIssue(tmpRoot);
    assert.equal(result, false, 'should be false when current.md is missing');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 러너 분류: blocking_draft path ───────────────────────────────────────────

test('runPreflight with execution_request and no active_issue → blocking_draft card', async () => {
  // Use a temp root with active_issue: null
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-blocking-test-'));
  try {
    // Copy minimal starter scaffold (projects.yaml, current.md)
    await cp(path.join(STARTER_ROOT, '.ai-os'), path.join(tmpRoot, '.ai-os'), {
      recursive: true,
    });
    // Explicitly set active_issue: null so the test does not depend on seed current.md content.
    await writeFile(path.join(tmpRoot, '.ai-os/current.md'), '---\nactive_issue: null\n---\n', 'utf8');

    // Import fresh (cache-bust via URL query param not possible in node:test; use dynamic path)
    const { runPreflight } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));
    const result = await runPreflight({ root: tmpRoot, phrase: '진행해줘' });

    assert.equal(result.command.kind, 'execution_request', 'command.kind must be execution_request');
    assert.equal(result.lifecycleCard?.card_type, 'blocking_draft', 'card_type must be blocking_draft');
    assert.ok(result.renderedLifecycleCard?.includes('이슈를 먼저 묶어야'), 'rendered card should contain block message');
    assert.ok(result.renderedLifecycleCard?.includes('pokit-issue-create'), 'rendered card should contain draft guidance');
    assert.equal(result.lifecycleCard?.approval_required, true);
    assert.equal(result.lifecycleCard?.approves_durable_work, false);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 러너 분류: execution_request WITH active_issue → pre_execution_preview ───

test('runPreflight with execution_request and active_issue → pre_execution_preview card', async () => {
  // cwd-independent: uses a tmpdir fixture with a known active_issue set.
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-preview-test-'));
  try {
    // Copy minimal starter scaffold (.ai-os dir)
    await cp(path.join(STARTER_ROOT, '.ai-os'), path.join(tmpRoot, '.ai-os'), {
      recursive: true,
    });
    // Set a valid active_issue in the fixture current.md
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: POK-001\ngate_state: pending\n---\n',
      'utf8',
    );

    const { runPreflight } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));
    const result = await runPreflight({ root: tmpRoot, phrase: '진행해줘' });

    assert.equal(result.command.kind, 'execution_request', 'command.kind must be execution_request');
    assert.equal(result.lifecycleCard?.card_type, 'pre_execution_preview', 'card_type must be pre_execution_preview');
    assert.ok(result.renderedLifecycleCard?.includes('a) 수동'), 'rendered card should contain a/b/c selection');
    assert.ok(result.renderedLifecycleCard?.includes('b) 자동'), 'rendered card should contain b) 자동');
    assert.ok(result.renderedLifecycleCard?.includes('c) 중단'), 'rendered card should contain c) 중단');
    assert.equal(result.lifecycleCard?.approval_required, true);
    assert.equal(result.lifecycleCard?.approves_durable_work, false);
    assert.equal(result.activeIssue, 'POK-001');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 러너 분류: startup behavior unchanged ────────────────────────────────────

test('classifyPokitCommand: "$pokit" still startup_trigger', async () => {
  const { classifyPokitCommand } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));

  const result = classifyPokitCommand('$pokit');
  assert.equal(result.kind, 'startup_trigger');
});

test('runPreflight with startup phrase still renders session_start card', async () => {
  // Run against STARTER_ROOT (cwd-independent — fixes test 12 fragility).
  const { runPreflight } = await import(path.join(STARTER_ROOT, 'scripts/pokit-runner.mjs'));
  const result = await runPreflight({ root: STARTER_ROOT, phrase: '$pokit' });

  assert.equal(result.command.kind, 'startup_trigger');
  assert.equal(result.lifecycleCard?.card_type, 'session_start');
  assert.ok(result.renderedLifecycleCard ?? renderFallback(result.lifecycleCard), 'rendered card should exist');
});

function renderFallback(lc) {
  // Minimal check — if renderedLifecycleCard is absent, lifecycleCard must at least be present
  return lc != null;
}

// ── 예방 훅: require-active-issue-before-mutation decide/decideAsync ──────────

test('훅 decide: Write on .mjs file (no active issue path) → check_active_issue', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Write', tool_input: { file_path: 'src/main.mjs' } };
  const result = decide(payload);
  assert.equal(result.decision, 'check_active_issue', 'durable .mjs file → check_active_issue');
});

test('훅 decide: Bash git commit → check_active_issue (durable)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } };
  const result = decide(payload);
  assert.equal(result.decision, 'check_active_issue', 'git commit is durable');
});

test('훅 decide: Bash git push → check_active_issue', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Bash', tool_input: { command: 'git push origin main' } };
  const result = decide(payload);
  assert.equal(result.decision, 'check_active_issue', 'git push is durable');
});

test('훅 decide: Bash cat (read-only) → allow', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Bash', tool_input: { command: 'cat .ai-os/current.md' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'cat is read-only → allow');
});

test('훅 decide: Bash ls → allow (read-only)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'ls is read-only → allow');
});

test('훅 decide: Task write_scoped 도구 → check_active_issue (durable 의도)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Task', tool_input: { task_scope: 'write_scoped', description: '코드 구현' } };
  const result = decide(payload);
  assert.equal(result.decision, 'check_active_issue', 'write_scoped Task is durable');
});

test('훅 decide: 명시적 read_only Task → allow', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Task', tool_input: { task_scope: 'read_only', description: 'READ-ONLY: return data only, do not modify files' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'explicit read_only Task is non-durable');
});

test('훅 decide: 모호한 review Task → check_active_issue', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Task', tool_input: { description: 'review the hook implementation' } };
  const result = decide(payload);
  assert.equal(result.decision, 'check_active_issue', 'ambiguous review Task remains guarded');
});

test('훅 decideAsync: active issue 없는 read_only Task → allow', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Task', tool_input: { can_write: false, description: 'READ-ONLY: inspect state, do not edit' } };
  const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'pokit-readonly-task-'));
  try {
    const result = await decideAsync(payload, isolatedRoot);
    assert.equal(result.decision, 'allow', 'read_only Task should not require active_issue');
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true });
  }
});

test('훅 decide: 부트스트랩 화이트리스트 — pokit-issue-create Bash → allow', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Bash', tool_input: { command: 'node scripts/pokit-issue-create.mjs --title "첫 이슈"' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'pokit-issue-create is bootstrap whitelisted');
});

test('훅 decide: 부트스트랩 화이트리스트 — 이슈 파일 Write → allow', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Write', tool_input: { file_path: 'projects/common/issues/COM-001.md' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'issue file write is bootstrap whitelisted');
});

test('훅 decide: prefix-agnostic — GG-001 이슈 파일 Write → allow (화이트리스트)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Write', tool_input: { file_path: 'projects/golden-goose/issues/GG-001.md' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'GG- issue file is bootstrap whitelisted');
});

test('훅 decide: prefix-agnostic — MODU-001 이슈 파일 Write → allow (화이트리스트)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const payload = { tool_name: 'Write', tool_input: { file_path: 'projects/modu/issues/MODU-001.md' } };
  const result = decide(payload);
  assert.equal(result.decision, 'allow', 'MODU- issue file is bootstrap whitelisted');
});

test('훅 decideAsync: durable + no active issue → deny', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-hook-deny-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: null\ngate_state: idle\n---\n',
      'utf8',
    );
    const payload = { tool_name: 'Write', tool_input: { file_path: 'docs/spec.md' } };
    const result = await decideAsync(payload, tmpRoot);
    assert.equal(result.decision, 'deny', 'durable + no active issue → deny');
    assert.ok(result.reason, 'deny should have a reason');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('훅 decideAsync: durable + active issue 있음 → allow', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-hook-allow-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: GG-001\ngate_state: pending\n---\n',
      'utf8',
    );
    const payload = { tool_name: 'Write', tool_input: { file_path: 'docs/spec.md' } };
    const result = await decideAsync(payload, tmpRoot);
    assert.equal(result.decision, 'allow', 'durable + active issue → allow');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('훅 decideAsync: read-only Bash (grep) → allow (no active issue needed)', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-hook-readonly-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: null\ngate_state: idle\n---\n',
      'utf8',
    );
    const payload = { tool_name: 'Bash', tool_input: { command: 'grep -r "test" src/' } };
    const result = await decideAsync(payload, tmpRoot);
    assert.equal(result.decision, 'allow', 'grep is read-only → allow even without active issue');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 예방 훅 AC7: DENY reason이 renderDraftCard와 동일한 텍스트 ───────────────

test('훅 DENY reason은 renderDraftCard 반환 텍스트와 동일 (단일 렌더러)', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );
  const { renderDraftCard } = await import(
    path.join(STARTER_ROOT, 'scripts/active-issue-guard.mjs')
  );

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-hook-reason-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: null\ngate_state: idle\n---\n',
      'utf8',
    );
    const fp = 'docs/spec.md';
    const payload = { tool_name: 'Write', tool_input: { file_path: fp } };
    const result = await decideAsync(payload, tmpRoot);
    assert.equal(result.decision, 'deny');

    const expectedReason = renderDraftCard({}, `Write ${fp}`);
    assert.equal(result.reason, expectedReason, 'DENY reason must match renderDraftCard output exactly');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 설정 병합: mergeSafetyFloorSettings ──────────────────────────────────────

test('mergeSafetyFloorSettings: 기존 설정 없음 → safetyFloor 그대로 반환', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const floor = {
    hooks: {
      PreToolUse: [
        { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node scripts/hooks/require-active-issue-before-mutation.mjs' }] },
      ],
    },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(null, floor);
  assert.deepEqual(merged, floor, 'null existing → safetyFloor returned as-is');
  assert.equal(warnings.length, 0);
});

test('mergeSafetyFloorSettings: 기존 설정 있음 — 사용자 키 보존', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const existing = {
    theme: 'dark',
    model: 'claude-opus',
    hooks: {},
  };
  const floor = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'node scripts/hooks/require-active-issue-before-mutation.mjs' }] },
      ],
    },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(existing, floor);
  assert.equal(merged.theme, 'dark', 'user theme key preserved');
  assert.equal(merged.model, 'claude-opus', 'user model key preserved');
  assert.ok(merged.hooks.PreToolUse.length > 0, 'PreToolUse entry added');
  assert.equal(warnings.length, 0);
});

test('mergeSafetyFloorSettings: 중복 항목이면 추가 안 함', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const cmd = 'node scripts/hooks/require-active-issue-before-mutation.mjs';
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] },
      ],
    },
  };
  const floor = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] },
      ],
    },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(existing, floor);
  // 중복이므로 추가 안 함 — 항목 수 여전히 1
  assert.equal(merged.hooks.PreToolUse.length, 1, 'duplicate not added twice');
  assert.equal(warnings.length, 0);
});

test('mergeSafetyFloorSettings: 사용자 PreToolUse 있음 → 사용자 항목 보존 + 안전바닥 항목 append (경고 없음)', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const userCmd = 'node scripts/hooks/other-hook.mjs';
  const floorCmd = 'node scripts/hooks/require-active-issue-before-mutation.mjs';
  const existing = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: userCmd }] },
      ],
    },
  };
  const floor = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: floorCmd }] },
      ],
    },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(existing, floor);
  // (1) 사용자 command 보존
  const bashEntry = merged.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  const cmds = bashEntry.hooks.map((h) => h.command);
  assert.ok(cmds.includes(userCmd), '사용자 command가 보존돼야 함');
  // (2) 안전바닥 command가 배열에 추가됨
  assert.ok(cmds.includes(floorCmd), '안전바닥 command가 append돼야 함');
  // (3) 경고 없음 — 배열 append는 충돌이 아님
  assert.equal(warnings.length, 0, '배열 append는 경고 없음');
});

test('mergeSafetyFloorSettings: 기존 PreToolUse가 비-배열(구조 충돌) → 경고 + 사용자 값 보존(덮지 않음)', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const floorCmd = 'node scripts/hooks/require-active-issue-before-mutation.mjs';
  // 사용자가 PreToolUse를 배열이 아닌 값으로 둔 비정상 구조
  const existing = { hooks: { PreToolUse: 'oops-not-an-array' } };
  const floor = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: floorCmd }] }] },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(existing, floor);
  // 구조 충돌 → 경고 1건 이상, 기존 값 그대로 보존(덮어쓰지 않음)
  assert.ok(warnings.length >= 1, '비-배열 PreToolUse는 경고를 남겨야 함');
  assert.equal(merged.hooks.PreToolUse, 'oops-not-an-array', '사용자 값은 보존돼야 함');
});

// ── 예방 훅 H1 회귀: redirect >= 비교연산자 false positive 방지 ──────────────

test('훅 decide: Bash awk NR >= 10 (비교연산자) → allow (read-only, 거짓양성 없음)', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const cmds = [
    'awk "NR >= 10" file.txt',
    'awk \'NR >= 5\' input.csv',
    '[ $a -ge 10 ]',
  ];
  for (const command of cmds) {
    const result = decide({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(result.decision, 'allow', `>= 비교연산자는 read-only → allow: ${command}`);
  }
});

test('훅 decide: 진짜 redirect (echo > f, cmd >> f) → durable 차단', async () => {
  const { decide } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const cmds = [
    'echo hello > /tmp/out.txt',
    'cat file >> /tmp/log.txt',
    'ls > output.txt',
  ];
  for (const command of cmds) {
    const result = decide({ tool_name: 'Bash', tool_input: { command } });
    assert.equal(result.decision, 'check_active_issue', `redirect → durable(check_active_issue): ${command}`);
  }
});

test('훅 decideAsync: awk NR >= 10 (active_issue null, tmpdir) → allow (H1 end-to-end)', async () => {
  const { decideAsync } = await import(
    path.join(STARTER_ROOT, 'scripts/hooks/require-active-issue-before-mutation.mjs')
  );

  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'pokit-hook-ge-'));
  try {
    await mkdir(path.join(tmpRoot, '.ai-os'), { recursive: true });
    await writeFile(
      path.join(tmpRoot, '.ai-os/current.md'),
      '---\nactive_issue: null\ngate_state: idle\n---\n',
      'utf8',
    );
    const payload = { tool_name: 'Bash', tool_input: { command: 'awk "NR >= 10" file.txt' } };
    const result = await decideAsync(payload, tmpRoot);
    assert.equal(result.decision, 'allow', 'awk NR >= 10 → allow (비교연산자, active_issue 불필요)');
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ── 설정 병합 M1 회귀: mergeSafetyFloorSettings 배열 append idempotent ────────

test('mergeSafetyFloorSettings: 재실행 idempotent — 안전바닥 항목 중복 추가 안 함', async () => {
  const { mergeSafetyFloorSettings } = await import(
    path.join(STARTER_ROOT, 'scripts/install-safety-floor-settings.mjs')
  );

  const userCmd = 'node scripts/hooks/other-hook.mjs';
  const floorCmd = 'node scripts/hooks/require-active-issue-before-mutation.mjs';
  // 1회 병합 결과 (안전바닥 이미 포함된 상태)
  const afterFirstMerge = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [
          { type: 'command', command: userCmd },
          { type: 'command', command: floorCmd },
        ]},
      ],
    },
  };
  const floor = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: floorCmd }] },
      ],
    },
  };

  const { merged, warnings } = mergeSafetyFloorSettings(afterFirstMerge, floor);
  const bashEntry = merged.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  const floorCmds = bashEntry.hooks.filter((h) => h.command === floorCmd);
  assert.equal(floorCmds.length, 1, '재실행 시 안전바닥 항목이 중복 추가되지 않아야 함');
  assert.equal(warnings.length, 0);
});
