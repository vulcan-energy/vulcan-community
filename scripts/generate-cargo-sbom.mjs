#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const cargoLockPath = join(repositoryRoot, 'Cargo.lock');
const sbomPath = join(repositoryRoot, 'SBOM.cdx.json');

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function packageOrder(left, right) {
  return (
    compareText(left.name, right.name)
    || compareText(left.version, right.version)
    || compareText(left.source, right.source)
    || compareText(left.checksum ?? '', right.checksum ?? '')
  );
}

export function parseCargoLockPackages(cargoLock) {
  const packages = [];

  for (const block of cargoLock.split(/\r?\n(?=\[\[package\]\]\r?\n)/)) {
    if (!block.startsWith('[[package]]')) continue;
    const field = (name) => block.match(
      new RegExp(`^${name} = "([^"]+)"\\r?$`, 'm'),
    )?.[1];
    const source = field('source');
    if (!source) continue;

    const name = field('name');
    const version = field('version');
    const checksum = field('checksum');
    if (!name || !version) {
      throw new Error('Cargo.lock has a non-local package without a name and version');
    }
    if (checksum && !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new Error(`Cargo.lock has an invalid checksum for ${name}@${version}`);
    }
    packages.push({ checksum, name, source, version });
  }

  return packages;
}

function sourceHash(source) {
  return createHash('sha256').update(source).digest('hex');
}

function cargoComponent(pkg) {
  const component = {
    type: 'library',
    'bom-ref':
      `urn:cargo-lock:${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`
      + `?source=${sourceHash(pkg.source)}`,
    name: pkg.name,
    version: pkg.version,
    purl: `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`,
    properties: [
      {
        name: 'cargo:source',
        value: pkg.source,
      },
    ],
  };

  if (pkg.checksum) {
    component.hashes = [
      {
        alg: 'SHA-256',
        content: pkg.checksum,
      },
    ];
  }
  return component;
}

export function generateCargoSbom(cargoLock) {
  const packages = parseCargoLockPackages(cargoLock).sort(packageOrder);
  return {
    $schema: 'https://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'Vulcan Community',
      },
    },
    components: packages.map(cargoComponent),
  };
}

export function renderCargoSbom(cargoLock) {
  return `${JSON.stringify(generateCargoSbom(cargoLock), null, 2)}\n`;
}

function runCli(args) {
  if (args.some((argument) => argument !== '--check')) {
    throw new Error('usage: node scripts/generate-cargo-sbom.mjs [--check]');
  }
  const check = args.includes('--check');
  const rendered = renderCargoSbom(readFileSync(cargoLockPath, 'utf8'));

  if (check) {
    if (!existsSync(sbomPath)) {
      throw new Error('SBOM.cdx.json is missing; run npm run generate:sbom');
    }
    if (readFileSync(sbomPath, 'utf8') !== rendered) {
      throw new Error('SBOM.cdx.json is stale; run npm run generate:sbom');
    }
    console.log('SBOM.cdx.json matches Cargo.lock.');
    return;
  }

  writeFileSync(sbomPath, rendered);
  const componentCount = JSON.parse(rendered).components.length;
  console.log(`Generated SBOM.cdx.json with ${componentCount} Cargo components.`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Cargo SBOM generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
