#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: CC-BY-4.0

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseCargoLockPackages,
  renderCargoSbom,
} from './generate-cargo-sbom.mjs';

const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = packDir;
const releaseMode = process.argv.includes('--release');
const failures = [];

const FETCHED_ARTIFACT_ACQUISITION =
  'fetched_and_hash_verified_by_community_scripts_fetch_ifc_wheel_sh';
const FETCHED_IFC_WHEEL_PATH =
  'apps/geometry-editor/public/ifc/ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl';

function isUnresolvedLicense(value) {
  return value === 'PENDING' || value === 'per-file';
}

// Answers one question: is this the known, hash-pinned wheel that is deliberately
// not committed? That is a question of identity, and every check below establishes
// it. The entry's release_status and export_action used to be required here too,
// which conflated identity with policy — so the record could not state a different
// release position without this predicate rejecting the file's absence. Policy now
// lives only in the release-mode checks that read those fields.
function isRecordedAbsentFetchedArtifact(entry) {
  return (
    entry.path === FETCHED_IFC_WHEEL_PATH
    && entry.source_path === FETCHED_IFC_WHEEL_PATH
    && entry.license === 'GPL-3.0-or-later'
    && entry.committed === false
    && entry.expected_absent_from_git === true
    && entry.acquisition === FETCHED_ARTIFACT_ACQUISITION
    && typeof entry.source_sha256 === 'string'
  );
}

function verifyCandidateSource(entry, label) {
  if (!entry.source_path || entry.source_path.includes('*')) return;
  const sourcePath = join(repositoryRoot, entry.source_path);
  if (!existsSync(sourcePath)) {
    if (isRecordedAbsentFetchedArtifact(entry)) return;
    failures.push(`${label} references missing candidate source: ${entry.source_path}`);
    return;
  }
  if (!entry.source_sha256) return;
  const actual = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  if (actual !== entry.source_sha256) {
    failures.push(
      `${label} hash mismatch for ${entry.source_path}: expected ${entry.source_sha256}, got ${actual}`,
    );
  }
}

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.mjs',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const FIRST_PARTY_LICENSES = new Set([
  'AGPL-3.0-only',
  'Apache-2.0',
  'CC-BY-4.0',
]);
const EXPECTED_COPYRIGHT =
  'SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors';

function manifestPathMatches(pattern, candidatePath) {
  if (pattern.endsWith('/**')) {
    return candidatePath.startsWith(pattern.slice(0, -2));
  }
  return pattern === candidatePath;
}

function manifestEntryMatches(entry, candidatePath) {
  return (
    manifestPathMatches(entry.path, candidatePath)
    && !(entry.exceptions ?? []).some((exception) =>
      manifestPathMatches(exception, candidatePath))
  );
}

function isCoverageExcludedPath(candidatePath) {
  return (
    candidatePath === 'hem_engine_upstream'
    || candidatePath.startsWith('hem_engine_upstream/')
    || candidatePath === 'hem_fhs_upstream'
    || candidatePath.startsWith('hem_fhs_upstream/')
  );
}

function isHeaderExcludedPath(candidatePath) {
  return (
    candidatePath === 'Cargo.lock'
    || candidatePath === 'package-lock.json'
    || candidatePath === 'hem_engine_upstream'
    || candidatePath.startsWith('hem_engine_upstream/')
    || candidatePath === 'hem_fhs_upstream'
    || candidatePath.startsWith('hem_fhs_upstream/')
    || candidatePath.startsWith('third_party/')
    || candidatePath.startsWith('apps/geometry-editor/src/generated/')
    || (
      candidatePath.startsWith('apps/geometry-editor/src/assets/ifc/')
      && candidatePath !== 'apps/geometry-editor/src/assets/ifc/ifc_parser.py'
    )
  );
}

function classifyPath(manifest, candidatePath) {
  return (manifest.entries ?? [])
    .filter((entry) => manifestEntryMatches(entry, candidatePath))
    .sort((left, right) => {
      const exactDifference =
        Number(!left.path.includes('*')) - Number(!right.path.includes('*'));
      return exactDifference || left.path.length - right.path.length;
    })
    .at(-1);
}

function trackedPaths() {
  try {
    return execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    failures.push(`could not enumerate repository paths: ${error.message}`);
    return [];
  }
}

function verifyPathCoverageAndSpdxHeaders(manifest) {
  const counts = new Map();
  const unclassified = [];
  const entries = manifest.entries ?? [];
  const entryMatchCounts = new Map(entries.map((entry) => [entry.path, 0]));

  for (const candidatePath of trackedPaths()) {
    for (const entry of entries) {
      if (manifestEntryMatches(entry, candidatePath)) {
        entryMatchCounts.set(entry.path, entryMatchCounts.get(entry.path) + 1);
      }
    }

    const absolutePath = join(repositoryRoot, candidatePath);
    if (isCoverageExcludedPath(candidatePath)) continue;

    const entry = classifyPath(manifest, candidatePath);
    if (!entry) {
      unclassified.push(candidatePath);
    }

    if (isHeaderExcludedPath(candidatePath)) {
      if (
        existsSync(absolutePath)
        && statSync(absolutePath).isFile()
        && readFileSync(absolutePath, 'utf8').includes(EXPECTED_COPYRIGHT)
      ) {
        failures.push(`protected upstream or third-party path has a Vulcan header: ${candidatePath}`);
      }
      continue;
    }
    if (!entry) continue;
    if (!SOURCE_EXTENSIONS.has(extname(candidatePath))) continue;
    const { license } = entry;
    if (!FIRST_PARTY_LICENSES.has(license)) continue;

    const content = readFileSync(absolutePath, 'utf8');
    if (!content.includes(EXPECTED_COPYRIGHT)) {
      failures.push(`${candidatePath} is missing the required SPDX copyright line`);
    }
    if (!content.includes(`SPDX-License-Identifier: ${license}`)) {
      failures.push(`${candidatePath} is missing SPDX-License-Identifier: ${license}`);
    }
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }

  for (const entry of entries) {
    const matchCount = entryMatchCounts.get(entry.path);
    if (matchCount === 0 && entry.expected_absent_from_git !== true) {
      failures.push(`manifest entry matches no tracked path: ${entry.path}`);
    }
    if (matchCount > 0 && entry.expected_absent_from_git === true) {
      failures.push(
        `manifest entry marked expected_absent_from_git matches a tracked path: ${entry.path}`,
      );
    }
  }

  if (unclassified.length > 0) {
    failures.push(
      `${releaseMode ? 'release mode' : 'ordinary validation'} has `
        + `${unclassified.length} unclassified path(s): `
        + unclassified.join(', '),
    );
  }
  return { counts, unclassified };
}

const requiredFiles = [
  'README.md',
  'ADDITIONAL_TERMS.md',
  'ATTRIBUTION.md',
  'NOTICE',
  'TRADEMARKS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'AGENTS.md',
  'CLA-INDIVIDUAL.md',
  'CLA-ENTITY.md',
  'PATH_RIGHTS.md',
  'LICENSE',
  'LICENSES/Apache-2.0.txt',
  'LICENSES/CC-BY-4.0.txt',
  'LICENSES/OGL-UK-3.0.txt',
  'licence-manifest.json',
  'vulcan-origin.json',
  'CITATION.cff',
];

function read(relativePath) {
  const absolutePath = join(packDir, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`missing required file: ${relativePath}`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, expected) {
  const content = read(relativePath);
  if (!content.includes(expected)) {
    failures.push(`${relativePath} is missing required text: ${expected}`);
  }
}

function collectSbomComponents(components, identities) {
  for (const component of components ?? []) {
    if (component?.name && component?.version) {
      identities.add(`${component.name}@${component.version}`);
    }
    collectSbomComponents(component?.components, identities);
  }
}

function verifyReleaseSbom(config) {
  const expected = {
    path: 'SBOM.cdx.json',
    format: 'CycloneDX JSON',
    cargo_lock: 'Cargo.lock',
    required_coverage: 'every non-local locked Rust package',
  };
  if (JSON.stringify(config) !== JSON.stringify(expected)) {
    failures.push('licence-manifest.json has an invalid release_sbom contract');
    return;
  }
  const sbomPath = join(packDir, config.path);
  if (!existsSync(sbomPath)) {
    failures.push(`missing required deterministic Cargo SBOM: ${config.path}`);
    return;
  }

  const sbomSource = readFileSync(sbomPath, 'utf8');
  let sbom;
  try {
    sbom = JSON.parse(sbomSource);
  } catch (error) {
    failures.push(`${config.path} is invalid JSON: ${error.message}`);
    return;
  }
  if (
    sbom.bomFormat !== 'CycloneDX'
    || sbom.specVersion !== '1.6'
    || !Array.isArray(sbom.components)
  ) {
    failures.push(`${config.path} is not a CycloneDX 1.6 JSON component inventory`);
    return;
  }

  const cargoLockPath = join(packDir, config.cargo_lock);
  if (!existsSync(cargoLockPath)) return;
  const cargoLock = readFileSync(cargoLockPath, 'utf8');
  let lockedPackages;
  let expectedSbom;
  try {
    lockedPackages = parseCargoLockPackages(cargoLock);
    expectedSbom = renderCargoSbom(cargoLock);
  } catch (error) {
    failures.push(`could not derive ${config.path} from Cargo.lock: ${error.message}`);
    return;
  }
  const sbomIdentities = new Set();
  collectSbomComponents(sbom.components, sbomIdentities);
  const missing = lockedPackages
    .filter(({ name, version }) => !sbomIdentities.has(`${name}@${version}`))
    .map(({ name, version }) => `${name}@${version}`);
  if (missing.length > 0) {
    const preview = missing.slice(0, 20).join(', ');
    const suffix = missing.length > 20 ? `, and ${missing.length - 20} more` : '';
    failures.push(
      `${config.path} misses ${missing.length} non-local Cargo.lock package(s): ${preview}${suffix}`,
    );
  }
  if (sbomSource !== expectedSbom) {
    failures.push(`${config.path} is stale or was not generated deterministically from Cargo.lock`);
  }
}

for (const relativePath of requiredFiles) {
  read(relativePath);
}

let manifest;
let origin;
let spdxSummary;

try {
  manifest = JSON.parse(read('licence-manifest.json'));
} catch (error) {
  failures.push(`licence-manifest.json is invalid JSON: ${error.message}`);
}

try {
  origin = JSON.parse(read('vulcan-origin.json'));
} catch (error) {
  failures.push(`vulcan-origin.json is invalid JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.status !== 'approved') {
    failures.push('licence-manifest.json status must be "approved"');
  }
  if (manifest.export_authorized !== true) {
    failures.push('licence-manifest.json export_authorized must be true');
  }
  if (manifest.default_action !== 'exclude') {
    failures.push('licence-manifest.json default_action must be "exclude"');
  }
  for (const noticeInput of manifest.generated_notice_inputs ?? []) {
    if (!existsSync(join(packDir, noticeInput))) {
      failures.push(`licence-manifest.json references missing notice input: ${noticeInput}`);
    }
  }
  verifyReleaseSbom(manifest.release_sbom);
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    failures.push('licence-manifest.json must contain path entries');
  }
  const seenPaths = new Set();
  for (const entry of manifest.entries ?? []) {
    if (!entry.path || !entry.license || !entry.rights_status) {
      failures.push(`incomplete licence-manifest entry: ${JSON.stringify(entry)}`);
    }
    if (seenPaths.has(entry.path)) failures.push(`duplicate manifest path: ${entry.path}`);
    seenPaths.add(entry.path);
    if (entry.additional_terms && entry.license !== 'AGPL-3.0-only') {
      failures.push(`additional terms applied outside AGPL path: ${entry.path}`);
    }
    if (
      Object.hasOwn(entry, 'expected_absent_from_git')
      && entry.expected_absent_from_git !== true
    ) {
      failures.push(
        `expected_absent_from_git must be true when present: ${entry.path}`,
      );
    }
    if (entry.committed === false && !isRecordedAbsentFetchedArtifact(entry)) {
      failures.push(`invalid deliberately-absent artifact record: ${entry.path}`);
    }
    verifyCandidateSource(entry, `licence-manifest entry ${entry.path}`);
    for (const exceptionPath of entry.exceptions ?? []) {
      if (!manifest.entries.some((candidate) => candidate.path === exceptionPath)) {
        failures.push(
          `licence-manifest exception has no exact classification: ${exceptionPath}`,
        );
      }
    }
  }

  const requiredPathLicenses = new Map([
    ['data/defaults/defaults_template.json', 'AGPL-3.0-only'],
    ['data/schemas/core-input.schema.json', 'MIT'],
    ['data/schemas/input_fhs.schema.json', 'MIT'],
    ['data/junction_psi_defaults/table_3_7_default_psi.csv', 'OGL-UK-3.0'],
    ['data/assembly_library/materials.json', 'CC-BY-4.0'],
    ['data/assembly_library/cavity_resistances.json', 'CC-BY-4.0'],
    ['data/assembly_library/assemblies.json', 'CC-BY-4.0'],
    ['apps/geometry-editor/src/assets/ifc/ifc_parser.py', 'AGPL-3.0-only'],
    ['SBOM.cdx.json', 'CC-BY-4.0'],
    ['scripts/generate-cargo-sbom.mjs', 'AGPL-3.0-only'],
    ['scripts/generate-cargo-sbom.test.mjs', 'AGPL-3.0-only'],
    ['scripts/validate-licensing.mjs', 'CC-BY-4.0'],
    ['package.json', 'AGPL-3.0-only'],
    ['.gitignore', 'AGPL-3.0-only'],
    ['tsconfig.phase1a.json', 'AGPL-3.0-only'],
    [
      'packages/geometry-editor/src/geometry/__fixtures__/example_semi_detached.csv',
      'CC-BY-4.0',
    ],
    [FETCHED_IFC_WHEEL_PATH, 'GPL-3.0-or-later'],
    ['deployment/netlify/_headers', 'Apache-2.0'],
    ['deployment/nginx.conf', 'Apache-2.0'],
    ['third_party/jsonschema-0.46.5-offline/**', 'MIT'],
    ['hem_engine_upstream', 'MIT'],
    ['hem_fhs_upstream', 'MIT'],
  ]);
  for (const [requiredPath, requiredLicense] of requiredPathLicenses) {
    const entry = manifest.entries?.find((candidate) => candidate.path === requiredPath);
    if (!entry) {
      failures.push(`licence-manifest.json is missing selected public path: ${requiredPath}`);
    } else if (entry.license !== requiredLicense) {
      failures.push(
        `licence-manifest.json has ${entry.license} for ${requiredPath}; expected ${requiredLicense}`,
      );
    }
    if (!requiredPath.includes('*')) {
      const resolvedEntry = classifyPath(manifest, requiredPath);
      if (resolvedEntry?.license !== requiredLicense) {
        failures.push(
          `licence-manifest.json resolves ${requiredPath} to `
            + `${String(resolvedEntry?.license)}; expected ${requiredLicense}`,
        );
      }
    }
  }

  const jsonschema = manifest.entries?.find(
    (entry) => entry.path === 'third_party/jsonschema-0.46.5-offline/**',
  );
  const requiredJsonschemaProvenance = {
    component: 'jsonschema',
    version: '0.46.5',
    source: 'https://crates.io/crates/jsonschema/0.46.5',
    source_revision: '77457694b36546bd9b79662d92a64b531d88bb7f',
    source_archive_sha256:
      '6a5fe5206f06e589caf25e79fc05ccdf91fca745685fe9fe1a13bbdfb479a631',
    provenance: 'third_party/jsonschema-0.46.5-offline/VULCAN_PROVENANCE.md',
    license_notice: 'third_party/jsonschema-0.46.5-offline/LICENSE',
  };
  for (const [field, expected] of Object.entries(requiredJsonschemaProvenance)) {
    if (jsonschema?.[field] !== expected) {
      failures.push(
        `jsonschema 0.46.5 manifest provenance has invalid ${field}: `
          + `${String(jsonschema?.[field])}`,
      );
    }
  }

  for (const approvedDecisionPath of [
    'data/defaults/defaults_template.json',
    'data/schemas/core-input.schema.json',
    'data/schemas/input_fhs.schema.json',
    'data/junction_psi_defaults/table_3_7_default_psi.csv',
    'data/assembly_library/materials.json',
    'data/assembly_library/cavity_resistances.json',
    'data/assembly_library/assemblies.json',
    'apps/geometry-editor/src/assets/ifc/ifc_parser.py',
    'hem_engine_upstream',
    'hem_fhs_upstream',
  ]) {
    const entry = manifest.entries?.find(
      (candidate) => candidate.path === approvedDecisionPath,
    );
    if (entry?.rights_status !== 'approved') {
      failures.push(`${approvedDecisionPath} is an approved publishable decision and must remain approved`);
    }
  }

  const table37 = manifest.entries?.find(
    (entry) => entry.path === 'data/junction_psi_defaults/table_3_7_default_psi.csv',
  );
  if (!table37?.attribution?.includes('Open Government Licence v3.0')) {
    failures.push('Table 3.7 manifest entry is missing the OGL v3 attribution');
  }
  if (
    table37?.source !== 'Home Energy Model guidance, Building Fabric, section 3.7.2, Table 3.7'
    || !table37.source_revision?.includes('HEM guidance Building Fabric, Table 3.7')
  ) {
    failures.push('Table 3.7 manifest entry is missing exact HEM guidance source provenance');
  }
  if (/SAP 10\.2|Appendix K|Table K1|breeam\.com/.test(JSON.stringify(table37 ?? {}))) {
    failures.push('Table 3.7 manifest entry still carries the withdrawn SAP Appendix K attribution');
  }

  for (const [phaseName, phase] of Object.entries(manifest)) {
    if (!phaseName.startsWith('phase_')) continue;
    if (!phase || typeof phase !== 'object') {
      failures.push(`${phaseName} must be an object`);
      continue;
    }
    const expectedAuthorization = true;
    if (phase.export_authorized !== expectedAuthorization) {
      failures.push(
        `all phase export_authorized flags must be ${String(expectedAuthorization)}`,
      );
    }
    for (const entry of phase.source_entries ?? []) {
      if (!entry.export_path) continue;
      if (!entry.source_path || !entry.classification || !entry.intended_license || !entry.rights_status) {
        failures.push(`${phaseName} has an incomplete public source entry: ${JSON.stringify(entry)}`);
        continue;
      }
      if (releaseMode && entry.rights_status !== 'approved') {
        failures.push(`${phaseName} has an unapproved public source: ${entry.export_path}`);
      }
      if (releaseMode && entry.release_status?.startsWith('blocked_')) {
        failures.push(`release-blocked path: ${entry.export_path}`);
      }
      if (releaseMode && isUnresolvedLicense(entry.intended_license)) {
        failures.push(`${phaseName} has an unresolved public-source licence: ${entry.export_path}`);
      }
    }
    for (const dependency of phase.remote_runtime_dependencies ?? []) {
      if (!dependency.component || !dependency.version || !dependency.license || !dependency.rights_status) {
        failures.push(`${phaseName} has an incomplete runtime dependency: ${JSON.stringify(dependency)}`);
        continue;
      }
      if (dependency.export_authorized !== true) {
        failures.push(
          `${phaseName} runtime dependency export_authorized must be true: ${dependency.component}`,
        );
      }
      const exactPyodideSpecifier =
        'https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.mjs';
      if (
        !Array.isArray(dependency.allowed_specifiers)
        || dependency.allowed_specifiers.length !== 1
        || dependency.allowed_specifiers[0] !== exactPyodideSpecifier
      ) {
        failures.push(
          `${phaseName} runtime dependency must allow only the exact pinned Pyodide module specifier`,
        );
      }
      if (releaseMode && dependency.rights_status !== 'approved') {
        failures.push(`${phaseName} has an unapproved runtime dependency: ${dependency.component}`);
      }
      if (releaseMode && isUnresolvedLicense(dependency.license)) {
        failures.push(`${phaseName} has an unresolved runtime licence: ${dependency.component}`);
      }
    }
    for (const dependency of phase.third_party_dependencies ?? []) {
      const dependencyName = dependency.package ?? dependency.component;
      const dependencyLicense = dependency.current_license ?? dependency.license;
      if (!dependencyName || !dependency.version || !dependencyLicense || !dependency.rights_status) {
        failures.push(`${phaseName} has an incomplete third-party dependency: ${JSON.stringify(dependency)}`);
        continue;
      }
      if (dependency.rights_status === 'pending_notice_review') {
        failures.push(
          `${phaseName} still conflates approved dependency rights with notice generation: ${dependencyName}`,
        );
      }
      if (
        dependency.rights_status === 'approved'
        && dependency.export_action === 'include_after_notice_and_sbom_gate'
        && !dependency.notice_status
      ) {
        failures.push(`${phaseName} is missing notice/SBOM status: ${dependencyName}`);
      }
      if (releaseMode && dependency.rights_status !== 'approved') {
        failures.push(`${phaseName} has an unapproved third-party dependency: ${dependencyName}`);
      }
      if (
        releaseMode
        && dependency.notice_status
        && dependency.notice_status !== 'complete_for_exact_release_artifact'
      ) {
        failures.push(
          `incomplete notices/SBOM: ${dependencyName}@${dependency.version}`,
        );
      }
    }
  }
  spdxSummary = verifyPathCoverageAndSpdxHeaders(manifest);
}

if (origin) {
  for (const key of ['component', 'original_developer', 'homepage', 'license', 'source']) {
    if (!origin[key]) failures.push(`vulcan-origin.json is missing ${key}`);
  }
  if (origin.original_developer !== 'Home Energy Foundry Limited') {
    failures.push('vulcan-origin.json has the wrong original developer');
  }
  if (
    origin.source?.repository
    !== 'https://github.com/vulcan-energy/vulcan-community'
  ) {
    failures.push('vulcan-origin.json has the wrong source repository');
  }
  const thirdPartyLicences = new Map(
    (origin.third_party ?? []).map((entry) => [entry.component, entry.license]),
  );
  if (thirdPartyLicences.get('Home Energy Model engine') !== 'MIT') {
    failures.push('vulcan-origin.json must record the HEM engine as MIT');
  }
  if (
    thirdPartyLicences.get('Home Energy Model Future Homes Standard wrapper') !== 'MIT'
  ) {
    failures.push('vulcan-origin.json must record the FHS wrapper as MIT');
  }
  const thirdPartyByName = new Map(
    (origin.third_party ?? []).map((entry) => [entry.component, entry]),
  );
  if (
    thirdPartyByName.get('Home Energy Model engine')?.revision
    !== '62d3df705690f33b3fc3e905c9971d4f3743bf2e'
  ) {
    failures.push('vulcan-origin.json has the wrong HEM revision');
  }
  if (
    thirdPartyByName.get('Home Energy Model Future Homes Standard wrapper')?.revision
    !== 'c5ba2673fbd886cfe4fb528f61b376bdf406ebbd'
  ) {
    failures.push('vulcan-origin.json has the wrong FHS revision');
  }
  if (
    thirdPartyLicences.get('HEM guidance Building Fabric Table 3.7 default psi values') !==
    'OGL-UK-3.0'
  ) {
    failures.push('vulcan-origin.json must record HEM guidance Table 3.7 as OGL-UK-3.0');
  }
}

requireText('ADDITIONAL_TERMS.md', 'sections 7(b),');
requireText('ADDITIONAL_TERMS.md', '7(c) and 7(e)');
requireText('ADDITIONAL_TERMS.md', 'do not require a logo');
requireText('ADDITIONAL_TERMS.md', 'Powered by Vulcan');
requireText('ATTRIBUTION.md', 'originally developed by');
requireText('ATTRIBUTION.md', 'Home Energy Foundry Limited');
requireText('ATTRIBUTION.md', 'not necessarily affiliated with or endorsed by');
requireText('TRADEMARKS.md', 'compatible with Vulcan');
requireText(
  'PATH_RIGHTS.md',
  'data/junction_psi_defaults/table_3_7_default_psi.csv',
);
requireText('PATH_RIGHTS.md', 'apps/geometry-editor/src/assets/ifc/ifc_parser.py');
requireText(
  'PATH_RIGHTS.md',
  'ifcopenshell-0.8.3+34a1bc6-cp313-cp313-emscripten_4_0_9_wasm32.whl',
);
const pathRights = read('PATH_RIGHTS.md');
if (/hem_fhs_upstream[^\n]*Blocked/i.test(pathRights)) {
  failures.push('PATH_RIGHTS.md still marks FHS upstream as blocked');
}
requireText(
  'third_party/ifc/dependencies.json',
  '34a1bc6f04c6dfc66915ca5345bfdf78e23447c6',
);
requireText(
  'third_party/ifc/dependencies.json',
  'ed567eb8d2b41fb0e325927c44466b866ef56a34',
);
requireText(
  'AGENTS.md',
  'Licensing and attribution files must not be removed, summarised, rewritten or',
);
requireText('AGENTS.md', 'must preserve the Vulcan');
requireText('AGENTS.md', 'origin notice described in `ATTRIBUTION.md`');

for (const cla of ['CLA-INDIVIDUAL.md', 'CLA-ENTITY.md']) {
  requireText(cla, 'Harmony Option Five');
  requireText(cla, 'commercial or proprietary licences');
  requireText(cla, 'also to license the Contribution under the');
  requireText(cla, 'England and Wales');
  requireText(cla, 'contributor agreements developed by Project Harmony');
}

if (releaseMode) {
  const releaseFiles = [
    'LICENSE',
    'LICENSES/Apache-2.0.txt',
    'LICENSES/CC-BY-4.0.txt',
    'LICENSES/OGL-UK-3.0.txt',
    'CITATION.cff',
  ];
  for (const relativePath of releaseFiles) {
    if (!existsSync(join(packDir, relativePath))) {
      failures.push(`release mode missing: ${relativePath}`);
    }
  }

  const releasePlaceholderFiles = [
    'ATTRIBUTION.md',
    'NOTICE',
    'licence-manifest.json',
    'vulcan-origin.json',
    'CITATION.cff',
  ];
  for (const relativePath of releasePlaceholderFiles) {
    const absolutePath = join(packDir, relativePath);
    if (
      existsSync(absolutePath) &&
      readFileSync(absolutePath, 'utf8').includes('TO_BE_SET_BEFORE_RELEASE')
    ) {
      failures.push(`release placeholder remains in ${relativePath}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(origin?.source?.revision ?? '')) {
    failures.push('release mode requires an exact 40-character source revision');
  }
  if (!/^https:\/\//.test(origin?.source?.archive ?? '')) {
    failures.push('release mode requires an exact source archive URL');
  }
  const citation = read('CITATION.cff');
  if (!/^commit: [0-9a-f]{40}$/m.test(citation)) {
    failures.push('release mode requires an exact CITATION.cff commit');
  }
  if (!/^version: \S+$/m.test(citation)) {
    failures.push('release mode requires a CITATION.cff version');
  }
  if (manifest?.status !== 'approved') {
    failures.push('release mode requires licence-manifest.json status "approved"');
  }
  for (const entry of manifest?.entries ?? []) {
    if (entry.rights_status !== 'approved') {
      failures.push(`release mode has unapproved path: ${entry.path}`);
    }
    if (isUnresolvedLicense(entry.license)) {
      failures.push(`release mode has unresolved licence: ${entry.path}`);
    }
    if (entry.release_status?.startsWith('blocked_')) {
      failures.push(`release-blocked path: ${entry.path}`);
    }
  }
}

const uniqueFailures = [...new Set(failures)];

if (uniqueFailures.length > 0) {
  console.error(`Vulcan Community licensing validation failed (${uniqueFailures.length}):`);
  for (const failure of uniqueFailures) console.error(`- ${failure}`);
  process.exit(1);
}

if (spdxSummary) {
  const counts = [...spdxSummary.counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}=${count}`)
    .join(', ');
  console.log(`SPDX source headers verified: ${counts}.`);
  if (spdxSummary.unclassified.length > 0) {
    console.log(
      `Manifest-default exclusions (${spdxSummary.unclassified.length} unclassified paths):`,
    );
    for (const candidatePath of spdxSummary.unclassified) {
      console.log(`- ${candidatePath}`);
    }
  }
}

console.log(
  releaseMode
    ? 'Vulcan Community release licensing validation passed.'
    : 'Vulcan Community licensing validation passed.',
);
