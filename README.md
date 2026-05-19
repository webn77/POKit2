# POKit Starter

POKit Starter는 PM/PO와 AI가 같은 저장소 안에서 이슈, 증거, 검수, 기억, 다음 액션을 함께 관리하기 위한 local-first AI Harness다. 핵심 원칙은 `.ai-os/`를 프로젝트의 source of truth로 삼는 것이다.

이 starter는 비공개 경로, 회사 계정, 외부 SaaS 연결 없이 시작할 수 있다. 압축 파일을 새 프로젝트에 풀면 이미 `.ai-os/`, `AGENTS.md`, `scripts/`가 포함되어 있다.

## Release Status

현재 배포 대상은 `v0.1.0-rc.1` release candidate다. 안정 버전 `v0.1.0`이 아니며, GitHub release/tag/upload 증거가 기록되기 전까지는 `released` 상태로 보지 않는다.

## Quick Start

1. `pokit-starter-v0.1.0-rc.1.tar.gz`를 새 프로젝트 폴더에 푼다.
2. 에이전트에게 `AGENTS.md`와 `.ai-os/current.md`를 읽고 현재 상태를 복구하라고 요청한다.
3. 로컬 검사를 실행한다.

```bash
node scripts/pokit-runner.mjs "$pokit"
node scripts/pokit-doctor.mjs
```

기대 결과는 runner와 doctor가 모두 `pass`를 보고하고, active issue가 `POK-001`로 시작하는 것이다.

## What It Gives You

- 시작점: `AGENTS.md`
- 상태 포인터: `.ai-os/current.md`
- 첫 Harness Issue 예시: `.ai-os/POK-001.md`
- 작업 상태판과 인덱스: `.ai-os/status-board.md`, `.ai-os/issue-index.md`
- 실패 기억 입구: `.ai-os/memory/ai-failures/`
- 로컬 검사용 helper: `scripts/pokit-runner.mjs`, `scripts/pokit-doctor.mjs`

## Boundary

- `.ai-os/`가 source of truth다.
- durable work는 Harness Issue에 연결한다.
- 완료 주장은 gate evidence와 fresh verification으로 뒷받침한다.
- 외부 adapter, hosted dashboard, package registry publish는 MVP 범위가 아니다.
- 사용 경험은 자연어 지시와 repo-native 파일을 중심으로 한다.

## Code Management

- issue-per-durable-change: 코드, 계약, 문서, 릴리즈 작업은 하나의 Harness Issue에 묶는다.
- small scoped changes: 각 변경은 한 번에 검토 가능한 크기로 유지한다.
- tests before gate claim: 동작, 계약, 릴리즈 상태를 주장하기 전에 fresh verification을 실행한다.
- no unrelated refactor: 현재 이슈와 무관한 정리나 구조 변경을 섞지 않는다.
- public-safe starter content: starter 파일에는 secret, 개인 경로, private company assumption, production history, run log, event receipt를 넣지 않는다.
- review evidence before completion: delegated agent 결과는 입력 증거일 뿐이며, 완료 판단은 로컬 검증으로 한다.

## PO Work Model

- Project key: 각 프로젝트가 namespace를 정한다. `POK`는 starter 예시일 뿐이다.
- Issue/task: MVP durable work는 `.ai-os/POK-001.md` 같은 단일 파일 Harness Issue로 시작한다.
- Subtask/subissue: MVP는 `subtask_id`가 있는 subagent 결과로 기록한다. 폴더형 `subissue.yaml`은 future scope다.
- Temporary Todo: 실행 체크리스트일 뿐 durable issue를 대체하지 않는다.
- Epic: MVP의 1급 artifact가 아니다. Epic metadata, issue link, epic-level gate evidence는 후속 계약에서 다룬다.

## Not Included

- hosted SaaS
- web dashboard
- Linear/GitHub/Slack 필수 연결
- package registry 배포
- semantic search
- first-class epic artifact
- root project의 production `.ai-os` history

## More Docs

- `ARCHITECTURE.md`: 구조와 런타임 흐름
- `CHANGELOG.md`: 공개 버전 이력
- `LICENSE`: MIT license
- Source repository `RELEASE.md`: release candidate 체크리스트와 외부 배포 경계
- Source repository `release/v0.1.0-rc.1.md`: GitHub release 본문 초안
