#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

program
  .name('prototype-map')
  .description('Screenshot capture and journey map generator for prototypes')
  .version(pkg.version);

program
  .command('init')
  .description('Create a new project')
  .option('-n, --name <name>', 'Project name')
  .action(async (opts) => {
    const { init } = await import('../src/init.js');
    await init(opts);
  });

program
  .command('serve')
  .description('Start the server and dashboard')
  .option('-p, --port <n>', 'Server port', '4444')
  .action(async (opts) => {
    const { startServer } = await import('../src/server.js');
    await startServer(opts);
  });

program
  .command('capture')
  .description('Take screenshots for a journey')
  .requiredOption('--project <slug>', 'Project slug')
  .requiredOption('--journey <slug>', 'Journey slug')
  .action(async (opts) => {
    const { getConfigPath, getScreenshotDir } = await import('../src/registry.js');
    const { capture } = await import('../src/capture.js');
    await capture({
      config: getConfigPath(opts.project, opts.journey),
      screenshotDir: getScreenshotDir(opts.project, opts.journey)
    });
  });

program
  .command('map')
  .description('Generate journey map visualization')
  .requiredOption('--project <slug>', 'Project slug')
  .requiredOption('--journey <slug>', 'Journey slug')
  .option('--format <type>', 'Output format: html, png, svg, or all', 'html')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .action(async (opts) => {
    const { getConfigPath, getScreenshotDir, getJourneyDir } = await import('../src/registry.js');
    const { map } = await import('../src/map.js');
    await map({
      config: getConfigPath(opts.project, opts.journey),
      mapDir: getJourneyDir(opts.project, opts.journey),
      screenshotDir: getScreenshotDir(opts.project, opts.journey),
      format: opts.format,
      embedScreenshots: opts.embedScreenshots
    });
  });

program
  .command('run')
  .description('Capture screenshots and generate map in one step')
  .requiredOption('--project <slug>', 'Project slug')
  .requiredOption('--journey <slug>', 'Journey slug')
  .option('--format <type>', 'Map format: html, png, svg, or all', 'html')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .action(async (opts) => {
    const { getConfigPath, getScreenshotDir, getJourneyDir } = await import('../src/registry.js');
    const { capture } = await import('../src/capture.js');
    const { map } = await import('../src/map.js');
    const configPath = getConfigPath(opts.project, opts.journey);
    const screenshotDir = getScreenshotDir(opts.project, opts.journey);
    await capture({ config: configPath, screenshotDir });
    await map({
      config: configPath,
      mapDir: getJourneyDir(opts.project, opts.journey),
      screenshotDir,
      format: opts.format,
      embedScreenshots: opts.embedScreenshots
    });
  });

program
  .command('deploy')
  .description('Copy screenshots and manifest to a target directory')
  .requiredOption('--project <slug>', 'Project slug')
  .requiredOption('--journey <slug>', 'Journey slug')
  .option('--target <path>', 'Destination directory (or set deploy.target in config)')
  .action(async (opts) => {
    const { getConfigPath, getScreenshotDir } = await import('../src/registry.js');
    const { deploy } = await import('../src/deploy.js');
    await deploy({
      config: getConfigPath(opts.project, opts.journey),
      screenshotDir: getScreenshotDir(opts.project, opts.journey),
      target: opts.target
    });
  });

program.parse();
