// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import coreSchemaText from '../../../data/schemas/core-input.schema.json?raw';
import fhsSchemaText from '../../../data/schemas/input_fhs.schema.json?raw';

import type { CommunityModelProfile } from './communityModelBuildDocumentHost';

export async function loadCommunitySchemaText(
  profile: CommunityModelProfile,
): Promise<string> {
  return profile === 'fhs' ? fhsSchemaText : coreSchemaText;
}
