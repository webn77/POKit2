/**
 * pokit-deferred-ledger.mjs
 *
 * 모든 과거 스프린트의 release-scope.yaml 안 deferred 항목을 전수 집계해,
 * "이 후보가 몇 번 이월됐나"를 기계 집계로 산출한다.
 *
 * 집계 규칙 (합집합):
 * (a) top-level `deferred:` 섹션 안에 있는 항목, 또는
 * (b) 어느 섹션에서든 `status: deferred` (정확히 일치) 인 항목.
 * 같은 (스프린트, id)는 한 번만 센다.
 *
 * 제외: status: deferred_from_* 등 접두사 변형은 카운트하지 않는다.
 *
 * 텍스트 추정 금지 — 오직 release-scope.yaml 데이터에서만 산출.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ──────────────────────────────────────────────
// Semver 정렬 (문자열 비교 금지, 숫자 비교)
// ──────────────────────────────────────────────

/**
 * "v0.17.0" → [0, 17, 0]
 */
function parseSemver(versionStr) {
  const match = versionStr.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * semver 오름차순 비교 함수
 */
function compareSemver(a, b) {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

// ──────────────────────────────────────────────
// YAML 파서 — 합집합 이월 항목 추출
// ──────────────────────────────────────────────

/**
 * release-scope.yaml 텍스트에서 이월 항목을 합집합으로 추출.
 *
 * (a) top-level `deferred:` 섹션 안에 있는 항목
 * (b) 어느 섹션에서든 status 값이 정확히 "deferred" 인 항목
 * → 두 조건의 합집합. 같은 id는 한 번만.
 *
 * 각 항목: { id, title, deferred_reason }
 * deferred_reason 폴백: deferred_reason: 없으면 reason: 사용. 둘 다 없으면 ''.
 */
function parseAllDeferredItems(yamlText) {
  const lines = yamlText.split('\n');

  // ── 1단계: 모든 `- id:` 블록을 파싱해 항목 목록 구성 ──
  // 각 항목마다 { id, title, deferred_reason, reason, status, inDeferredSection } 수집

  // top-level deferred: 섹션 범위 탐색
  let deferredSectionStart = -1;
  let deferredSectionEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^deferred:\s*$/.test(lines[i])) {
      deferredSectionStart = i + 1;
      // 섹션 끝: 다음 top-level 키 (들여쓰기 0인 "word:" 패턴)
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[A-Za-z0-9_-]+:\s/.test(lines[j]) || /^[A-Za-z0-9_-]+:\s*$/.test(lines[j])) {
          deferredSectionEnd = j;
          break;
        }
      }
      break; // top-level deferred: 는 파일 당 하나만 존재
    }
  }

  /**
   * 라인 인덱스 i가 top-level deferred: 섹션 안에 있는지 판별.
   */
  function isInDeferredSection(lineIdx) {
    return deferredSectionStart !== -1 &&
      lineIdx >= deferredSectionStart &&
      lineIdx < deferredSectionEnd;
  }

  // ── 2단계: 모든 `- id:` 항목 파싱 ──
  const allItems = [];
  let current = null;
  let currentStartLine = -1;
  let inMultilineField = null; // 'deferred_reason' | 'reason' | null
  let multilineIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 새 항목 시작: "  - id: ..." 패턴 (들여쓰기 있음)
    const itemStart = line.match(/^(\s+)-\s+id:\s+(.+)$/);
    if (itemStart) {
      if (current) allItems.push(current);
      current = {
        id: itemStart[2].trim().replace(/^["']|["']$/g, ''),
        title: '',
        deferred_reason: '',
        reason: '',
        status: '',
        startLine: i,
        inDeferredSection: isInDeferredSection(i),
      };
      inMultilineField = null;
      continue;
    }

    if (!current) continue;

    // title 파싱
    const titleMatch = line.match(/^\s+title:\s+(.+)$/);
    if (titleMatch) {
      current.title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      inMultilineField = null;
      continue;
    }

    // status 파싱
    const statusMatch = line.match(/^\s+status:\s+(\S+)$/);
    if (statusMatch) {
      current.status = statusMatch[1].trim().replace(/^["']|["']$/g, '');
      inMultilineField = null;
      continue;
    }

    // deferred_reason 파싱 (인라인)
    const drInlineMatch = line.match(/^(\s+)deferred_reason:\s+(.+)$/);
    if (drInlineMatch) {
      current.deferred_reason = drInlineMatch[2].trim().replace(/^["']|["']$/g, '');
      inMultilineField = null;
      continue;
    }

    // deferred_reason 블록 스타일 "|" or ">"
    const drBlockMatch = line.match(/^(\s+)deferred_reason:\s*[|>]?\s*$/);
    if (drBlockMatch) {
      multilineIndent = drBlockMatch[1].length + 2;
      inMultilineField = 'deferred_reason';
      current.deferred_reason = '';
      continue;
    }

    // reason 파싱 (인라인 — 옛 v0.11~v0.13 방식)
    const reasonInlineMatch = line.match(/^(\s+)reason:\s+(.+)$/);
    if (reasonInlineMatch) {
      current.reason = reasonInlineMatch[2].trim().replace(/^["']|["']$/g, '');
      inMultilineField = null;
      continue;
    }

    // reason 블록 스타일
    const reasonBlockMatch = line.match(/^(\s+)reason:\s*[|>]?\s*$/);
    if (reasonBlockMatch) {
      multilineIndent = reasonBlockMatch[1].length + 2;
      inMultilineField = 'reason';
      current.reason = '';
      continue;
    }

    // 멀티라인 처리
    if (inMultilineField) {
      const indent = line.search(/\S/);
      if (indent < 0) {
        // 빈 줄: 계속
      } else if (indent >= multilineIndent) {
        const content = line.trim();
        current[inMultilineField] += (current[inMultilineField] ? ' ' : '') + content;
      } else {
        inMultilineField = null;
        // 이 줄은 다른 필드일 수 있으므로 다시 처리하지 않음 (next loop iteration)
      }
    }
  }

  if (current) allItems.push(current);

  // ── 3단계: 합집합 필터링 ──
  // (a) inDeferredSection === true, 또는
  // (b) status === 'deferred' (정확히)
  const filtered = allItems.filter(item => {
    if (!item.id) return false;
    const isDeferred = item.status === 'deferred';
    return item.inDeferredSection || isDeferred;
  });

  // ── 4단계: id 중복 제거 (같은 스프린트 내, deferred: 섹션 + status:deferred 동시 해당 시 1회) ──
  const seen = new Set();
  const result = [];
  for (const item of filtered) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    // deferred_reason 폴백: deferred_reason 없으면 reason 사용
    const resolvedReason = item.deferred_reason || item.reason || '';
    result.push({
      id: item.id,
      title: item.title,
      deferred_reason: resolvedReason,
    });
  }

  return result;
}

// ──────────────────────────────────────────────
// 메인 집계 함수
// ──────────────────────────────────────────────

/**
 * 모든 스프린트의 deferred 항목을 집계한다.
 *
 * @param {string} root - 레포 루트 경로
 * @returns {{ entries: Array, generatedAt: string }}
 */
export async function aggregateDeferredLedger(root) {
  const sprintsDir = path.join(root, '.ai-os', 'sprints');

  // 스프린트 폴더 목록 (semver 오름차순)
  let sprintDirs;
  try {
    const entries = await readdir(sprintsDir, { withFileTypes: true });
    sprintDirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort(compareSemver);
  } catch {
    return { entries: [], generatedAt: new Date().toISOString() };
  }

  // 각 스프린트별 deferred 항목 수집
  // Map<id, { count, sprints, latestTitle, latestReason }>
  const ledgerMap = new Map();

  for (const sprint of sprintDirs) {
    const scopePath = path.join(sprintsDir, sprint, 'release-scope.yaml');
    if (!existsSync(scopePath)) continue;

    let text;
    try {
      text = await readFile(scopePath, 'utf8');
    } catch {
      continue;
    }

    const deferredItems = parseAllDeferredItems(text);
    for (const item of deferredItems) {
      if (!item.id) continue;

      if (!ledgerMap.has(item.id)) {
        ledgerMap.set(item.id, {
          id: item.id,
          count: 0,
          sprints: [],
          latestTitle: '',
          latestReason: '',
        });
      }

      const entry = ledgerMap.get(item.id);
      entry.count += 1;
      entry.sprints.push(sprint);
      // 최신 스프린트(가장 나중에 처리된) 값으로 갱신
      if (item.title) entry.latestTitle = item.title;
      if (item.deferred_reason) entry.latestReason = item.deferred_reason;
    }
  }

  // entries 배열 구성 (count 내림차순, 동수면 id 오름차순)
  const entries = Array.from(ledgerMap.values())
    .map(e => ({
      id: e.id,
      title: e.latestTitle || e.id,
      count: e.count,
      sprints: [...e.sprints].sort(compareSemver),
      lastSprint: [...e.sprints].sort(compareSemver).at(-1) ?? '',
      lastDeferredReason: e.latestReason,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.id.localeCompare(b.id);
    });

  return {
    entries,
    generatedAt: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────
// lookupDeferred
// ──────────────────────────────────────────────

/**
 * ledger에서 id로 항목을 조회한다.
 * - 존재하면 entry 객체 반환
 * - 존재하지 않으면 { id, status: 'unlisted' } 반환 (count:0 금지)
 *
 * @param {{ entries: Array }} ledger
 * @param {string} id
 */
export function lookupDeferred(ledger, id) {
  const found = ledger.entries.find(e => e.id === id);
  if (found) return found;
  return { id, status: 'unlisted' };
}

// ──────────────────────────────────────────────
// renderDeferredLedgerCard
// ──────────────────────────────────────────────

/**
 * 사람이 읽는 ASCII 카드 문자열 반환.
 * minCount 이상 이월된 항목만, count 내림차순.
 * 각 줄에 "이월 N회 + 마지막 연기 사유" 포함.
 *
 * @param {{ entries: Array }} ledger
 * @param {{ minCount?: number }} [options]
 * @returns {string}
 */
export function renderDeferredLedgerCard(ledger, { minCount = 2 } = {}) {
  const filtered = ledger.entries.filter(e => e.count >= minCount);

  if (filtered.length === 0) {
    return `╭─ 🔁 이월 누적 (킥오프 재평가 대상)\n│ 이월 ${minCount}회 이상 후보 없음\n╰─`;
  }

  const lines = ['╭─ 🔁 이월 누적 (킥오프 재평가 대상)'];
  for (const entry of filtered) {
    const sprintRange =
      entry.sprints.length >= 2
        ? `[${entry.sprints[0]}→${entry.sprints[entry.sprints.length - 1]}]`
        : `[${entry.sprints[0] ?? '?'}]`;
    lines.push(`│ ${entry.id.padEnd(24)} 이월 ${entry.count}회  ${sprintRange}`);
    const reason = entry.lastDeferredReason || '(사유 없음)';
    lines.push(`│   └ 마지막 사유: ${reason}`);
  }
  lines.push('╰─');

  return lines.join('\n');
}

// ──────────────────────────────────────────────
// CLI 진입점 (import 시 자동 실행 안 됨)
// ──────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd();
  const ledger = await aggregateDeferredLedger(root);

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(ledger, null, 2) + '\n');
  } else {
    process.stdout.write(renderDeferredLedgerCard(ledger) + '\n');
  }
  process.exit(0);
}
