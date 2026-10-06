// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The Appropriate Legal Notices that ADDITIONAL_TERMS.md section 1 requires in the
// version output of a non-interactive distribution. Wording follows ATTRIBUTION.md.

import packageJson from '../package.json';

// Stamped by vite.config.ts from GITHUB_SHA; absent when running from source.
declare const __VULCAN_COMMUNITY_REVISION__: string | undefined;

const SOURCE_REPOSITORY = 'https://github.com/vulcan-energy/vulcan-community';

export function versionInfo() {
  const revision =
    typeof __VULCAN_COMMUNITY_REVISION__ === 'string' && __VULCAN_COMMUNITY_REVISION__ !== ''
      ? __VULCAN_COMMUNITY_REVISION__
      : null;
  return {
    name: 'Vulcan Community',
    command: 'vulcan-community',
    version: packageJson.version,
    originalDeveloper: 'Home Energy Foundry Limited',
    origin: 'https://usevulcan.app/open-source',
    copyright: 'Copyright © 2026 Home Energy Foundry Limited and contributors.',
    license: 'AGPL-3.0-only',
    additionalTerms: 'Vulcan-Origin-Terms-1.0',
    sourceRepository: SOURCE_REPOSITORY,
    sourceRevision: revision,
    correspondingSource: revision === null ? null : `${SOURCE_REPOSITORY}/tree/${revision}`,
    nonAffiliation:
      'This product is not necessarily affiliated with or endorsed by Home Energy Foundry Limited.',
  };
}

export function versionText(): string {
  const info = versionInfo();
  return [
    `${info.command} ${info.version}`,
    '',
    `This product contains ${info.name} software, originally developed by ${info.originalDeveloper}.`,
    `Vulcan: ${info.origin}`,
    info.copyright,
    'Licensed under the GNU Affero General Public License version 3 (AGPL-3.0-only),',
    'with the Vulcan Origin Terms 1.0 (ADDITIONAL_TERMS.md).',
    `Source repository: ${info.sourceRepository}`,
    info.correspondingSource === null
      ? 'Corresponding Source: unofficial build, revision unknown.'
      : `Corresponding Source: ${info.correspondingSource}`,
    info.nonAffiliation,
  ].join('\n');
}
