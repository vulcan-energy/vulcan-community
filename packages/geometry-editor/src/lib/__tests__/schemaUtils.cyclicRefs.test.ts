// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import { findParameterInSchema } from '../schemaUtils';
import { __setFHSSchemaObjectForTests, __setSchemaObjectForTests } from '../schemaCache';
import type { SchemaNode } from '../schemaTypes';

afterEach(() => {
  __setSchemaObjectForTests(null);
  __setFHSSchemaObjectForTests(null);
});

describe('findParameterInSchema on cyclic $ref chains', () => {
  it('terminates and still finds a property reached through the cycle', () => {
    // entry -> CycleA -> CycleB -> back -> CycleA would recurse forever without
    // a visited set on the search's $ref-following; the property match sits on
    // the cycle so the search must walk into it once before terminating.
    const root: SchemaNode = {
      $defs: {
        CycleA: { $ref: '#/$defs/CycleB' },
        CycleB: {
          properties: {
            within_cycle: { type: 'number', description: 'reachable through the cycle' },
            back: { $ref: '#/$defs/CycleA' },
          },
        },
      },
      properties: {
        entry: { $ref: '#/$defs/CycleA' },
      },
    };
    __setSchemaObjectForTests(root);
    __setFHSSchemaObjectForTests(null);

    const result = findParameterInSchema('within_cycle');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('within_cycle');
    expect(result?.description).toBe('reachable through the cycle');
  });
});
