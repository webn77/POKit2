#!/usr/bin/env node
/**
 * pokit-install.mjs — 프로젝트에 포킷 잔류(residue)를 설치하거나 마이그레이션하는 CLI.
 *
 * 사용법:
 *   node scripts/pokit-install.mjs [--root <dir>] [--yes]
 *
 * --yes 없음 (기본): 완전 read-only. 계획만 출력하고 아무것도 쓰지 않는다.
 *   (v0.13 결함2 교훈: init 미리보기가 글로벌에 썼던 버그 선제 차단)
 * --yes: 계획을 실제로 적용한다 (로컬 프로젝트에만 씀. 글로벌 홈 불변).
 *
 * packageRoot / version 해석: scripts/lib/pokit-config.mjs의
 *   resolvePackageRoot() / readPokitPackageVersion() 사용.
 *   (다른 워커가 병렬 추가 중인 계약 — 실제로는 이미 pokit-config.mjs에 존재)
 */

import path from 'node:path';

import {
  readPokitPackageVersion,
  resolvePackageRoot,
} from './lib/pokit-config.mjs';
import {
  applyMigration,
  detectLegacyInstall,
  isPokitSourceCheckout,
  planMigration,
  writeResidue,
} from './lib/pokit-topology.mjs';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { root: process.cwd(), yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.root = path.resolve(argv[++index]);
    else if (arg === '--yes') args.yes = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.root);

// packageRoot / version — 계약: pokit-config.mjs의 함수를 통해 해석
const packageRoot = resolvePackageRoot();
const version = await readPokitPackageVersion(packageRoot);

// 결함 3 가드: pokit2 소스 레포에서 install 실행 시 자기파괴 방지.
// 어떤 파일도 쓰기/삭제하기 전에 체크한다.
if (await isPokitSourceCheckout(projectRoot)) {
  process.stderr.write(
    [
      'Error: pokit2 소스 레포에서 pokit install을 실행할 수 없습니다.',
      '현재 디렉토리가 pokit2 개발 레포로 감지되었습니다.',
      '설치 대상 프로젝트 디렉토리에서 실행하거나 --root 옵션으로 경로를 지정하세요.',
    ].join('\n') + '\n',
  );
  process.exit(1);
}

// Step 1: detect legacy
const { legacy, bodyFiles } = await detectLegacyInstall(projectRoot, packageRoot);

if (legacy) {
  // Legacy install detected — build migration plan
  const plan = await planMigration(projectRoot, { packageRoot });

  if (!args.yes) {
    // READ-ONLY: preview only, zero writes
    console.log(JSON.stringify({
      action: 'migration_plan_preview',
      legacy: true,
      projectRoot,
      packageRoot,
      version,
      note: 'Run with --yes to apply. No files were written.',
      plan,
    }, null, 2));
  } else {
    // Apply migration
    await applyMigration(projectRoot, plan, { packageRoot, version });
    console.log(JSON.stringify({
      action: 'migration_applied',
      legacy: true,
      projectRoot,
      packageRoot,
      version,
      removed: plan.remove,
      preserved: plan.preserve,
      residue: plan.residue,
    }, null, 2));
  }
} else {
  // Fresh install — build residue plan
  if (!args.yes) {
    // READ-ONLY: preview only, zero writes
    const residuePlan = [
      'AGENTS.md (marker block)',
      '.claude/skills/pokit-*/ (from starter)',
      '.ai-os/ (seed files — no overwrite if exists)',
      '.ai-os/current.md pokit_version field',
      '.claude/settings.json (safety-floor hooks — points to global engine, user hooks preserved)',
    ];
    console.log(JSON.stringify({
      action: 'install_plan_preview',
      legacy: false,
      projectRoot,
      packageRoot,
      version,
      note: 'Run with --yes to apply. No files were written.',
      residuePlan,
    }, null, 2));
  } else {
    // Apply fresh install
    const result = await writeResidue(projectRoot, { packageRoot, version, regenerate: false });
    console.log(JSON.stringify({
      action: 'install_applied',
      legacy: false,
      projectRoot,
      packageRoot,
      version,
      written: result.written,
      skipped: result.skipped,
      preserved: result.preserved,
    }, null, 2));
  }
}
