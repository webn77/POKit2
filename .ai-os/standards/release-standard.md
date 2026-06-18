# Release Standard

릴리즈 = 어디까지인가에 대한 단일 정의. POKit2 한 버전을 "배포 완료"라 주장하려면 아래 산출물 4종이 각자의 완료 판정 기준을 통과해야 한다. v0.18 npm 전환 후 GitHub Release/git 태그가 조용히 누락된 사고(2026-06-12 PO 발견)의 재발 방지 — "어디까지가 릴리즈인지"가 미명문화였던 게 원인이었다.

근거: v0.19 retro §3·§5 (개인경로 2건 npm 포장 누출 + 실 설치 결함 3건 게이트 후 발견), POK-346.

## 릴리즈 산출물 4종

한 버전 `vX.Y.Z`의 릴리즈는 아래 4종이 모두 완료돼야 "released"다. 하나라도 빠지면 `release_candidate`이며 released 주장 금지.

| # | 산출물 | 완료 판정 기준 |
|---|--------|----------------|
| 1 | **npm publish** | `npm view pokit2 version` 실측이 해당 버전과 일치하고, `prepublishOnly` 누출 스캔을 통과한 패키지가 올라가 있다. |
| 2 | **공개 레포 소스** | 공개 레포(github.com/webn77/POKit2) 기본 브랜치 HEAD가 해당 버전 산출물로 갱신돼 있다 (커밋 SHA 기록). POK-372: 캐노니컬을 회사계정 dongwonlee222/pokit2에서 개인계정 webn77/POKit2로 이전. |
| 3 | **git 태그** | `vX.Y.Z` 태그가 원격에 존재한다 (`git ls-remote --tags`로 실측). |
| 4 | **공개 레포 GitHub Release** | 공개 레포에 `vX.Y.Z` GitHub Release가 생성돼 있다 (`gh release view vX.Y.Z` 실측). 외부 공개이므로 생성은 PO 승인 경계. |

"released" 주장은 4종 전부의 실측 증거가 있을 때만 가능하다. 4종 중 일부만 완료된 상태는 부분 릴리즈이며, 누락분을 릴리즈 산출물 체크에 미해소로 남긴다.

## 릴리즈 게이트 조건

릴리즈를 게이트 통과로 주장하기 전 아래를 모두 충족한다.

### G1. prepublish 누출 스캔 (fail-by-default)

- npm 포장 길목(`prepublishOnly`)에서 `scripts/pokit-prepublish-scan.mjs`가 자동 실행된다 — 우회 가능한 옆문 없음.
- 검사 대상은 `npm pack --dry-run --json`이 산출하는 실제 포장 파일 목록 (package.json `files` 글롭 자동 추종).
- 누출 패턴(개인 절대 홈 경로, 내부 비공개 작업 레포명) 발견 시 배포가 차단된다 (exit 1). 정확한 패턴 정의의 SSoT는 `scripts/pokit-prepublish-scan.mjs`의 `LEAK_PATTERNS` (스캔 대상에서 자가 제외 — 리터럴이 공개본에 새지 않도록).
- 회귀 고정: 0.18.0 실누출 2건(auto-memory 개인경로)이 회귀 케이스로 `tests/prepublish-scan.test.mjs`에 박제돼 있다.

### G2. 빈 폴더 실 설치 실측 (관행 → 표준)

설계 리뷰가 못 잡는 결함·누출·사고를 끌어내는 건 "진짜 사용자 경로 실측"이다. 실측은 사후 확인이 아니라 게이트 조건이다 (v0.19 retro §5: "이번엔 관행, 다음엔 표준").

검사 절차:
1. 빈 임시 폴더에서 `npx pokit2 install`(또는 해당 릴리즈 설치 경로)로 fresh 설치한다.
2. **부트스트랩 startup 비크래시** (POK-363 의무화, v0.22+): 빈손 신규 설치 상태(`active_issue: null`, `canonical_state: bootstrap`)에서 시작 트리거('포킷 시작')가 비크래시 + exit 0이어야 한다. `node scripts/pokit-release-g2-check.mjs`로 자동 실측. 실패 시 G2 불통과.
3. 첫 명령 실행: 설치 직후 첫 사용자 명령(예: 시작 트리거)이 동작한다.
4. `doctor` 실행: fresh 설치 상태에서 `pokit doctor` exit 0.

통과 기준: 위 4단계가 모두 성공(설치 성공 + 부트스트랩 startup 비크래시 + 첫 명령 동작 + doctor fail 0). 하나라도 실패하면 릴리즈 게이트 불통과. 게이트 **전**에 측정한다 (게이트 후 다음 이슈에서 발견하는 것은 늦은 실측 — 0.18.0·0.21.0의 실패 패턴).

> **부트스트랩 케이스란**: 사용자가 `npx pokit2 install` 후 아무 이슈도 없는 상태에서 "포킷 시작"을 처음 치는 경로다. `active_issue: null` 토큰이 문자열 "null"로 파싱돼 `isIssueId` 검증에 걸려 크래시하는 결함이 v0.19~v0.21 6 sprint를 통과했다(POK-362). G2가 이 경로를 1급 케이스로 실측함으로써 시스템 차단한다.

## github-publish-hook 결론 (3회 이월 종결)

**결론: 보류(전면 자동화 훅 미도입). 대신 릴리즈 기계화는 개별 게이트로 분해해 제공한다.**

근거 (docs/v0.18.0/starter-publish-notes.md 마찰 5건):
- 마찰 1(mapStarterPath 3중 복사)·2(버전 문자열 산재)는 드리프트가 본질 문제다. 드리프트가 살아있는 상태에서 publish 훅을 얹으면 깨지기 쉬운 절차를 자동화해 잘못된 곳을 경화하는 것이 된다.
- 따라서 v0.20에서는 전면 publish 훅 대신, 되돌릴 수 있고 증거가 남는 개별 게이트(prepublish 누출 스캔 G1 + 실 설치 실측 G2 + 산출물 4종 정의)를 먼저 박는다.
- 재평가 전제조건: (a) mapStarterPath/공유 함수 shared lib 단일화, (b) 단일 버전 소스에서 파생. 두 전제가 해소되면 publish 훅 도입을 재논의한다.

이 결론으로 github-publish-hook deferred 항목(v0.17~v0.19 3회 이월)을 종결한다.

## Doctor 검사 (결정 기록)

릴리즈 게이트 조건의 doctor 검사 추가는 **보류**한다. 실제 강제는 npm 포장 길목(`prepublishOnly`)의 fail-by-default 스캔이 담당하며, doctor는 publish 시점에 돌지 않으므로 길목 강제력이 없다. 자연 경로 길목(G1)이 [B] Natural-Path Hook + [C] Fail-by-Default를 충족한다.

## 릴리즈 갭 자동 표면화 (POK-356)

스프린트 마감(`pokit-sprint-close`) 및 킥오프(`pokit-runner backlog_view`) 길목에서 공개 게시 버전이 마지막 마감 스프린트보다 뒤처지면 자동 경고를 표시한다. 구현: `scripts/lib/release-gap.mjs`.

- 표면화까지만 — 실제 게시는 PO 사람 게이트.
- 조회 실패(npm 미가용)는 경고 없음 처리(차단 없음).

## Scope Boundary

- 이 표준은 릴리즈(버전 배포) 단위의 완료 정의를 규율한다.
- 이슈 단위 게이트 증거는 `completion-claim.md`가 SSoT다 (층이 다름).
- 릴리즈 산출물 4종 중 GitHub Release·공개 레포 push는 외부 공개이므로 PO 승인 경계.
