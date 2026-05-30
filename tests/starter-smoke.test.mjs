import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('starter runner, doctor, metrics, issue list, and evidence list run', () => {
  for (const args of [
    ['scripts/pokit-runner.mjs', '$pokit'],
    ['scripts/pokit-doctor.mjs'],
    ['scripts/pokit-measure-startup.mjs'],
    ['scripts/pokit-list-issues.mjs'],
    ['scripts/pokit-list-evidence.mjs'],
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
