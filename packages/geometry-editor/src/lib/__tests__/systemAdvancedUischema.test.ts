// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { buildSystemAdvancedUischema } from '../systemAdvancedUischema';

const heatSourceSubschema = {
  type: 'object',
  properties: {
    HeatSourceWet: {
      type: 'object',
      properties: {
        boiler: {
          type: 'object',
          properties: {
            type: { const: 'Boiler' },
            rated_power: { type: 'number', title: 'Rated power' },
          },
        },
      },
    },
  },
};

describe('buildSystemAdvancedUischema', () => {
  it('uses flat Control rows (no Group accordions) and correct scopes', () => {
    const ui = buildSystemAdvancedUischema('HeatSourceWet', heatSourceSubschema as Record<string, unknown>) as {
      type: string;
      elements: { type: string; scope?: string; label?: string; elements?: unknown[] }[];
    };
    expect(ui.type).toBe('VerticalLayout');
    expect(ui.elements.some((e) => e.type === 'Group')).toBe(false);
    const controls = ui.elements.filter((e) => e.type === 'Control');
    const scopes = controls.map((c) => c.scope);
    expect(scopes).toContain('#/properties/HeatSourceWet/properties/boiler/properties/rated_power');
    // Plant-root `type` is omitted from Advanced uischema (discriminant shown in the summary row).
    const rated = controls.find((c) => c.scope?.endsWith('/rated_power'));
    expect(rated?.label).toBeUndefined();
  });

  it('prefixes control labels with plant key when multiple plants exist', () => {
    const subschema = {
      type: 'object',
      properties: {
        HeatSourceWet: {
          type: 'object',
          properties: {
            boiler: {
              type: 'object',
              properties: {
                rated_power: { type: 'number', title: 'Rated power' },
              },
            },
            hp: {
              type: 'object',
              properties: {
                rated_power: { type: 'number', title: 'Rated power' },
              },
            },
          },
        },
      },
    };
    const ui = buildSystemAdvancedUischema('HeatSourceWet', subschema as Record<string, unknown>) as {
      type: string;
      elements: { type: string; scope?: string; label?: string }[];
    };
    const labels = ui.elements.filter((e) => e.type === 'Control').map((e) => e.label);
    expect(labels.some((l) => l === 'boiler · Rated power')).toBe(true);
    expect(labels.some((l) => l === 'hp · Rated power')).toBe(true);
  });

  it('hoists HotWaterSource hw cylinder HeatSource map (no extra HeatSource wrapper; scopes unchanged)', () => {
    const subschema = {
      type: 'object',
      properties: {
        HotWaterSource: {
          type: 'object',
          properties: {
            'hw cylinder': {
              type: 'object',
              properties: {
                volume: { type: 'number', title: 'Volume' },
                HeatSource: {
                  type: 'object',
                  properties: {
                    immersion: {
                      type: 'object',
                      properties: {
                        power: { type: 'number', title: 'Power' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const ui = buildSystemAdvancedUischema('HotWaterSource', subschema as Record<string, unknown>) as {
      type: string;
      elements: { type: string; scope?: string; label?: string; elements?: unknown[] }[];
    };
    const immersionPower =
      '#/properties/HotWaterSource/properties/hw cylinder/properties/HeatSource/properties/immersion/properties/power';
    const walk = (els: typeof ui.elements): typeof ui.elements => {
      const out: typeof ui.elements = [];
      for (const e of els) {
        out.push(e);
        if (Array.isArray(e.elements)) out.push(...walk(e.elements as typeof ui.elements));
      }
      return out;
    };
    const flat = walk(ui.elements);
    const controls = flat.filter((e) => e.type === 'Control');
    expect(controls.some((c) => c.scope === immersionPower)).toBe(true);
    expect(controls.some((c) => c.label?.includes('HeatSource'))).toBe(false);
    expect(flat.some((e) => e.scope?.endsWith('/properties/HeatSource') && e.type === 'Control')).toBe(false);
  });

  it('does not emit a top-level HeatSource Control when the schema has no materialised properties (avoids [object Object])', () => {
    const subschema = {
      type: 'object',
      properties: {
        HotWaterSource: {
          type: 'object',
          properties: {
            'hw cylinder': {
              type: 'object',
              properties: {
                HeatSource: {
                  type: 'object',
                  additionalProperties: { type: 'object' },
                },
              },
            },
          },
        },
      },
    };
    const ui = buildSystemAdvancedUischema('HotWaterSource', subschema as Record<string, unknown>) as {
      type: string;
      elements: { type: string; scope?: string }[];
    };
    const walk = (els: typeof ui.elements): typeof ui.elements => {
      const out: typeof ui.elements = [];
      for (const e of els) {
        out.push(e);
        if (Array.isArray((e as { elements?: unknown[] }).elements)) {
          out.push(...walk((e as { elements: typeof ui.elements }).elements));
        }
      }
      return out;
    };
    const controls = walk(ui.elements).filter((e) => e.type === 'Control');
    expect(controls.some((c) => c.scope?.endsWith('/properties/HeatSource'))).toBe(false);
  });

  it('R4.3b: plant keys containing "/" and "~" produce RFC-6901-escaped scopes, but RAW labels', () => {
    // Raw user CSV plant names. A literal '/' would otherwise break resolveSchemaPointer
    // (it splits the pointer ref on '/'); a literal '~' would collide with the escape
    // character itself if left unescaped/mis-escaped.
    const subschema = {
      type: 'object',
      properties: {
        HeatSourceWet: {
          type: 'object',
          properties: {
            'Kitchen/Diner boiler': {
              type: 'object',
              properties: {
                rated_power: { type: 'number', title: 'Rated power' },
              },
            },
            'a~b tilde heater': {
              type: 'object',
              properties: {
                rated_power: { type: 'number', title: 'Rated power' },
              },
            },
          },
        },
      },
    };
    const ui = buildSystemAdvancedUischema('HeatSourceWet', subschema as Record<string, unknown>) as {
      type: string;
      elements: { type: string; scope?: string; label?: string }[];
    };
    const controls = ui.elements.filter((e) => e.type === 'Control');
    const scopes = controls.map((c) => c.scope);

    // '/' -> '~1' in the plant-key token; the surrounding schema-keyword tokens
    // ('properties') are untouched. Splitting this exact string back on the literal
    // delimiter '/properties/' -- exactly what `segmentsFromLayoutScope` in
    // DirectAdvancedFields.tsx does -- now yields the real plant key as ONE segment
    // ('Kitchen/Diner boiler'), not two bogus ones split on the raw '/'.
    expect(scopes).toContain('#/properties/HeatSourceWet/properties/Kitchen~1Diner boiler/properties/rated_power');
    // '~' -> '~0' in the plant-key token.
    expect(scopes).toContain('#/properties/HeatSourceWet/properties/a~0b tilde heater/properties/rated_power');

    // Labels keep the RAW, unescaped plant key -- escaping applies to scopes only.
    const labels = controls.map((c) => c.label);
    expect(labels).toContain('Kitchen/Diner boiler · Rated power');
    expect(labels).toContain('a~b tilde heater · Rated power');
  });
});
