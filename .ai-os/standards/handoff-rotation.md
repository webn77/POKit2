# Handoff Rotation Policy

> **범위**: 스프린트 없는 프로젝트의 `handoff.md` 회전 정책 + 스프린트 있는 프로젝트 보완

---

## 1. 회전 결정 트리

```
handoff.md 회전이 필요한가?
│
├── active_sprint 있음?
│   ├── YES → 스프린트 클로즈 시 회전 (기존 패턴 유지)
│   │         archive: handoff-<sprint>.md (예: handoff-v0.16.0.md)
│   └── NO  → 아래 스프린트 없는 트리거 확인
│
└── 스프린트 없는 트리거 (아래 중 하나라도 해당하면 회전 권장)
    ├── [T1] 이슈 완료: gate_passed 이슈가 N건 이상 쌓임 (기본 N=5)
    ├── [T2] 날짜 주기: 마지막 회전 후 D일 경과 (기본 D=30)
    └── [T3] 크기 임계: handoff.md가 L줄 초과 (기본 L=100)
         ↓
         doctor 경고 → PO 확인 → 수동 회전 실행
```

---

## 2. Archive 파일명 컨벤션

**권장: 날짜 기반**
```
.ai-os/memory/session/archive/handoff-<YYYY-MM-DD>.md
예: handoff-2026-06-09.md
```

기존 glob `handoff-v*.md`와 겹치지 않음. 날짜가 명확해 조회 용이.

**Archive Pointer 섹션 갱신 규칙**:
회전 후 `handoff.md`의 `## Archive Pointer` 섹션에 새 항목을 추가한다.
```markdown
- <YYYY-MM-DD>: `.ai-os/memory/session/archive/handoff-<YYYY-MM-DD>.md`
```

---

## 3. 트리거별 임계값 기본값

| 트리거 | 기본값 | 비고 |
|--------|--------|------|
| T1 이슈 완료 건수 | 5건 | gate_passed 이슈 누적 기준 |
| T2 날짜 주기 | 30일 | 마지막 회전 또는 세션 시작일 기준 |
| T3 크기 | 100줄 | handoff.md 전체 줄 수 기준 |

임계값은 프로젝트 특성에 따라 조정 가능. 조정 시 프로젝트 AGENTS.md 또는 `.ai-os/current.md` 주석에 명시.

---

## 4. 재시작 복구 보장

회전 후 다음 두 가지가 보장되어야 한다:

1. `node scripts/pokit-doctor.mjs` fail=0
2. startup read 3종만으로 컨텍스트 완전 복원:
   - `AGENTS.md` → 진입점
   - `.ai-os/current.md` → `active_issue`, `gate_state`, `active_project`
   - `.ai-os/memory/session/handoff.md` → `Active Snapshot` (next action)

회전 후 `handoff.md`의 `## Active Snapshot`은 반드시 최신 상태를 유지해야 한다. 과거 Sprint Memory는 archive로 이동해도 되지만, Active Snapshot과 Startup Boundary는 `handoff.md`에 남긴다.

---

## 5. 수동 회전 절차

doctor 경고 또는 PO 판단 시 아래 순서로 수행한다.

```bash
# 1. archive 파일 생성 (현재 handoff.md 복사)
cp .ai-os/memory/session/handoff.md \
   .ai-os/memory/session/archive/handoff-$(date +%Y-%m-%d).md

# 2. handoff.md를 슬림하게 재작성
#    Active Snapshot + Startup Boundary + Archive Pointer 유지
#    Sprint Memory는 핵심 요약만 남기거나 archive 참조로 대체

# 3. Archive Pointer 갱신
#    handoff.md ## Archive Pointer에 새 항목 추가

# 4. 검증
node scripts/pokit-doctor.mjs
```
