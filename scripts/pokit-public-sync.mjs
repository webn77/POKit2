#!/usr/bin/env node
/**
 * POK-361: 공개 레포 정제 동기화 스크립트.
 *
 * 기본 동작 (dry-run):
 *   1. 공개 레포를 임시 디렉터리에 클론
 *   2. npm pack --dry-run으로 배포 파일셋 계산
 *   3. 임시 클론에 dev 현재 버전으로 교체 (복사만, push 안 함)
 *   4. 누출 스캔 (pokit-prepublish-scan.mjs LEAK_PATTERNS 재사용)
 *   5. diff stat 출력
 *
 * --apply 플래그: 준비된 클론에서 git add + commit. push는 하지 않음 (외부 쓰기 PO 게이트).
 *
 * 사용:
 *   node scripts/pokit-public-sync.mjs              # dry-run
 *   node scripts/pokit-public-sync.mjs --apply      # commit 준비 (push 없음)
 *   node scripts/pokit-public-sync.mjs --version 0.21.1
 */
import { execFile, exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, LEAK_PATTERNS } from './pokit-prepublish-scan.mjs';
import { PUBLIC_REPO_GIT_URL } from './lib/release-artifacts-check.mjs';

const exec = promisify(execFile);
const execShell = promisify(execCb);

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');
// POK-372: 공개 레포 캐노니컬 토큰은 release-artifacts-check.mjs가 단일 소스 (webn77/POKit2).
const PUBLIC_REPO = PUBLIC_REPO_GIT_URL;

// repo-docs: 공개 레포에 항상 포함되는 문서 파일 (npm pack 비포함 문서 포함)
export const REPO_DOCS = ['README.md', 'CHANGELOG.md', 'ARCHITECTURE.md', 'RELEASE.md', 'LICENSE'];

async function getPackFiles(root) {
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json'], { cwd: root });
  const result = JSON.parse(stdout);
  return result[0].files.map(f => f.path);
}

/**
 * 동기화 파일셋 = npm pack 파일 ∪ repo-docs (중복 제거).
 * 복사 루프와 누출 스캔이 동일 파일셋을 기준으로 동작하게 하는 SSoT.
 */
export function computeSyncFileSet(packFiles, repoDocs = REPO_DOCS) {
  return [...new Set([...packFiles, ...repoDocs])];
}

/**
 * files를 srcRoot → destRoot로 복사. dev 루트에 없는 파일은 안전하게 skip.
 * 반환: { copied, skipped, copiedFiles } — copiedFiles는 실제 복사된 상대경로만.
 */
export async function copyFileSet({ srcRoot, destRoot, files }) {
  let copied = 0, skipped = 0;
  const copiedFiles = [];
  for (const relPath of files) {
    const src = path.join(srcRoot, relPath);
    const dest = path.join(destRoot, relPath);
    try {
      await cp(src, dest, { recursive: true, force: true });
      copied++;
      copiedFiles.push(relPath);
    } catch {
      skipped++;
    }
  }
  return { copied, skipped, copiedFiles };
}

// POK-384 — 인자 파싱 순수 함수. --version이 없으면 pkgVersion을 기본값으로 쓴다.
// 버그였던 부분: indexOf('--version')가 -1이면 args[0]을 버전으로 오인 → '--apply'를 버전으로 읽음.
export function parseSyncArgs(args = [], pkgVersion) {
  const applyMode = args.includes('--apply');
  const versionIdx = args.indexOf('--version');
  const rawVersionArg = versionIdx !== -1 ? args[versionIdx + 1] : undefined;
  // --version 다음 토큰이 없거나 또 다른 플래그면 무시하고 pkgVersion으로 폴백.
  const versionArg = (rawVersionArg && !rawVersionArg.startsWith('--')) ? rawVersionArg : undefined;
  const version = versionArg || pkgVersion;
  return { applyMode, version, tag: `v${version}` };
}

async function main() {
  const args = process.argv.slice(2);
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const { applyMode, version, tag } = parseSyncArgs(args, pkg.version);

  console.log(`\n📦 pokit-public-sync  버전: ${version}  모드: ${applyMode ? 'apply (commit 준비)' : 'dry-run'}`);
  console.log('─'.repeat(60));

  // 1. 임시 디렉터리에 공개 레포 클론
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'pokit-public-sync-'));
  console.log(`\n[1/5] 공개 레포 클론 → ${tmpDir}`);
  try {
    await exec('git', ['clone', '--depth=1', PUBLIC_REPO, tmpDir]);
  } catch (e) {
    // 공개 레포 접근 불가 시 gh api로 시도
    console.warn(`     클론 실패 (${e.message.slice(0, 60)}). 네트워크 또는 권한 확인 필요.`);
    await rm(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // 2. 배포 파일셋 계산 (npm files ∪ repo-docs)
  console.log('\n[2/5] 배포 파일셋 계산 (npm pack --dry-run)');
  const packFiles = await getPackFiles(ROOT);
  const allFiles = computeSyncFileSet(packFiles);
  console.log(`     npm pack: ${packFiles.length}개  +  repo-docs: ${REPO_DOCS.length}개  →  합계: ${allFiles.length}개`);

  // 3. 임시 클론에 dev 현재 버전으로 교체
  //    복사 대상은 allFiles(npm pack ∪ repo-docs). dev 루트에 없는 파일은 안전하게 skip.
  console.log('\n[3/5] dev → 임시 클론 교체');
  const { copied, skipped, copiedFiles } = await copyFileSet({ srcRoot: ROOT, destRoot: tmpDir, files: allFiles });
  console.log(`     복사: ${copied}개  건너뜀: ${skipped}개`);

  // 4. 누출 스캔 — 실제 복사된 파일셋(copiedFiles)과 일관되게 스캔
  console.log('\n[4/5] 누출 스캔');
  const findings = await scanFiles({ root: tmpDir, files: copiedFiles });
  if (findings.length > 0) {
    console.error('     ❌ 누출 발견:');
    for (const f of findings) {
      console.error(`        ${f.file}:${f.line} — ${f.patternName}: ${f.match}`);
    }
    await rm(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log('     ✅ 누출 없음');

  // 5. diff stat
  console.log('\n[5/5] diff stat');
  try {
    const { stdout: diffStat } = await execShell('git diff --stat HEAD', { cwd: tmpDir });
    if (diffStat.trim()) {
      console.log(diffStat);
    } else {
      console.log('     변경 없음 (이미 최신)');
    }
  } catch {
    // 새 파일만 있으면 diff stat이 없을 수 있음
    const { stdout: status } = await execShell('git status --short', { cwd: tmpDir });
    console.log(status || '     변경 없음');
  }

  if (applyMode) {
    console.log('\n[apply] git add + commit 준비 (push 없음 — 외부 쓰기는 PO 게이트)');
    await execShell(`git add -A && git commit -m "chore: sync from pokit2-work ${tag}"`, { cwd: tmpDir });
    console.log(`     커밋 완료. push 명령:\n     cd ${tmpDir} && git push origin main`);
  } else {
    console.log(`\n✅ dry-run 완료. 클론 경로: ${tmpDir}`);
    console.log('   --apply 플래그로 커밋을 준비하고, 이후 push는 PO 승인 후 수행.\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    console.error('\n오류:', e.message);
    process.exit(1);
  });
}
