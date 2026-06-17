/**
 * release-gap.mjs (POK-356)
 *
 * 공개 게시 버전(npm dist-tag)과 마지막 마감 스프린트를 비교해
 * 게시 버전 < 마감 스프린트면 미게시 갭을 반환한다.
 *
 * 표면화까지만 — 실제 게시는 사람 게이트.
 */

import { exec } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function parseSemver(v) {
  const match = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return true;
    if (pa[i] > pb[i]) return false;
  }
  return false;
}

/**
 * npm registry에서 packageName의 최신 게시 버전을 가져온다.
 * 실패 시 null 반환 (네트워크 없음 등).
 */
async function fetchNpmVersion(packageName) {
  try {
    const { stdout } = await execAsync(`npm view ${packageName} version --json`, { timeout: 10000 });
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * .ai-os/sprints/ 아래 마감된 스프린트 중 gate_passed 이슈가 있는 가장 최신 버전을 찾는다.
 * release-scope.yaml의 accepted 섹션에 gate_passed 항목이 있으면 마감 스프린트로 간주.
 */
async function findLastClosedSprint(root) {
  const sprintsDir = path.join(root, '.ai-os/sprints');
  let entries;
  try {
    entries = await readdir(sprintsDir);
  } catch {
    return null;
  }

  const versions = entries
    .filter((e) => /^v\d+\.\d+\.\d+$/.test(e))
    .sort((a, b) => {
      const pa = parseSemver(a);
      const pb = parseSemver(b);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });

  for (const ver of versions) {
    const scopePath = path.join(sprintsDir, ver, 'release-scope.yaml');
    try {
      const text = await readFile(scopePath, 'utf8');
      if (/status:\s*gate_passed/.test(text)) {
        return ver;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 릴리즈 갭 체크.
 * @param {object} opts
 * @param {string} opts.root - repo root
 * @param {string} opts.packageName - npm package name (default: 'pokit2')
 * @param {string|null} [opts._mockNpmVersion] - 테스트용 npm 버전 주입 (undefined면 실제 npm 조회)
 * @returns {Promise<ReleaseGapResult>}
 */
export async function checkReleaseGap({ root = process.cwd(), packageName = 'pokit2', _mockNpmVersion } = {}) {
  const npmVersionPromise = _mockNpmVersion !== undefined
    ? Promise.resolve(_mockNpmVersion)
    : fetchNpmVersion(packageName);

  const [npmVersion, lastClosedSprint] = await Promise.all([
    npmVersionPromise,
    findLastClosedSprint(root),
  ]);

  if (!lastClosedSprint) {
    return { hasGap: false, reason: 'no_closed_sprint', npmVersion, lastClosedSprint };
  }

  if (!npmVersion) {
    return { hasGap: false, reason: 'npm_unreachable', npmVersion: null, lastClosedSprint };
  }

  const hasGap = semverLt(`v${npmVersion}`, lastClosedSprint);
  return { hasGap, npmVersion, lastClosedSprint, reason: hasGap ? 'unpublished_gap' : 'up_to_date' };
}

/**
 * 릴리즈 갭 경고 카드 렌더링.
 */
export function renderReleaseGapCard(gap) {
  if (!gap?.hasGap) return null;

  return [
    '╭─ ⚠️  릴리즈 갭 감지',
    '│',
    `│  npm 게시    v${gap.npmVersion}`,
    `│  마감 스프린트  ${gap.lastClosedSprint}`,
    '│',
    '│  게시되지 않은 스프린트가 있습니다.',
    '│  실제 게시는 사람 게이트 — POK-357 또는 /pokit.next 로 릴리즈 이슈 선택.',
    '╰─',
  ].join('\n');
}
