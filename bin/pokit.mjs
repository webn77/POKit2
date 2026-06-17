#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveHookScriptPath } from '../scripts/lib/hook-floor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = new Map([
  ['doctor', { script: 'scripts/pokit-doctor.mjs', summary: 'Run the local POKit doctor checks.' }],
  ['runner', { script: 'scripts/pokit-runner.mjs', summary: 'Run the existing lifecycle runner.' }],
  ['start', { script: 'scripts/pokit-runner.mjs', defaultArgs: ['포킷 시작'], summary: 'Render the startup lifecycle card.' }],
  ['issues', { script: 'scripts/pokit-list-issues.mjs', summary: 'List issue cards from the local workspace.' }],
  ['artifacts', { script: 'scripts/pokit-list-artifacts.mjs', summary: 'List artifact cards from the local workspace.' }],
  ['evidence', { script: 'scripts/pokit-list-evidence.mjs', summary: 'Preview or write the evidence index.' }],
  ['project:init', { script: 'scripts/pokit-project-init.mjs', summary: 'Initialize project-local .pokit state.' }],
  ['project:use', { script: 'scripts/pokit-project-use.mjs', summary: 'Switch the active project.' }],
  ['project:list', { script: 'scripts/pokit-project-list.mjs', summary: 'List configured local projects.' }],
  ['project:overview', { script: 'scripts/pokit-project-overview.mjs', summary: 'Read the local multi-project overview.' }],
  ['issue:create', { script: 'scripts/pokit-issue-create.mjs', summary: 'Create a local issue card through the existing command.' }],
  ['session', { script: 'scripts/pokit-session.mjs', summary: 'Create/adopt/check task-session worktree flows.' }],
  ['integration', { script: 'scripts/pokit-integration.mjs', summary: 'Review and integrate proposed task-session updates.' }],
  ['worktree:gc', { script: 'scripts/pokit-worktree-gc.mjs', summary: 'Preview or apply safe task-session worktree cleanup.' }],
  ['sprint-close', { script: 'scripts/pokit-sprint-close.mjs', summary: 'Run the manual sprint-close command.' }],
  ['sync', { script: 'scripts/pokit-sync.mjs', summary: 'Sync repo-local command/skill templates.' }],
  ['dry-run', { script: 'scripts/pokit-dry-run.mjs', summary: 'Run the local scenario dry-run.' }],
  ['install', { script: 'scripts/pokit-install.mjs', summary: 'Install the thin project residue (new topology) or migrate a legacy full-copy install.' }],
  ['update', { script: 'scripts/pokit-update.mjs', summary: 'Refresh tool-owned files; never touches user-owned state.' }],
]);

function printHelp() {
  console.log(`Usage: pokit <command> [args]

Local install:
  npm install
  npm link
  pokit --help

Commands:
${[...COMMANDS.entries()].map(([name, command]) => `  ${name.padEnd(16)} ${command.summary}`).join('\n')}
  ${'hook-floor'.padEnd(16)} Run a thin-project safety-floor hook from the global engine (used by .claude/settings.json).

The core engine installs globally once (npm i -g pokit2 or npx pokit2).
Each project keeps only its own state — no full engine copy per project.
`);
}

function normalizeCommand(command) {
  if (command === 'help' || command === '--help' || command === '-h' || !command) return 'help';
  if (command === 'init') return 'project:init';
  if (command === 'use') return 'project:use';
  if (command === 'list') return 'project:list';
  if (command === 'overview') return 'project:overview';
  if (command === 'create-issue') return 'issue:create';
  if (command === 'gc') return 'worktree:gc';
  return command;
}

async function main(argv = process.argv.slice(2)) {
  const [rawCommand, ...args] = argv;
  const commandName = normalizeCommand(rawCommand);

  if (commandName === 'help') {
    printHelp();
    return 0;
  }

  // hook-floor — 얇은 프로젝트 안전바닥 훅 디스패치 (POK-347).
  // 프로젝트 .claude/settings.json의 훅 명령이 `pokit hook-floor <script>`로 들어오면,
  // 글로벌 본체(repoRoot)의 scripts/hooks/<script>.mjs를 찾아 그대로 실행한다.
  // stdin(훅 입력 JSON)·stdout·stderr·exit code를 모두 통과시켜 본체 훅과 동일하게 동작한다.
  if (commandName === 'hook-floor') {
    const [scriptName] = args;
    if (!scriptName) {
      console.error('Usage: pokit hook-floor <hook-script>');
      return 1;
    }
    let hookScriptPath;
    try {
      hookScriptPath = resolveHookScriptPath(repoRoot, scriptName);
    } catch (err) {
      console.error(err.message);
      return 1;
    }
    const hookChild = spawn(process.execPath, [hookScriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    return await new Promise((resolve) => {
      hookChild.on('close', (code) => resolve(code ?? 1));
      hookChild.on('error', (err) => {
        console.error(`Failed to run hook-floor ${scriptName}: ${err.message}`);
        resolve(1);
      });
    });
  }

  const command = COMMANDS.get(commandName);
  if (!command) {
    console.error(`Unknown command: ${rawCommand}`);
    console.error('Run `pokit --help` for supported local commands.');
    return 1;
  }

  const scriptPath = path.join(repoRoot, command.script);
  const childArgs = [scriptPath, ...(command.defaultArgs ?? []), ...args];
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  return await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`Failed to run ${commandName}: ${err.message}`);
      resolve(1);
    });
  });
}

const exitCode = await main();
if (exitCode !== 0) process.exit(exitCode);
