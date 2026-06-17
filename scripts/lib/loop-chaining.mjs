// POK-353 — loop 첫 적용: 자율 이음새 체이닝 + 멈춤조건 4종.
//
// 경계 근거(POK-351 sprint-loop-boundary-spec.md): 자율 이음새는 safe-step-policy의
// 🟢(code_change·verify·commit·proposal)만이다. 사람 게이트(🔴 push·gate_pass·release·
// scope_change)는 체인에서 영구 제외 — 자동화 금지(포킷 거버넌스 해자).
//
// 이 모듈은 조합층(composer)이다. 큐 소진은 readReleaseScope, retro 표면화는
// deferred-ledger, 게이트 분류는 safe-step-policy에 위임한다. 새로 정의하는 것은
// (1) 자율/사람게이트 경계로 거른 체인, (2) 멈춤조건 4종 평가기, (3) 반복 상한 강제다.
//
// 반복 상한(AC3): spec은 gate_reopen_count ≥ N을 명명했으나 그 카운터는 수동 플래그로만
// 증가한다(자동 증가 경로 없음 → 실사용에서 사문). 실제 자동 누적 신호는
// failure_context.attempt(같은 이슈 record-failure 시 +1, gate-pass가 verification_failures로
// 승격). 따라서 attempt를 1차 신호로, gate_reopen_count를 OR 보조로 받아 spec 연속성을 보존한다.
// (PO 결정 2026-06-16 '그러자고' — advisor 검증으로 사문 함정 확인.)

import { classifyStepSignal } from './safe-step-policy.mjs';

export const STOP_CONDITION = Object.freeze({
  QUEUE_DRAINED: 'queue_drained', // 큐 소진 — 정상 종료
  PO_HALT: 'po_halt', // PO 중단 — 사람 개입
  GATE_FAIL: 'gate_fail', // 게이트 미통과 — 다음 이슈 gate fail(결함)
  REOPEN_LIMIT: 'reopen_limit', // 반복 상한 — 결함 신호
});

// 반복 상한 임계 (N=3, PO 결정 2026-06-16).
export const REOPEN_LIMIT_N = 3;

/**
 * 자율 이음새만 이어 붙인다. 첫 사람 게이트(🔴)에서 체인을 끊는다 (AC1).
 * safe-step-policy를 근거로 삼아 '자율 이음새 목록'을 손으로 관리하지 않는다 —
 * 그래야 경계 drift가 구조적으로 불가능하다.
 *
 * @param {string[]} steps
 * @param {object} [opts] classifyStepSignal 옵션
 * @returns {string[]} 🟢 단계만, 첫 🔴 직전까지
 */
export function filterAutonomousChain(steps = [], opts = {}) {
  const chain = [];
  for (const step of steps) {
    const sig = classifyStepSignal(step, opts);
    if (sig.requires_human) break;
    chain.push(sig.step);
  }
  return chain;
}

/**
 * 체인에 사람 게이트(🔴)가 하나도 없으면 true (AC1 거버넌스 경계 증명).
 * @param {string[]} steps
 * @param {object} [opts]
 * @returns {boolean}
 */
export function chainExcludesHumanGate(steps = [], opts = {}) {
  return !steps.some((step) => classifyStepSignal(step, opts).requires_human);
}

/**
 * 멈춤조건 4종 평가 (AC2/AC3/AC5). 하나라도 걸리면 멈춤 결과, 아니면 null(계속).
 * 우선순위: PO 중단 > 게이트 미통과 > 반복 상한 > 큐 소진.
 *
 * @param {object} args
 * @param {boolean} [args.poHalt]            PO 중단(mode c)
 * @param {string|null} [args.gateFailReason] 게이트 미통과 — 다음 이슈 gate fail(doctor fail 아님)
 * @param {number} [args.reopenAttempt]       failure_context.attempt — 자동 누적 신호
 * @param {number} [args.gateReopenCount]     수동 플래그 — OR 보조
 * @param {number|null} [args.candidateCount] 남은 후보 수. 0이면 큐 소진
 * @param {number} [args.reopenLimit]         반복 상한 N (기본 REOPEN_LIMIT_N)
 * @returns {{condition: string, requiresHuman: boolean, defect: boolean}|null}
 */
export function evaluateStopCondition({
  poHalt = false,
  gateFailReason = null,
  reopenAttempt = 0,
  gateReopenCount = 0,
  candidateCount = null,
  reopenLimit = REOPEN_LIMIT_N,
} = {}) {
  if (poHalt) {
    return { condition: STOP_CONDITION.PO_HALT, requiresHuman: true, defect: false };
  }
  if (gateFailReason) {
    return {
      condition: STOP_CONDITION.GATE_FAIL,
      requiresHuman: true,
      defect: true,
      reason: String(gateFailReason),
    };
  }
  const reopen = Math.max(toCount(reopenAttempt), toCount(gateReopenCount));
  if (reopen >= reopenLimit) {
    return {
      condition: STOP_CONDITION.REOPEN_LIMIT,
      requiresHuman: true,
      defect: true,
      count: reopen,
      limit: reopenLimit,
    };
  }
  if (candidateCount === 0) {
    return { condition: STOP_CONDITION.QUEUE_DRAINED, requiresHuman: true, defect: false };
  }
  return null;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const STOP_LABELS = Object.freeze({
  [STOP_CONDITION.QUEUE_DRAINED]: '큐 소진',
  [STOP_CONDITION.PO_HALT]: 'PO 중단',
  [STOP_CONDITION.GATE_FAIL]: '게이트 미통과',
  [STOP_CONDITION.REOPEN_LIMIT]: '반복 상한',
});

/**
 * 멈춤 결과를 사람에게 넘기는 카드로 표면화한다 (AC6).
 * deferred-ledger 카드 패턴(╭─ … ╰─ ASCII 박스)을 재사용한다 — 신규 표면 금지.
 *
 * @param {{condition: string, defect: boolean, count?: number, limit?: number, reason?: string}} stop
 * @returns {string}
 */
export function renderStopConditionCard(stop) {
  if (!stop) return '';
  const label = STOP_LABELS[stop.condition] ?? stop.condition;
  const lines = [];
  if (stop.defect) {
    lines.push('╭─ ⚠️ loop 멈춤 — 결함 신호 (사람 호출)');
  } else {
    lines.push('╭─ 🔁 loop 멈춤 — 사람에게 넘김');
  }
  lines.push('│');
  lines.push(`│ 멈춤조건  ${label}`);
  if (stop.condition === STOP_CONDITION.REOPEN_LIMIT) {
    lines.push(`│ 반복      ${stop.count}회 ≥ 상한 ${stop.limit} — 정상 종료 아님`);
  }
  if (stop.condition === STOP_CONDITION.GATE_FAIL && stop.reason) {
    lines.push(`│ 사유      ${stop.reason}`);
  }
  if (stop.condition === STOP_CONDITION.QUEUE_DRAINED) {
    lines.push('│ 상태      후보 큐 비었음 — 자율 종료, 다음 판단은 사람');
  }
  lines.push('│');
  lines.push('├─ 다음');
  lines.push('│   사람이 확인 후 이어갑니다. 자율 체이닝은 여기서 멈춥니다.');
  lines.push('╰─');
  return lines.join('\n');
}

/**
 * 두 자율 이음새(다음후보·retro 표면화)를 한 번에 연속 출력한다 (자동 체이닝 동작 ①).
 * 이미 렌더된 카드 문자열을 받는다 — 큐/집계 로직은 호출부(runner)가 위임 호출한다.
 *
 * @param {{candidateCard?: string|null, retroCard?: string|null}} cards
 * @returns {string}
 */
export function buildChainedSurfacing({ candidateCard = null, retroCard = null } = {}) {
  return [candidateCard, retroCard].filter(Boolean).join('\n\n');
}

/**
 * loop 한 틱: 멈춤조건 평가 → 걸리면 멈춤 카드(사람 호출), 아니면 두 이음새 연속 출력.
 *
 * @param {object} args
 * @param {object} args.stopInputs              evaluateStopCondition 입력
 * @param {string|null} [args.candidateCard]    렌더된 다음후보 카드
 * @param {string|null} [args.retroCard]        렌더된 retro 표면화 카드
 * @returns {{halted: boolean, stop: object|null, card: string}}
 */
export function runLoopTick({ stopInputs = {}, candidateCard = null, retroCard = null } = {}) {
  const stop = evaluateStopCondition(stopInputs);
  if (stop) {
    return { halted: true, stop, card: renderStopConditionCard(stop) };
  }
  return { halted: false, stop: null, card: buildChainedSurfacing({ candidateCard, retroCard }) };
}
