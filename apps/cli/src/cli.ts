// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { parseArgs } from 'node:util';

import { checkExitCode, checkGeometryCsv, printCheckSummary, type FailOn } from './check';
import {
  autoThermalBridges,
  printAutoCsvSection,
  printAutoSummary,
  printValidationSummary,
  validateThermalBridges,
} from './thermalBridges';
import { versionInfo, versionText } from './version';

const HELP = `Usage: vulcan-community <command> [options]

Commands:
  check <csv> [--summary|--json] [--fail-on=none|critical|warning]
      Validate a geometry CSV. Exits 1 when issues reach --fail-on (default critical).
  thermal-bridges <csv> [--summary|--json|--csv-section]
      Propose automatic thermal bridges for a geometry CSV.
  thermal-bridges <csv> --validate [--with-auto] [--summary|--json]
      Validate the CSV's linear thermal bridges, optionally with the auto proposals added.
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

function runVersion(args: string[]): number {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } } });
  console.log(values.json ? JSON.stringify(versionInfo(), null, 2) : versionText());
  return 0;
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  // check keeps the old validate-geometry-csv contract: 1 = findings, 2 = could not run.
  const errorExitCode = command === 'check' ? 2 : 1;
  try {
    if (command === 'check') return runCheck(rest);
    if (command === 'thermal-bridges') return runThermalBridges(rest);
    if (command === 'version' || command === '--version' || command === '-v') return runVersion(rest);
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

process.exitCode = main(process.argv.slice(2));
