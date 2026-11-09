/**
 * Doctor Script
 *
 * Checks that the local environment is ready to run ContextMCP: Node version,
 * config file presence + validity, and required API key env vars for the
 * configured embedding provider and vector DB.
 *
 * Usage:
 *   npx tsx scripts/doctor.ts
 *   npx tsx scripts/doctor.ts --config path/to/config.yaml
 *
 * Exit codes:
 *   0  all checks passed (warnings allowed)
 *   1  one or more checks failed
 */

import { readFileSync, existsSync } from 'fs';
import 'dotenv/config';
import { parse as parseYaml } from 'yaml';
import {
  checkNodeVersion,
  checkEnvVar,
  checkConfig,
  countResults,
  hasFailure,
  type CheckResult,
} from '../src/config/doctor-checks.js';
import { CONFIG_PATHS, findConfigFile } from '../src/config/loader.js';

interface CliArgs {
  config?: string;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--config' || arg === '-c') {
      const value = process.argv[i + 1];
      if (value === undefined) {
        console.error(`❌ Missing value for ${arg} — expected a path to a config file.`);
        process.exit(1);
      }
      args.config = value;
      i++;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
ContextMCP Doctor

Checks that your environment is ready to index and serve documentation.

Usage:
  npx tsx scripts/doctor.ts [options]

Options:
  --help, -h             Show this help message
  --config, -c <path>    Use a specific config file

Exit codes:
  0  all checks passed
  1  one or more checks failed
`);
}

const ICON = { pass: '✅', warn: '⚠️ ', fail: '❌' } as const;

function render(results: CheckResult[]): void {
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  }
}

function summarise(results: CheckResult[]): void {
  const { pass, warn, fail } = countResults(results);
  console.log('\n' + '═'.repeat(50));
  console.log(`\n${pass} passed, ${warn} warning(s), ${fail} failed`);
  if (hasFailure(results)) {
    console.error('\n❌ Environment is NOT ready. Fix the failed checks above.');
    process.exit(1);
  }
  console.log('\n✅ Environment is ready.');
}

function main(): void {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  console.log('🩺 ContextMCP Doctor\n');
  console.log('═'.repeat(50) + '\n');

  const results: CheckResult[] = [];

  // 1. Node.js version.
  results.push(checkNodeVersion(process.versions.node));

  // 2. Config file presence.
  const configPath = args.config || findConfigFile();
  if (!configPath || !existsSync(configPath)) {
    results.push({
      status: 'fail',
      label: 'Config file',
      detail: `not found (looked for ${CONFIG_PATHS.join(', ')})`,
    });
    render(results);
    summarise(results);
    return;
  }
  results.push({ status: 'pass', label: 'Config file', detail: configPath });

  // 3-4. Config parse/validate + embedding consistency + provider key.
  let raw: any;
  try {
    raw = parseYaml(readFileSync(configPath, 'utf-8'));
    results.push(...checkConfig(raw, process.env));
  } catch (error) {
    results.push({
      status: 'fail',
      label: 'Config parses',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // 5. Vector DB key / configuration.
  const vectorDbProvider = raw?.vectordb?.provider || 'pinecone';
  if (vectorDbProvider === 'qdrant') {
    const qdrantUrl = process.env.QDRANT_URL || raw?.vectordb?.qdrant?.url || 'http://localhost:6333';
    results.push({
      status: 'pass',
      label: 'Qdrant URL',
      detail: qdrantUrl,
    });
  } else {
    results.push(checkEnvVar('PINECONE_API_KEY', process.env));
  }

  render(results);
  summarise(results);
}

main();
