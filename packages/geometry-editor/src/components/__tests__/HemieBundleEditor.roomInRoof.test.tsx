// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { drawRoofPart, type RoofParameters } from '../../lib/roofPart';
import type { Element } from '../../geometry/types';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { HemieBundleEditor } from '../HemieBundleEditor';

// A room in the roof on the part editor: detached, 8 × 5, hipped all round, common walls.
let n = 0;
const wall = (name: string, a: [number, number], b: [number, number]) => ({
  id: `w${(n += 1)}`, name, type: 'BuildingElementOpaque', zoneId: 'z', parent_element: null,
  coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  width: Math.hypot(b[0] - a[0], b[1] - a[1]), height: 2.5, area: 1, pitch: 90, orientation360: 0, base_height: 0,
}) as unknown as Element;
const walls = () => [wall('Front', [0, 0], [8, 0]), wall('East', [8, 0], [8, 5]), wall('Rear', [8, 5], [0, 5]), wall('West', [0, 5], [0, 0])];

function editor(p: Partial<RoofParameters>) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().addElements(walls().map((e) => ({ ...e, id: undefined })) as never);
  const placed = drawRoofPart(store.getState(), { level: 0, at: { x: 4, y: 2.5 }, use: 'room', ...p } as RoofParameters);
  if ('problem' in placed) throw new Error(placed.problem);
  const anchor = () => store.getState().elementsById[placed.anchorId];
  const noop = () => {};
  const ui = (
    <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <HemieBundleEditor anchor={anchor()} markedId="" onMark={noop} onEditMembers={noop} onRedrawn={noop} onDone={noop} onDelete={noop} />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>
  );
  return { store, anchor, ...render(ui) };
}

describe('room in the roof on the part editor', () => {
  it('common walls: the knee height is required, as the max ceiling height is, and the notice names it', () => {
    editor({ maxCeilingHeight: 2.1 });
    expect(screen.getByLabelText('Knee wall height').closest('[data-field]')!.textContent).toContain('required');
    expect(screen.getByRole('alert').textContent).toBe('Give Roof 1 a knee wall height.');
    // No pitch readout until the room gives one.
    expect(screen.queryByText('from the room')).toBeNull();
  });

  it('a refused measurement stays on screen with the problem', () => {
    const { anchor } = editor({ maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
    const knee = screen.getByLabelText('Knee wall height') as HTMLInputElement;
    fireEvent.change(knee, { target: { value: '2.5' } });
    fireEvent.blur(knee);
    expect(screen.getByRole('alert').textContent).toBe('Make the max ceiling height more than the knee wall height.');
    expect((screen.getByLabelText('Knee wall height') as HTMLInputElement).value).toBe('2.5');
    // Nothing was drawn: the part keeps its knee height.
    expect((anchor().extra_json as { hemie_bundle: { knee_wall_height?: number } }).hemie_bundle.knee_wall_height).not.toBe(2.5);
  });

  it('with the storey outline gone, the notice says so and the room fields are not shown', () => {
    const { store, anchor, rerender } = editor({ maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
    const state = store.getState();
    for (const e of Object.values(state.elementsById)) if (e.type === 'BuildingElementOpaque' && e.pitch === 90 && !e.extra_json?.hemie_bundle) state.removeElement(e.id);
    const noop = () => {};
    rerender(
      <GeometryEditorServicePortsProvider schemaPort={canonicalGeometrySchemaPort} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
        <GeometryStoreProvider store={store}>
          <HemieBundleEditor anchor={anchor()} markedId="" onMark={noop} onEditMembers={noop} onRedrawn={noop} onDone={noop} onDelete={noop} />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    expect(screen.getByRole('alert').textContent).toBe('The storey outline under this roof is gone: draw its walls again, or delete the roof.');
    expect(screen.queryByLabelText('Max ceiling height')).toBeNull();
  });
});
