// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import { EdgeInsulationFields } from '../EdgeInsulationFields';

const root = { $defs: { WallInsulationMaterial: { enum: ['mineral wool', 'EPS', 'XPS'] } } };

function renderExisting(value: unknown) {
  const onChange = vi.fn();
  const port = { ...canonicalGeometrySchemaPort, getRootSchema: () => root as never };
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: port });
  store.setState({ complianceSettings: { IsExistingBuilding: true } } as never);
  render(
    <GeometryEditorServicePortsProvider schemaPort={port} workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}>
      <GeometryStoreProvider store={store}>
        <EdgeInsulationFields value={value} onChange={onChange} elementType="BuildingElementGround" />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return onChange;
}

it('takes thickness and material on an existing building by default, with the defaults as placeholders', () => {
  const onChange = renderExisting(null);
  const method = screen.getByRole('group', { name: 'Edge insulation from' });
  expect(within(method).getByRole('button', { name: 'Thickness and material' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByPlaceholderText('0.025 m (default)')).toHaveLength(2);
  expect(screen.getByPlaceholderText('0.26 m (default)')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Edge thermal resistance/)).not.toBeInTheDocument();
  // The material list is the schema's.
  const material = screen.getAllByText('Mineral wool (default)')[1]!.closest('select')!;
  expect([...material.options].map((option) => option.textContent)).toEqual(['Mineral wool (default)', 'Mineral wool', 'EPS', 'XPS']);
  fireEvent.change(screen.getAllByPlaceholderText('0.025 m (default)')[1]!, { target: { value: '0.05' } });
  fireEvent.change(material, { target: { value: 'EPS' } });
  expect(onChange).toHaveBeenLastCalledWith([{ type: 'vertical', thickness: 0.05, material: 'EPS' }]);
  // Conductivity is detail, under More.
  expect(screen.queryByLabelText(/Thermal conductivity/)).not.toBeInTheDocument();
  expect(screen.getAllByText('More')).toHaveLength(2);
});

it('keeps a conductivity XPS needs in view', () => {
  renderExisting([{ type: 'vertical', material: 'XPS' }]);
  expect(screen.getByPlaceholderText('Required for XPS')).toBeInTheDocument();
});

it('shows the stated method, and switching clears the other method in one change', () => {
  const onChange = renderExisting([{ type: 'vertical', depth: 0.3, thickness: 0.05, material: 'EPS' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Resistance' }));
  expect(onChange).toHaveBeenLastCalledWith([{ type: 'vertical', depth: 0.3 }]);
  expect(screen.getAllByLabelText(/Edge thermal resistance/)).toHaveLength(2);
  expect(screen.queryByPlaceholderText('0.025 m (default)')).not.toBeInTheDocument();
});
