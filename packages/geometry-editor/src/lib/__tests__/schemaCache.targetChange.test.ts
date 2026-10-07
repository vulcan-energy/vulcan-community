// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import { configureGeometrySchemaAssetSource, preloadSchema, preloadFHSSchema, getSchemaObject, getFHSSchemaObject, resetGeometrySchemaAssetsForTests, subscribeGeometrySchema, getGeometrySchemaRevision, getApplianceKeysForMode } from '../schemaCache';
import { ensureRootSchema, getAjvInstance, resetGeometrySchemaValidators } from '../ajvCache';

const schema = (minimum: number) => ({ type: 'object', properties: { value: { type: 'number', minimum } } });
afterEach(() => { resetGeometrySchemaAssetsForTests(); resetGeometrySchemaValidators(); });

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
  it.each(['core', 'fhs'] as const)('rejects late %s results from a previous target without clearing the new schema', async mode => {
    let finish!: (text: string) => void;
    configureGeometrySchemaAssetSource({ loadText: () => new Promise(resolve => { finish = resolve; }) });
    const preload = mode === 'core' ? preloadSchema : preloadFHSSchema;
    const current = mode === 'core' ? getSchemaObject : getFHSSchemaObject;
    const old = preload();
    const oldResult = expect(old).rejects.toThrow('superseded');
    configureGeometrySchemaAssetSource({ loadText: async () => JSON.stringify(schema(9)) });
    expect(current()).toBeNull();
    await preload();
    finish(JSON.stringify(schema(1)));
    await oldResult;
    expect(current()?.properties?.value.minimum).toBe(9);
    await preload();
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
