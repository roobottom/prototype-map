import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REGISTRY_DIR = join(homedir(), '.prototype-map');
const REGISTRY_PATH = join(REGISTRY_DIR, 'projects.json');

/**
 * Load the global project registry.
 * Returns [] if the file doesn't exist yet.
 */
export function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Register a project. Upserts by path — if a project with the same
 * path already exists, it updates the name and baseUrl.
 */
export function registerProject({ name, path, baseUrl }) {
  const projects = loadRegistry();
  const idx = projects.findIndex(p => p.path === path);
  const entry = { name, path, baseUrl: baseUrl || 'http://localhost:3000' };

  if (idx >= 0) {
    projects[idx] = entry;
  } else {
    projects.push(entry);
  }

  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(projects, null, 2));
  return entry;
}

/**
 * Remove a project from the registry by path.
 */
export function removeProject(projectPath) {
  const projects = loadRegistry().filter(p => p.path !== projectPath);
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(projects, null, 2));
}
