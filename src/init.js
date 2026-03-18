import { createInterface } from 'readline/promises';
import { resolve } from 'path';
import { registerProject } from './registry.js';

/**
 * Register a prototype project so it appears in the extension dropdown.
 * The .prototype-map/ directory in the target project is created automatically
 * when you first record and stop.
 */
export async function init(opts) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = opts.name || await rl.question('Project name: ');
    if (!name.trim()) {
      throw new Error('Project name is required');
    }

    const pathInput = opts.path || await rl.question('Project path: ');
    if (!pathInput.trim()) {
      throw new Error('Project path is required');
    }
    const projectPath = resolve(pathInput.trim());

    const baseUrl = opts.url || await rl.question('Base URL (http://localhost:3000): ') || 'http://localhost:3000';

    registerProject({
      name: name.trim(),
      path: projectPath,
      baseUrl
    });

    console.log(`\nRegistered "${name.trim()}"`);
    console.log(`  Path: ${projectPath}`);
    console.log(`  Base URL: ${baseUrl}`);
    console.log(`\nNext steps:`);
    console.log(`  1. npx prototype-map serve`);
    console.log(`  2. Select "${name.trim()}" in the extension and start recording`);
  } finally {
    rl.close();
  }
}
