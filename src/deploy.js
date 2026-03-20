import { cpSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { loadConfig } from './config.js';

/**
 * Deploy screenshots and manifest to a target directory.
 * Copies the journey's screenshots folder to the target.
 */
export async function deploy(opts) {
  const config = loadConfig(opts.config);
  const sourceDir = resolve(opts.screenshotDir);

  const target = opts.target || config.deploy?.target;
  if (!target) {
    throw new Error(
      'No deploy target specified. Use --target <path> or set deploy.target in your config.'
    );
  }
  const destDir = resolve(target);

  if (!existsSync(sourceDir)) {
    throw new Error(
      `No screenshots found at ${sourceDir}. Run 'capture' first.`
    );
  }

  const files = readdirSync(sourceDir);
  const pngs = files.filter(f => f.endsWith('.png'));
  const hasManifest = files.includes('manifest.json');

  cpSync(sourceDir, destDir, { recursive: true });

  console.log(`Deployed to ${destDir}`);
  console.log(`  ${pngs.length} screenshot(s)${hasManifest ? ' + manifest.json' : ''}`);
}
