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
 * Get the absolute path to a project's directory.
 */
export function getProjectDir(projectSlug) {
  return join(PROJECTS_DIR, projectSlug);
}

/**
 * Get the absolute path to a journey's directory.
 */
export function getJourneyDir(projectSlug, journeySlug) {
  return join(PROJECTS_DIR, projectSlug, journeySlug);
}

/**
 * Get the config file path for a journey.
 */
export function getConfigPath(projectSlug, journeySlug) {
  return join(PROJECTS_DIR, projectSlug, journeySlug, 'config.yaml');
}

/**
 * Get the screenshot directory for a journey.
 */
export function getScreenshotDir(projectSlug, journeySlug) {
  return join(PROJECTS_DIR, projectSlug, journeySlug, 'screenshots');
}

/**
 * Get the map directory for a journey.
 */
export function getMapDir(projectSlug, journeySlug) {
  return join(PROJECTS_DIR, projectSlug, journeySlug, 'maps');
}

/**
 * Titlecase a slug: "mya-provocotype" → "Mya Provocotype"
 */
function titleCase(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Scan the projects/ directory and return all projects with their journeys.
 * Returns: [{ slug, name, journeys: [{ slug, name, baseUrl }] }]
 */
export function loadRegistry() {
  if (!existsSync(PROJECTS_DIR)) return [];

  const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  const projects = [];

  for (const projectDir of projectDirs) {
    const projectPath = join(PROJECTS_DIR, projectDir.name);
    const journeys = [];

    // Scan for journey subdirectories containing config.yaml
    let subDirs;
    try {
      subDirs = readdirSync(projectPath, { withFileTypes: true })
        .filter(d => d.isDirectory());
    } catch {
      subDirs = [];
    }

    for (const journeyDir of subDirs) {
      const configPath = join(projectPath, journeyDir.name, 'config.yaml');
      if (!existsSync(configPath)) continue;

      try {
        const raw = readFileSync(configPath, 'utf8');
        const config = yaml.load(raw);
        journeys.push({
          slug: journeyDir.name,
          name: config.name || titleCase(journeyDir.name),
          baseUrl: config.baseUrl || 'http://localhost:3000'
        });
      } catch {
        journeys.push({
          slug: journeyDir.name,
          name: titleCase(journeyDir.name),
          baseUrl: 'http://localhost:3000'
        });
      }
    }

    projects.push({
      slug: projectDir.name,
      name: titleCase(projectDir.name),
      journeys
    });
  }

  return projects;
}

/**
 * Create a project directory.
 */
export function createProject(projectSlug) {
  const projectDir = join(PROJECTS_DIR, projectSlug);
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
