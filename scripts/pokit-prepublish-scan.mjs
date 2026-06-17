#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

/**
 * Leak patterns that should never appear in published npm package files.
 * fail-by-default: any match blocks the publish.
 */
export const LEAK_PATTERNS = [
  {
    name: 'personal-home-users',
    regex: /\/Users\/[A-Za-z0-9._-]+/,
    reason: 'Personal absolute home path (/Users/<username>) must not be published',
  },
  {
    name: 'personal-home-home',
    regex: /\/home\/[A-Za-z0-9._-]+/,
    reason: 'Personal absolute home path (/home/<username>) must not be published',
  },
  {
    // `\b` treats hyphens as word boundaries, so compound forms (e.g. `pokit2-work-x`)
    // also match. This is intentional — any appearance of the internal repo name blocks.
    name: 'internal-repo-name',
    regex: /\bpokit2-work\b/,
    reason: 'Internal private repo name (pokit2-work) must not be published',
  },
];

/**
 * Files that are always excluded from leak scanning.
 * The scan script itself defines pattern strings in source — scanning it would
 * produce false positives. Any future tooling-only scripts can be added here.
 * Note: the test file is not currently in the npm pack set (tests/ is excluded by
 * package.json `files`); its entry is a defensive pre-exclusion in case `files`
 * ever ships tests, so the pattern-literal fixtures would not self-trip the scan.
 */
const SCAN_EXCLUDES = new Set([
  'scripts/pokit-prepublish-scan.mjs',
  'tests/prepublish-scan.test.mjs',
]);

/**
 * Scan a list of files for leak patterns, line by line.
 * @param {{ root: string, files: string[] }} opts
 *   root  - absolute path to the package root (files are resolved relative to this)
 *   files - relative file paths to scan (injected for testability; no npm-pack dependency)
 * @returns {Promise<Array<{ file: string, line: number, patternName: string, match: string }>>}
 */
export async function scanFiles({ root, files }) {
  const findings = [];

  for (const relPath of files) {
    // Skip tooling files that intentionally contain pattern strings
    if (SCAN_EXCLUDES.has(relPath)) continue;

    const fullPath = path.resolve(root, relPath);
    let text;
    try {
      text = await readFile(fullPath, 'utf8');
    } catch {
      // Binary or unreadable — skip, do not crash
      process.stderr.write(`[prepublish-scan] skip (unreadable): ${relPath}\n`);
      continue;
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of LEAK_PATTERNS) {
        const m = lines[i].match(pattern.regex);
        if (m) {
          findings.push({
            file: relPath,
            line: i + 1,
            patternName: pattern.name,
            match: m[0],
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Run `npm pack --dry-run --json` and return the list of packed file paths
 * (relative to the package root).
 * This is the authoritative source — it follows package.json `files` globs automatically.
 * @param {string} root - absolute path to package root
 * @returns {Promise<string[]>}
 */
export async function getPackFileList(root) {
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json'], { cwd: root });
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return (entry.files || []).map((f) => f.path);
}

/**
 * Full scan: discover pack files via npm, then scan them all.
 * @param {{ root: string }} opts
 * @returns {Promise<Array<{ file, line, patternName, match }>>}
 */
export async function runScan({ root }) {
  const files = await getPackFileList(root);
  return scanFiles({ root, files });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const root = process.cwd();
  try {
    const files = await getPackFileList(root);
    const findings = await scanFiles({ root, files });

    if (findings.length > 0) {
      for (const f of findings) {
        process.stderr.write(`${f.file}:${f.line} [${f.patternName}] ${f.match}\n`);
      }
      process.exit(1);
    } else {
      process.stdout.write(`✅ prepublish 누출 스캔 통과 (${files.length} 파일)\n`);
      process.exit(0);
    }
  } catch (err) {
    process.stderr.write(`[prepublish-scan] fatal: ${err.message}\n`);
    process.exit(1);
  }
}
