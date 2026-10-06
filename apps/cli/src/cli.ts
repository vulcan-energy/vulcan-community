// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { checkExitCode, checkGeometryCsv, printCheckSummary, type FailOn } from './check';
import { convertCsv, printValidationErrors } from './convert';
import { preflightModel, preflightPassed } from './preflight';
import {
  autoThermalBridges,
  printAutoCsvSection,
  printAutoSummary,
  printValidationSummary,
  validateThermalBridges,
} from './thermalBridges';
import { versionInfo, versionText } from './version';
import { loadModelWasm, modelWasmAvailable } from './wasm';

const HELP = `Usage: vulcan-community <command> [options]

Commands:
  check <csv> [--summary|--json] [--fail-on=none|critical|warning]
      Validate a geometry CSV. Exits 1 when issues reach --fail-on (default critical).
  thermal-bridges <csv> [--summary|--json|--csv-section]
      Propose automatic thermal bridges for a geometry CSV.
  thermal-bridges <csv> --validate [--with-auto] [--summary|--json]
      Validate the CSV's linear thermal bridges, optionally with the auto proposals added.
  convert <csv> [--output <file>] [--schema <file>] [--defaults <file>] [--json]
      Convert a geometry CSV to HEM input JSON (stdout, or --output). Defaults come from
      --defaults, else the CSV's DefaultsPath (relative to the current directory), else
      the bundled template. Exits 1 when the model fails schema validation.
  preflight <csv|json> [--schema <file>] [--defaults <file>] [--json]
      Run FHS preflight (no simulation) on a HEM JSON, or on a CSV after convert.
      Exits 1 on any issue.
  version [--json]
      Print the version and legal notices.

Options:
  -h, --help     Show this help
  -v, --version  Same as the version command

Powered by Vulcan — run \`vulcan-community version\` for legal notices.`;

const FAIL_ON: readonly FailOn[] = ['none', 'critical', 'warning'];

function singleCsv(positionals: string[], usage: string): string {
  if (positionals.length !== 1) throw new Error(`Usage: ${usage}`);
  return positionals[0]!;
}

function runCheck(args: string[]): number {
  const usage = 'vulcan-community check <csv> [--summary|--json] [--fail-on=none|critical|warning]';
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      summary: { type: 'boolean' },
      'fail-on': { type: 'string', default: 'critical' },
    },
  });
  const failOn = values['fail-on'] as FailOn;
  if (!FAIL_ON.includes(failOn)) throw new Error(`Unknown --fail-on value: ${failOn}`);
  const result = checkGeometryCsv(singleCsv(positionals, usage));
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else printCheckSummary(result);
  return checkExitCode(result, failOn);
}

function runThermalBridges(args: string[]): number {
  const usage =
    'vulcan-community thermal-bridges <csv> [--summary|--json|--csv-section] [--validate [--with-auto]]';
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      summary: { type: 'boolean' },
      'csv-section': { type: 'boolean' },
      validate: { type: 'boolean' },
      'with-auto': { type: 'boolean' },
    },
  });
  const csvPath = singleCsv(positionals, usage);

  if (values.validate) {
    if (values['csv-section']) throw new Error('--csv-section cannot be combined with --validate');
    const result = validateThermalBridges(csvPath, values['with-auto'] === true);
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else printValidationSummary(result);
    return 0;
  }

  if (values['with-auto']) throw new Error('--with-auto requires --validate');
  const result = autoThermalBridges(csvPath);
  if (values.json) console.log(JSON.stringify(result.proposals, null, 2));
  else if (values['csv-section']) printAutoCsvSection(result);
  else printAutoSummary(result);
  return 0;
}

const MODEL_OPTIONS = {
  json: { type: 'boolean' },
  schema: { type: 'string' },
  defaults: { type: 'string' },
} as const;

async function runConvert(args: string[]): Promise<number> {
  const usage =
    'vulcan-community convert <csv> [--output <file>] [--schema <file>] [--defaults <file>] [--json]';
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { ...MODEL_OPTIONS, output: { type: 'string' } },
  });
  const result = await convertCsv(singleCsv(positionals, usage), values);
  if (result.ok && values.output !== undefined) {
    writeFileSync(values.output, `${JSON.stringify(result.json, null, 2)}\n`);
  }
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok && values.output === undefined) console.log(JSON.stringify(result.json, null, 2));
    if (!result.ok) console.error(`Conversion failed: ${result.error}`);
    else if (!result.validation.is_valid) console.error('Schema validation failed:');
    printValidationErrors(result.validation);
  }
  return result.ok && result.validation.is_valid ? 0 : 1;
}

async function runPreflight(args: string[]): Promise<number> {
  const usage = 'vulcan-community preflight <csv|json> [--schema <file>] [--defaults <file>] [--json]';
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: MODEL_OPTIONS });
  const result = await preflightModel(singleCsv(positionals, usage), values);
  const passed = preflightPassed(result);
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return passed ? 0 : 1;
  }
  if (result.conversionError !== undefined) console.error(`Conversion failed: ${result.conversionError}`);
  if (result.validation?.is_valid === false) console.error('Schema validation failed:');
  printValidationErrors(result.validation);
  for (const error of result.preflight?.errors ?? []) {
    console.error(`  [${error.code}] ${error.path}: ${error.message}`);
  }
  console.log(passed ? 'FHS preflight passed' : 'FHS preflight failed');
  return passed ? 0 : 1;
}

async function runVersion(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } } });
  const wasm = modelWasmAvailable() ? await loadModelWasm() : null;
  const engines = wasm && {
    hemCoreVersion: wasm.hem_core_version(),
    fhsWrapperVersion: wasm.fhs_wrapper_version(),
  };
  console.log(values.json ? JSON.stringify(versionInfo(engines), null, 2) : versionText(engines));
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  // check keeps the old validate-geometry-csv contract: 1 = findings, 2 = could not run.
  const errorExitCode = command === 'check' ? 2 : 1;
  try {
    if (command === 'check') return runCheck(rest);
    if (command === 'thermal-bridges') return runThermalBridges(rest);
    if (command === 'convert') return await runConvert(rest);
    if (command === 'preflight') return await runPreflight(rest);
    if (command === 'version' || command === '--version' || command === '-v') return await runVersion(rest);
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      console.log(HELP);
      return 0;
    }
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return errorExitCode;
  }
}

process.exitCode = await main(process.argv.slice(2));
