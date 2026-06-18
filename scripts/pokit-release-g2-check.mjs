#!/usr/bin/env node
/**
 * POK-363 G2 부트스트랩 startup 비크래시 게이트 검사.
 *
 * 릴리즈 게이트 G2의 "첫 명령 동작" 단계 중
 * 빈손 신규 설치(bootstrap, active_issue 없음) 시작 트리거 비크래시를 실측한다.
 *
 * 통과 기준:
 *   - bootstrap current.md로 runPreflight('포킷 시작') exit 0 (크래시 없음)
 *   - 반환 결과 command.kind === 'startup_trigger'
 *
 * 실패 시 exit 1 (G2 fail).
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BOOTSTRAP_CURRENT = `---
schema_version: 0.1.0
canonical_state: bootstrap
active_project: null
active_issue: null
gate_state: idle
---

# Current Work Surface
`;

async function main() {
  let root;
  try {
    root = await mkdtemp(path.join(tmpdir(), 'pokit-g2-bootstrap-'));
    await mkdir(path.join(root, '.ai-os'), { recursive: true });
    await writeFile(path.join(root, '.ai-os/current.md'), BOOTSTRAP_CURRENT, 'utf8');
  } catch (err) {
    process.stderr.write(`G2 bootstrap check: temp setup failed — ${err.message}\n`);
    process.exit(1);
  }

  let result;
  try {
    const { runPreflight } = await import('./pokit-runner.mjs');
    result = await runPreflight({ root, phrase: '포킷 시작' });
  } catch (err) {
    process.stderr.write(`❌ G2 bootstrap check FAIL — 시작 트리거 크래시: ${err.message}\n`);
    process.exit(1);
  }

  if (!result || result.command?.kind !== 'startup_trigger') {
    process.stderr.write(
      `❌ G2 bootstrap check FAIL — startup_trigger 아님: ${JSON.stringify(result?.command?.kind)}\n`
    );
    process.exit(1);
  }

  process.stdout.write(`✅ G2 bootstrap check PASS — 시작 트리거 비크래시 확인\n`);
}

main().catch((err) => {
  process.stderr.write(`G2 bootstrap check: unhandled error — ${err.message}\n`);
  process.exit(1);
});
