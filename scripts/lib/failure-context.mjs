// POK-327 — failure_context 구조화: 검증 실패 단계·원인·시도 횟수를 프론트매터에 기록한다.
// POK-386 — 멀티유저 쓰기 길목 배선: 상태 파일 경로를 resolveCurrentStatePath로 사람별
//   라우팅하고, 읽기-수정-쓰기를 withStateWriteGuard로 직렬화한다(동일 유저 동시 세션·
//   공용 current.md lost-update 방지). 부품(worktree-locks)은 v0.13(POK-223/236)에 존재.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveCurrentStatePath } from './user-state.mjs';
import { withStateWriteGuard } from './worktree-locks.mjs';

// 잠금 보유자 식별 — 세션 ID 우선, 없으면 프로세스 PID (project-state.mjs 동일 패턴).
function lockHolder() {
  return process.env.POKIT_SESSION_ID ?? `pid-${process.pid}`;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

/**
 * 실패 단계 코드 → 한국어 레이블.
 * 알 수 없는 토큰은 'other' 로 정규화한다.
 */
export const FAILURE_STAGES = Object.freeze({
  preflight: '사전 확인',
  implementation: '구현',
  tests: '테스트',
  doctor: '자가 점검',
  review: '리뷰',
  gate: '완료 확인',
  other: '기타',
});

// ── Pure functions ─────────────────────────────────────────────────────────────

/**
 * 프론트매터 `failure_context:` 값 문자열을 파싱한다.
 *
 * - null/undefined/빈 문자열/'none' → null 반환 (컨텍스트 없음).
 * - 파이프 구분 형식: `issue=POK-327 | stage=tests | attempt=2 | at=2026-06-11 | reason=free text`
 * - issue 토큰 누락 → null (이슈 없는 컨텍스트는 사용할 수 없음).
 * - 알 수 없는 stage 토큰 → 'other' 로 정규화.
 * - attempt 파싱 실패 → 기본값 1.
 *
 * @param {string|null|undefined} value
 * @returns {{ issue: string, stage: string, attempt: number, at: string, reason: string }|null}
 */
export function parseFailureContext(value) {
  if (!value || value.trim() === '' || value.trim() === 'none') return null;

  const fields = {};
  // `key=value` 쌍을 `|` 로 분리, 첫 번째 `=` 이후는 전부 value (reason 에 = 포함 가능)
  const parts = value.split('|');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    const v = part.slice(eqIdx + 1).trim();
    if (k) fields[k] = v;
  }

  // issue 누락 시 사용 불가
  if (!fields.issue) return null;

  // stage 정규화
  const stage = fields.stage && fields.stage in FAILURE_STAGES ? fields.stage : 'other';

  // attempt: 정수 ≥1, 파싱 실패 시 1
  const rawAttempt = parseInt(fields.attempt, 10);
  const attempt = Number.isFinite(rawAttempt) && rawAttempt >= 1 ? rawAttempt : 1;

  return {
    issue: fields.issue,
    stage,
    attempt,
    at: fields.at ?? '',
    reason: fields.reason ?? '',
  };
}

/**
 * 컨텍스트 오브젝트를 파이프 구분 한 줄 문자열로 직렬화한다.
 *
 * reason 정제:
 *   - 줄바꿈 → 공백
 *   - `|` → 공백
 *   - 연속 공백 축약 + trim
 *   - 160자 초과 시 truncate
 *
 * @param {{ issue: string, stage: string, attempt: number|string, at: string, reason?: string }}
 * @returns {string}
 */
export function formatFailureContext({ issue, stage, attempt, at, reason = '' }) {
  // stage 정규화: FAILURE_STAGES 에 없으면 'other'
  const normalizedStage = stage in FAILURE_STAGES ? stage : 'other';

  // attempt: 정수 ≥1 강제
  const rawAttempt = parseInt(String(attempt), 10);
  const normalizedAttempt = Number.isFinite(rawAttempt) && rawAttempt >= 1 ? rawAttempt : 1;

  // reason 정제: 줄바꿈·파이프 → 공백, 연속 공백 축약, trim, 160자 절사
  let cleanReason = String(reason ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanReason.length > 160) cleanReason = cleanReason.slice(0, 160);

  return `issue=${issue} | stage=${normalizedStage} | attempt=${normalizedAttempt} | at=${at} | reason=${cleanReason}`;
}

/**
 * 이전 컨텍스트를 기반으로 다음 컨텍스트 오브젝트를 생성한다.
 *
 * - previous.issue === issue → attempt + 1
 * - 그 외(이슈 다름 또는 previous null) → attempt = 1
 *
 * @param {{ previous: object|null, issue: string, stage: string, reason: string, at: string }}
 * @returns {{ issue: string, stage: string, attempt: number, at: string, reason: string }}
 */
export function nextFailureContext({ previous, issue, stage, reason, at }) {
  const attempt = previous && previous.issue === issue ? previous.attempt + 1 : 1;
  return { issue, stage, attempt, at, reason };
}

/**
 * PO에게 보여줄 한국어 필드를 생성한다. ctx가 null이면 null 반환.
 *
 * 금지 토큰: 게이트, 박제, receipt, 영수증 (PO 평어 규칙)
 *
 * @param {object|null} ctx
 * @returns {{ stage: string, reason: string, attempt_line: string, resume_message: string }|null}
 */
export function buildFailureNoticeFields(ctx) {
  if (!ctx) return null;

  return {
    stage: FAILURE_STAGES[ctx.stage] ?? '기타',
    reason: ctx.reason || '원인 미기록',
    attempt_line: `${ctx.attempt}번째 시도까지 실패`,
    resume_message: '"진행해줘" → 멈춘 단계부터 이어서 재시도합니다.',
  };
}

// ── Async I/O functions ────────────────────────────────────────────────────────

/**
 * `${root}/.ai-os/current.md` 의 `failure_context:` 줄을 갱신한다.
 *
 * - frontmatter 블록(`---\n...\n---`) 안에서만 `failure_context:` 를 찾아 교체한다
 *   (본문에 같은 키가 있어도 영향 없음).
 * - active_issue 불일치 시 파일을 건드리지 않고 { ok: false } 를 반환한다.
 * - at 은 호출자가 넘기며, 누락 시 Date.now() 기반 YYYY-MM-DD 를 사용한다.
 *
 * @param {{ root: string, issueId: string, stage: string, reason: string, at?: string }}
 * @returns {Promise<{ ok: true, failureContext: string, attempt: number, parsed: object }
 *                  | { ok: false, reason: string, activeIssue: string|null }>}
 */
export async function recordFailureContext({ root, issueId, stage, reason, at }) {
  // POK-386: current.md 고정 대신 사람별 파일로 라우팅 (유저 파일 없으면 fast-path로 current.md).
  const { relPath } = await resolveCurrentStatePath(root);
  const filePath = join(root, relPath);

  // POK-386: read-modify-write를 가드 안에서 수행해 동시 쓰기 lost-update를 막는다.
  return withStateWriteGuard(
    root,
    { filePath: relPath, holder: lockHolder(), reason: 'record_failure_context' },
    async () => {
      const text = await readFile(filePath, 'utf8');

      const activeIssue = parseFrontmatterField(text, 'active_issue');
      if (activeIssue !== issueId) {
        return { ok: false, reason: 'issue_mismatch', activeIssue };
      }

      // at 기본값: 호출자 미제공 시 오늘 날짜 (YYYY-MM-DD)
      const resolvedAt = at ?? new Date(Date.now()).toISOString().slice(0, 10);

      const existingRaw = parseFrontmatterField(text, 'failure_context');
      const existing = parseFailureContext(existingRaw);
      const next = nextFailureContext({ previous: existing, issue: issueId, stage, reason, at: resolvedAt });
      const failureContextStr = formatFailureContext(next);

      const newText = rewriteFrontmatterField(text, 'failure_context', failureContextStr);
      await writeFile(filePath, newText, 'utf8');

      return { ok: true, failureContext: failureContextStr, attempt: next.attempt, parsed: next };
    },
  );
}

/**
 * `failure_context:` 를 `none` 으로 초기화한다.
 *
 * - 현재 컨텍스트가 존재하고 issueId 와 일치할 때만 파일을 수정한다.
 * - 컨텍스트 없음 또는 다른 이슈의 컨텍스트 → 파일 수정 없이 { cleared: false } 반환.
 *
 * @param {{ root: string, issueId: string }}
 * @returns {Promise<{ ok: true, cleared: boolean, previous: object|null }>}
 */
export async function clearFailureContext({ root, issueId }) {
  // POK-386: 사람별 파일로 라우팅 + 가드로 read-modify-write 직렬화.
  const { relPath } = await resolveCurrentStatePath(root);
  const filePath = join(root, relPath);

  return withStateWriteGuard(
    root,
    { filePath: relPath, holder: lockHolder(), reason: 'clear_failure_context' },
    async () => {
      const text = await readFile(filePath, 'utf8');

      const rawValue = parseFrontmatterField(text, 'failure_context');
      const parsed = parseFailureContext(rawValue);

      if (parsed && parsed.issue === issueId) {
        const newText = rewriteFrontmatterField(text, 'failure_context', 'none');
        await writeFile(filePath, newText, 'utf8');
        return { ok: true, cleared: true, previous: parsed };
      }

      return { ok: true, cleared: false, previous: null };
    },
  );
}

/**
 * `${root}/.ai-os/current.md` 의 failure_context 를 읽어 파싱한다.
 * 파일 없음/파싱 불가 → null (기록 없음과 동일하게 취급).
 *
 * @param {{ root: string }}
 * @returns {Promise<object|null>}
 */
export async function readCurrentFailureContext({ root }) {
  try {
    // POK-386: 읽기도 쓰기와 동일하게 사람별 파일로 해석 (읽기↔쓰기 대칭). 읽기는 가드 불필요.
    const { relPath } = await resolveCurrentStatePath(root);
    const text = await readFile(join(root, relPath), 'utf8');
    return parseFailureContext(parseFrontmatterField(text, 'failure_context'));
  } catch {
    return null;
  }
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * YAML 프론트매터에서 `key: value` 스칼라를 추출한다 — `---` 블록 내부만 본다
 * (본문 오매칭 방지, feedback-card.mjs 패턴 동일).
 *
 * @param {string} text
 * @param {string} key
 * @returns {string|null}
 */
function parseFrontmatterField(text, key) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = re.exec(block[1]);
  return m ? m[1].trim() : null;
}

/**
 * 프론트매터 블록 안의 `key:` 줄만 `key: newValue` 로 교체한다.
 *
 * - 블록이 없으면 텍스트를 그대로 반환한다.
 * - 블록 안에 키가 없으면 블록 첫 줄에 삽입한다.
 * - 본문 내 같은 키 패턴은 건드리지 않는다.
 *
 * @param {string} text
 * @param {string} key
 * @param {string} newValue
 * @returns {string}
 */
function rewriteFrontmatterField(text, key, newValue) {
  // 첫 번째 `---\n...\n---` 쌍을 찾는다
  const headerRe = /^---\n([\s\S]*?)\n---/;
  const match = headerRe.exec(text);
  if (!match) return text;

  const blockContent = match[1]; // `---` 안쪽 내용
  const blockStart = match.index + 4; // `---\n` 이후 위치
  const blockEnd = blockStart + blockContent.length;

  const lineRe = new RegExp(`^${key}:.*$`, 'm');
  let newBlockContent;
  if (lineRe.test(blockContent)) {
    newBlockContent = blockContent.replace(lineRe, `${key}: ${newValue}`);
  } else {
    // 키가 없으면 블록 첫 줄로 추가
    newBlockContent = `${key}: ${newValue}\n${blockContent}`;
  }

  return text.slice(0, blockStart) + newBlockContent + text.slice(blockEnd);
}
