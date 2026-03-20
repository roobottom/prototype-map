import { createInterface } from 'readline/promises';
import { existsSync } from 'fs';
import { createProject, slugify, getProjectDir } from './registry.js';

/**
 * Create a new project directory under projects/.
 */
export async function init(opts) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = opts.name || await rl.question('Project name: ');
    if (!name.trim()) {
      throw new Error('Project name is required');
    }

    const slug = slugify(name.trim());
    const projectDir = getProjectDir(slug);

    if (existsSync(projectDir)) {
      console.log(`Project "${slug}" already exists at projects/${slug}/`);
      return;
    }

    createProject(slug);

    console.log(`\nProject "${name.trim()}" created.`);
    console.log(`  Directory: projects/${slug}/`);
    console.log(`\nNext steps:`);
    console.log(`  1. npm start`);
    console.log(`  2. Select "${name.trim()}" in the extension and record a journey`);
  } finally {
    rl.close();
  }
}
