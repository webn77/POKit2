// POK-344 (POK-259 흡수) — main session 토큰 수집기.
//
// 배경: 플랫폼(Claude Code)은 main 세션 자신의 토큰 usage를 스크립트에 직접 노출하지
// 않는다. 그래서 v0.16~v0.19 내내 metrics.main_tokens_collected=false(미수집)가 기본값으로
// 남았다. 다만 Claude Code는 세션 transcript를
//   <homeDir>/.claude/projects/<encoded-cwd>/<claude-session-uuid>.jsonl
// 에 남기고, assistant message마다 message.usage(input/output/cache 토큰)가 들어 있다.
// 이 transcript의 usage를 합산하면 main 세션 토큰을 사후 산출할 수 있다.
//
// 정직성 원칙(metrics는 정직한 실제값): transcript를 못 찾거나 못 읽으면 가짜 0이 아니라
// 미수집(collected:false, 0)으로 정직하게 구분한다. 수집 성공 시에만 collected:true.
//
// Open Questions (POK-259 draft → 본 이슈에서 해소):
//  - (Q1) 비캐시 input 판별: transcript usage가 input_tokens(신규)·cache_read_input_tokens
//    (캐시 재사용)·cache_creation_input_tokens(캐시 적재)를 분리 제공한다. 그대로 분리 집계.
//  - (Q2) 수집 실패 graceful: claude-session-uuid를 스크립트가 직접 알 수 없으므로(POKIT_SESSION_ID는
//    POKit 내부 세션ID라 transcript 파일명과 다름) 프로젝트 디렉터리의 최신-mtime jsonl을
//    현재 세션으로 본다. 디렉터리/파일 부재 시 throw 없이 collected:false로 반환.

import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// cwd → Claude Code transcript 디렉터리명. 절대경로의 '/'와 '.'를 '-'로 치환한다.
// 예: 절대경로 /a/b.c/proj → -a-b-c-proj
export function encodeProjectDir(cwd) {
  return String(cwd).replace(/[/.]/g, '-');
}

function emptyResult(source = null) {
  return {
    main_tokens_collected: false,
    main_total_tokens: 0,
    non_cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    message_count: 0,
    source,
  };
}

// 현재 세션 transcript 경로를 해석한다. transcriptPath가 명시되면 그대로,
// 아니면 프로젝트 디렉터리의 최신-mtime jsonl(현재 세션 추정). 없으면 null.
export async function resolveTranscriptPath({
  cwd = process.cwd(),
  homeDir = os.homedir(),
  transcriptPath = null,
} = {}) {
  if (transcriptPath) {
    try {
      await stat(transcriptPath);
      return transcriptPath;
    } catch {
      return null;
    }
  }
  const dir = path.join(homeDir, '.claude', 'projects', encodeProjectDir(cwd));
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  let best = null;
  let bestMtime = -1;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    try {
      const s = await stat(full);
      if (s.mtimeMs > bestMtime) {
        bestMtime = s.mtimeMs;
        best = full;
      }
    } catch {
      // skip unreadable
    }
  }
  return best;
}

// transcript usage를 합산해 main 세션 토큰을 산출한다.
// 반환: { main_tokens_collected, main_total_tokens, non_cached_input_tokens,
//         cache_creation_input_tokens, cached_input_tokens, output_tokens, message_count, source }
export async function collectMainSessionTokens({
  cwd = process.cwd(),
  homeDir = os.homedir(),
  transcriptPath = null,
} = {}) {
  const resolved = await resolveTranscriptPath({ cwd, homeDir, transcriptPath });
  if (!resolved) return emptyResult(null);

  let text;
  try {
    text = await readFile(resolved, 'utf8');
  } catch {
    return emptyResult(null);
  }

  let nonCached = 0;
  let cacheCreate = 0;
  let cached = 0;
  let output = 0;
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = record?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    nonCached += num(usage.input_tokens);
    cacheCreate += num(usage.cache_creation_input_tokens);
    cached += num(usage.cache_read_input_tokens);
    output += num(usage.output_tokens);
    count += 1;
  }

  // usage 엔트리가 하나도 없으면 transcript는 있었으나 실측 불가 — 미수집으로 정직 구분.
  if (count === 0) return emptyResult(path.basename(resolved));

  // main_total_tokens = 신규 토큰(비캐시 input + 캐시 적재 + output)만 합산한다.
  // 캐시 재사용(cache_read_input_tokens)은 같은 컨텍스트를 메시지마다 누적 재읽기한 값이라
  // 긴 세션에선 총합을 압도해 "사용량"을 오도한다(예: 본 세션 106M 중 103M이 캐시 재사용).
  // 그래서 total에서 제외하고 cached_input_tokens로 분리 투명 공개한다 — 둘 다 정직한 실측값.
  const main_total_tokens = nonCached + cacheCreate + output;

  // 정직성(D2): 실작업은 항상 토큰을 쓴다. usage 엔트리가 있는데 신규 토큰 합이 0이면
  // 정상 수집이 아니라 측정 이상이므로, collected:true + 0(가짜 0)으로 박지 않고 미수집으로 돌린다.
  if (main_total_tokens === 0) return emptyResult(path.basename(resolved));
  return {
    main_tokens_collected: true,
    main_total_tokens,
    non_cached_input_tokens: nonCached,
    cache_creation_input_tokens: cacheCreate,
    cached_input_tokens: cached,
    output_tokens: output,
    message_count: count,
    source: path.basename(resolved),
  };
}

// v0.19 디스패치 1차 전멸(워커가 0~369 토큰에 즉사) 재발 인지 수단.
// subagent usage 엔트리에서 조기 종료(한도 즉사 등) 의심 항목을 플래그한다.
// 판정이 아니라 신호: total_tokens가 임계 미만이거나 tool_uses가 0이면 의심으로 표시.
export function detectWorkerEarlyExit(subagents, { minTokens = 500 } = {}) {
  if (!Array.isArray(subagents)) return [];
  return subagents
    .map((s, index) => {
      const totalTokens = num(s?.total_tokens ?? s?.subagent_tokens);
      const toolUses = s?.tool_uses;
      // tool_uses가 undefined(미측정)면 zero_tool_uses로 보지 않는다 — 0(실제 0회)만 신호.
      const suspected =
        totalTokens < minTokens || toolUses === 0;
      return {
        index,
        model: String(s?.model ?? 'unknown'),
        worker_type: String(s?.worker_type ?? s?.worker_kind ?? 'unknown'),
        total_tokens: totalTokens,
        tool_uses: toolUses,
        suspected_early_exit: suspected,
        reason: totalTokens < minTokens ? 'low_tokens' : toolUses === 0 ? 'zero_tool_uses' : null,
      };
    })
    .filter((s) => s.suspected_early_exit);
}

// CLI: 현재 세션 main 토큰을 정직 집계해 출력. --json 이면 JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  const json = process.argv.includes('--json');
  const result = await collectMainSessionTokens({ cwd: process.cwd() });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.main_tokens_collected) {
    process.stdout.write(
      `main_tokens_collected: true\n` +
        `main_total_tokens: ${result.main_total_tokens}\n` +
        `  비캐시 input: ${result.non_cached_input_tokens}\n` +
        `  캐시 적재:   ${result.cache_creation_input_tokens}\n` +
        `  캐시 재사용: ${result.cached_input_tokens}\n` +
        `  output:      ${result.output_tokens}\n` +
        `  메시지 수:   ${result.message_count}\n` +
        `  source:      ${result.source}\n`,
    );
  } else {
    process.stdout.write('main_tokens_collected: false (미수집 — transcript 없음/식별 불가)\n');
  }
}
