// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureGeometrySchemaAssetSource, preloadSchema, preloadFHSSchema, getSchemaObject, getFHSSchemaObject, resetGeometrySchemaAssetsForTests, subscribeGeometrySchema, getGeometrySchemaRevision, getApplianceKeysForMode, thermalBridgingAcceptsTotal, elementTypeAvailability, resolveElementSubschemaForProfile } from '../schemaCache';
import { ELEMENT_TYPE_ORDER } from '../elementTypeMetadata';
import type { GeometrySchemaMode, GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { ensureRootSchema, getAjvInstance, resetGeometrySchemaValidators } from '../ajvCache';

const schema = (minimum: number) => ({ type: 'object', properties: { value: { type: 'number', minimum } } });
afterEach(() => { resetGeometrySchemaAssetsForTests(); resetGeometrySchemaValidators(); });

describe('thermalBridgingAcceptsTotal', () => {
  const root = (bridging: unknown) => ({ properties: { Zone: { additionalProperties: { properties: { ThermalBridging: bridging } } } } });
  it('follows the zone schema', () => {
    expect(thermalBridgingAcceptsTotal(root({ type: ['object', 'number'] }))).toBe(true);
    expect(thermalBridgingAcceptsTotal(root({ anyOf: [{ type: 'object' }, { type: 'number' }] }))).toBe(true);
    expect(thermalBridgingAcceptsTotal(root({ type: 'object' }))).toBe(false);
  });
  it('says nothing without a schema or the field', () => {
    expect(thermalBridgingAcceptsTotal(null)).toBe(true);
    expect(thermalBridgingAcceptsTotal({ properties: {} })).toBe(true);
  });
});

describe('target-scoped schema caches', () => {
  it.each(['Clothes_washing|Fridge-Freezer|Kettle', '^(Clothes_washing|Fridge-Freezer|Kettle)$'])(
    'reads appliance names from %s without regex syntax', async pattern => {
      configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify({
        type: 'object', properties: { Appliances: { patternProperties: { [pattern]: { type: 'string' } } } },
      }) });
      await preloadFHSSchema();
      expect(getApplianceKeysForMode(true)).toEqual(['Clothes_washing', 'Fridge-Freezer', 'Kettle']);
    },
  );
  it('notifies mounted consumers on invalidation and successful load only', async () => {
    const revisions: number[] = [];
    const unsubscribe = subscribeGeometrySchema(() => revisions.push(getGeometrySchemaRevision()));
    const before = getGeometrySchemaRevision();
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(schema(9)) });
    expect(revisions).toEqual([before + 1]);
    await preloadFHSSchema();
    expect(revisions).toEqual([before + 1, before + 2]);
    await preloadFHSSchema();
    expect(revisions).toHaveLength(2);
    unsubscribe();
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(schema(1)) });
    expect(revisions).toHaveLength(2);
  });
  it.each(['core', 'fhs'] as const)('a superseded %s load joins the current target instead of rejecting', async mode => {
    let finish!: (text: string) => void;
    configureGeometrySchemaAssetSource({ loadText: () => new Promise(resolve => { finish = resolve; }) });
    const preload = mode === 'core' ? preloadSchema : preloadFHSSchema;
    const current = mode === 'core' ? getSchemaObject : getFHSSchemaObject;
    const old = preload();
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(schema(9)) });
    expect(current()).toBeNull();
    await preload();
    finish(JSON.stringify(schema(1)));
    await old;
    expect(current()?.properties?.value.minimum).toBe(9);
    await preload();
    expect(current()?.properties?.value.minimum).toBe(9);
  });
  it.each(['core', 'fhs'] as const)('a superseded %s load that fails still joins the current target', async mode => {
    let fail!: (error: Error) => void;
    configureGeometrySchemaAssetSource({ loadText: () => new Promise((_, reject) => { fail = reject; }) });
    const preload = mode === 'core' ? preloadSchema : preloadFHSSchema;
    const current = mode === 'core' ? getSchemaObject : getFHSSchemaObject;
    const old = preload();
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(schema(9)) });
    fail(new Error('old target 404'));
    await old;
    expect(current()?.properties?.value.minimum).toBe(9);
  });
  it('coalesces FHS loads and awaits their actual completion', async () => {
    let finish!: (text: string) => void;
    let count = 0;
    configureGeometrySchemaAssetSource({ loadText: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
    const first = preloadFHSSchema();
    let done = false;
    const second = preloadFHSSchema().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    expect(count).toBe(1);
    finish(JSON.stringify(schema(3)));
    await Promise.all([first, second]);
    expect(done).toBe(true);
  });
  it('does not reuse an AJV root when targets share top-level property names', () => {
    ensureRootSchema(schema(1));
    expect(getAjvInstance().getSchema('root')!({ value: 2 })).toBe(true);
    ensureRootSchema(schema(9));
    expect(getAjvInstance().getSchema('root')!({ value: 2 })).toBe(false);
  });
});

describe('elementTypeAvailability', () => {
  const root = (path: string) => JSON.parse(readFileSync(join(import.meta.dirname, '../../../../..', path), 'utf8'));
  const port = (mode: GeometrySchemaMode, schemaRoot: unknown, extra: Partial<GeometrySchemaPort> = {}) => ({
    availability: 'available',
    targetSchemaMode: () => mode,
    getRootSchema: () => schemaRoot,
    getElementSubschema: (_: GeometrySchemaMode, type: string) => resolveElementSubschemaForProfile(schemaRoot as never, mode, type),
    ...extra,
  }) as unknown as GeometrySchemaPort;
  const unavailable = (p: GeometrySchemaPort) => ELEMENT_TYPE_ORDER.filter((type) => !elementTypeAvailability(p, type, {}).available);

  // Exact lists: a resolver gap fails here instead of hiding a type. Each is a section the schema lacks.
  it.each([
    ['fhs', 'hem_fhs_upstream/schema/input_fhs.schema.json', ['CombustionAppliances']],
    ['fhs', 'data/schemas/input_fhs.schema.json', ['CombustionAppliances']],
    ['core', 'hem_engine_upstream/schemas/core-input.schema.json', ['Lighting', 'Appliance', 'CombustionAppliances']],
    ['core', 'data/schemas/core-input.schema.json', ['Lighting', 'Appliance', 'CombustionAppliances']],
  ] as const)('%s %s offers every type it has a section for', (mode, path, absent) => {
    expect(unavailable(port(mode, root(path)))).toEqual(absent);
  });

  it('hides a type the host excludes, with its reason, and offers nothing else before the schema loads', () => {
    const excluding = port('fhs', null, { targetRules: () => ({
      modelValidityChecks: true, fhsInputRules: true, buildingRegulationsChecks: false, hiddenFields: {},
      excludedElementTypes: { Lighting: { reason: 'Not used by this target.' } },
    }) });
    expect(elementTypeAvailability(excluding, 'Lighting', {})).toEqual({ available: false, reason: 'Not used by this target.' });
    expect(elementTypeAvailability(excluding, 'BuildingElementOpaque', {})).toEqual({ available: false, pending: true });
    expect(elementTypeAvailability(excluding, 'System', {})).toEqual({ available: true });
  });
});
