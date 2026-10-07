// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  GeometryEditorServicePortsProvider,
  useGeometrySchemaPort,
  useGeometrySourceComparisonPort,
  useGeometryWorkspaceResourcePort,
} from '../editorServicePorts';
import type { GeometrySourceComparisonPort } from '../sourceComparisonPort';
import type { GeometrySchemaPort } from '../schemaPort';
import type { GeometryWorkspaceResourcePort } from '../workspaceResourcePort';

const schemaPort: GeometrySchemaPort = Object.freeze({
  availability: 'available',
  preload: async () => undefined,
  getRootSchema: () => Object.freeze({}),
  getElementSubschema: () => null,
  getBaseFieldsForElementType: () => Object.freeze([]),
  getApplianceKeys: () => Object.freeze([]),
  getStrictestIntegerKeysForElementType: () => new Set<string>(),
  findParameter: () => null,
});

const workspaceResourcePort: GeometryWorkspaceResourcePort = Object.freeze({
  availability: 'available',
  readText: async () => '',
  readFile: async () => new File([], 'resource'),
  writeText: async () => undefined,
  writeBytes: async () => undefined,
  removeFile: async () => undefined,
  ensureDirectory: async () => undefined,
  exists: async () => false,
  list: async () => Object.freeze([]),
});
const comparisonSnapshot = Object.freeze({ revision: 0, inputRevision: 0 });
const sourceComparisonPort: GeometrySourceComparisonPort = Object.freeze({
  availability: 'available',
  label: 'test source',
  getSnapshot: () => comparisonSnapshot,
  subscribe: () => () => undefined,
  refresh: () => undefined,
  elementInfo: () => null,
  zoneInfo: () => null,
  globalInfo: () => null,
  listMissingItems: () => [],
  candidateElementTypes: () => [],
  prefillMissingItem: () => null,
  assignMissingItem: async () => undefined,
  assignmentForElement: () => null,
  unassignElement: async () => undefined,
});

function Probe() {
  const schema = useGeometrySchemaPort();
  const workspace = useGeometryWorkspaceResourcePort();
  const comparison = useGeometrySourceComparisonPort();
  return <span>{`${schema.availability}:${workspace.availability}:${comparison.availability}`}</span>;
}

describe('Geometry editor service ports', () => {
  it('fails closed outside a host and supplies the exact per-host ports inside one', () => {
    const { rerender } = render(<Probe />);
    expect(screen.getByText('unavailable:unavailable:unavailable')).toBeInTheDocument();

    rerender(
      <GeometryEditorServicePortsProvider
        schemaPort={schemaPort}
        workspaceResourcePort={workspaceResourcePort}
        sourceComparisonPort={sourceComparisonPort}
      >
        <Probe />
      </GeometryEditorServicePortsProvider>,
    );
    expect(screen.getByText('available:available:available')).toBeInTheDocument();
  });
});


describe('schema revision subscriptions', () => {
  it('refreshes schema-derived fields without remounting or clearing a draft', () => {
    let revision = 0;
    let fields = ['u_value'];
    const listeners = new Set<() => void>();
    const reactivePort: GeometrySchemaPort = {
      ...schemaPort,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      getRevision: () => revision,
      getBaseFieldsForElementType: () => fields,
    };
    function MountedEditor() {
      const port = useGeometrySchemaPort();
      const names = useMemo(() => port.getBaseFieldsForElementType('BuildingElementPartyWall'), [port]);
      const [draft, setDraft] = useState('');
      return <><span>{names.join(',')}</span><input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} /></>;
    }
    const { unmount } = render(<GeometryEditorServicePortsProvider schemaPort={reactivePort} workspaceResourcePort={workspaceResourcePort}><MountedEditor /></GeometryEditorServicePortsProvider>);
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: '0.25' } });
    expect(screen.getByText('u_value')).toBeInTheDocument();
    act(() => { fields = ['u_value_whole_wall']; revision++; listeners.forEach(listener => listener()); });
    expect(screen.getByText('u_value_whole_wall')).toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toHaveValue('0.25');
    unmount();
    expect(listeners.size).toBe(0);
  });
});
