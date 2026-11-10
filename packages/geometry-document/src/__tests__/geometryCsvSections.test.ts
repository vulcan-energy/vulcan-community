// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_GEOMETRY_CSV_SECTIONS } from '../geometryCsvSections';

describe('KNOWN_GEOMETRY_CSV_SECTIONS', () => {
  it('lists the sections of the Rust parser, in its order', () => {
    const parser = readFileSync(resolve(import.meta.dirname, '../../../../crates/vulcan-csv-codec/src/parser.rs'), 'utf8');
    const block = parser.match(/const SECTIONS: &'static \[&'static str\] = &\[([^\]]*)\];/)?.[1];
    expect(block, 'SECTIONS in vulcan-csv-codec/src/parser.rs').toBeDefined();
    const rust = [...block!.replace(/\/\/.*/g, '').matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    expect([...KNOWN_GEOMETRY_CSV_SECTIONS]).toEqual(rust);
  });
});
