// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { emptyGeometryInspectorContributions } from '../../../../geometry-editor-host/src/inspectorContributions';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { ElementCreator } from '../ElementCreator';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';

type Store = ReturnType<typeof createGeometryStore>;

const line = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 }];

/**
 * A 4 m × 8.9 m ground floor with walls on three sides and a party wall on the fourth, so the
 * drawing gives an exposed perimeter of 16.9 m. `statedPerimeter` is written as a file would
 * carry it: no marker saying who entered it.
 */
function openedModel(statedPerimeter?: number): Store {
  const builder = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  builder.getState().addZone({ name: 'Zone 1', floorArea: 35.6, height: 2.8, volume: 99.68 });
  const zoneId = builder.getState().zones[0]!.id;
  const wall = (name: string, coordinates: ReturnType<typeof line>) => ({
    type: 'BuildingElementOpaque' as const, name, zoneId, height: 2.8, pitch: 90, base_height: 0,
    parent_element: null, coordinates,
  });
  builder.getState().addElements([
    wall('Wall (S)', line(0, 0, 4, 0)),
    wall('Wall (N)', line(4, 8.9, 0, 8.9)),
    wall('Wall (W)', line(0, 8.9, 0, 0)),
    { type: 'BuildingElementPartyWall', name: 'Party Wall (E)', zoneId, height: 2.8, pitch: 90, coordinates: line(4, 0, 4, 8.9) },
    {
      type: 'BuildingElementGround', name: 'Floor', zoneId, floor_type: 'Slab_no_edge_insulation',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 8.9, z: 0 }, { x: 0, y: 8.9, z: 0 }],
    },
  ] as never);
  let csv = builder.getState().generateCSV({ allowUnresolvedMigration: true });
  if (statedPerimeter !== undefined) {
    csv = csv.replace(',16.9,Slab_no_edge_insulation', `,${statedPerimeter},Slab_no_edge_insulation`);
    expect(csv).toContain(`${statedPerimeter},Slab_no_edge_insulation`);
  }
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  store.getState().loadFromCSV(csv);
  return store;
}

const idOf = (store: Store, name: string) =>
  store.getState().elementIds.find((id) => store.getState().elementsById[id]?.name === name)!;
const perimeterOf = (store: Store) =>
  (store.getState().elementsById[idOf(store, 'Floor')] as { perimeter?: number }).perimeter;

describe('ground perimeter follows the walls only on edits', () => {
  it('opening the model and selecting the floor write nothing', () => {
    const store = openedModel(25.8);
    expect(perimeterOf(store)).toBe(25.8);
    expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);

    render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
      >
        <GeometryStoreProvider store={store}>
          <ElementCreator selection={{ type: 'element', id: idOf(store, 'Floor') } as never} setSelection={vi.fn()}
            useCard={false} inspectorContributions={emptyGeometryInspectorContributions} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    expect(perimeterOf(store)).toBe(25.8);
    expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
  });

  it('a wall edit updates a perimeter that follows the drawing', () => {
    const store = openedModel();
    expect(perimeterOf(store)).toBe(16.9);
    store.getState().updateElement(idOf(store, 'Wall (S)'), { coordinates: line(2, 0, 4, 0) });
    expect(perimeterOf(store)).toBe(14.9);
  });

  it('a stated perimeter survives a wall edit', () => {
    const store = openedModel(25.8);
    store.getState().updateElement(idOf(store, 'Wall (S)'), { coordinates: line(2, 0, 4, 0) });
    expect(perimeterOf(store)).toBe(25.8);
  });

  it('undo restores the walls and the perimeter without a further write', () => {
    const store = openedModel();
    store.getState().updateElement(idOf(store, 'Wall (S)'), { coordinates: line(2, 0, 4, 0) });
    store.getState().saveToHistory('edit');
    store.getState().undo();
    expect(perimeterOf(store)).toBe(16.9);
    expect(store.getState().getDocumentCsv()).toBe(store.getState().lastSavedCsv);
  });
});
