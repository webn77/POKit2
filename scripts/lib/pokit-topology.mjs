/**
 * pokit-topology.mjs — 프로젝트 잔류(residue) 설치/마이그레이션 라이브러리
 *
 * 규칙 (topology-spec §2·§3·§4):
 *  - 잔류 5종: AGENTS.md, .claude/skills/pokit-* SKILL.md, .ai-os/ 시드, pokit_version,
 *    .claude/settings.json(안전바닥 훅 배선 — POK-347, PO 승인 2026-06-15)
 *  - 사용자 소유(.ai-os/ 상태, AGENTS.md 마커 밖, settings.json 사용자 훅)는 절대 보존
 *  - 도구 소유(마커 블록 안, skills, 안전바닥 훅 항목)는 regenerate=true 시 덮어쓰기
 *
 * 이 모듈은 순수 lib — packageRoot와 version은 항상 인자로 받는다.
 * process.env·import.meta.url 의존 없음.
 */

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseFrontmatter } from './issue-frontmatter.mjs';
import { mergeFloorIntoSettings } from './hook-floor.mjs';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const POKIT_MARKER_BEGIN = '<!-- pokit:begin -->';
export const POKIT_MARKER_END = '<!-- pokit:end -->';

// ---------------------------------------------------------------------------
// Source checkout guard (결함 3 — 소스 레포 자기파괴 방지)
// ---------------------------------------------------------------------------

/**
 * root가 pokit2 소스 레포인지 판별한다.
 * - root/package.json의 name이 'pokit2'이거나
 * - root/scripts/lib/pokit-topology.mjs가 존재하면 → true
 *
 * @param {string} root
 * @returns {Promise<boolean>}
 */
export async function isPokitSourceCheckout(root) {
  // 1. package.json name 확인
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    if (pkg?.name === 'pokit2') return true;
  } catch {
    // 없거나 파싱 실패 → 다음 체크로
  }
  // 2. 본체 파일 존재 확인
  return fileExists(path.join(root, 'scripts', 'lib', 'pokit-topology.mjs'));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readTextOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively list files under a directory, returning paths relative to baseDir.
 * Returns [] if directory doesn't exist.
 */
async function listFilesRecursive(baseDir, relDir = '') {
  const results = [];
  let entries;
  try {
    entries = await readdir(path.join(baseDir, relDir), { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...await listFilesRecursive(baseDir, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/**
 * Build the marker block content from starter/AGENTS.md.
 * Wraps the source content (sans its own markers if any) with POKIT_MARKER_BEGIN/END.
 */
async function buildMarkerBlock(packageRoot) {
  const sourcePath = path.join(packageRoot, 'starter', 'AGENTS.md');
  const sourceText = await readTextOptional(sourcePath);
  let innerContent;
  if (sourceText !== null) {
    // If the source already has markers (generated file), extract inner content;
    // otherwise use the whole file
    const beginIdx = sourceText.indexOf(POKIT_MARKER_BEGIN);
    const endIdx = sourceText.indexOf(POKIT_MARKER_END);
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      innerContent = sourceText.slice(beginIdx + POKIT_MARKER_BEGIN.length, endIdx);
    } else {
      innerContent = sourceText;
    }
  } else {
    innerContent = '\n<!-- pokit managed content -->\n';
  }
  // Ensure inner content is surrounded by newlines
  const inner = innerContent.startsWith('\n') ? innerContent : `\n${innerContent}`;
  const innerTrimmed = inner.endsWith('\n') ? inner : `${inner}\n`;
  return `${POKIT_MARKER_BEGIN}${innerTrimmed}${POKIT_MARKER_END}`;
}

/**
 * Write or update AGENTS.md with the marker block.
 * - No file: create with marker block only
 * - File exists, markers present: replace between markers
 * - File exists, no markers: prepend marker block + blank line
 * Returns 'written' | 'skipped' (never skipped for AGENTS.md — always written)
 */
async function writeAgentsMd(projectRoot, packageRoot) {
  const destPath = path.join(projectRoot, 'AGENTS.md');
  const markerBlock = await buildMarkerBlock(packageRoot);
  const existingText = await readTextOptional(destPath);

  if (existingText === null) {
    // No file — create with marker block only
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, `${markerBlock}\n`, 'utf8');
    return 'written';
  }

  const beginIdx = existingText.indexOf(POKIT_MARKER_BEGIN);
  const endIdx = existingText.indexOf(POKIT_MARKER_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Replace between markers — preserve everything outside
    const before = existingText.slice(0, beginIdx);
    const after = existingText.slice(endIdx + POKIT_MARKER_END.length);
    const newText = `${before}${markerBlock}${after}`;
    await writeFile(destPath, newText, 'utf8');
    return 'written';
  } else {
    // No markers — prepend marker block + blank line, preserve existing
    const newText = `${markerBlock}\n\n${existingText}`;
    await writeFile(destPath, newText, 'utf8');
    return 'written';
  }
}

/**
 * Copy skill files from starter into project.
 * regenerate=false → only copy if destination doesn't exist.
 * regenerate=true  → always overwrite.
 */
async function writeSkills(projectRoot, packageRoot, regenerate) {
  const srcSkillsDir = path.join(packageRoot, 'starter', '.claude', 'skills');
  const written = [];
  const skipped = [];

  let skillDirs;
  try {
    skillDirs = await readdir(srcSkillsDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return { written, skipped };
    throw err;
  }

  for (const entry of skillDirs) {
    if (!entry.isDirectory() || !entry.name.startsWith('pokit-')) continue;
    const skillFiles = await listFilesRecursive(path.join(srcSkillsDir, entry.name));
    for (const relFile of skillFiles) {
      const srcPath = path.join(srcSkillsDir, entry.name, relFile);
      const destRel = `.claude/skills/${entry.name}/${relFile}`;
      const destPath = path.join(projectRoot, destRel);

      if (!regenerate && await fileExists(destPath)) {
        skipped.push(destRel);
        continue;
      }
      await mkdir(path.dirname(destPath), { recursive: true });
      await copyFile(srcPath, destPath);
      written.push(destRel);
    }
  }
  return { written, skipped };
}

/**
 * Seed .ai-os/ from starter — only when destination doesn't exist.
 * Never overwrites existing state (even with regenerate=true per spec §4).
 */
async function writeAiOsSeed(projectRoot, packageRoot) {
  const srcDir = path.join(packageRoot, 'starter', '.ai-os');
  const written = [];
  const skipped = [];

  const srcFiles = await listFilesRecursive(srcDir);
  for (const relFile of srcFiles) {
    const srcPath = path.join(srcDir, relFile);
    const destRel = `.ai-os/${relFile}`;
    const destPath = path.join(projectRoot, destRel);

    if (await fileExists(destPath)) {
      skipped.push(destRel);
      continue;
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    written.push(destRel);
  }
  return { written, skipped };
}

/**
 * Write or merge the thin-project safety-floor hooks into .claude/settings.json (POK-347).
 *
 * 멱등 병합: 안전바닥 훅(pokit hook-floor)을 보장하되 사용자가 직접 추가한 훅은 보존한다.
 *  - 파일 없음 → 안전바닥만 생성 ('written')
 *  - 파일 있고 내용 변경 필요 → 병합 후 갱신 ('updated')
 *  - 파일 있고 이미 안전바닥 포함(변경 없음) → 'skipped'
 *
 * 프로젝트에 훅 스크립트 파일은 깔지 않는다 — settings.json은 본체를 가리키는 얇은 포인터다.
 */
async function writeResidueSettings(projectRoot) {
  const destPath = path.join(projectRoot, '.claude', 'settings.json');
  const existingText = await readTextOptional(destPath);

  let existing = null;
  if (existingText !== null) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      // 손상된 JSON — 안전바닥은 재생성하되 사용자 내용은 복구 불가하므로 새로 쓴다.
      // 사일런트 손실 방지: 사용자가 인지할 수 있게 stderr로 경고한다.
      process.stderr.write(
        `[pokit] 경고: ${destPath} 가 올바른 JSON이 아닙니다 — 안전바닥 훅으로 새로 씁니다. ` +
          '기존 사용자 설정이 있었다면 보존되지 않습니다.\n',
      );
      existing = null;
    }
  }

  const merged = mergeFloorIntoSettings(existing);
  const nextText = `${JSON.stringify(merged, null, 2)}\n`;

  if (existingText === nextText) return 'skipped';

  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, nextText, 'utf8');
  return existingText === null ? 'written' : 'updated';
}

// ---------------------------------------------------------------------------
// pokit_version frontmatter write (line-level replacement)
// ---------------------------------------------------------------------------

/**
 * Insert or replace `pokit_version: <version>` in the frontmatter of a
 * Markdown file. Preserves all other content exactly.
 *
 * If the file has no frontmatter, prepend a minimal frontmatter block.
 */
async function setPokitVersionInFile(filePath, version) {
  const text = await readTextOptional(filePath);
  if (text === null) {
    // File doesn't exist yet — create minimal frontmatter
    const content = `---\npokit_version: ${version}\n---\n`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return;
  }

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    // No frontmatter — prepend one
    const newText = `---\npokit_version: ${version}\n---\n\n${text}`;
    await writeFile(filePath, newText, 'utf8');
    return;
  }

  const fmBody = fmMatch[1];
  const versionLineRe = /^pokit_version:.*$/m;
  let newFmBody;
  if (versionLineRe.test(fmBody)) {
    newFmBody = fmBody.replace(versionLineRe, `pokit_version: ${version}`);
  } else {
    newFmBody = `pokit_version: ${version}\n${fmBody}`;
  }
  const after = text.slice(fmMatch[0].length);
  const newText = `---\n${newFmBody}\n---${after}`;
  await writeFile(filePath, newText, 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write the 4 residue items into projectRoot.
 *
 * @param {string} projectRoot
 * @param {{ packageRoot: string, version: string, regenerate?: boolean }} options
 * @returns {{ written: string[], skipped: string[], preserved: string[] }}
 */
export async function writeResidue(projectRoot, { packageRoot, version, regenerate = false }) {
  const written = [];
  const skipped = [];
  const preserved = [];

  // 1. AGENTS.md — marker block (always rewritten on regenerate, always preserved outside)
  const agentsStatus = await writeAgentsMd(projectRoot, packageRoot);
  if (agentsStatus === 'written') written.push('AGENTS.md');
  else skipped.push('AGENTS.md');

  // 2. .claude/skills/pokit-*/
  const skillsResult = await writeSkills(projectRoot, packageRoot, regenerate);
  written.push(...skillsResult.written);
  skipped.push(...skillsResult.skipped);

  // 3. .ai-os/ seed — never overwrites existing state (even regenerate)
  const aiOsResult = await writeAiOsSeed(projectRoot, packageRoot);
  written.push(...aiOsResult.written);
  preserved.push(...aiOsResult.skipped);  // existing state is preserved, not skipped

  // 4. pokit_version in .ai-os/current.md frontmatter
  const currentMdPath = path.join(projectRoot, '.ai-os', 'current.md');
  await setPokitVersionInFile(currentMdPath, version);

  // 5. .claude/settings.json — 안전바닥 훅 배선 (POK-347, residue +1, PO 승인 2026-06-15).
  //    프로젝트엔 훅 스크립트 0개; 훅 명령은 `pokit hook-floor`로 글로벌 본체를 참조한다.
  const settingsStatus = await writeResidueSettings(projectRoot);
  if (settingsStatus === 'skipped') skipped.push('.claude/settings.json');
  else written.push(`.claude/settings.json (${settingsStatus})`);
  // current.md may already have been counted in aiOsResult — record version write separately
  if (!written.includes('.ai-os/current.md') && !preserved.includes('.ai-os/current.md')) {
    written.push('.ai-os/current.md (pokit_version)');
  } else {
    // It was already handled (written or preserved); version was updated in-place
    // Mark as written to indicate version field was set
    const idx = written.indexOf('.ai-os/current.md');
    if (idx !== -1) written[idx] = '.ai-os/current.md (seeded + pokit_version)';
    else {
      // was preserved (existed before) — version field updated in-place
      const pidx = preserved.indexOf('.ai-os/current.md');
      if (pidx !== -1) preserved[pidx] = '.ai-os/current.md (preserved, pokit_version updated)';
    }
  }

  return { written, skipped, preserved };
}

/**
 * Detect whether a project has a legacy (full-copy) installation.
 *
 * A project is legacy if it has .ai-os/current.md AND at least one
 * of the known body files (scripts/pokit-runner.mjs or scripts/pokit-doctor.mjs).
 *
 * bodyFiles: starter/scripts/** and starter/tests/** relative paths that exist in projectRoot.
 *
 * @param {string} projectRoot
 * @param {string} packageRoot
 * @returns {{ legacy: boolean, bodyFiles: string[] }}
 */
// 레거시(전체-복사) 설치가 깔아두던 본체성 파일의 고정 목록.
// 레거시 설치본은 과거 버전(v0.16/v0.18)에서 동결된 집합이므로 정적 목록이 정답이다 —
// 글로벌 설치된 패키지에는 starter/scripts·tests가 동봉되지 않아(files 제외)
// packageRoot 스캔만으로는 목록이 비어 마이그레이션이 무효화된다.
export const LEGACY_BODY_FILES = Object.freeze([
  'scripts/active-issue-guard.mjs',
  'scripts/install-safety-floor-settings.mjs',
  'scripts/pokit-doctor.mjs',
  'scripts/pokit-init.mjs',
  'scripts/pokit-issue-create.mjs',
  'scripts/pokit-issue-use.mjs',
  'scripts/pokit-list-evidence-raw.mjs',
  'scripts/pokit-list-issues.mjs',
  'scripts/pokit-measure-startup.mjs',
  'scripts/pokit-project-contract.mjs',
  'scripts/pokit-project-create.mjs',
  'scripts/pokit-project-use.mjs',
  'scripts/pokit-runner.mjs',
  'scripts/pokit-sprint-close.mjs',
  'scripts/hooks/require-active-issue-before-mutation.mjs',
  'scripts/hooks/session-start.mjs',
  'scripts/lib/task-scope-classifier.mjs',
  'tests/pokit-doctor-binding.test.mjs',
  'tests/starter-smoke.test.mjs',
]);

export async function detectLegacyInstall(projectRoot, packageRoot) {
  const hasCurrent = await fileExists(path.join(projectRoot, '.ai-os', 'current.md'));
  if (!hasCurrent) return { legacy: false, bodyFiles: [] };

  const hasRunner = await fileExists(path.join(projectRoot, 'scripts', 'pokit-runner.mjs'));
  const hasDoctor = await fileExists(path.join(projectRoot, 'scripts', 'pokit-doctor.mjs'));
  const isLegacy = hasRunner || hasDoctor;

  if (!isLegacy) return { legacy: false, bodyFiles: [] };

  // 정적 목록 + (개발 레포처럼 동봉돼 있으면) packageRoot의 starter 디렉토리 스캔을 합집합으로.
  const candidates = new Set(LEGACY_BODY_FILES);
  const srcScripts = await listFilesRecursive(path.join(packageRoot, 'starter', 'scripts'));
  for (const rel of srcScripts) candidates.add(`scripts/${rel}`);
  const srcTests = await listFilesRecursive(path.join(packageRoot, 'starter', 'tests'));
  for (const rel of srcTests) candidates.add(`tests/${rel}`);

  const bodyFiles = [];
  for (const rel of candidates) {
    if (await fileExists(path.join(projectRoot, rel))) bodyFiles.push(rel);
  }
  bodyFiles.sort();

  return { legacy: isLegacy, bodyFiles };
}

/**
 * Plan a migration from legacy full-copy to thin residue topology.
 *
 * @param {string} projectRoot
 * @param {{ packageRoot: string }} options
 * @returns {{ remove: string[], preserve: string[], residue: string[] }}
 */
export async function planMigration(projectRoot, { packageRoot }) {
  const { bodyFiles } = await detectLegacyInstall(projectRoot, packageRoot);

  // remove = body files (scripts/ + tests/) + empty directories after removal
  const remove = [...bodyFiles];

  // preserve = .ai-os/** + AGENTS.md user body + projects/
  const preserve = [];

  // .ai-os/**
  const aiOsFiles = await listFilesRecursive(path.join(projectRoot, '.ai-os'));
  for (const rel of aiOsFiles) preserve.push(`.ai-os/${rel}`);

  // AGENTS.md (user body outside markers)
  if (await fileExists(path.join(projectRoot, 'AGENTS.md'))) {
    preserve.push('AGENTS.md (user body outside markers preserved)');
  }

  // projects/
  if (await fileExists(path.join(projectRoot, 'projects'))) {
    const projectFiles = await listFilesRecursive(path.join(projectRoot, 'projects'));
    for (const rel of projectFiles) preserve.push(`projects/${rel}`);
  }

  // residue = what writeResidue will write
  const residue = [
    'AGENTS.md (marker block)',
    '.claude/skills/pokit-*/ (regenerate)',
    '.ai-os/ (seed only for missing files)',
    '.ai-os/current.md pokit_version field',
    '.claude/settings.json (safety-floor hooks, merged — user hooks preserved)',
  ];

  return { remove, preserve, residue };
}

/**
 * Apply a migration plan: delete body files, then write residue.
 *
 * @param {string} projectRoot
 * @param {{ remove: string[], preserve: string[], residue: string[] }} plan
 * @param {{ packageRoot: string, version: string }} options
 */
export async function applyMigration(projectRoot, plan, { packageRoot, version }) {
  // Step 1: Remove body files
  const removedDirs = new Set();
  for (const rel of plan.remove) {
    const fullPath = path.join(projectRoot, rel);
    try {
      await rm(fullPath, { force: true });
      removedDirs.add(path.dirname(fullPath));
    } catch {
      // ignore missing files
    }
  }

  // Step 2: Clean up empty directories (scripts/ and tests/)
  for (const dir of removedDirs) {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  // Check parent dirs too (scripts/hooks/, scripts/lib/)
  const parentDirs = new Set([...removedDirs].map((d) => path.dirname(d)));
  for (const dir of parentDirs) {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) await rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // Step 3: Write residue (regenerate=true for migration — overwrite skills).
  // writeResidue가 pokit_version까지 기입하므로 별도 호출 불필요.
  await writeResidue(projectRoot, { packageRoot, version, regenerate: true });
}

/**
 * Read the pokit_version from .ai-os/current.md frontmatter.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
export async function readProjectPokitVersion(projectRoot) {
  const filePath = path.join(projectRoot, '.ai-os', 'current.md');
  const text = await readTextOptional(filePath);
  if (text === null) return null;
  const fm = parseFrontmatter(text);
  const version = fm.pokit_version;
  if (typeof version === 'string' && version.length > 0) return version;
  return null;
}

/**
 * Write (insert or replace) the pokit_version field in .ai-os/current.md frontmatter.
 *
 * @param {string} projectRoot
 * @param {string} version
 */
export async function writeProjectPokitVersion(projectRoot, version) {
  const filePath = path.join(projectRoot, '.ai-os', 'current.md');
  await setPokitVersionInFile(filePath, version);
}
