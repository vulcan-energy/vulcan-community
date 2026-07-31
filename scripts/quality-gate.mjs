#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Community-owned static-analysis ratchet. Both the runner and its baseline live in this
// repository so every checkout enforces the same floor.
// Existing debt is allowed; a regression in any recorded metric is not.
//
//   node scripts/quality-gate.mjs            # report movement, always exit 0
//   node scripts/quality-gate.mjs --enforce  # fail if any metric worsened
//   node scripts/quality-gate.mjs --update   # lower the baseline to current results

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = {
  eslintRoot: '.',
  doctorRoot: 'packages/geometry-editor',
  baseline: 'quality-baseline.json',
}

function runJson(cmd, args, cwd) {
  // Both tools exit non-zero when they find problems, which is the normal case here, so
  // status is ignored and only unparseable output is treated as a runner failure.
  let stdout = ''
  try {
    stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    stdout = error.stdout ?? ''
    if (!stdout.trim()) {
      throw new Error(`${cmd} produced no output in ${cwd}: ${error.stderr || error.message}`)
    }
  }
  return JSON.parse(stdout)
}

function measureEslint(root) {
  const results = runJson('npx', ['eslint', '.', '-f', 'json'], join(REPO_ROOT, root))
  let errors = 0
  let warnings = 0
  let filesWithProblems = 0
  const byRule = {}
  for (const result of results) {
    if (result.messages.length > 0) filesWithProblems += 1
    for (const message of result.messages) {
      const rule = message.ruleId ?? '(no rule)'
      byRule[rule] = (byRule[rule] ?? 0) + 1
      if (message.severity === 2) errors += 1
      else warnings += 1
    }
  }
  return { errors, warnings, filesWithProblems, byRule }
}

function measureReactDoctor(root) {
  const report = runJson(
    'npx',
    ['react-doctor', '--json', '--no-dead-code', '-y', '.'],
    join(REPO_ROOT, root),
  )
  const summary = report.summary ?? {}
  const byRule = {}
  for (const diagnostic of report.diagnostics ?? []) {
    const rule = diagnostic.rule ?? '(no rule)'
    byRule[rule] = (byRule[rule] ?? 0) + 1
  }
  return {
    score: summary.score ?? null,
    errors: summary.errorCount ?? 0,
    warnings: summary.warningCount ?? 0,
    affectedFiles: summary.affectedFileCount ?? 0,
    byRule,
  }
}

// Score rises as quality improves; every other metric falls. Comparing in the wrong
// direction would make the gate celebrate a regression, so direction is explicit per key.
const METRICS = [
  ['eslint', 'errors', 'lower'],
  ['eslint', 'warnings', 'lower'],
  ['reactDoctor', 'errors', 'lower'],
  ['reactDoctor', 'warnings', 'lower'],
  ['reactDoctor', 'score', 'higher'],
]

function compare(baseline, current) {
  const regressions = []
  const improvements = []
  for (const [group, key, better] of METRICS) {
    const was = baseline?.[group]?.[key]
    const now = current[group][key]
    if (typeof was !== 'number' || typeof now !== 'number' || was === now) continue
    const worse = better === 'lower' ? now > was : now < was
    const entry = { label: `${group}.${key}`, was, now }
    if (worse) regressions.push(entry)
    else improvements.push(entry)
  }
  return { regressions, improvements }
}

const flags = process.argv.slice(2)
const unknownFlags = flags.filter((flag) => flag !== '--enforce' && flag !== '--update')
if (unknownFlags.length > 0) {
  console.error('Usage: quality-gate.mjs [--enforce] [--update]')
  process.exit(2)
}
const enforce = flags.includes('--enforce')
const update = flags.includes('--update')

console.log('quality-gate: community')
const current = {
  eslint: measureEslint(TARGET.eslintRoot),
  reactDoctor: measureReactDoctor(TARGET.doctorRoot),
}

console.log(
  `  eslint        ${current.eslint.errors} errors, ${current.eslint.warnings} warnings ` +
    `across ${current.eslint.filesWithProblems} files (${TARGET.eslintRoot})`,
)
console.log(
  `  react-doctor  score ${current.reactDoctor.score}, ${current.reactDoctor.errors} errors, ` +
    `${current.reactDoctor.warnings} warnings across ${current.reactDoctor.affectedFiles} files ` +
    `(${TARGET.doctorRoot})`,
)

const baselinePath = join(REPO_ROOT, TARGET.baseline)

if (update) {
  const next = {
    recorded: new Date().toISOString().slice(0, 10),
    note:
      'Recorded by scripts/quality-gate.mjs. Counts are a ratchet, not a target: they exist ' +
      'so new problems are visible against a known floor, and are expected to fall.',
    eslintRoot: TARGET.eslintRoot,
    doctorRoot: TARGET.doctorRoot,
    eslint: {
      errors: current.eslint.errors,
      warnings: current.eslint.warnings,
      filesWithProblems: current.eslint.filesWithProblems,
      byRule: current.eslint.byRule,
    },
    reactDoctor: {
      score: current.reactDoctor.score,
      errors: current.reactDoctor.errors,
      warnings: current.reactDoctor.warnings,
      affectedFiles: current.reactDoctor.affectedFiles,
      byRule: current.reactDoctor.byRule,
    },
  }
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`  baseline written to ${TARGET.baseline}`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  const message = `quality-gate: no baseline at ${TARGET.baseline}; run with --update to record one`
  if (enforce) {
    console.error(message)
    process.exit(1)
  }
  console.log(message)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const { regressions, improvements } = compare(baseline, current)

for (const { label, was, now } of improvements) {
  console.log(`  improved  ${label}: ${was} -> ${now}`)
}
for (const { label, was, now } of regressions) {
  console.log(`  WORSE     ${label}: ${was} -> ${now}`)
}
if (regressions.length === 0 && improvements.length === 0) {
  console.log('  unchanged against baseline')
}

if (improvements.length > 0 && regressions.length === 0) {
  console.log('  run: node scripts/quality-gate.mjs --update  to lower the ratchet')
}

if (regressions.length > 0 && enforce) {
  console.error('quality-gate: refusing — static analysis got worse against the recorded baseline')
  process.exit(1)
}
process.exit(0)
