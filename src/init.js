import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline/promises';
import { writeConfig } from './config.js';
import { registerProject } from './registry.js';

/**
 * Initialize a new prototype-map project in the current directory.
 * Creates .prototype-map/config.yaml and registers in the global registry.
 */
export async function init(opts) {
  const projectDir = resolve('.');
  const configDir = join(projectDir, '.prototype-map');
  const configPath = join(configDir, 'config.yaml');

  // Interactive prompts for missing options
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name = opts.name || await rl.question('Project name: ');
    if (!name.trim()) {
      throw new Error('Project name is required');
    }

    const baseUrl = opts.url || await rl.question('Base URL (http://localhost:3000): ') || 'http://localhost:3000';
    const port = opts.port ? Number(opts.port) : Number(await rl.question('Server port (4444): ') || '4444');

    // Check for existing config
    if (existsSync(configPath)) {
      const overwrite = await rl.question('.prototype-map/config.yaml already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Aborted.');
        return;
      }
    }

    // Create directory and config
    mkdirSync(configDir, { recursive: true });

    const config = {
      name: name.trim(),
      baseUrl,
      viewport: { width: 1280, height: 900 },
      round: 1,
      pages: [],
      journeys: []
    };

    writeConfig(configPath, config);

    // Register globally
    registerProject({
      name: name.trim(),
      path: projectDir,
      port
    });

    console.log(`\nProject "${name.trim()}" initialized.`);
    console.log(`  Config: ${configPath}`);
    console.log(`  Port: ${port}`);
    console.log(`\nNext steps:`);
    console.log(`  1. npx prototype-map serve`);
    console.log(`  2. Open your prototype and start recording with the extension`);
  } finally {
    rl.close();
  }
}
