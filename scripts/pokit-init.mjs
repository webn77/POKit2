#!/usr/bin/env node
import { copyFile, mkdir, readdir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 패키지 루트: 이 스크립트는 <root>/scripts/ 에 위치
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 최상위에서 복사 제외할 항목
const SKIP_TOP_LEVEL = new Set([
  '.git',
  'node_modules',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'RELEASE.md',
  'ARCHITECTURE.md',
  '.DS_Store',
]);

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`사용법: npx pokit2-starter [--force]

POKit2 스타터 파일을 현재 디렉토리에 설치합니다.

옵션:
  --force   기존 파일이 있어도 덮어쓰기
  --help    이 도움말 표시

설치 후:
  node scripts/pokit-doctor.mjs   # 환경 점검
  AGENTS.md 읽기                  # 운영 규칙 확인
  "포킷 시작"으로 세션 시작
`);
  process.exit(0);
}

const force = args.includes('--force');
const dest = process.cwd();

// 패키지 안에서 실행 방지
try {
  const destReal = await realpath(dest);
  const pkgReal = await realpath(PKG_ROOT);
  if (destReal === pkgReal) {
    console.error('패키지 루트 안에서는 실행할 수 없습니다. 빈 프로젝트 폴더로 이동 후 실행하세요.');
    process.exit(1);
  }
} catch {
  // realpath 실패 시 경로 비교로 폴백
  if (path.resolve(dest) === path.resolve(PKG_ROOT)) {
    console.error('패키지 루트 안에서는 실행할 수 없습니다. 빈 프로젝트 폴더로 이동 후 실행하세요.');
    process.exit(1);
  }
}

// 재귀적으로 복사할 파일 목록 수집 (심볼릭 링크 제외)
async function collectFiles(srcDir, destDir, isTopLevel = false) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    // .DS_Store 는 모든 깊이에서 건너뜀
    if (entry.name === '.DS_Store') continue;
    // 최상위에서는 SKIP_TOP_LEVEL 적용
    if (isTopLevel && SKIP_TOP_LEVEL.has(entry.name)) continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isSymbolicLink()) {
      // 심볼릭 링크 건너뜀
      continue;
    } else if (entry.isDirectory()) {
      const children = await collectFiles(srcPath, destPath);
      result.push(...children);
    } else if (entry.isFile()) {
      result.push({ src: srcPath, dest: destPath });
    }
  }
  return result;
}

let files;
try {
  files = await collectFiles(PKG_ROOT, dest, true);
} catch (err) {
  console.error(`파일 목록 수집 실패: ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.error('설치할 파일이 없습니다.');
  process.exit(1);
}

// 비파괴 가드: 충돌 파일 사전 스캔
if (!force) {
  const conflicts = [];
  for (const { dest: fileDest } of files) {
    try {
      await stat(fileDest);
      // 존재하면 충돌
      const rel = path.relative(dest, fileDest);
      conflicts.push(rel);
    } catch {
      // 없으면 OK
    }
  }

  if (conflicts.length > 0) {
    const shown = conflicts.slice(0, 10);
    const extra = conflicts.length - shown.length;
    console.error(`충돌: 아래 파일이 이미 존재합니다. 덮어쓰려면 --force를 사용하세요.\n`);
    for (const f of shown) console.error(`  ${f}`);
    if (extra > 0) console.error(`  ... 외 ${extra}건`);
    process.exit(1);
  }
}

// 복사 실행
let copied = 0;
for (const { src, dest: fileDest } of files) {
  try {
    await mkdir(path.dirname(fileDest), { recursive: true });
    await copyFile(src, fileDest);
    copied++;
  } catch (err) {
    console.error(`복사 실패 (${path.relative(dest, fileDest)}): ${err.message}`);
    process.exit(1);
  }
}

console.log(`\nPOKit2 스타터 설치 완료 — ${copied}개 파일 설치됨\n`);
console.log('다음 단계:');
console.log('  1. node scripts/pokit-doctor.mjs   # 환경 점검');
console.log('  2. AGENTS.md 읽기                   # 운영 규칙 확인');
console.log('  3. Claude Code에서 "포킷 시작"으로 세션 시작');
console.log('');
