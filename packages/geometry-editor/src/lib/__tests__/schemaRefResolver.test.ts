// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  isInternalSchemaRef,
  resolveRefChain,
  resolveRefNode,
  resolveSchemaPointer,
  resolveSchemaRef,
} from '../schemaRefResolver';
import type { SchemaNode } from '../schemaTypes';

const root: SchemaNode = {
  $defs: {
    Leaf: { type: 'number', description: 'terminal' },
    Hop: { $ref: '#/$defs/Leaf' },
    CycleA: { $ref: '#/$defs/CycleB' },
    CycleB: { $ref: '#/$defs/CycleA' },
    'odd~key/slash': { type: 'string' },
  },
  properties: {
    list: { items: { const: 'in-array' } } as SchemaNode,
  },
};

describe('resolveSchemaPointer', () => {
  it('returns the root for # and walks nested paths', () => {
    expect(resolveSchemaPointer(root, '#')).toBe(root);
    expect(resolveSchemaPointer(root, '#/$defs/Leaf/description')).toBe('terminal');
  });

  it('decodes ~0 and ~1 pointer tokens', () => {
    expect(resolveSchemaPointer(root, '#/$defs/odd~0key~1slash')).toEqual({ type: 'string' });
  });

  it('traverses arrays by index', () => {
    const doc = { rows: [{ id: 'first' }, { id: 'second' }] };
    expect(resolveSchemaPointer(doc, '#/rows/1/id')).toBe('second');
  });

  it('returns undefined for missing paths and non-internal refs', () => {
    expect(resolveSchemaPointer(root, '#/$defs/Missing')).toBeUndefined();
    expect(resolveSchemaPointer(root, 'https://example.com/schema#/x')).toBeUndefined();
    expect(isInternalSchemaRef('https://example.com/schema#/x')).toBe(false);
  });
});

describe('resolveSchemaRef and resolveRefNode', () => {
  it('resolves a string ref to a node, null when the target is not a node', () => {
    expect(resolveSchemaRef(root, '#/$defs/Leaf')).toEqual({ type: 'number', description: 'terminal' });
    expect(resolveSchemaRef(root, '#/$defs/Leaf/description')).toBeNull();
  });

  it('passes through nodes without $ref and hops once for nodes with one', () => {
    const plain: SchemaNode = { type: 'string' };
    expect(resolveRefNode(root, plain)).toBe(plain);
    expect(resolveRefNode(root, { $ref: '#/$defs/Leaf' })).toEqual(root.$defs?.Leaf);
    expect(resolveRefNode(root, 'not-a-node')).toBeNull();
    expect(resolveRefNode(root, { $ref: '#/$defs/Missing' })).toBeNull();
  });
});

describe('resolveRefChain', () => {
  it('follows a chain of refs to the terminal node', () => {
    expect(resolveRefChain(root, { $ref: '#/$defs/Hop' })).toEqual(root.$defs?.Leaf);
  });

  it('terminates on cyclic ref chains instead of hanging', () => {
    const resolved = resolveRefChain(root, { $ref: '#/$defs/CycleA' });
    expect(resolved).not.toBeNull();
    expect(resolved?.$ref).toMatch(/#\/\$defs\/Cycle/);
  });
});
