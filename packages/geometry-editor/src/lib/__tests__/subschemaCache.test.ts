// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDereferencedByPointer, getDereferencedSubschema } from '../subschemaCache';

const coreSchemaPath = join(import.meta.dirname, '../../../../../hem_engine_upstream/schemas/core-input.schema.json');
const fhsSchemaPath = join(import.meta.dirname, '../../../../../hem_fhs_upstream/schema/input_fhs.schema.json');

describe('subschema dereference cache', () => {
  it('does not reuse dereferenced results across different root schemas', async () => {
    const core = JSON.parse(readFileSync(coreSchemaPath, 'utf8'));
    const fhs = JSON.parse(readFileSync(fhsSchemaPath, 'utf8'));

    const coreSpaceHeat = await getDereferencedByPointer(core, '#/properties/SpaceHeatSystem') as any;
    expect(coreSpaceHeat.anyOf).toBeDefined();

    const fhsSpaceHeat = await getDereferencedByPointer(fhs, '#/properties/SpaceHeatSystem') as any;
    expect(fhsSpaceHeat.anyOf).toBeUndefined();
    expect(fhsSpaceHeat.additionalProperties).toBeDefined();

    const coreEvents = await getDereferencedSubschema('events', core, 'Events') as any;
    expect(coreEvents.properties?.Shower).toBeDefined();

    const fhsEvents = await getDereferencedSubschema('events', fhs, 'Events') as any;
    expect(fhsEvents.properties?.Shower).toBeUndefined();
    expect(fhsEvents.type).toBe('object');
  });
});
