import { readdirSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = join(__dirname, '..', 'projects');

/**
 * Get the absolute path to the projects directory.
 */
export function getProjectsDir() {
  return PROJECTS_DIR;
}

/**
 * Get the absolute path to a project's directory by slug.
 */
export function getProjectDir(slug) {
  return join(PROJECTS_DIR, slug);
}

/**
 * Get the config file path for a project.
 */
export function getConfigPath(slug) {
  return join(PROJECTS_DIR, slug, 'config.yaml');
}

/**
 * Get the output directory for a project.
 */
export function getOutputDir(slug) {
  return join(PROJECTS_DIR, slug, 'output');
}

/**
 * Scan the projects/ directory and return all registered projects.
 * Each project is a subfolder containing a config.yaml.
 */
export function loadRegistry() {
  if (!existsSync(PROJECTS_DIR)) return [];

  const entries = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const configPath = join(PROJECTS_DIR, entry.name, 'config.yaml');
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, 'utf8');
      const config = yaml.load(raw);
      projects.push({
        slug: entry.name,
        name: config.name || entry.name,
        baseUrl: config.baseUrl || 'http://localhost:3000',
        round: config.round || 1
      });
    } catch {
      // Skip invalid configs
      projects.push({
        slug: entry.name,
        name: entry.name,
        baseUrl: 'http://localhost:3000',
        round: 1
      });
    }
  }

  return projects;
}

/**
 * Create a new project directory with a config.yaml.
 */
export function createProject({ slug, name, baseUrl }) {
  const projectDir = join(PROJECTS_DIR, slug);
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

/**
 * Slugify a string for use as a directory name.
 */
export function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
}
