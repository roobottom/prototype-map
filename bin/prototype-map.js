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
  .option('-u, --url <url>', 'Base URL of the prototype')
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
  .description('Take screenshots of pages and states defined in config')
  .requiredOption('--project <slug>', 'Project to capture')
  .option('--round <n>', 'Override round number from config')
  .option('--page <id>', 'Capture only a specific page')
  .option('--journey <id>', 'Capture only pages in a specific journey')
  .action(async (opts) => {
    const { getConfigPath, getOutputDir } = await import('../src/registry.js');
    const { capture } = await import('../src/capture.js');
    await capture({
      config: getConfigPath(opts.project),
      out: getOutputDir(opts.project),
      round: opts.round,
      page: opts.page,
      journey: opts.journey
    });
  });

program
  .command('map')
  .description('Generate journey map visualization')
  .requiredOption('--project <slug>', 'Project to map')
  .option('--format <type>', 'Output format: html, png, svg, or all', 'html')
  .option('--journey <id>', 'Map a specific journey')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .option('--round <n>', 'Round to use for screenshot thumbnails')
  .action(async (opts) => {
    const { getConfigPath, getOutputDir } = await import('../src/registry.js');
    const { map } = await import('../src/map.js');
    await map({
      config: getConfigPath(opts.project),
      out: getOutputDir(opts.project),
      format: opts.format,
      journey: opts.journey,
      embedScreenshots: opts.embedScreenshots,
      round: opts.round
    });
  });

program
  .command('run')
  .description('Capture screenshots and generate map in one step')
  .requiredOption('--project <slug>', 'Project to run')
  .option('--round <n>', 'Override round number from config')
  .option('--format <type>', 'Map format: html, png, svg, or all', 'html')
  .option('--journey <id>', 'Specific journey only')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .action(async (opts) => {
    const { getConfigPath, getOutputDir } = await import('../src/registry.js');
    const { capture } = await import('../src/capture.js');
    const { map } = await import('../src/map.js');
    const shared = {
      config: getConfigPath(opts.project),
      out: getOutputDir(opts.project),
      round: opts.round,
      journey: opts.journey
    };
    await capture(shared);
    await map({ ...shared, format: opts.format, embedScreenshots: opts.embedScreenshots });
  });

program
  .command('deploy')
  .description('Copy screenshots and manifest to a target project directory')
  .requiredOption('--project <slug>', 'Project to deploy')
  .option('--round <n>', 'Override round number from config')
  .option('--target <path>', 'Destination directory (or set deploy.target in config)')
  .action(async (opts) => {
    const { getConfigPath, getOutputDir } = await import('../src/registry.js');
    const { deploy } = await import('../src/deploy.js');
    await deploy({
      config: getConfigPath(opts.project),
      out: getOutputDir(opts.project),
      round: opts.round,
      target: opts.target
    });
  });

program.parse();
