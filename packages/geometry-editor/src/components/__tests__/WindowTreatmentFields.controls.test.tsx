// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/index';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { WindowTreatmentFields } from '../WindowTreatmentFields';

const subschema = { properties: { treatment: { type: 'array', items: { properties: { controls: { enum: ['auto_motorised', 'manual'] } } } } } };
const resources = { availability: 'unavailable' } as never;

function renderControls(controls: string, schema: typeof subschema | null) {
  render(
    <GeometryEditorServicePortsProvider
      schemaPort={{ ...canonicalGeometrySchemaPort, getElementSubschema: () => schema, getRootSchema: () => ({ $defs: {} }) }}
      workspaceResourcePort={resources}
    >
      <GeometryStoreProvider store={createGeometryStore()}>
        <WindowTreatmentFields
          treatment={[{ type: 'blinds', controls, delta_r: 0.1, trans_red: 0.25 }]}
          treatmentUi={null}
          onPatch={vi.fn()}
          elementType="BuildingElementTransparent"
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return screen.getAllByRole('option').map((option) => option.textContent);
}

describe('WindowTreatmentFields controls', () => {
  it('offers only the schema values', () => {
    const options = renderControls('manual', subschema);
    expect(options).toContain('Manual');
    expect(options).not.toContain('Motorised (manual)');
    expect(screen.queryByText(/does not accept this control/)).toBeNull();
  });

  it('keeps a rejected saved value visible with an error', () => {
    expect(renderControls('manual_motorised', subschema)).toContain('Motorised (manual)');
    expect(screen.getByText(/does not accept this control/)).toBeInTheDocument();
  });

  it('keeps every option when no schema declares them', () => {
    expect(renderControls('manual_motorised', null)).toContain('Linked lights / HVAC');
  });
});
