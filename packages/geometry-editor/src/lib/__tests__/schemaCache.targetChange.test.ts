// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'vitest';
import { configureGeometrySchemaAssetSource, preloadSchema, preloadFHSSchema, getSchemaObject, getFHSSchemaObject, resetGeometrySchemaAssetsForTests } from '../schemaCache';
import { ensureRootSchema, getAjvInstance, resetGeometrySchemaValidators } from '../ajvCache';

const schema = (minimum: number) => ({ type: 'object', properties: { value: { type: 'number', minimum } } });
afterEach(() => { resetGeometrySchemaAssetsForTests(); resetGeometrySchemaValidators(); });

describe('target-scoped schema caches', () => {
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
