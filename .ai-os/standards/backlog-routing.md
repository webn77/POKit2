# Backlog Routing Standard

POKit2 candidate 라우팅의 단일 진실원 정책. POK-137에서 박제.

## 1. 단일 진실원 (Source of Truth)

candidate의 라우팅(어느 sprint로 갈지)은 **카드 frontmatter `sprint:` 필드** 하나로만 표현한다.

```yaml
# projects/pokit/issues/POK-XXX.md
---
id: POK-XXX
sprint: v0.9.0       # ← 라우팅의 유일한 표현
status: candidate
---
```

### 허용값

| 값 | 의미 |
|---|---|
| `v<MAJOR>.<MINOR>.<PATCH>` | 특정 sprint best-guess 지정 (예: `v0.9.0`, `v0.10.0`) |
| `backlog` | 미정 parking. 작업 의도는 있으나 sprint 미지정 |

### 라이프사이클

1. 카드 생성 시 PO가 로드맵을 고려해 best-guess 지정 (`sprint: v0.X.Y` 또는 `backlog`)
2. 다음 sprint scope spec에서 accepted / 재미루기 / drop 확정
3. accepted 시 `release-scope.yaml accepted:` derived view에 등장 (generator로 자동 생성 예정)

## 2. release-scope.yaml 의 책임 (좁힘)

```yaml
sprint: v0.X.Y
goal: "..."
theme: "..."

accepted:        # 카드 frontmatter sprint: 가 본 sprint를 가리키는 candidate의 derived view
  - id: POK-XXX
    status: candidate | gate_passed
    note: "..."

sprint_gate_conditions:   # sprint 종료 조건
  - G1. ...
```

폐지된 섹션:

- `deferred_to_v0_X:` — 카드 frontmatter `sprint:` 와 중복. POK-137에서 삭제.
- 자유서술 아이디어 dump — `docs/research/ideas-parking.md`로 분리.

## 3. 백로그 뷰

글로벌 `backlog.md` 파일은 신설하지 않는다. 다음 두 출처로 충분:

```bash
# 다음 버전 candidate (특정 sprint 지정)
grep "sprint: v0.10.0" projects/pokit/issues/*.md | grep "status: candidate"

# 미정 parking
grep "sprint: backlog" projects/pokit/issues/*.md

# 아이디어 (카드 없음)
cat docs/research/ideas-parking.md
```

`.ai-os/issue-index.md`에 sprint 컬럼이 추가되면 `grep "| candidate |" issue-index.md` 한 줄로 candidate 뷰가 가능하다 (130건 일괄 backfill은 POK-145 sweep).

## 4. 라우팅 결정 트리 (3축 input)

새 candidate / advisory 발견 시 다음 트리를 적용한다.

```text
새 candidate / advisory 발견
───────────────────────────────────────────────

  (1) 현 sprint scope에 자연스럽게 들어가는가?
       ├─ Yes → sprint: v현재버전, accepted 조건 검사 (§5)
       │        (sprint-mid 발견 시 hotfix 분류 검토 — POK-129)
       └─ No  → (2)

  (2) 기존 candidate 카드에 흡수 가능한가?
       │   조건: 같은 영역 / 같은 worker_type / 작업 단위 비대 X
       ├─ Yes → 흡수, 신규 카드 ❌
       │        (예: POK-141에 Tier 4 흡수, POK-094에 split 흡수)
       └─ No  → (3)

  (3) Concrete enough? (작업 단위 분명? AC 가능?)
       ├─ Yes → 신규 카드 + sprint: v다음버전, draft 가능
       │        (예: POK-146 Index Files Derived View)
       └─ No  → (4)

  (4) Ideas Parking
       └─ docs/research/ideas-parking.md
          (작업 의도 생기면 POK 카드 부여 + sprint: backlog)
```

### spec 선행 판정 (3 Yes 이후)

신규 카드가 concrete enough(3 Yes)면, 카드 하나로 충분한지 **spec 이슈를 선행**해야 하는지 판정한다.
판정 기준은 `.ai-os/standards/spec-separation.md`(되돌리기 비용·다중 의존·외부 계약 3종) 하나로만 한다 —
셋 중 하나라도 해당하면 spec 이슈 선행, 아니면 카드 AC로 충분. `/pokit.backlog`는 scope_routing
(`single_issue` vs `spec_needed`)을 이 기준으로 결정한다.

### 3축 input 정의

| 축 | 허용값 |
|---|---|
| `trigger` | 후속 가드 / 회고 / 신규 영역 / 외부 요청 |
| `severity` | 응급 / 일반 |
| `theme_fit` | 부합 / 불부합 |

## 5. 현 sprint accepted 조건

(1)에서 "Yes" 판정 후에도 본 조건을 통과해야 현 sprint `accepted:`로 진입한다.

```text
(theme_fit OR severity=응급)
  AND PO_approval
  AND (follow_up_guard OR real_failure_case)
```

위 조건 미통과 시 → 카드 frontmatter `sprint: v다음버전` 으로 지정 (다음 스프린트 후보).

## 6. 4 사례 적용 결과 (2026-05-25 evidence)

| 사례 | trigger | severity | theme_fit | accepted 조건 | 실제 라우팅 | 트리 판정 |
|---|---|---|---|---|---|---|
| POK-135 (2026-05-25) | 후속 가드 | 일반 | 약 (관측성 vs 휘발방지) | follow_up_guard ✓ + PO_approval ✓ | v0.8.0 accepted | (1) Yes — 약 theme_fit 이지만 follow_up_guard + 실 발생 사례로 통과 |
| POK-132/133/134 (2026-05-24) | 신규 영역 | 일반 | 불부합 | 미통과 | v0.8.0 deferred (POK-137 통과 후 sprint: v0.9.0) | (1) No → (3) Yes → 신규 카드 sprint: v0.9.0 |
| POK-129 (2026-05-24) | 회고 | 일반 | 불부합 | 미통과 | 이중 등록 (frontmatter + deferred) — POK-137 위반 사례 | (3) Yes → 신규 카드 sprint: v0.9.0, deferred 섹션 등록 ❌ |
| POK-136/137 (2026-05-25) | 회고 | 일반 | 불부합 | 미통과 | v0.8.0 deferred (POK-137 통과 후 sprint: v0.9.0) | (1) No → (3) Yes → 신규 카드 sprint: v0.9.0 |

## 7. Doctor 가드 (warn only)

`scripts/pokit-doctor.mjs` 에서 본 표준 위반을 감지한다. fail 승격은 v0.10 운영 검증 후 검토.

| Check key | 동작 | 트리거 |
|---|---|---|
| `candidate_unrouted` | warn | candidate 상태 카드에 `sprint:` 필드가 없을 때 |
| `deferred_to_X_regression` | warn | 임의 `release-scope.yaml` 에 `deferred_to_v0_` 키 등장 시 |

`forward_to_v0_X` 같은 historical 잔재 키는 본 표준 doctor warn 범위 밖이며, POK-145 sweep에서 처리한다.

## 8. communication.md Section 7 연동

Sprint Close Summary 의 "남은 것 (다음 버전 candidate)" 출처가 본 표준에 따라 변경된다:

```text
이전: release-scope.yaml deferred_to_v0_X 블록
이후: grep "sprint: v<next>" projects/pokit/issues/*.md + docs/research/ideas-parking.md
```

## 9. POK-149 (v0.10) 와의 관계

POK-149 Ideation 4-layer 도입 시 `docs/research/ideas-parking.md`는 `docs/ideas/PARKING.md`로 이관 예정. 본 표준 §3 출처 경로는 그때 함께 갱신한다.

## Provenance

- Source: POK-137 Backlog Routing Standard (v0.9.0)
- PO 결정: 2026-05-25 "2곳에서 관리하는건 잘못된거 맞다"
- Opus 2차 리뷰: simpler-is-better 5 보정 반영
- Out of scope (POK-091/POK-145 위임): 130 카드 sprint backfill, historical sprint 정규화
