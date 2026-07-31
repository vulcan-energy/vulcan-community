// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  applyElementNameMapToElementsById,
  applyElementRenamePlanToElementsById,
  buildUnambiguousElementNameMap,
  remapElementNameReferences,
} from '../elementNameRemap';

const makeElement = (overrides: Partial<Element> & { id: string; name: string }): Element => ({
  id: overrides.id,
  name: overrides.name,
  type: 'BuildingElementOpaque',
  coordinates: [],
  parent_element: null,
  width: 1,
  height: 1,
  area: 1,
  ...overrides,
} as Element);

describe('elementNameRemap', () => {
  it('remaps direct parent_element references', () => {
    const child = makeElement({
      id: 'child',
      name: 'Window',
      type: 'BuildingElementTransparent',
      parent_element: 'Wall (S)',
      width: 1,
      height: 1,
      area: 1,
    });

    const result = remapElementNameReferences(child, new Map([['Wall (S)', 'Wall (E)']]));

    expect(result).not.toBe(child);
    expect(result.parent_element).toBe('Wall (E)');
    expect(result._v).toBe(1);
  });

  it('remaps MVHR duct parent references', () => {
    const duct = makeElement({
      id: 'duct',
      name: 'Supply duct',
      type: 'MechanicalVentilationDuctwork',
      duct_type: 'supply',
      length: 1,
      parent_element: 'MVHR 1',
      coordinates: [{ x: 0, y: 0, z: 2.4 }, { x: 1, y: 0, z: 2.4 }],
    } as Partial<Element> & { id: string; name: string });

    const result = remapElementNameReferences(duct, new Map([['MVHR 1', 'Ground floor MVHR']]));

    expect(result).not.toBe(duct);
    expect(result.parent_element).toBe('Ground floor MVHR');
    expect(result._v).toBe(1);
  });

  it('remaps known dormer bundle name references', () => {
    const anchor = makeElement({
      id: 'anchor',
      name: 'Main Roof Dormer Front Wall',
      extra_json: {
        dormer_bundle: {
          host_element_name: 'Main Roof',
          anchor_name: 'Main Roof Dormer Front Wall',
          roof_name: 'Main Roof Dormer Roof Left',
          roof_names: ['Main Roof Dormer Roof Left', 'Main Roof Dormer Roof Right'],
          window_name: 'Main Roof Dormer Window',
          cheek_wall_names: ['Main Roof Dormer Left Cheek', 'Main Roof Dormer Right Cheek'],
          bundle_id: 'bundle-1',
        },
      },
    });

    const result = remapElementNameReferences(anchor, new Map([
      ['Main Roof', 'Roof (S)'],
      ['Main Roof Dormer Front Wall', 'Dormer Wall'],
      ['Main Roof Dormer Roof Left', 'Dormer Roof L'],
      ['Main Roof Dormer Roof Right', 'Dormer Roof R'],
      ['Main Roof Dormer Window', 'Dormer Window'],
      ['Main Roof Dormer Left Cheek', 'Dormer Left Cheek'],
      ['Main Roof Dormer Right Cheek', 'Dormer Right Cheek'],
    ]));

    const bundle = result.extra_json?.dormer_bundle as Record<string, unknown>;
    expect(bundle.host_element_name).toBe('Roof (S)');
    expect(bundle.anchor_name).toBe('Dormer Wall');
    expect(bundle.roof_name).toBe('Dormer Roof L');
    expect(bundle.roof_names).toEqual(['Dormer Roof L', 'Dormer Roof R']);
    expect(bundle.window_name).toBe('Dormer Window');
    expect(bundle.cheek_wall_names).toEqual(['Dormer Left Cheek', 'Dormer Right Cheek']);
    expect(bundle.bundle_id).toBe('bundle-1');
  });

  it('remaps wet emitter distribution system references', () => {
    const emitter = makeElement({
      id: 'emitter',
      name: 'Radiator',
      type: 'WetEmitter',
      subcategory: 'radiator',
      unit_number: 1,
      space_heat_system: 'Living circuit',
    } as Partial<Element> & { id: string; name: string });

    const result = remapElementNameReferences(emitter, new Map([['Living circuit', 'F1 Living circuit']]));

    expect(result).not.toBe(emitter);
    expect((result as { space_heat_system?: string }).space_heat_system).toBe('F1 Living circuit');
    expect(result._v).toBe(1);
  });

  it('remaps MVHR terminal unit and mounted host references', () => {
    const terminal = makeElement({
      id: 'terminal',
      name: 'Intake terminal',
      type: 'MechanicalVentilationTerminal',
      terminal_type: 'intake',
      parent_element: 'MVHR 1',
      host_element: 'North wall',
      coordinates: [{ x: 0, y: 0, z: 2.4 }],
    } as Partial<Element> & { id: string; name: string });

    const result = remapElementNameReferences(terminal, new Map([
      ['MVHR 1', 'Ground floor MVHR'],
      ['North wall', 'F1 North wall'],
    ]));

    expect(result).not.toBe(terminal);
    expect(result.parent_element).toBe('Ground floor MVHR');
    expect((result as { host_element?: string }).host_element).toBe('F1 North wall');
    expect(result._v).toBe(1);
  });

  it('returns the same element when no references match', () => {
    const element = makeElement({
      id: 'wall',
      name: 'Wall',
      parent_element: null,
      extra_json: { dormer_bundle: { host_element_name: 'Other Roof' } },
    });

    expect(remapElementNameReferences(element, new Map([['Wall', 'Wall 2']]))).toBe(element);
  });

  it('applies remaps across an elementsById collection', () => {
    const host = makeElement({ id: 'host', name: 'Wall (S)' });
    const child = makeElement({
      id: 'child',
      name: 'Window',
      type: 'BuildingElementTransparent',
      parent_element: 'Wall (S)',
      width: 1,
      height: 1,
      area: 1,
    });
    const elementsById = { host, child };

    const result = applyElementNameMapToElementsById(
      elementsById,
      ['host', 'child'],
      new Map([['Wall (S)', 'Wall (E)']]),
    );

    expect(result.changed).toBe(true);
    expect(result.elementsById.host).toBe(host);
    expect(result.elementsById.child.parent_element).toBe('Wall (E)');
    expect(result.elementsById).not.toBe(elementsById);
  });

  it('remaps duplicate old parent names by source zone when the target element is known', () => {
    const groundHost = makeElement({ id: 'ground-host', name: 'Wall (S)', zoneId: 'ground-zone' });
    const firstHost = makeElement({ id: 'first-host', name: 'Wall (S)', zoneId: 'first-zone' });
    const groundWindow = makeElement({
      id: 'ground-window',
      name: 'Window',
      zoneId: 'ground-zone',
      type: 'BuildingElementTransparent',
      parent_element: 'Wall (S)',
    });
    const firstWindow = makeElement({
      id: 'first-window',
      name: 'Window',
      zoneId: 'first-zone',
      type: 'BuildingElementTransparent',
      parent_element: 'Wall (S)',
    });
    const elementsById = {
      'ground-host': { ...groundHost, name: 'F1 Wall (S)' },
      'first-host': { ...firstHost, name: 'F2 Wall (S)' },
      'ground-window': groundWindow,
      'first-window': firstWindow,
    };

    const result = applyElementRenamePlanToElementsById(
      elementsById,
      ['ground-host', 'first-host', 'ground-window', 'first-window'],
      [
        { elementId: 'ground-host', from: 'Wall (S)', to: 'F1 Wall (S)', zoneId: 'ground-zone', type: 'BuildingElementOpaque' },
        { elementId: 'first-host', from: 'Wall (S)', to: 'F2 Wall (S)', zoneId: 'first-zone', type: 'BuildingElementOpaque' },
      ],
    );

    expect(result.changed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.elementsById['ground-window'].parent_element).toBe('F1 Wall (S)');
    expect(result.elementsById['first-window'].parent_element).toBe('F2 Wall (S)');
  });

  it('leaves ambiguous duplicate references unchanged when no source scope resolves them', () => {
    const orphan = makeElement({
      id: 'orphan',
      name: 'Window',
      type: 'BuildingElementTransparent',
      parent_element: 'Wall (S)',
    });
    const elementsById = { orphan };

    const result = applyElementRenamePlanToElementsById(
      elementsById,
      ['orphan'],
      [
        { elementId: 'ground-host', from: 'Wall (S)', to: 'F1 Wall (S)', zoneId: 'ground-zone', type: 'BuildingElementOpaque' },
        { elementId: 'first-host', from: 'Wall (S)', to: 'F2 Wall (S)', zoneId: 'first-zone', type: 'BuildingElementOpaque' },
      ],
    );

    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.elementsById.orphan.parent_element).toBe('Wall (S)');
  });

  it('only builds name-only maps for unambiguous external links', () => {
    const elementsById = {
      a: makeElement({ id: 'a', name: 'F1 Wall (S)' }),
      b: makeElement({ id: 'b', name: 'F2 Wall (S)' }),
      c: makeElement({ id: 'c', name: 'Door' }),
    };

    const result = buildUnambiguousElementNameMap(
      [
        { elementId: 'a', from: 'Wall (S)', to: 'F1 Wall (S)', zoneId: 'z0', type: 'BuildingElementOpaque' },
        { elementId: 'b', from: 'Wall (S)', to: 'F2 Wall (S)', zoneId: 'z1', type: 'BuildingElementOpaque' },
        { elementId: 'c', from: 'Old Door', to: 'Door', zoneId: 'z0', type: 'BuildingElementTransparent' },
      ],
      elementsById,
      ['a', 'b', 'c'],
    );

    expect(result.nameMap.get('Wall (S)')).toBeUndefined();
    expect(result.nameMap.get('Old Door')).toBe('Door');
    expect(result.skippedAmbiguousNameCount).toBe(1);
  });
});
