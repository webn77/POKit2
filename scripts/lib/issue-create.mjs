import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { withStateWriteGuard } from './worktree-locks.mjs';
import { emptySkeletonBody } from './issue-sections.mjs';

const EVENT_LOG_REL = '.ai-os/events/event-log.jsonl';
const RECEIPT_SCHEMA_VERSION = '0.1.0';
const EVENT_NAME = 'issue_authored';

function lockHolder() {
  return process.env.POKIT_SESSION_ID ?? `pid-${process.pid}`;
}

/**
 * Compute a 16-hex content hash for an issue card.
 * Invariant: sha256(`${id} ${title} ${created_at}`).slice(0, 16)
 */
export function computeContentHash({ id, title, created_at }) {
  return createHash('sha256')
    .update(`${id} ${title} ${created_at}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Build an issue_authored receipt object (does not write to disk).
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.title
 * @param {string} opts.created_at - YYYY-MM-DD
 * @param {string} [opts.provider]
 * @param {string} [opts.authoring_path]
 * @param {string|null} [opts.reason]
 * @param {string} [opts.emittedAt] - ISO timestamp (injectable for tests)
 */
export function buildIssueAuthoredReceipt({
  id,
  title,
  created_at,
  provider = 'claude_code',
  authoring_path,
  reason = null,
  emittedAt,
}) {
  const content_hash = computeContentHash({ id, title, created_at });
  const emitted_at = emittedAt ?? new Date().toISOString();

  return {
    event_type: EVENT_NAME,
    event_name: EVENT_NAME,
    issue_id: id,
    created_at,
    emitted_at,
    provider,
    authoring_path: authoring_path ?? null,
    reason: reason ?? null,
    content_hash,
    payload: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      event_name: EVENT_NAME,
      issue_id: id,
      content_hash,
      title,
    },
  };
}

/**
 * Append a receipt JSON line to <root>/.ai-os/events/event-log.jsonl.
 * Creates the directory if it does not exist.
 */
export async function appendIssueAuthoredReceipt(root, receipt) {
  const logPath = path.join(root, EVENT_LOG_REL);
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(receipt)}\n`, 'utf8');
}

/**
 * Write a minimal issue card and append an issue_authored receipt.
 *
 * @param {object} opts
 * @param {string} opts.root - repo root
 * @param {string} opts.id - e.g. 'POK-204'
 * @param {string} opts.title
 * @param {string} opts.issueType - e.g. 'implementation'
 * @param {string} [opts.project] - default 'pokit'
 * @param {string} [opts.authoringPath] - default 'pokit.backlog'
 * @param {string|null} [opts.reason]
 * @param {string} [opts.body] - body text after the title heading
 * @param {string} opts.created_at - YYYY-MM-DD
 * @param {string} [opts.emittedAt] - ISO timestamp (injectable for tests)
 * @returns {{ cardPath: string, receipt: object }}
 */
export async function createIssue({
  root,
  id,
  title,
  issueType,
  project = 'pokit',
  authoringPath = 'pokit.backlog',
  reason = null,
  body = '',
  created_at,
  emittedAt,
}) {
  if (!id) throw new Error('id is required');
  if (!title) throw new Error('title is required');
  if (/[\r\n]/.test(title)) throw new Error('title must not contain newlines');
  if (!created_at) throw new Error('created_at is required');
  if (!issueType) throw new Error('issueType is required');

  // Normalize title to the same form parseFrontmatter will read back (.trim()),
  // so the receipt content_hash matches the doctor's re-computed hash round-trip.
  const safeTitle = title.trim();

  const cardPath = path.join(root, 'projects', project, 'issues', `${id}.md`);

  // REFUSE if card already exists (no overwrite)
  let alreadyExists = false;
  try {
    await stat(cardPath);
    alreadyExists = true;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  if (alreadyExists) {
    throw new Error(`Card already exists: ${cardPath}`);
  }

  // Build minimal frontmatter
  const frontmatter = [
    '---',
    `schema_version: ${RECEIPT_SCHEMA_VERSION}`,
    `id: ${id}`,
    `namespace: POK`,
    `project: ${project}`,
    `title: ${safeTitle}`,
    `issue_type: ${issueType}`,
    `canonical_state: backlog`,
    `gate_state: pending`,
    `status: candidate`,
    `definition_readiness: draft`,
    `depends_on: []`,
    `authoring_path: ${authoringPath}`,
    `authoring_contract_version: backlog-flow-mvp-v1`,
    `created_at: ${created_at}`,
    `updated_at: ${created_at}`,
    '---',
  ].join('\n');

  // POK-349: full required-section skeleton from the single source (empty headers,
  // no fake fill) when no body is supplied — so a freshly created card carries every
  // section the doctor will later require, and nothing masquerades as filled.
  const bodySection = body
    ? `\n${body}`
    : emptySkeletonBody(issueType);

  const cardContent = `${frontmatter}\n\n# ${id} ${safeTitle}${bodySection}\n`;

  // Write card behind a short-lived guard so concurrent authoring does not race the issue card path.
  await withStateWriteGuard(root, {
    filePath: path.relative(root, cardPath),
    holder: lockHolder(),
    reason: `create issue card ${id}`,
  }, async () => {
    await mkdir(path.dirname(cardPath), { recursive: true });
    await writeFile(cardPath, cardContent, { encoding: 'utf8', flag: 'wx' });
  });

  // Build and append receipt
  const receipt = buildIssueAuthoredReceipt({
    id,
    title: safeTitle,
    created_at,
    provider: 'claude_code',
    authoring_path: authoringPath,
    reason,
    emittedAt,
  });

  try {
    await appendIssueAuthoredReceipt(root, receipt);
  } catch (appendErr) {
    // Best-effort rollback: remove just-created card
    try {
      await rm(cardPath, { force: true });
    } catch {
      // Ignore rollback errors
    }
    throw appendErr;
  }

  return { cardPath, receipt };
}

// POK-325 — definition-change reissue. A title edit changes the content hash, so
// the original issue_authored receipt no longer matches and doctor fails until a
// new receipt is appended. This reads the CURRENT card frontmatter, recomputes the
// hash, and appends a fresh receipt only when none matches (idempotent no-op when
// the receipt is already current — multiple issue_authored lines per issue are valid).
export async function reissueIssueAuthoredReceipt({
  root,
  cardPath,
  reason = 'definition_change_reissue',
  emittedAt,
} = {}) {
  if (!root) throw new Error('root is required');
  if (!cardPath) throw new Error('cardPath is required');

  const fullPath = path.isAbsolute(cardPath) ? cardPath : path.join(root, cardPath);
  let text;
  try {
    text = await readFile(fullPath, 'utf8');
  } catch {
    return { ok: false, reissued: false, reason: 'card_not_found', cardPath };
  }

  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) {
    return { ok: false, reissued: false, reason: 'frontmatter_missing', cardPath };
  }

  // Quote-stripping must match the doctor's frontmatter normalizeValue, or a
  // quoted `title: "..."` card reissues a hash the doctor will never look up.
  const field = (name) => {
    const raw = frontmatter.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
    return raw.replace(/^['"]|['"]$/g, '');
  };
  const id = field('id');
  const title = field('title');
  const created_at = field('created_at');
  const authoring_path = field('authoring_path') || null;

  if (!id || !title || !created_at) {
    return { ok: false, reissued: false, reason: 'frontmatter_incomplete', cardPath, id, title, created_at };
  }

  const content_hash = computeContentHash({ id, title, created_at });
  const receiptSet = await loadIssueAuthoredReceiptSet(root);
  if (receiptSet.has(`${id}::${content_hash}`)) {
    return { ok: true, reissued: false, reason: 'receipt_current', issueId: id, content_hash };
  }

  const receipt = buildIssueAuthoredReceipt({
    id,
    title,
    created_at,
    provider: 'claude_code',
    authoring_path,
    reason,
    emittedAt,
  });
  await appendIssueAuthoredReceipt(root, receipt);
  return { ok: true, reissued: true, issueId: id, content_hash, receipt };
}

/**
 * Read event-log.jsonl and return a Set of `${issue_id}::${content_hash}` strings
 * from all issue_authored events.
 */
export async function loadIssueAuthoredReceiptSet(root) {
  const logPath = path.join(root, EVENT_LOG_REL);
  let text;
  try {
    text = await readFile(logPath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return new Set();
    throw err;
  }

  const receiptSet = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (
        (event.event_type === EVENT_NAME || event.event_name === EVENT_NAME) &&
        event.issue_id &&
        event.content_hash
      ) {
        receiptSet.add(`${event.issue_id}::${event.content_hash}`);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return receiptSet;
}
