import { cpSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { loadConfig } from './config.js';

/**
 * Deploy screenshots and manifest to a target directory.
 * Copies the round folder (PNGs + manifest.json) to the target.
 */
export async function deploy(opts) {
  const config = loadConfig(opts.config);
  const round = opts.round ? Number(opts.round) : config.round;
  const outDir = resolve(opts.out);
  const sourceDir = join(outDir, 'screenshots', `round-${round}`);

  // Resolve target: CLI flag takes priority, then config, then error
  const target = opts.target || config.deploy?.target;
  if (!target) {
    throw new Error(
      'No deploy target specified. Use --target <path> or set deploy.target in your config.'
    );
  }
  const targetDir = resolve(target);
  const destDir = join(targetDir, `round-${round}`);

  // Check source exists
  if (!existsSync(sourceDir)) {
    throw new Error(
      `No screenshots found at ${sourceDir}. Run 'capture' first.`
    );
  }

  // Count files to copy
  const files = readdirSync(sourceDir);
  const pngs = files.filter(f => f.endsWith('.png'));
  const hasManifest = files.includes('manifest.json');

  // Copy the entire round directory
  cpSync(sourceDir, destDir, { recursive: true });

  console.log(`Deployed round ${round} to ${destDir}`);
  console.log(`  ${pngs.length} screenshot(s)${hasManifest ? ' + manifest.json' : ''}`);
}
