// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { flattenIfThenAllOfProperties, forbiddenPlantKeys, jsonSchemaIfMatches, newlyForbiddenFieldKeys } from '../systemSchemaFlatten';
import { mergeSystemExtraJsonAfterJsonForms } from '../systemAdvancedSchemaExpand';

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

describe('jsonSchemaIfMatches and booleans', () => {
  it('lets an absent boolean satisfy const false, not const true', () => {
    expect(jsonSchemaIfMatches({ properties: { integral: { const: false } } }, {})).toBe(true);
    expect(jsonSchemaIfMatches({ properties: { integral: { const: true } } }, {})).toBe(false);
  });
});

describe('forbidden values', () => {
  const plant = {
    properties: { heat: {}, area: { type: 'number' } },
    allOf: [{ if: { required: ['heat'] }, then: { properties: { area: { not: {} } } } }],
  };
  const schema = { properties: { HotWaterSource: { properties: { tank: plant } } } };
  const forbidden = (name: string, value: unknown) => forbiddenPlantKeys(schema, 'HotWaterSource', name, value, {});

  it('strips only a key this plant edit newly forbids', () => {
    const edited = mergeSystemExtraJsonAfterJsonForms(
      { HotWaterSource: { tank: { area: 2 } } }, { HotWaterSource: { tank: { area: 2, heat: {} } } }, 'HotWaterSource', forbidden,
    ) as { HotWaterSource: { tank: Record<string, unknown> } };
    expect(edited.HotWaterSource.tank).toEqual({ heat: {} });
  });

  it('keeps a value forbidden before this edit', () => {
    const edited = mergeSystemExtraJsonAfterJsonForms(
      { HotWaterSource: { tank: { area: 2, heat: {} } } }, { HotWaterSource: { tank: { area: 2, heat: { a: 1 } } } }, 'HotWaterSource', forbidden,
    ) as { HotWaterSource: { tank: Record<string, unknown> } };
    expect(edited.HotWaterSource.tank.area).toBe(2);
  });

  it('compares a duct before and after an edit', () => {
    const duct = { properties: { shape: {}, d: { type: 'number' } }, allOf: [{ if: { properties: { shape: { const: 'r' } } }, then: { properties: { d: false } } }] };
    expect(newlyForbiddenFieldKeys(duct, { shape: 'c', d: 1 }, { shape: 'r', d: 1 })).toEqual(['d']);
    expect(newlyForbiddenFieldKeys(duct, { shape: 'r', d: 1 }, { shape: 'r', d: 2 })).toEqual([]);
  });
});
