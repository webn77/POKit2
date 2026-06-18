#!/usr/bin/env node
/**
 * POK-361: 릴리즈 산출물 4종 발행 상태 실측 조회.
 * release-standard.md 기준:
 *   1. npm publish  — npm view pokit2 version
 *   2. 공개 레포 소스 — github.com/webn77/POKit2 HEAD 커밋
 *   3. 공개 레포 태그 — vX.Y.Z 태그 존재 여부
 *   4. GitHub Release — vX.Y.Z Release 존재 여부
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// POK-372: 공개 레포 캐노니컬 단일 소스 (회사계정 dongwonlee222 → 개인계정 webn77 이전).
// 다른 스크립트(pokit-public-sync.mjs)는 이 토큰을 import해 하드코딩 중복을 피한다.
export const PUBLIC_REPO = 'webn77/POKit2';
export const PUBLIC_REPO_GIT_URL = `https://github.com/${PUBLIC_REPO}.git`;

/**
 * @param {string} version — e.g. "0.21.1"
 * @returns {Promise<Array<{id: number, label: string, status: 'published'|'missing'|'error', detail: string}>>}
 */
export async function checkReleaseArtifacts(version) {
  const tag = `v${version}`;
  const results = [];

  // 1. npm version
  try {
    const { stdout } = await exec('npm', ['view', 'pokit2', 'version']);
    const published = stdout.trim();
    results.push({
      id: 1,
      label: 'npm publish',
      status: published === version ? 'published' : 'missing',
      detail: published === version ? `npm view: ${published}` : `npm view: ${published} (expected ${version})`,
    });
  } catch (e) {
    results.push({ id: 1, label: 'npm publish', status: 'error', detail: e.message });
  }

  // 2. 공개 레포 HEAD
  try {
    const { stdout } = await exec('gh', ['api', `repos/${PUBLIC_REPO}/commits/HEAD`, '--jq', '.sha + " " + .commit.message']);
    const [sha, ...msgParts] = stdout.trim().split(' ');
    results.push({
      id: 2,
      label: '공개 레포 소스',
      status: 'published',
      detail: `HEAD: ${sha.slice(0, 8)} ${msgParts.join(' ').slice(0, 60)}`,
    });
  } catch (e) {
    results.push({ id: 2, label: '공개 레포 소스', status: 'error', detail: e.message });
  }

  // 3. 공개 레포 태그
  try {
    await exec('gh', ['api', `repos/${PUBLIC_REPO}/git/ref/tags/${tag}`]);
    results.push({ id: 3, label: `공개 레포 태그 ${tag}`, status: 'published', detail: `태그 ${tag} 존재 확인` });
  } catch (e) {
    const missing = e.message.includes('404') || e.message.includes('Not Found');
    results.push({ id: 3, label: `공개 레포 태그 ${tag}`, status: missing ? 'missing' : 'error', detail: missing ? `태그 ${tag} 없음` : e.message });
  }

  // 4. GitHub Release
  try {
    const { stdout } = await exec('gh', ['release', 'view', tag, '--repo', PUBLIC_REPO, '--json', 'tagName,publishedAt', '--jq', '.tagName + " " + .publishedAt']);
    results.push({ id: 4, label: `GitHub Release ${tag}`, status: 'published', detail: `Release ${stdout.trim()}` });
  } catch (e) {
    const missing = e.message.includes('release not found') || e.message.includes('404');
    results.push({ id: 4, label: `GitHub Release ${tag}`, status: missing ? 'missing' : 'error', detail: missing ? `Release ${tag} 없음` : e.message });
  }

  return results;
}

/**
 * Render results as an ASCII table string.
 */
export function renderArtifactsTable(results) {
  const icon = { published: '✅', missing: '❌', error: '⚠️ ' };
  const lines = [
    `릴리즈 산출물 4종 체크`,
    `${'─'.repeat(60)}`,
    ...results.map(r => `${icon[r.status]} ${r.id}. ${r.label.padEnd(24)} ${r.detail}`),
    `${'─'.repeat(60)}`,
    `통과: ${results.filter(r => r.status === 'published').length}/4`,
  ];
  return lines.join('\n');
}

// CLI 직접 실행 — POK-372: 다른 스크립트/테스트가 import할 때 argv[1] 부재로 깨지지 않게 null-safe.
if (process.argv[1]?.endsWith('release-artifacts-check.mjs')) {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  const version = process.argv[2] || pkg.version;
  console.log(`버전 ${version} 산출물 4종 확인 중...\n`);
  const results = await checkReleaseArtifacts(version);
  console.log(renderArtifactsTable(results));
}
