// POK-371 — 멀티유저 상태 파일 분리(A형). 유저 키 = git user.email.

import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * git user.email을 상태 파일 키로 변환한다.
 * - 소문자화 후 [a-z0-9._+-] 이외 문자는 '-'로 치환.
 * - 빈 문자열이면 null 반환.
 *
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
export function userStateKeyFromEmail(email) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return normalized.replace(/[^a-z0-9._+\-]/g, '-');
}

/**
 * 키로부터 상태 파일명을 반환한다.
 *
 * @param {string} key
 * @returns {string}
 */
export function userStateFileName(key) {
  return `current-${key}.md`;
}

/**
 * <root>/.ai-os 디렉터리에서 유저별 상태 파일 목록을 반환한다.
 * - `current-`로 시작하고 `.md`로 끝나는 파일만 포함.
 * - 정확히 `current.md`는 제외.
 * - 에러(ENOENT 등) 발생 시 빈 배열 반환 (throw 금지).
 *
 * @param {string} root - 프로젝트 루트 경로
 * @returns {Promise<Array<{ key: string, file: string, relPath: string }>>}
 */
export async function listUserStateFiles(root) {
  const aiOsDir = path.join(root, '.ai-os');
  let entries;
  try {
    entries = await readdir(aiOsDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of entries) {
    if (!file.startsWith('current-') || !file.endsWith('.md')) continue;
    // 정확히 'current.md'는 이미 위 조건에서 제외됨 (current-로 시작 안 함)
    const key = file.slice('current-'.length, -'.md'.length);
    results.push({
      key,
      file,
      relPath: `.ai-os/${file}`,
    });
  }
  return results;
}

/**
 * 현재 git user.email을 동기적으로 조회한다.
 * 실패하거나 빈 값이면 null 반환.
 *
 * @param {string} root - 프로젝트 루트 경로 (git cwd)
 * @returns {string|null}
 */
export function resolveCurrentUserEmail(root) {
  try {
    const result = spawnSync('git', ['config', '--get', 'user.email'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const email = result.stdout.trim();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * 현재 유저에 맞는 상태 파일 경로를 결정한다.
 *
 * 동작 규칙:
 * - **fast path**: 유저 파일이 하나도 없으면 git을 호출하지 않고 즉시 single-user 반환.
 * - 유저 파일이 있고 email → key 매칭 성공: per-user 반환.
 * - 유저 파일이 있지만 매칭 실패(email 없음 or 불일치): fallback 반환.
 *
 * @param {string} root - 프로젝트 루트 경로
 * @param {{ resolveEmail?: () => string|null }} [options]
 * @returns {Promise<{ relPath: string, user: string|null, source: 'single-user'|'per-user'|'fallback' }>}
 */
export async function resolveCurrentStatePath(root, { resolveEmail } = {}) {
  const _resolveEmail = resolveEmail ?? (() => resolveCurrentUserEmail(root));

  const userFiles = await listUserStateFiles(root);

  // fast path: 유저 파일 없음 → git 호출 없이 즉시 반환
  if (userFiles.length === 0) {
    return { relPath: '.ai-os/current.md', user: null, source: 'single-user' };
  }

  // 유저 파일이 존재 → email 조회 후 매칭
  const email = _resolveEmail();
  const key = userStateKeyFromEmail(email);

  if (key) {
    const matched = userFiles.find((f) => f.key === key);
    if (matched) {
      return { relPath: matched.relPath, user: key, source: 'per-user' };
    }
  }

  // 매칭 실패 → fallback
  return { relPath: '.ai-os/current.md', user: null, source: 'fallback' };
}
