import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_PROJECT,
  defaultPokitHome,
  resolvePokitConfig,
} from './pokit-config.mjs';
import { plainifyUserText } from './user-text.mjs';
import { withStateWriteGuard } from './worktree-locks.mjs';

export const PROJECT_STATE_SCHEMA_VERSION = '0.1.0';
export { DEFAULT_PROJECT };

function pokitDir(root) {
  return path.join(root, '.pokit');
}

function registryDir(homeDir = defaultPokitHome()) {
  return path.join(homeDir, 'projects');
}

function jsonWithNewline(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT' && fallback !== null) return fallback;
    throw err;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonWithNewline(value), 'utf8');
}

function lockHolder() {
  return process.env.POKIT_SESSION_ID ?? `pid-${process.pid}`;
}

async function guardedWriteJson(root, relativePath, value, reason) {
  await withStateWriteGuard(root, {
    filePath: relativePath,
    holder: lockHolder(),
    reason,
  }, async () => {
    await writeJson(path.join(root, relativePath), value);
  });
}

async function guardedWriteText(root, relativePath, text, reason) {
  await withStateWriteGuard(root, {
    filePath: relativePath,
    holder: lockHolder(),
    reason,
  }, async () => {
    await writeFile(path.join(root, relativePath), text, 'utf8');
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePrefix(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function assertProjectShape(project) {
  const key = normalizeKey(project.key);
  const name = String(project.name ?? key).trim();
  const prefix = normalizePrefix(project.prefix);
  if (!key) throw new Error('project key is required');
  if (!name) throw new Error('project name is required');
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefix)) {
    throw new Error('project prefix must be 2-6 uppercase letters or digits');
  }
  return { key, name, prefix };
}

export function recommendProjectIdentity(projectRoot) {
  const base = path.basename(path.resolve(projectRoot));
  const key = normalizeKey(base) || DEFAULT_PROJECT.key;
  const words = key.split('-').filter(Boolean);
  const prefix = words.length >= 2
    ? words.map((word) => word[0]).join('').toUpperCase().slice(0, 4)
    : key.slice(0, 3).toUpperCase().padEnd(3, 'X');
  return {
    key,
    name: words.join(' ') || key,
    prefix,
  };
}

function defaultConfig(defaultProject = DEFAULT_PROJECT) {
  return {
    schema_version: PROJECT_STATE_SCHEMA_VERSION,
    default_project: defaultProject.key,
    projects: [{ ...defaultProject }],
  };
}

function defaultProjectState(defaultProject = DEFAULT_PROJECT) {
  return {
    schema_version: PROJECT_STATE_SCHEMA_VERSION,
    active_project: defaultProject.key,
    active_issue: null,
    gate_state: 'idle',
    next_action: nextActionForProject(defaultProject.key),
    updated_at: nowIso(),
  };
}

function nextActionForProject(projectKey) {
  return projectKey === DEFAULT_PROJECT.key
    ? 'Create or continue a common project issue'
    : `Create or continue an issue in ${projectKey}`;
}

function defaultSeq(defaultProject = DEFAULT_PROJECT) {
  return {
    schema_version: PROJECT_STATE_SCHEMA_VERSION,
    counters: {
      [defaultProject.key]: 1,
    },
  };
}

function findProject(config, key) {
  return config.projects.find((project) => project.key === key) ?? null;
}

async function registerProject(homeDir, root, project) {
  const homeConfigPath = path.join(homeDir, 'config.json');
  const projectsDir = registryDir(homeDir);
  const homeConfig = await readJson(homeConfigPath, {
    schema_version: PROJECT_STATE_SCHEMA_VERSION,
    projects_dir: 'projects',
  });
  if (!homeConfig.schema_version) homeConfig.schema_version = PROJECT_STATE_SCHEMA_VERSION;
  if (!homeConfig.projects_dir) homeConfig.projects_dir = 'projects';

  await writeJson(homeConfigPath, homeConfig);
  await writeJson(path.join(projectsDir, `${project.key}.json`), {
    schema_version: PROJECT_STATE_SCHEMA_VERSION,
    key: project.key,
    name: project.name,
    prefix: project.prefix,
    path: root,
    updated_at: nowIso(),
  });
}

export async function readProjectState(root) {
  const dir = pokitDir(root);
  const config = await readJson(path.join(dir, 'config.json'));
  const projectState = await readJson(path.join(dir, 'project-state.json'));
  const seq = await readJson(path.join(dir, 'seq.json'));
  const activeProject = findProject(config, projectState.active_project) ?? findProject(config, config.default_project);
  return { config, projectState, seq, activeProject };
}

export async function ensureProjectState(root, { homeDir = defaultPokitHome() } = {}) {
  const dir = pokitDir(root);
  const configPath = path.join(dir, 'config.json');
  const statePath = path.join(dir, 'project-state.json');
  const seqPath = path.join(dir, 'seq.json');
  const resolvedConfig = await resolvePokitConfig(root, { homeDir });
  const defaultProject = resolvedConfig.defaultProject;

  await mkdir(path.join(dir, 'sessions'), { recursive: true });
  await mkdir(path.join(root, 'issues'), { recursive: true });

  const config = await readJson(configPath, defaultConfig(defaultProject));
  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    config.projects = [{ ...defaultProject }];
  }
  if (!config.default_project) config.default_project = defaultProject.key;
  if (!findProject(config, config.default_project)) config.projects.unshift({ ...defaultProject });
  config.schema_version = config.schema_version ?? PROJECT_STATE_SCHEMA_VERSION;

  const projectState = await readJson(statePath, defaultProjectState(defaultProject));
  projectState.schema_version = projectState.schema_version ?? PROJECT_STATE_SCHEMA_VERSION;
  projectState.active_project = projectState.active_project ?? config.default_project;
  projectState.active_issue = projectState.active_issue ?? null;
  projectState.gate_state = projectState.gate_state ?? 'idle';
  projectState.next_action = projectState.next_action ?? 'Create or continue a common project issue';
  projectState.updated_at = nowIso();

  const seq = await readJson(seqPath, defaultSeq(defaultProject));
  seq.schema_version = seq.schema_version ?? PROJECT_STATE_SCHEMA_VERSION;
  seq.counters = seq.counters ?? {};
  for (const project of config.projects) {
    if (!Number.isInteger(seq.counters[project.key]) || seq.counters[project.key] < 1) {
      seq.counters[project.key] = 1;
    }
  }

  await guardedWriteJson(root, '.pokit/config.json', config, 'ensure project config');
  await guardedWriteJson(root, '.pokit/project-state.json', projectState, 'ensure project state');
  await guardedWriteJson(root, '.pokit/seq.json', seq, 'ensure project sequence');

  const activeProject = findProject(config, projectState.active_project) ?? findProject(config, config.default_project);
  await registerProject(homeDir, root, activeProject);
  await renderProjectViews(root, { config, projectState, seq, activeProject });
  return { config, projectState, seq, activeProject };
}

export async function createProject(root, { key, name, prefix, homeDir = defaultPokitHome() } = {}) {
  await ensureProjectState(root, { homeDir });
  const { config, projectState, seq } = await readProjectState(root);
  const project = assertProjectShape({ key, name, prefix });

  if (findProject(config, project.key)) throw new Error(`project already exists: ${project.key}`);
  if (config.projects.some((existing) => existing.prefix === project.prefix)) {
    throw new Error(`project prefix already exists: ${project.prefix}`);
  }

  config.projects.push(project);
  seq.counters[project.key] = 1;
  await guardedWriteJson(root, '.pokit/config.json', config, `create project ${project.key}`);
  await guardedWriteJson(root, '.pokit/seq.json', seq, `create project ${project.key}`);
  await registerProject(homeDir, root, project);
  await renderProjectViews(root, { config, projectState, seq, activeProject: findProject(config, projectState.active_project) });
  return { config, projectState, seq, project };
}

export async function switchProject(root, key, { homeDir = defaultPokitHome(), force = false } = {}) {
  await ensureProjectState(root, { homeDir });
  const { config, projectState, seq } = await readProjectState(root);
  const project = findProject(config, normalizeKey(key));
  if (!project) throw new Error(`unknown project: ${key}`);
  if (
    !force &&
    projectState.active_issue &&
    projectState.active_project !== project.key &&
    projectState.gate_state !== 'gate_passed'
  ) {
    throw new Error(`active issue ${projectState.active_issue} is still ${projectState.gate_state}; finish it or pass --force`);
  }

  await withStateWriteGuard(root, {
    filePath: '.pokit/project-state.json',
    holder: lockHolder(),
    reason: `switch project to ${project.key}`,
  }, async () => {
    projectState.active_project = project.key;
    projectState.active_issue = force ? null : projectState.active_issue;
    projectState.gate_state = force ? 'idle' : projectState.gate_state;
    projectState.next_action = nextActionForProject(project.key);
    projectState.updated_at = nowIso();
    await writeJson(path.join(pokitDir(root), 'project-state.json'), projectState);
    await registerProject(homeDir, root, project);
    await renderProjectViews(root, { config, projectState, seq, activeProject: project });
  });
  return { config, projectState, seq, activeProject: project };
}

// Guard (POK-316): scan real issue files on disk and return the highest number
// for this project's prefix. Prevents counter drift from re-issuing existing IDs.
// Returns 0 when the project issues directory is absent.
export async function maxIssueNumberOnDisk(root, project) {
  const dir = path.join(root, 'projects', project.key, 'issues');
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err?.code === 'ENOENT') return 0;
    throw err;
  }
  const prefix = `${project.prefix}-`;
  let max = 0;
  for (const name of entries) {
    if (!name.endsWith('.md') || !name.startsWith(prefix)) continue;
    const num = Number.parseInt(name.slice(prefix.length, -'.md'.length), 10);
    if (Number.isInteger(num) && num > max) max = num;
  }
  return max;
}

export async function allocateIssueId(root, targetProjectKey, { homeDir } = {}) {
  await ensureProjectState(root, { homeDir });
  const { config, projectState, seq, activeProject } = await readProjectState(root);
  let project;
  if (targetProjectKey) {
    project = findProject(config, normalizeKey(targetProjectKey));
    if (!project) throw new Error(`unknown project: ${targetProjectKey}`);
  } else {
    project = activeProject ?? findProject(config, DEFAULT_PROJECT.key);
  }
  // Reconcile the persisted counter with the real files on disk so a drifted
  // counter (e.g. 301 while POK-315 exists) cannot re-issue an existing ID.
  const counter = seq.counters[project.key] ?? 1;
  const fileMax = await maxIssueNumberOnDisk(root, project);
  const nextNumber = Math.max(counter, fileMax + 1);
  const issueId = `${project.prefix}-${String(nextNumber).padStart(3, '0')}`;
  seq.counters[project.key] = nextNumber + 1;
  await guardedWriteJson(root, '.pokit/seq.json', seq, `allocate issue ${issueId}`);
  await renderProjectViews(root, { config, projectState, seq, activeProject: project });
  return { issueId, project, nextNumber };
}

// POK-383 — 등록된 프로젝트 목록(레지스트리 인덱스). 러너 카드의 "등록 N개 중" 표시에 사용.
// 레지스트리 부재/비어있으면 빈 배열을 반환(throw 금지) — 단일 프로젝트 환경 non-breaking.
export async function listRegisteredProjects(homeDir = defaultPokitHome()) {
  let entries;
  try {
    entries = await readdir(registryDir(homeDir), { withFileTypes: true });
  } catch {
    return [];
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const project = await readJson(path.join(registryDir(homeDir), entry.name), null);
    if (!project?.key && !project?.path) continue;
    projects.push(project);
  }
  projects.sort((left, right) => String(left.key ?? '').localeCompare(String(right.key ?? '')));
  return projects;
}

// POK-383 — cwd가 속한 등록 프로젝트를 이미 읽어둔 목록에서 고른다(I/O 없는 순수 매칭).
// 가장 긴 경로 접두사 우선. registryDir 재스캔을 피하려고 resolveRegistryContext와 공유한다.
export function matchRegisteredProjectByPath(projects, cwd) {
  const resolvedCwd = path.resolve(cwd);
  const candidates = [];
  for (const project of projects ?? []) {
    if (!project?.path) continue;
    const projectPath = path.resolve(project.path);
    if (resolvedCwd === projectPath || resolvedCwd.startsWith(`${projectPath}${path.sep}`)) {
      candidates.push(project);
    }
  }
  candidates.sort((left, right) => String(right.path).length - String(left.path).length);
  return candidates[0] ?? null;
}

export async function resolveRegisteredProjectByPath(homeDir, cwd) {
  const projects = await listRegisteredProjects(homeDir);
  return matchRegisteredProjectByPath(projects, cwd);
}

export async function hasProjectState(root) {
  try {
    const stats = await stat(path.join(root, '.pokit/config.json'));
    return stats.isFile();
  } catch {
    return false;
  }
}

export async function renderProjectViews(root, { config, projectState, seq, activeProject }, { write = true } = {}) {
  const project = activeProject ?? findProject(config, projectState.active_project) ?? DEFAULT_PROJECT;
  const nextNumber = seq.counters?.[project.key] ?? 1;
  const nextIssue = `${project.prefix}-${String(nextNumber).padStart(3, '0')}`;
  const lines = [
    `Current project: ${project.key} (${project.prefix})`,
    `Current issue: ${projectState.active_issue ?? 'none'}`,
    `Next issue: ${nextIssue}`,
    `Next action: ${projectState.next_action ?? `Create or continue a ${project.key} project issue`}`,
  ].map(plainifyUserText);
  const current = lines.join('\n');

  // POK-262: read-only callers (e.g. project:list) pass { write: false } so a view
  // command does not persist .pokit/current.md or .pokit/handoff.md. Default stays
  // write:true for state-materializing callers (project init/create, issue-create).
  if (write) {
    await guardedWriteText(root, '.pokit/current.md', `${current}\n`, 'render project current view');
    await guardedWriteText(root, '.pokit/handoff.md', `${current}\n`, 'render project handoff view');
  }
  return { current, nextIssue };
}
