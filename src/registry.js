import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'projects.json');

/**
 * Load the project registry.
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

  writeFileSync(REGISTRY_PATH, JSON.stringify(projects, null, 2));
  return entry;
}

/**
 * Remove a project from the registry by path.
 */
export function removeProject(projectPath) {
  const projects = loadRegistry().filter(p => p.path !== projectPath);
  writeFileSync(REGISTRY_PATH, JSON.stringify(projects, null, 2));
}
