/**
 * hook-floor.mjs — 얇은 프로젝트 안전바닥 훅 단일 출처 (POK-347)
 *
 * 배경:
 *  본체(.claude/settings.json)는 `node scripts/hooks/X.mjs` 상대경로로 훅을 돌린다.
 *  그런데 v0.19 얇은 토폴로지 전환으로 프로젝트엔 scripts/가 없다(본체 한 벌). 프로젝트에
 *  훅 스크립트를 다시 까는 방식은 v0.19를 되돌리는 것 — 금지(POK-347 AC3).
 *
 * 해법:
 *  프로젝트 .claude/settings.json의 훅 명령이 파일이 아니라 `pokit hook-floor <script>`를
 *  부른다. bin이 글로벌 본체 위치(resolvePackageRoot)에서 훅 스크립트를 찾아 실행하므로,
 *  프로젝트엔 스크립트 파일 0개 · 얇은 포인터만 남는다 (AGENTS.md·스킬이 본체를 가리키는 구조와 동일).
 *
 * 이 모듈이 "이벤트 → matcher → 본체 훅 스크립트" 매핑의 단일 출처다:
 *  - buildResidueSettings(): writeResidue가 프로젝트 settings.json을 생성/병합할 때 사용
 *  - resolveHookScriptPath(): bin hook-floor 디스패치가 본체 스크립트 경로를 찾을 때 사용
 *  - listFloorScripts(): drift 가드 테스트가 본체 .claude/settings.json과 대조할 때 사용
 *
 * 안전바닥 = 본체 4개 훅 그대로 (PO 승인 2026-06-15: "본체 한 벌" 유지 — 얇은 프로젝트도
 * 같은 바닥을 갖되 한 곳에서 관리해 본체와 안 갈림).
 */

import path from 'node:path';

/**
 * 안전바닥 훅 스펙. 각 행 = 프로젝트 settings.json의 훅 항목 하나.
 * 본체 .claude/settings.json과 동일한 (event, matcher, script) 집합이어야 한다.
 * (drift 가드 테스트가 이 동일성을 강제한다 — 본체에 훅이 추가되면 여기도 갱신해야 통과.)
 */
export const HOOK_FLOOR_SPEC = Object.freeze([
  Object.freeze({ event: 'SessionStart', matcher: null, script: 'session-start' }),
  Object.freeze({ event: 'PreToolUse', matcher: 'Write|Edit', script: 'block-issue-card-write' }),
  Object.freeze({ event: 'PreToolUse', matcher: 'Bash', script: 'block-issue-card-write' }),
  Object.freeze({ event: 'PreToolUse', matcher: 'Task', script: 'require-plan-before-dispatch' }),
  Object.freeze({ event: 'PostToolUse', matcher: 'Write|Edit', script: 'reissue-issue-authored' }),
]);

// 본체 훅 스크립트 기준 디렉토리 (packageRoot 기준).
const HOOK_DIR_SEGMENTS = ['scripts', 'hooks'];

/**
 * 안전바닥에 포함된 훅 스크립트 basename 집합 (정렬·중복 제거).
 * drift 가드 + resolveHookScriptPath 허용 목록의 단일 출처.
 *
 * @returns {string[]}
 */
export function listFloorScripts() {
  return [...new Set(HOOK_FLOOR_SPEC.map((entry) => entry.script))].sort();
}

/**
 * 훅 스크립트 basename → 본체 절대경로.
 * 허용 목록(HOOK_FLOOR_SPEC) 밖 이름은 거부한다 — 임의 스크립트 실행 방지(길목 가드).
 *
 * @param {string} packageRoot 글로벌 본체 패키지 루트
 * @param {string} scriptName 훅 스크립트 basename (확장자 없음)
 * @returns {string} 본체 훅 스크립트 절대경로
 */
export function resolveHookScriptPath(packageRoot, scriptName) {
  if (!listFloorScripts().includes(scriptName)) {
    throw new Error(`unknown hook-floor script: ${scriptName}`);
  }
  return path.join(packageRoot, ...HOOK_DIR_SEGMENTS, `${scriptName}.mjs`);
}

/**
 * 한 훅 항목이 안전바닥(pokit hook-floor) 항목인지 판별한다.
 * 사용자가 직접 추가한 훅과 도구 소유 안전바닥 훅을 구분하기 위함.
 *
 * @param {any} entry settings.json hooks[event] 배열의 항목
 * @returns {boolean}
 */
function entryIsFloor(entry) {
  const list = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return list.some(
    (hook) => typeof hook?.command === 'string' && hook.command.includes('hook-floor'),
  );
}

/**
 * 안전바닥만 담은 settings.json 객체를 생성한다.
 * 훅 명령은 `<binName> hook-floor <script>` — 프로젝트엔 스크립트 0개, 본체 참조만.
 *
 * @param {string} [binName='pokit'] npm bin 이름
 * @returns {{ hooks: Record<string, Array<object>> }}
 */
export function buildResidueSettings(binName = 'pokit') {
  const hooks = {};
  for (const { event, matcher, script } of HOOK_FLOOR_SPEC) {
    if (!hooks[event]) hooks[event] = [];
    const entry = {};
    if (matcher) entry.matcher = matcher;
    entry.hooks = [{ type: 'command', command: `${binName} hook-floor ${script}` }];
    hooks[event].push(entry);
  }
  return { hooks };
}

/**
 * 안전바닥 훅을 기존 settings 객체에 병합한다 (멱등).
 *  - 사용자 소유 훅(다른 이벤트, 또는 같은 이벤트의 비-안전바닥 항목)은 보존(§4 소유권 경계).
 *  - 기존 안전바닥 항목(stale 포함)은 걷어내고 현재 스펙으로 재배치.
 *  - hooks 외 다른 settings 키는 그대로 둔다.
 *
 * fresh 설치(기존 파일 없음) → 안전바닥만. 기존 파일 있음 → 사용자 훅 유지 + 안전바닥 보장.
 *
 * @param {any} existing 기존 settings.json 파싱 결과(없으면 null)
 * @param {string} [binName='pokit']
 * @returns {object} 병합된 settings 객체
 */
export function mergeFloorIntoSettings(existing, binName = 'pokit') {
  const settings = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing }
    : {};
  const floor = buildResidueSettings(binName);
  const existingHooks = settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
    ? settings.hooks
    : {};
  const hooks = { ...existingHooks };

  for (const event of Object.keys(floor.hooks)) {
    const userEntries = Array.isArray(hooks[event])
      ? hooks[event].filter((entry) => !entryIsFloor(entry))
      : [];
    // 안전바닥 항목을 앞에, 사용자 항목을 뒤에 — 바닥이 먼저 평가되도록.
    hooks[event] = [...floor.hooks[event], ...userEntries];
  }

  settings.hooks = hooks;
  return settings;
}
