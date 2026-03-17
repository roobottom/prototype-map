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
  .command('serve')
  .description('Start the recording server for the browser extension')
  .option('-c, --config <path>', 'Config file path', 'prototype-map.yaml')
  .option('-p, --port <n>', 'Server port', '4444')
  .action(async (opts) => {
    const { startServer } = await import('../src/server.js');
    await startServer(opts);
  });

program
  .command('record <url>')
  .description('Record a journey by clicking through a prototype (no extension needed)')
  .option('-c, --config <path>', 'Config file path', 'prototype-map.yaml')
  .option('-n, --name <name>', 'Name for the recording (e.g. "Round 1")')
  .option('-d, --description <text>', 'Description of the recording')
  .option('--append', 'Add to existing config instead of overwriting')
  .action(async (url, opts) => {
    const { record } = await import('../src/record.js');
    await record(url, opts);
  });

program
  .command('capture')
  .description('Take screenshots of pages and states defined in config')
  .option('-c, --config <path>', 'Config file path', 'prototype-map.yaml')
  .option('-o, --out <dir>', 'Output directory', 'prototype-map-output')
  .option('--round <n>', 'Override round number from config')
  .option('--page <id>', 'Capture only a specific page')
  .option('--journey <id>', 'Capture only pages in a specific journey')
  .action(async (opts) => {
    const { capture } = await import('../src/capture.js');
    await capture(opts);
  });

program
  .command('map')
  .description('Generate journey map visualization')
  .option('-c, --config <path>', 'Config file path', 'prototype-map.yaml')
  .option('-o, --out <dir>', 'Output directory', 'prototype-map-output')
  .option('--format <type>', 'Output format: html, png, svg, or all', 'html')
  .option('--journey <id>', 'Map a specific journey')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .option('--round <n>', 'Round to use for screenshot thumbnails')
  .action(async (opts) => {
    const { map } = await import('../src/map.js');
    await map(opts);
  });

program
  .command('run')
  .description('Capture screenshots and generate map in one step')
  .option('-c, --config <path>', 'Config file path', 'prototype-map.yaml')
  .option('-o, --out <dir>', 'Output directory', 'prototype-map-output')
  .option('--round <n>', 'Override round number from config')
  .option('--format <type>', 'Map format: html, png, svg, or all', 'html')
  .option('--journey <id>', 'Specific journey only')
  .option('--embed-screenshots', 'Embed screenshot thumbnails in map nodes')
  .action(async (opts) => {
    const { capture } = await import('../src/capture.js');
    const { map } = await import('../src/map.js');
    await capture(opts);
    await map({ ...opts, embedScreenshots: opts.embedScreenshots });
  });

program.parse();
