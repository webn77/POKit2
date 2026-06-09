#!/usr/bin/env node
/**
 * PreToolUse 훅 — 이슈 없는 durable 작업 차단.
 *
 * 설계 계약: starter safety floor contract (active issue before durable mutation)
 *
 * ALLOW = exit 0, 아무것도 출력 안 함 (permissionDecision:"allow" 절대 출력 금지)
 * DENY  = hookSpecificOutput JSON stdout 출력 후 exit 0
 *
 * 이 훅은 러너(추론 1순위)의 백스톱(예방 2순위)이다.
 * 러너를 경유하지 않은 durable 작업(raw 도구 직접 호출)만 잡는다.
 *
 * 주의(과신 금지) — 이것은 "예방·안내" 레버지 un-bypassable 강제 벽이 아니다.
 * git 훅처럼 우회 가능하다: 내부 오류 시 fail-open(통과), settings.json은 편집 가능,
 * 에이전트는 자기 도구 호출을 스스로 제어한다. "DENY=차단"을 강제로 과신하지 말 것.
 * 진짜 강제는 3단 사다리의 합(추론 안내 + 예방 마찰 + 탐지 tamper-evident)이고,
 * 진짜 벽은 능력경계/외부 키 서명뿐이다(.ai-os/standards/guard-priority-ladder.md).
 * 목표는 tamper-proof(완벽 차단)가 아니라 올바른 경로를 가장 쉽게 만드는 것.
 */

import { hasActiveIssue, renderDraftCard } from '../active-issue-guard.mjs';
import { ISSUE_ID_PATTERN } from '../pokit-project-contract.mjs';
import { classifyTaskScope, TASK_SCOPE } from '../lib/task-scope-classifier.mjs';

// ── durable 경로 분류 ──────────────────────────────────────────────────────────

/**
 * Write/Edit 도구의 file_path가 durable 경로인지 판정한다.
 * durable = 소스·데이터 흔적을 남기는 파일 확장자 또는 경로.
 *
 * @param {string} fp - file_path
 * @returns {boolean}
 */
function isDurableFilePath(fp) {
  if (!fp || typeof fp !== 'string') return false;

  // durable 디렉토리 prefix
  const durablePrefixes = [
    'projects/',
    'docs/',
    'artifacts/',
    '.ai-os/',
  ];
  for (const prefix of durablePrefixes) {
    if (fp.startsWith(prefix) || fp.includes(`/${prefix}`)) return true;
  }

  // 코드·설정·문서 파일 확장자
  const durableExtensions = [
    '.mjs', '.js', '.ts', '.cjs', '.mts', '.cts',
    '.json', '.yaml', '.yml',
    '.md', '.mdx',
    '.toml', '.ini', '.cfg', '.conf',
    '.sh', '.bash', '.zsh',
    '.html', '.css', '.scss',
    '.py', '.rb', '.go', '.rs',
  ];
  const lower = fp.toLowerCase();
  return durableExtensions.some((ext) => lower.endsWith(ext));
}

/**
 * Bash 명령이 durable(쓰기) 명령인지 판정한다.
 * 순수 읽기(cat, ls, grep, rg, node doctor 등)는 false.
 *
 * @param {string} cmd
 * @returns {boolean}
 */
function isDurableBashCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;

  // git commit / git push
  if (/\bgit\s+(commit|push)\b/.test(cmd)) return true;

  // redirect: > 또는 >>  (< 는 stdin이므로 제외)
  // ">=" / "<=" 는 비교연산자이므로 제외 → ">>" (append) 는 ">" 뒤에 ">"가 오므로
  // >>?(?!=) 패턴에서 ">>" 의 마지막 ">" 뒤에 "="가 없으면 통과 → durable 유지.
  // 즉 ">=" → 마지막 ">" 뒤가 "=" → 제외, ">>" → 마지막 ">" 뒤가 없거나 공백 → 통과.
  if (/(?:^|[^<])[^<]>>?(?!=)/.test(cmd)) return true;

  // tee (stdout을 파일로 쓰기)
  if (/\btee\b/.test(cmd)) return true;

  // cp, mv: 파일을 복사·이동 (durable 흔적)
  if (/\b(cp|mv)\s/.test(cmd)) return true;

  // install: 파일 설치
  if (/\binstall\b/.test(cmd)) return true;

  // npm publish / yarn publish
  if (/\b(npm|yarn|pnpm)\s+publish\b/.test(cmd)) return true;

  // mkdir: 디렉토리 생성도 durable
  if (/\bmkdir\b/.test(cmd)) return true;

  // curl/wget로 파일 쓰기
  if (/\b(curl|wget)\b.*(-o|-O)\b/.test(cmd)) return true;

  return false;
}

// ── 부트스트랩 화이트리스트 ───────────────────────────────────────────────────

/**
 * 이슈 0개 부트스트랩 화이트리스트 경로인지 판정한다.
 * (1) 이슈 생성 경로 — pokit-issue-create / pokit.backlog / 이슈 파일 신규 생성
 * (2) common/COM 버킷 대상
 *
 * @param {{ tool_name: string, tool_input: object }} payload
 * @returns {boolean}
 */
function isBootstrapWhitelisted(payload) {
  const toolName = payload.tool_name ?? '';
  const toolInput = payload.tool_input ?? {};

  if (toolName === 'Write' || toolName === 'Edit') {
    const fp = toolInput.file_path ?? '';
    // 이슈 파일 신규 생성 경로: projects/*/issues/<ID>.md
    if (/projects\/[^/]+\/issues\/[A-Z][A-Z0-9]*-\d{3,}\.md$/.test(fp)) return true;
    // COM 버킷 경로
    if (/projects\/common\//.test(fp)) return true;
    if (/\.ai-os\/COM-\d/.test(fp)) return true;
  }

  if (toolName === 'Bash') {
    const cmd = toolInput.command ?? '';
    // 이슈 생성 명령
    if (/pokit-issue-create/.test(cmd)) return true;
    if (/pokit\.backlog/.test(cmd)) return true;
    if (/pokit-issue-use/.test(cmd)) return true;
    // COM 버킷 자동초안 유도
    if (/\bCOM-/.test(cmd)) return true;
  }

  if (toolName === 'Task') {
    const desc = (toolInput.description ?? toolInput.prompt ?? '').toLowerCase();
    if (desc.includes('pokit-issue-create') || desc.includes('pokit.backlog')) return true;
    if (desc.includes('com-') || desc.includes('common 이슈')) return true;
  }

  return false;
}

// ── 판정 로직 ─────────────────────────────────────────────────────────────────

/**
 * 동기 판정 (디스크 미확인).
 * durable 여부만 판별. active_issue 확인은 decideAsync가 처리.
 *
 * @param {object} payload - PreToolUse JSON payload
 * @returns {{ decision: 'allow'|'check_active_issue', workSummary: string }}
 */
export function decide(payload) {
  if (!payload || typeof payload !== 'object') {
    return { decision: 'allow', workSummary: '' };
  }

  const toolName = payload.tool_name ?? '';
  const toolInput = payload.tool_input ?? {};

  let isDurable = false;
  let workSummary = '';

  if (toolName === 'Write' || toolName === 'Edit') {
    const fp = toolInput.file_path ?? '';
    isDurable = isDurableFilePath(fp);
    workSummary = `${toolName} ${fp}`;
  } else if (toolName === 'Bash') {
    const cmd = toolInput.command ?? '';
    isDurable = isDurableBashCommand(cmd);
    workSummary = `Bash: ${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''}`;
  } else if (toolName === 'Task') {
    const taskScope = classifyTaskScope(payload);
    // Hook allow/deny is not runtime execution proof. Only explicit read_only
    // exploration bypasses the active-issue durable-work guard; unknown stays guarded.
    isDurable = taskScope !== TASK_SCOPE.READ_ONLY;
    const desc = toolInput.description ?? toolInput.prompt ?? 'Task 실행';
    workSummary = `Task(${taskScope}): ${String(desc).slice(0, 80)}`;
  }

  if (!isDurable) {
    return { decision: 'allow', workSummary };
  }

  // 부트스트랩 화이트리스트
  if (isBootstrapWhitelisted(payload)) {
    return { decision: 'allow', workSummary };
  }

  return { decision: 'check_active_issue', workSummary };
}

/**
 * 비동기 판정 — hasActiveIssue 디스크 확인 포함.
 *
 * @param {object} payload - PreToolUse JSON payload
 * @param {string} root - 프로젝트 루트 (기본: process.cwd())
 * @returns {Promise<{ decision: 'allow'|'deny', reason?: string }>}
 */
export async function decideAsync(payload, root = process.cwd()) {
  const sync = decide(payload);

  if (sync.decision === 'allow') {
    return { decision: 'allow' };
  }

  // check_active_issue: 디스크에서 실제 확인
  const hasIssue = await hasActiveIssue(root);
  if (hasIssue) {
    return { decision: 'allow' };
  }

  // active_issue 없음 → DENY + renderDraftCard
  const reason = renderDraftCard({}, sync.workSummary);
  return { decision: 'deny', reason };
}

// ── I/O 레이어 ────────────────────────────────────────────────────────────────

function outputDeny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n',
  );
}

function outputAllow() {
  // IMPORTANT: ALLOW 시 아무것도 출력하지 않는다.
  // permissionDecision:"allow" JSON을 출력하면 Claude Code의 정상 권한 체계를 우회해
  // 모든 Write/Edit/Bash 도구를 자동 승인시킨다 — 절대 출력 금지.
}

async function main() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
  } catch {
    // stdin 오류 → fail-open (allow)
    outputAllow();
    return;
  }

  if (!raw.trim()) {
    outputAllow();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // 파싱 실패 → fail-open (allow)
    outputAllow();
    return;
  }

  let result;
  try {
    result = await decideAsync(payload, process.cwd());
  } catch {
    // 내부 오류 → fail-open (allow)
    outputAllow();
    return;
  }

  if (result.decision === 'deny') {
    outputDeny(result.reason ?? '이슈를 먼저 생성하고 활성화해 주세요.');
  } else {
    outputAllow();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
