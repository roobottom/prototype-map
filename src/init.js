import { createInterface } from 'readline/promises';
import { existsSync } from 'fs';
import { createProject, slugify, getConfigPath } from './registry.js';
import { writeConfig } from './config.js';

/**
 * Create a new project under projects/[slug]/.
 */
export async function init(opts) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = opts.name || await rl.question('Project name: ');
    if (!name.trim()) {
      throw new Error('Project name is required');
    }

    const baseUrl = opts.url || await rl.question('Base URL (http://localhost:3000): ') || 'http://localhost:3000';

    const slug = slugify(name.trim());
    const configPath = getConfigPath(slug);

    if (existsSync(configPath)) {
      const overwrite = await rl.question(`Project "${slug}" already exists. Overwrite config? (y/N): `);
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Aborted.');
        return;
      }
    }

    createProject({ slug, name: name.trim(), baseUrl });

    const config = {
      name: name.trim(),
      baseUrl,
      viewport: { width: 1280, height: 900 },
      round: 1,
      pages: [],
      journeys: []
    };

    writeConfig(configPath, config);

    console.log(`\nProject "${name.trim()}" created.`);
    console.log(`  Directory: projects/${slug}/`);
    console.log(`  Config:    projects/${slug}/config.yaml`);
    console.log(`\nNext steps:`);
    console.log(`  1. npm start`);
    console.log(`  2. Select "${name.trim()}" in the extension or dashboard and start recording`);
  } finally {
    rl.close();
  }
}
