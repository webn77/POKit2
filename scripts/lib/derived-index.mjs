import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { listIssueFiles } from './issue-paths.mjs';
// POK-391: 로컬 parseFrontmatter(이 파일 아래에 별도 정의)는 멀티라인 list를
// 못 읽어 멀티라인 형식 254개 이슈의 depends_on 엣지(총 403개 중 대부분)를
// 전부 떨군다. 그래프 쿼리는 멀티라인 배열을 파싱하는 issue-frontmatter의
// 것을 써야 한다(이름 충돌 회피용 alias).
import { parseFrontmatter as parseCardFrontmatter } from './issue-frontmatter.mjs';

export function parseArgs(argv) {
  const args = { root: process.cwd(), sprint: null, status: null, projectLocal: false, grouped: false, groupBy: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') args.root = argv[++index];
    else if (arg === '--sprint') args.sprint = argv[++index];
    else if (arg === '--status') args.status = argv[++index];
    else if (arg === '--project-local') args.projectLocal = true;
    else if (arg === '--grouped') args.grouped = true;
    else if (arg === '--group-by') args.groupBy = argv[++index];
  }
  return args;
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---', 4);
  if (end === -1) return {};

  const frontmatter = {};
  for (const line of text.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    frontmatter[key] = rawValue.replace(/^["']|["']$/g, '').trim();
  }
  return frontmatter;
}

export function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

export async function buildIssueIndexRows(root, filters = {}) {
  const { dir, files } = await listIssueFiles(root);
  const rows = [];
  for (const file of files) {
    const relativePath = `${dir}/${file}`;
    const text = await readFile(path.join(root, relativePath), 'utf8');
    const frontmatter = parseFrontmatter(text);
    const id = frontmatter.id ?? file.replace(/\.md$/, '');
    const title = frontmatter.title ?? firstMarkdownHeading(text) ?? id;
    const status = frontmatter.status ?? frontmatter.gate_state ?? frontmatter.canonical_state ?? 'unknown';
    const sprint = frontmatter.sprint ?? '—';
    if (filters.sprint && sprint !== filters.sprint) continue;
    if (filters.status && status !== filters.status) continue;
    rows.push([id, title, status, sprint, `\`${relativePath}\``]);
  }
  return rows.sort((left, right) => issueNumber(left[0]) - issueNumber(right[0]));
}

export async function buildProjectLocalIssueRows(root, filters = {}) {
  // POK-316: scan projects/<key>/issues/ per registered project instead of the
  // legacy root issues/ directory, matching the system-wide convention used by
  // pokit-issue-create, the block-issue-card-write hook, and doctor listIssueFiles.
  let config;
  try {
    const configText = await readFile(path.join(root, '.pokit/config.json'), 'utf8');
    config = JSON.parse(configText);
  } catch {
    return [];
  }
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const rows = [];
  for (const project of projects) {
    const issuesDir = path.join(root, 'projects', project.key, 'issues');
    let files = [];
    try {
      files = (await readdir(issuesDir)).filter((name) => /^[A-Z][A-Z0-9]{1,5}-\d{3}\.md$/.test(name));
    } catch {
      continue;
    }
    for (const file of files) {
      const relativePath = `projects/${project.key}/issues/${file}`;
      const text = await readFile(path.join(root, relativePath), 'utf8');
      const frontmatter = parseFrontmatter(text);
      const id = frontmatter.id ?? file.replace(/\.md$/, '');
      const title = frontmatter.title ?? firstMarkdownHeading(text) ?? id;
      const status = frontmatter.status ?? frontmatter.gate_state ?? frontmatter.canonical_state ?? 'unknown';
      const sprint = frontmatter.project ?? '—';
      if (filters.status && status !== filters.status) continue;
      rows.push([id, title, status, sprint, `\`${relativePath}\``]);
    }
  }
  return rows.sort((left, right) => left[0].localeCompare(right[0]));
}

export async function buildArtifactIndexRows(root) {
  const rows = [];
  for await (const relativePath of walkMarkdown(root, '.ai-os')) {
    if (relativePath === '.ai-os/issue-index.md' || relativePath === '.ai-os/artifact-index.md') continue;
    const text = await readFile(path.join(root, relativePath), 'utf8');
    const frontmatter = parseFrontmatter(text);
    const title = frontmatter.title ?? firstMarkdownHeading(text);
    if (!title) continue;
    rows.push([
      title,
      frontmatter.artifact_type ?? 'artifact',
      `\`${relativePath}\``,
    ]);
  }
  return rows.sort((left, right) => left[2].localeCompare(right[2]));
}

export async function buildEvidenceIndex(root, { generatedAt = new Date().toISOString() } = {}) {
  const contractPath = '.ai-os/standards/hooks-contract.md';
  const eventLogPath = '.ai-os/events/event-log.jsonl';
  const events = await readAfterGatePassEvents(root, eventLogPath);
  const receiptsByIssue = await readProviderReceipts(root);
  const metricsByIssue = await readMetricsPaths(root);
  const sourcePaths = new Set([contractPath, eventLogPath]);
  const entries = [];

  for (const event of latestEventByIssue(events)) {
    const issueId = String(event.issue_id).toUpperCase();
    const receipts = receiptsByIssue.get(issueId) ?? [];
    const runtimeProof = runtimeProofRows(receipts);
    const metricsPaths = metricsByIssue.get(issueId) ?? [];

    for (const receipt of receipts) sourcePaths.add(receipt.path);
    for (const proof of runtimeProof) sourcePaths.add(proof.path);
    for (const metricsPath of metricsPaths) sourcePaths.add(metricsPath);

    entries.push({
      issue_id: issueId,
      gate_state: event.gate_state ?? 'unknown',
      status: event.status ?? event.gate_state ?? 'unknown',
      contract_path: contractPath,
      event_log_locator: `${eventLogPath}#L${event.line}`,
      provider_receipts: receipts.map(({ provider, path: receiptPath, status, event_id }) => ({
        provider,
        path: receiptPath,
        status,
        event_id,
      })),
      runtime_proof: runtimeProof,
      metrics_paths: metricsPaths,
    });
  }

  return {
    schema_version: '0.1.0',
    artifact_type: 'derived_evidence_index',
    source_of_truth: false,
    generated_at: generatedAt,
    source_paths: Array.from(sourcePaths).sort(),
    entries: entries.sort((left, right) => issueNumber(left.issue_id) - issueNumber(right.issue_id)),
  };
}

const STATUS_PRIORITY = ['gate_passed', 'in_progress', 'accepted', 'candidate', 'pending', 'deferred'];

// Parse a top-level list section (accepted/candidates/deferred) from release-scope.yaml text.
// Returns array of { id, title, status } for each entry with a valid POK-NNN id.
function parseReleaseScopeSection(text, sectionName) {
  const body = text.match(new RegExp(`(?:^|\\n)${sectionName}:\\n([\\s\\S]*?)(?=\\n[A-Za-z0-9_-]+:|$)`))?.[1] ?? '';
  // Split on "- id:" at start of a line (with optional leading spaces).
  // The body may start directly with "  - id:" (no leading newline), so we
  // split on /(?:^|\n)\s*-\s+id:\s*/ which matches both positions.
  const chunks = body.split(/(?:^|\n)\s*-\s+id:\s*/).slice(1);
  return chunks.map((chunk) => {
    // id may be POK-NNN or a non-issue string (e.g. github-publish-hook)
    const idMatch = chunk.match(/^([A-Za-z0-9_-]+)/);
    const id = idMatch?.[1] ?? null;
    const title = chunk.match(/\n\s+title:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? null;
    const status = chunk.match(/\n\s+status:\s*([A-Za-z0-9_-]+)/)?.[1] ?? null;
    return { id, title, status };
  }).filter((entry) => entry.id && /^[A-Z]+-\d{3}$/.test(entry.id));
}

// Read the issue card title as a fallback when release-scope.yaml entry lacks a title.
async function readCardTitle(root, id) {
  // Try the standard issue path used by listIssueFiles
  const candidates = [
    path.join(root, 'projects/pokit/issues', `${id}.md`),
    path.join(root, '.ai-os/issues', `${id}.md`),
  ];
  for (const filePath of candidates) {
    try {
      const text = await readFile(filePath, 'utf8');
      const frontmatter = parseFrontmatter(text);
      if (frontmatter.title) return frontmatter.title;
      const heading = text.match(/^#\s+(.+)$/m)?.[1];
      if (heading) return heading;
    } catch {
      // try next
    }
  }
  return id;
}

export async function buildGroupedBacklog(root, { sprint = null, groupBy = null } = {}) {
  // When a sprint is given and no explicit groupBy override, try to use release-scope.yaml
  // for accurate sprint membership (AC #3: release-scope.yaml is the source of truth).
  if (sprint && !groupBy) {
    const scopePath = path.join(root, '.ai-os/sprints', sprint, 'release-scope.yaml');
    let scopeText;
    try {
      scopeText = await readFile(scopePath, 'utf8');
    } catch {
      scopeText = null;
    }
    if (scopeText) {
      return buildGroupedBacklogFromReleaseScope(root, sprint, scopeText);
    }
    // Fall through to card-frontmatter-based grouping if file missing
  }

  const rows = await buildIssueIndexRows(root, { sprint });
  const resolvedGroupBy = groupBy ?? (sprint ? 'status' : 'sprint');

  const groupMap = new Map();
  for (const row of rows) {
    const [id, title, status, rowSprint] = row;
    const key = resolvedGroupBy === 'sprint' ? rowSprint : status;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push({ id, title, status, sprint: rowSprint });
  }

  let sortedKeys;
  if (resolvedGroupBy === 'sprint') {
    sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
      if (a === '—') return 1;
      if (b === '—') return -1;
      return b.localeCompare(a);
    });
  } else {
    const knownOrder = STATUS_PRIORITY;
    sortedKeys = Array.from(groupMap.keys()).sort((a, b) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  const groups = sortedKeys.map((key) => {
    const items = groupMap.get(key).sort((a, b) => issueNumber(a.id) - issueNumber(b.id));
    const passed = items.filter((item) => item.status === 'gate_passed').length;
    return { key, label: key, items, passed, total: items.length };
  });

  const totalPassed = groups.reduce((sum, g) => sum + g.passed, 0);
  const totalCount = groups.reduce((sum, g) => sum + g.total, 0);

  return { sprint: sprint ?? null, groupBy: resolvedGroupBy, groups, totalPassed, totalCount };
}

async function buildGroupedBacklogFromReleaseScope(root, sprint, scopeText) {
  const SECTION_DEFS = [
    { key: 'accepted',   sectionName: 'accepted',   label: '핵심 목표' },
    { key: 'candidates', sectionName: 'candidates',  label: '남은 후보' },
    { key: 'deferred',   sectionName: 'deferred',    label: '연기됨' },
  ];

  const groups = [];
  for (const { key, sectionName, label } of SECTION_DEFS) {
    const entries = parseReleaseScopeSection(scopeText, sectionName);
    if (entries.length === 0) continue;

    // Resolve titles: prefer release-scope.yaml title, fall back to card title
    const items = await Promise.all(entries.map(async (entry) => {
      const title = entry.title ?? await readCardTitle(root, entry.id);
      const status = entry.status ?? 'unknown';
      return { id: entry.id, title, status };
    }));

    items.sort((a, b) => issueNumber(a.id) - issueNumber(b.id));
    const passed = items.filter((item) => item.status === 'gate_passed').length;
    groups.push({ key, label, items, passed, total: items.length });
  }

  const totalPassed = groups.reduce((sum, g) => sum + g.passed, 0);
  const totalCount = groups.reduce((sum, g) => sum + g.total, 0);

  return { sprint, groupBy: 'release-scope', groups, totalPassed, totalCount };
}

export function renderGroupedBacklogCard(grouped, { title = null } = {}) {
  const cardTitle = title ?? `📋 백로그${grouped.sprint ? ` (${grouped.sprint})` : ''}`;
  const lines = [];
  lines.push(`╭─ ${cardTitle}  ${grouped.totalPassed}/${grouped.totalCount}`);
  lines.push('│');
  for (const group of grouped.groups) {
    lines.push(`│ ${group.label}  ${group.passed}/${group.total}`);
    for (const item of group.items) {
      const marker = item.status === 'gate_passed' ? '✅' : '⬜';
      const statusNote = item.status !== 'gate_passed' ? ` (${item.status})` : '';
      const shortTitle = item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title;
      lines.push(`│   ${marker} ${item.id} ${shortTitle}${statusNote}`);
    }
    lines.push('│');
  }
  lines.push('╰─');
  return lines.join('\n');
}

function firstMarkdownHeading(text) {
  const match = text.match(/^#\s+(.+)$/m);
  return match?.[1] ?? null;
}

// ── POK-391: 이슈 관계 그래프 쿼리 (역방향·전이의존) ──────────────────────
//
// 기존 빌더는 평면 목록일 뿐 depends_on 엣지를 1-hop도 따라가지 않는다
// (POK-389 research §4). 아래 함수들이 엣지를 따라가는 첫 쿼리 계층이다.
// 외부 DB·신규 의존성 0 — 기존 listIssueFiles + 카드 파서만 재사용한다.

/**
 * depends_on 원시값을 엣지 배열로 정규화한다.
 * - 멀티라인 list → 배열(POK-id만 통과, 공백 정리)
 * - inline "[]" 문자열 / bare key(true) / null / undefined → []  (POK-389 BLOCKER A 방지)
 */
export function normalizeDependsOn(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => /^POK-\d+$/.test(entry)); // 끝 앵커 — "POK-371 (메모)" 같은 오염 항목 거부
}

/**
 * 모든 이슈 카드를 읽어 의존 그래프를 만든다.
 * @returns {Promise<{ nodes: Set<string>, forward: Map<string, string[]>, dir: string }>}
 *   nodes = 존재하는 이슈 ID, forward = id → depends_on 엣지 배열, dir = 이슈 디렉토리(상대경로)
 */
export async function buildIssueGraph(root) {
  const { dir, files } = await listIssueFiles(root);
  const nodes = new Set();
  const forward = new Map();
  for (const file of files) {
    const text = await readFile(path.join(root, dir, file), 'utf8');
    const frontmatter = parseCardFrontmatter(text);
    const id = frontmatter.id ?? file.replace(/\.md$/, '');
    nodes.add(id);
    forward.set(id, normalizeDependsOn(frontmatter.depends_on));
  }
  return { nodes, forward, dir };
}

/**
 * 역방향: targetId를 depends_on 엣지로 가진 이슈 ID 배열(이슈번호 오름차순).
 */
export async function queryReverseDependents(root, targetId) {
  const { forward } = await buildIssueGraph(root);
  const dependents = [];
  for (const [id, deps] of forward) {
    if (deps.includes(targetId)) dependents.push(id);
  }
  return dependents.sort((left, right) => issueNumber(left) - issueNumber(right));
}

/**
 * 전이: startId의 depends_on 체인을 위상순(의존이 먼저)으로 반환. startId 자신은 제외.
 * 순환에도 무한루프 없이 안전 종료(onStack 가드). 존재하지 않는 참조는 dangling으로 분리.
 * @returns {Promise<{ order: string[], dangling: string[] }>}
 */
export async function queryTransitiveDependencies(root, startId) {
  const { nodes, forward } = await buildIssueGraph(root);
  const visited = new Set();
  const onStack = new Set();
  const order = [];
  const dangling = new Set();

  const visit = (id) => {
    if (visited.has(id)) return;
    if (onStack.has(id)) return; // 순환 가드 — 재진입 차단
    onStack.add(id);
    for (const dep of forward.get(id) ?? []) {
      if (!nodes.has(dep)) { dangling.add(dep); continue; }
      visit(dep);
    }
    onStack.delete(id);
    visited.add(id);
    if (id !== startId) order.push(id); // post-order = 위상순(의존 먼저)
  };

  visit(startId);
  return {
    order,
    dangling: [...dangling].sort((left, right) => issueNumber(left) - issueNumber(right)),
  };
}

function issueNumber(id) {
  const match = String(id).match(/POK-(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function* walkMarkdown(root, relativeDir) {
  let entries;
  try {
    entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkMarkdown(root, relativePath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield relativePath;
    }
  }
}

async function readAfterGatePassEvents(root, relativePath) {
  let text;
  try {
    text = await readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return [];
  }

  const events = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if ((event.event_type === 'after_gate_pass' || event.event_name === 'after_gate_pass') && event.issue_id) {
        events.push({ ...event, line: index + 1 });
      }
    } catch {
      continue;
    }
  }
  return events;
}

async function readProviderReceipts(root) {
  const byIssue = new Map();
  for await (const relativePath of walkFiles(root, '.ai-os/events/provider-receipts', '.json')) {
    let receipt;
    try {
      receipt = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
    } catch {
      continue;
    }
    if (!receipt.issue_id) continue;
    const issueId = String(receipt.issue_id).toUpperCase();
    const rows = byIssue.get(issueId) ?? [];
    rows.push({
      provider: receipt.provider ?? providerFromReceiptPath(relativePath),
      path: relativePath,
      status: receipt.status ?? 'unknown',
      event_id: receipt.event_id ?? null,
      runtime_proof_path: receipt.runtime_proof_path ?? null,
    });
    byIssue.set(issueId, rows);
  }
  for (const rows of byIssue.values()) {
    rows.sort((left, right) => left.path.localeCompare(right.path));
  }
  return byIssue;
}

async function readMetricsPaths(root) {
  const byIssue = new Map();
  for await (const relativePath of walkFiles(root, '.ai-os/runs', 'metrics.json')) {
    const match = relativePath.match(/\/(POK-\d+)\/metrics\.json$/);
    if (!match) continue;
    const issueId = match[1].toUpperCase();
    const rows = byIssue.get(issueId) ?? [];
    rows.push(relativePath);
    byIssue.set(issueId, rows);
  }
  for (const rows of byIssue.values()) rows.sort();
  return byIssue;
}

function runtimeProofRows(receipts) {
  const rows = new Map();
  for (const receipt of receipts) {
    if (!receipt.runtime_proof_path) continue;
    rows.set(receipt.runtime_proof_path, {
      provider: receipt.provider,
      path: receipt.runtime_proof_path,
    });
  }
  return Array.from(rows.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function providerFromReceiptPath(relativePath) {
  return relativePath.split('/')[3] ?? 'unknown';
}

function latestEventByIssue(events) {
  const byIssue = new Map();
  for (const event of events) {
    byIssue.set(String(event.issue_id).toUpperCase(), event);
  }
  return Array.from(byIssue.values());
}

async function* walkFiles(root, relativeDir, suffix) {
  let entries;
  try {
    entries = await readdir(path.join(root, relativeDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkFiles(root, relativePath, suffix);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      yield relativePath;
    }
  }
}
