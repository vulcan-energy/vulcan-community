// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { parseCsvSections } from '../io/csvSectionRows';

/**
 * HEM's ECaaS input schema lets a heat source name a product by `product_reference`;
 * the ECaaS service resolves it to test data server-side. Local HEM cannot, so a model
 * carrying one can be submitted to ECaaS but not run in Vulcan.
 */
export const ecaasOnlyProductMessage = (labels: readonly string[]): string =>
  `ECaaS-only product (${labels.join(', ')}): this model can be submitted to ECaaS but can't run locally in Vulcan.`;

const collectProductReferences = (value: unknown, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectProductReferences(item, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  // Test data entered alongside the reference (Advanced Fields) makes it runnable locally.
  const hasTestData = Object.keys(value).some((key) => key.startsWith('test_data'));
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('_')) continue; // editor metadata, not HEM input
    if (key === 'product_reference') {
      if (!hasTestData && typeof child === 'string' && child.trim()) out.push(child.trim());
    } else collectProductReferences(child, out);
  }
};

const readString = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? (record[key] as string).trim() : '';

/**
 * Labels for the ECaaS-only products in one System `extra_json`: the catalogue
 * brand/model when the editor recorded one, otherwise the product reference itself.
 */
export function ecaasOnlyProductLabels(extraJson: unknown): string[] {
  const references: string[] = [];
  collectProductReferences(extraJson, references);
  if (references.length === 0) return [];
  const meta = (extraJson as Record<string, unknown>)._pcdb;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const name = [readString(meta as Record<string, unknown>, 'brandName'), readString(meta as Record<string, unknown>, 'modelName')]
      .filter(Boolean)
      .join(' ');
    if (name) return [name];
  }
  return references;
}

/** ECaaS-only product labels across every `extra_json` cell of a geometry CSV. */
export function findEcaasOnlyProductsInCsv(csv: string): string[] {
  return parseCsvSections(csv).flatMap((section) =>
    section.rows.flatMap((row) => {
      const cell = row.data.extra_json;
      if (!cell?.includes('product_reference')) return [];
      // Malformed extra_json is the merge's error to report, not this check's.
      try {
        return ecaasOnlyProductLabels(JSON.parse(cell));
      } catch {
        return [];
      }
    }),
  );
}
