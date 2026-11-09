// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { flattenIfThenAllOfProperties, jsonSchemaIfMatches } from '../systemSchemaFlatten';

describe('jsonSchemaIfMatches', () => {
  it('treats an absent discriminator as not matched', () => {
    expect(jsonSchemaIfMatches({ required: ['HeatSource'] }, {})).toBe(false);
    expect(jsonSchemaIfMatches({ required: ['HeatSource'] }, { HeatSource: {} })).toBe(true);
    expect(jsonSchemaIfMatches({ properties: { type: { const: 'x' } } }, {})).toBe(false);
  });

  it('requires every keyword of a combined condition', () => {
    const condition = { required: ['a'], properties: { b: { const: 1 } } };
    expect(jsonSchemaIfMatches(condition, { a: 1, b: 2 })).toBe(false);
    expect(jsonSchemaIfMatches(condition, { a: 1, b: 1 })).toBe(true);
  });

  it('evaluates contains against array items', () => {
    const condition = { properties: { emitters: { type: 'array', contains: { properties: { kind: { const: 'fancoil' } }, required: ['kind'] } } } };
    expect(jsonSchemaIfMatches(condition, { emitters: [{ kind: 'radiator' }] })).toBe(false);
    expect(jsonSchemaIfMatches(condition, { emitters: [{ kind: 'radiator' }, { kind: 'fancoil' }] })).toBe(true);
  });

  it('resolves "at least one heater matches" through a $ref', () => {
    const root = { $defs: { Hp: { required: ['type'], properties: { type: { const: 'hp' } } } } };
    const condition = { required: ['HeatSource'], properties: { HeatSource: { type: 'object', not: { additionalProperties: { not: { $ref: '#/$defs/Hp' } } } } } };
    expect(jsonSchemaIfMatches(condition, { HeatSource: { a: { type: 'immersion' } } }, root)).toBe(false);
    expect(jsonSchemaIfMatches(condition, { HeatSource: { a: { type: 'immersion' }, b: { type: 'hp' } } }, root)).toBe(true);
  });
});

describe('flattenIfThenAllOfProperties', () => {
  it('drops a forbidden property, including its required entry', () => {
    const flat = flattenIfThenAllOfProperties({
      properties: { a: { type: 'number' }, b: { type: 'number' }, c: { type: 'number' } },
      required: ['b'],
      allOf: [{ if: { required: ['x'] }, then: { properties: { a: { not: {} } } }, else: { properties: { b: { not: {} } } } },
        { if: { required: ['y'] }, then: { properties: { c: false } } }],
    }, { y: 1 }) as { properties: Record<string, unknown>; required?: string[] };
    expect(Object.keys(flat.properties).sort()).toEqual(['a']);
    expect(flat.required).toEqual([]);
  });
});
