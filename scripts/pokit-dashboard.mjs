// POK-385 — 멀티프로젝트 현황판 1단계
// 읽기 전용 (어떤 .ai-os 상태 파일도 쓰지 않음)
// 행 배열 구조(사람 레이어 확장 대비, POK-371): project.rows = [{issue, gate, next}]

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { defaultPokitHome } from './lib/pokit-config.mjs';
import { parseFrontmatter } from './lib/issue-frontmatter.mjs';
import { listRegisteredProjects } from './lib/project-state.mjs';
import { listUserStateFiles } from './lib/user-state.mjs';

// ─── pure helpers ────────────────────────────────────────────────────────────

/**
 * Trim next_action to ~40 chars with ellipsis so the board stays narrow.
 * @param {string|null|undefined} text
 * @returns {string}
 */
function shorten(text) {
  if (text == null) return '';
  const s = String(text).trim();
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/**
 * Normalise active_issue: 'none', 'null', empty string, null → null.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function normaliseIssue(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'null') return null;
  return String(value).trim();
}

/**
 * Pad a string to exactly `width` chars (left-aligned).
 * Works with multi-byte Hangul (each char = 2 terminal columns).
 * @param {string} s
 * @param {number} width  terminal-column width
 * @returns {string}
 */
function padEnd(s, width) {
  let cols = 0;
  for (const ch of s) cols += ch.codePointAt(0) > 0x7f ? 2 : 1;
  const pad = width - cols;
  return pad > 0 ? `${s}${' '.repeat(pad)}` : s;
}

// ─── pure render ─────────────────────────────────────────────────────────────

/**
 * Render a fixed-width ASCII dashboard from collected project data.
 *
 * @param {Array<{key:string, rows:Array<{issue:string|null, gate:string|null, next:string|null}>, missing:boolean}>} projects
 * @returns {string}
 */
export function renderDashboard(projects) {
  if (!Array.isArray(projects) || projects.length === 0) {
    return '등록된 프로젝트 없음';
  }

  // Measure longest key in terminal columns for alignment
  const KEY_MIN = 10;
  let keyWidth = KEY_MIN;
  for (const p of projects) {
    let cols = 0;
    for (const ch of String(p.key ?? '')) cols += ch.codePointAt(0) > 0x7f ? 2 : 1;
    if (cols > keyWidth) keyWidth = cols;
  }
  // add 2-space margin
  keyWidth += 2;

  const header = `프로젝트 현황판 · ${projects.length}개`;
  const divider = '-'.repeat(72);
  const lines = [header, divider];

  for (const project of projects) {
    const key = String(project.key ?? '?');

    if (project.missing || !Array.isArray(project.rows) || project.rows.length === 0) {
      // missing state file or no rows — align issue column with active rows (2-space separator)
      lines.push(`${padEnd(key, keyWidth)}  (상태 파일 없음)`);
      continue;
    }

    for (const row of project.rows) {
      const issueLabel = row.issue == null ? '(활성 이슈 없음)' : row.issue;
      const gateLabel = row.gate == null ? '     ' : padEnd(String(row.gate), 14);
      const nextLabel = row.next ? `다음: ${row.next}` : '';
      // POK-371: 사람별 행이면 유저 칸을 이슈 앞에 끼운다. 단일유저(user 없음)는
      // 기존 출력과 완전히 동일(칸 추가 없음).
      const userLabel = row.user ? padEnd(`@${row.user}`, 16) : null;

      if (row.issue == null) {
        const head = userLabel ? `${padEnd(key, keyWidth)}  ${userLabel}` : `${padEnd(key, keyWidth)}  `;
        lines.push(`${head}${issueLabel}`.trimEnd());
      } else {
        const parts = [padEnd(key, keyWidth)];
        if (userLabel) parts.push(userLabel);
        parts.push(padEnd(issueLabel, 10), gateLabel);
        if (nextLabel) parts.push(nextLabel);
        lines.push(parts.join('  ').trimEnd());
      }
    }
  }

  lines.push(divider);
  return lines.join('\n');
}

// ─── async collector ─────────────────────────────────────────────────────────

/**
 * Collect project status from each project's .ai-os/current.md.
 * READ ONLY — never writes any file, never calls git.
 *
 * @param {{
 *   homeDir?: string,
 *   readProjectCurrent?: (projectPath: string) => Promise<string>
 * }} opts
 * @returns {Promise<Array<{key:string, rows:Array<{issue,gate,next}>, missing:boolean}>>}
 */
export async function collectProjects({
  homeDir = defaultPokitHome(),
  readProjectCurrent = null,
  listProjectUsers = null,
  readProjectUserState = null,
} = {}) {
  const _readCurrent = readProjectCurrent ?? (async (projectPath) => {
    const currentPath = path.join(projectPath, '.ai-os', 'current.md');
    return readFile(currentPath, 'utf8');
  });
  // POK-371: 사람별 상태 파일 목록 (readdir만 — git 미호출, 읽기 전용 유지).
  const _listUsers = listProjectUsers ?? (async (projectPath) => listUserStateFiles(projectPath));
  const _readUserState = readProjectUserState ?? (async (projectPath, relPath) =>
    readFile(path.join(projectPath, relPath), 'utf8'));

  const registered = await listRegisteredProjects(homeDir);
  const result = [];

  const rowFromText = (text, user) => {
    const fm = parseFrontmatter(text);
    const row = {
      issue: normaliseIssue(fm.active_issue),
      gate: fm.gate_state ?? null,
      next: shorten(fm.next_action),
    };
    if (user) row.user = user;
    return row;
  };

  for (const project of registered) {
    const key = project.key ?? '?';
    const projectPath = path.resolve(project.path ?? '');

    // POK-371: 사람별 파일이 있으면 사람당 한 행. 없으면 기존 current.md 단일 행.
    let userFiles = [];
    try {
      userFiles = await _listUsers(projectPath);
    } catch {
      userFiles = [];
    }

    if (Array.isArray(userFiles) && userFiles.length > 0) {
      const rows = [];
      for (const uf of userFiles) {
        try {
          const text = await _readUserState(projectPath, uf.relPath);
          rows.push(rowFromText(text, uf.key));
        } catch {
          // 개별 유저 파일 읽기 실패는 그 행만 건너뛴다(비크래시).
        }
      }
      if (rows.length > 0) {
        result.push({ key, rows, missing: false });
        continue;
      }
      // 모든 유저 파일 읽기 실패 → current.md로 폴백.
    }

    let text;
    try {
      text = await _readCurrent(projectPath);
    } catch {
      result.push({ key, rows: [], missing: true });
      continue;
    }

    result.push({ key, rows: [rowFromText(text, null)], missing: false });
  }

  return result;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main() {
  const projects = await collectProjects();
  console.log(renderDashboard(projects));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('pokit-dashboard:', err.message);
    process.exit(1);
  });
}
