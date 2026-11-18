// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Applied assembly versus fabric value edits, through the two editing surfaces a user has:
 * the single-element Advanced Fields (ElementCreator passes its patch straight to
 * `updateElement`) and the multi-select construction rows.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../../lib/geometrySchemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { createGeometryStore, GeometryStoreProvider, type GeometryStoreApi } from '../../stores/geometryStore';
import type { Element } from '../../geometry/types';
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import { MultiSelectPanel } from '../MultiSelectPanel';
import { dormerThermalOverrideAfterEdit } from '../../lib/dormerGeometry';
import { ASSEMBLY_SET_ASIDE_KEY } from '../../lib/assemblyAppliedUi';
import { A7_AREAL_HEAT_CAPACITY_INPUT } from '../../../../geometry-editor-host/src/schemaPort';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({
    loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema),
  });
  await Promise.all([canonicalGeometrySchemaPort.preload('core'), canonicalGeometrySchemaPort.preload('fhs')]);
});
afterAll(() => resetGeometrySchemaAssetsForTests());
afterEach(() => cleanup());

const envelope = {
  schemaVersion: 1,
  assemblyId: 'wall-assembly',
  assemblySnapshot: {
    layers: [{ kind: 'solid', materialId: 'brick', thickness_m: 0.1 }],
    pitchDegrees: 90,
    elementMode: 'BuildingElementOpaque',
  },
  appliedAt: '2026-01-01T00:00:00.000Z',
  uncorrectedU_W_m2K: 0.18,
  correctedU_W_m2K: 0.18,
  uValueWrittenToElement_W_m2K: 0.18,
  thermalResistanceConstruction_m2K_W: 5,
  calculationEngineVersion: 'test',
};

function wall(): Element {
  return {
    id: 'wall', type: 'BuildingElementOpaque', name: 'Wall', zoneId: 'zone',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    width: 4, height: 2.4, area: 9.6, pitch: 90,
    extra_json: { u_value: 0.18, thermal_resistance_construction: 5, vulcan_assembly_v1: envelope },
  } as Element;
}

function storeWith(element: Element): GeometryStoreApi {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.setState({
    elementsById: { [element.id]: element }, elementIds: [element.id], selectedElementIds: [element.id],
    zones: [{ id: 'zone', name: 'Zone', floorArea: 1, height: 2.4 }], zoneIds: ['zone'],
  });
  return store;
}

function providers(store: GeometryStoreApi, children: React.ReactNode) {
  return (
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>{children}</GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>
  );
}

/** ElementCreator's `handleAdvancedFieldsChange` hands a non-system patch to `updateElement` unchanged. */
function SingleElementHarness({ store }: { store: GeometryStoreApi }) {
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  const element = store.getState().elementsById.wall!;
  return (
    <AdvancedFieldsEditor
      elementType="BuildingElementOpaque"
      subtype="wall"
      currentData={element}
      onChange={(patch) => {
        store.getState().updateElement('wall', patch as Partial<Element>);
        rerender();
      }}
      collapsible={false}
      useFHSSchema
    />
  );
}

function extra(store: GeometryStoreApi): Record<string, unknown> {
  return store.getState().elementsById.wall!.extra_json as Record<string, unknown>;
}

function editSingleElementU(store: GeometryStoreApi, value: string) {
  const { container } = render(providers(store, <SingleElementHarness store={store} />));
  const row = container.querySelector<HTMLElement>('[data-field-key="u_value"]')!;
  fireEvent.change(within(row).getByRole('textbox'), { target: { value } });
}

function editMultiSelectU(store: GeometryStoreApi, value: string) {
  render(providers(store, <MultiSelectPanel selectedElementIds={['wall']} onDelete={vi.fn()} />));
  fireEvent.change(screen.getByLabelText('U-Value'), { target: { value } });
}

describe('assembly versus U-value edits', () => {
  it.each([
    ['single element', editSingleElementU],
    ['multi-select', editMultiSelectU],
  ])('%s: a U override sets the layers aside, out of the converter\'s reach', async (_surface, edit) => {
    const store = storeWith(wall());
    edit(store, '0.16');
    await waitFor(() => expect(extra(store).u_value).toBe(0.16));
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
    expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY]).toEqual(envelope);
    // With R left behind the converter would drop the user's U (hem-target-core target_contracts).
    expect(extra(store).thermal_resistance_construction).toBeUndefined();
  });

  it('the U-value back at the layers\' value, or blank, brings the layers back', () => {
    for (const u of [0.18, undefined]) {
      const store = storeWith(wall());
      const { updateElement } = store.getState();
      updateElement('wall', { extra_json: { ...extra(store), u_value: 0.3 } });
      updateElement('wall', { extra_json: { ...extra(store), u_value: u } });
      expect(extra(store), String(u)).toMatchObject({ u_value: 0.18, thermal_resistance_construction: 5, vulcan_assembly_v1: envelope });
      expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY], String(u)).toBeUndefined();
    }
  });

  const massEnvelope = { ...envelope, arealHeatCapacityWrittenToElement_J_m2K: 110000, massDistributionClass: 'I: Mass concentrated at internal side' };
  const massWall = () => ({ ...wall(), extra_json: {
    u_value: 0.18, thermal_resistance_construction: 5, areal_heat_capacity: 'Medium',
    mass_distribution_class: 'I: Mass concentrated at internal side', vulcan_assembly_v1: massEnvelope,
  } } as Element);
  // The store's default target (HEM:FHS a7) takes a class, on the surface scale.
  const edited = { ...massEnvelope, uValueWrittenToElement_W_m2K: 0.2, thermalResistanceConstruction_m2K_W: 4.8, arealHeatCapacityWrittenToElement_J_m2K: 175000 };

  it('a row edit while set aside moves the values that still follow the layers, not the typed one', () => {
    const store = storeWith(massWall());
    const { updateElement } = store.getState();
    updateElement('wall', { extra_json: { ...extra(store), areal_heat_capacity: 'Light' } });
    updateElement('wall', { extra_json: { ...extra(store), [ASSEMBLY_SET_ASIDE_KEY]: edited } });
    expect(extra(store)).toMatchObject({ u_value: 0.2, thermal_resistance_construction: 4.8, areal_heat_capacity: 'Light', [ASSEMBLY_SET_ASIDE_KEY]: edited });
    // Under a typed U, the heat capacity and mass the layers give still follow them.
    const typed = storeWith(massWall());
    typed.getState().updateElement('wall', { extra_json: { ...extra(typed), u_value: 0.3 } });
    typed.getState().updateElement('wall', { extra_json: { ...extra(typed), [ASSEMBLY_SET_ASIDE_KEY]: edited } });
    expect(extra(typed)).toMatchObject({ u_value: 0.3, areal_heat_capacity: 'Heavy', [ASSEMBLY_SET_ASIDE_KEY]: edited });
    expect(extra(typed).thermal_resistance_construction).toBeUndefined();
  });

  it('"Use the layers" on one field brings back every value the layers give, whatever the others say', () => {
    for (const override of [{ areal_heat_capacity: 'Light' }, { thermal_resistance_construction: 4 }]) {
      const store = storeWith(massWall());
      const { updateElement } = store.getState();
      updateElement('wall', { extra_json: { ...extra(store), ...override } });
      updateElement('wall', { extra_json: { ...extra(store), u_value: 0.4, thermal_resistance_construction: 2 } });
      updateElement('wall', { extra_json: { ...extra(store), [ASSEMBLY_SET_ASIDE_KEY]: edited } });
      updateElement('wall', { extra_json: { ...extra(store), u_value: 0.2 } });
      expect(extra(store), JSON.stringify(override)).toMatchObject({
        u_value: 0.2, thermal_resistance_construction: 4.8, areal_heat_capacity: 'Heavy',
        mass_distribution_class: 'I: Mass concentrated at internal side', vulcan_assembly_v1: edited,
      });
      expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY]).toBeUndefined();
    }
  });

  it('a heat capacity or mass class put back at the layers\' value keeps a typed U: it only sets that field', () => {
    const store = storeWith(massWall());
    const { updateElement } = store.getState();
    updateElement('wall', { extra_json: { ...extra(store), u_value: 0.3 } });
    updateElement('wall', { extra_json: { ...extra(store), mass_distribution_class: 'E: Mass concentrated at external side' } });
    updateElement('wall', { extra_json: { ...extra(store), mass_distribution_class: 'I: Mass concentrated at internal side' } });
    expect(extra(store)).toMatchObject({ u_value: 0.3, mass_distribution_class: 'I: Mass concentrated at internal side', [ASSEMBLY_SET_ASIDE_KEY]: massEnvelope });
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
    // With U and R at the layers' values (or blank), the same reset brings the layers back.
    const kappa = storeWith(massWall());
    kappa.getState().updateElement('wall', { extra_json: { ...extra(kappa), areal_heat_capacity: 'Light' } });
    kappa.getState().updateElement('wall', { extra_json: { ...extra(kappa), areal_heat_capacity: 'Medium' } });
    expect(extra(kappa)).toMatchObject({ u_value: 0.18, areal_heat_capacity: 'Medium', vulcan_assembly_v1: massEnvelope });
  });

  it('a fresh build-up replaces layers set aside', () => {
    const store = storeWith(wall());
    const { updateElement } = store.getState();
    updateElement('wall', { extra_json: { ...extra(store), u_value: 0.3 } });
    const fresh = { ...envelope, assemblyId: 'other' };
    updateElement('wall', { extra_json: { ...extra(store), u_value: 0.18, thermal_resistance_construction: 5, vulcan_assembly_v1: fresh } });
    expect(extra(store).vulcan_assembly_v1).toEqual(fresh);
    expect(extra(store)[ASSEMBLY_SET_ASIDE_KEY]).toBeUndefined();
  });

  it('an R, whole-wall U or mass override keeps the other values as entered values', () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['BuildingElementOpaque', { thermal_resistance_construction: 4 }, { u_value: 0.18, thermal_resistance_construction: 4 }],
      ['BuildingElementPartyWall', { u_value_whole_wall: 0.3 }, { u_value: 0.18, thermal_resistance_construction: 5 }],
      ['BuildingElementOpaque', { mass_distribution_class: 'I: Mass concentrated at internal side' }, { u_value: 0.18, thermal_resistance_construction: 5 }],
    ];
    for (const [type, edit, kept] of cases) {
      const store = storeWith({ ...wall(), type } as Element);
      store.getState().updateElement('wall', { extra_json: { ...extra(store), ...edit } });
      expect(extra(store).vulcan_assembly_v1, type).toBeUndefined();
      expect(extra(store), type).toMatchObject(kept);
    }
  });

  it('a party-wall half U override removes the assembly R, so the converter derives R from the U', () => {
    const store = storeWith({ ...wall(), type: 'BuildingElementPartyWall' } as Element);
    store.getState().updateElement('wall', {
      extra_json: { ...extra(store), u_value: 0.4, u_value_interpretation: 'half_construction', u_value_interpreted_value: 0.4 },
    });
    expect(extra(store).thermal_resistance_construction).toBeUndefined();
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
  });

  it('writing the assembly value back, or a non-fabric edit, keeps the envelope', () => {
    const element = wall();
    element.extra_json = { ...element.extra_json, u_value: 0.2 };
    const store = storeWith(element);
    const { updateElement } = store.getState();
    updateElement('wall', { extra_json: { ...extra(store), solar_absorption_coeff: 0.4 } });
    expect(extra(store).vulcan_assembly_v1).toEqual(envelope);
    updateElement('wall', { extra_json: { ...extra(store), u_value: 0.18 } });
    expect(extra(store).vulcan_assembly_v1).toEqual(envelope);
  });

  it('a computed ground U does not clear the ground assembly', () => {
    const ground = {
      ...wall(), id: 'wall', type: 'BuildingElementGround',
      extra_json: { u_value: 0.2, thermal_resistance_floor_construction: 5, vulcan_assembly_v1: envelope },
    } as Element;
    const store = storeWith(ground);
    store.getState().updateElement('wall', { extra_json: { ...extra(store), u_value: 0.15 } });
    expect(extra(store).vulcan_assembly_v1).toEqual(envelope);
    store.getState().updateElement('wall', { extra_json: { ...extra(store), thermal_resistance_floor_construction: 4 } });
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
  });

  it('clearing U drops the envelope but keeps R as the source', () => {
    const store = storeWith({ ...wall(), type: 'BuildingElementPartyWall' } as Element);
    const withoutU = { ...extra(store) };
    delete withoutU.u_value;
    store.getState().updateElement('wall', { extra_json: withoutU });
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
    expect(extra(store).thermal_resistance_construction).toBe(5);
  });

  it('changing construction_basis away from the assembly basis drops the envelope', () => {
    const halfEnvelope = { ...envelope, assemblySnapshot: { ...envelope.assemblySnapshot, elementMode: 'BuildingElementPartyWall' } };
    const store = storeWith({
      ...wall(), type: 'BuildingElementPartyWall',
      extra_json: { u_value: 0.18, thermal_resistance_construction: 5, construction_basis: 'half', vulcan_assembly_v1: halfEnvelope },
    } as Element);
    store.getState().updateElement('wall', { extra_json: { ...extra(store), construction_basis: 'full' } });
    expect(extra(store).vulcan_assembly_v1).toBeUndefined();
  });

  it('dormer: an unrelated edit compares against the representative values the section rendered', () => {
    const representative = { u_value: 0.25, thermal_resistance_construction: 5, vulcan_assembly_v1: envelope };
    const next = dormerThermalOverrideAfterEdit('BuildingElementOpaque', undefined, representative, {
      ...representative, colour: 'Dark',
    }, A7_AREAL_HEAT_CAPACITY_INPUT);
    expect(next).toMatchObject({ thermal_resistance_construction: 5, vulcan_assembly_v1: envelope });
    expect(dormerThermalOverrideAfterEdit('BuildingElementOpaque', undefined, representative, {
      ...representative, u_value: 0.3,
    }, A7_AREAL_HEAT_CAPACITY_INPUT)).toEqual({ u_value: 0.3, [ASSEMBLY_SET_ASIDE_KEY]: envelope });
  });
});
