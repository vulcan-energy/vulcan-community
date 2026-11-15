// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GeometryDocumentHostPort } from '../../../../geometry-document/src';
import type { ReactNode } from 'react';
import { FilenameBar, type FilenameBarActionContext } from '../FilenameBar';
import { defineFilenameActionContributions } from '../../../../geometry-editor-host/src';
import {
  createGeometryStore,
  GeometryStoreProvider,
} from '../../stores/geometryStore';

function documentHostHarness(persistedRevision: number | null = 0): GeometryDocumentHostPort {
  const completed = async () => Object.freeze({ status: 'completed' as const });
  const document = Object.freeze({
    fileName: 'Model.csv',
    text: '',
    derivedResources: Object.freeze([]),
    sourceFiles: Object.freeze([]),
    revision: 0,
    persistedRevision,
    isDirty: false,
  });
  const snapshot = Object.freeze({
    document,
    activeDocument: null,
    operation: null,
  });
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    updateFileName: vi.fn(),
    isDirty: () => false,
    save: vi.fn(completed),
    newDocument: vi.fn(completed),
    open: vi.fn(completed),
    delete: vi.fn(completed),
    duplicate: vi.fn(completed),
    dispose: vi.fn(),
  });
}

function renderFilenameBar(scenariosBaseModelEnabled?: boolean, withLiveBuildError = false) {
  const store = createGeometryStore();
  store.getState().setComplianceSettings({ scenariosBaseModelEnabled });

  return render(
    <GeometryStoreProvider store={store}>
      <FilenameBar
        documentHost={documentHostHarness()}
        saveStatus="idle"
        saveError={null}
        buildError={withLiveBuildError ? 'Schema validation failed' : null}
        buildErrorItems={withLiveBuildError ? [{
          source: 'schema',
          message: '"NumberOfBedrooms" is a required property',
          path: '/',
          keyword: 'required',
        }] : []}
      />
    </GeometryStoreProvider>,
  );
}

describe('FilenameBar validation readiness', () => {
  it('shows the persisted failed-verdict chip and explanatory dropdown after reload', async () => {
    const user = userEvent.setup();
    renderFilenameBar(false);

    await user.click(screen.getByRole('button', { name: 'Not validated' }));

    expect(screen.getByText(
      'This saved model is hidden from Scenarios until it passes validation on re-save.',
    )).toBeInTheDocument();
    // The readiness dropdown has nothing to copy; the header must not offer the
    // "Copy error" control that build-error mode renders.
    expect(screen.queryByRole('button', { name: 'Copy error' })).not.toBeInTheDocument();
  });

  it('does not double-render the persisted chip while live build errors are present', () => {
    renderFilenameBar(false, true);

    expect(screen.getByRole('button', { name: 'Build Error (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not validated' })).not.toBeInTheDocument();
  });

  it('does not show Not validated for a draft that was never saved', () => {
    const store = createGeometryStore();
    store.getState().setComplianceSettings({ scenariosBaseModelEnabled: false });
    render(
      <GeometryStoreProvider store={store}>
        <FilenameBar documentHost={documentHostHarness(null)} saveStatus="idle" saveError={null} />
      </GeometryStoreProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Not validated' })).not.toBeInTheDocument();
  });

  it('keeps a data-loss load warning on the red chip without blocking Save', () => {
    render(
      <GeometryStoreProvider store={createGeometryStore()}>
        <FilenameBar documentHost={documentHostHarness()} saveStatus="idle" saveError={null}
          buildError="Loaded with 1 data warning(s)"
          buildErrorItems={[
            { source: 'build', severity: 'warning', message: 'Opening the model updated 1 value.' },
            { source: 'build', message: 'Wall 1: extra_json was malformed and its overrides were dropped.' },
          ]} />
      </GeometryStoreProvider>,
    );

    expect(screen.getByRole('button', { name: 'Build Error (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows no chip beside Save when there are only notices', () => {
    render(
      <GeometryStoreProvider store={createGeometryStore()}>
        <FilenameBar
          documentHost={documentHostHarness()}
          saveStatus="idle"
          saveError={null}
          buildError="Loading changed the file"
          buildErrorItems={[{ source: 'schema', severity: 'warning', path: '/', message: 'Opening the model updated 1 value.' }]}
        />
      </GeometryStoreProvider>,
    );

    expect(screen.queryByRole('button', { name: /Notice|Build Error/ })).not.toBeInTheDocument();
  });

  it('shows the live check\'s errors on open, before any save, beside a load notice', () => {
    const store = createGeometryStore();
    store.getState().setTargetValidation({ hemVersion: '0.13.2', items: [{ source: 'schema', path: '/OnSiteGeneration/PV/mounting_type', message: 'PV: mounting type is required.' }] });
    render(
      <GeometryStoreProvider store={store}>
        <FilenameBar documentHost={documentHostHarness()} saveStatus="idle" saveError={null}
          buildErrorItems={[{ source: 'build', severity: 'warning', message: 'Opening the model updated 1 value.' }]} />
      </GeometryStoreProvider>,
    );
    // The notice is not an error: it is listed under a Notices heading, after the errors.
    fireEvent.click(screen.getByRole('button', { name: 'Build Error (1)' }));
    expect(screen.getByText('1 error')).toBeInTheDocument();
    const heading = screen.getByText('Notices');
    expect(screen.getAllByText('PV: mounting type is required.')[0].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(screen.getAllByText('Opening the model updated 1 value.')[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a long notice\'s first line, with the rest under Details', () => {
    const store = createGeometryStore();
    store.getState().setTargetValidation({ hemVersion: '0.13.2', items: [{ source: 'schema', path: '/OnSiteGeneration/PV/mounting_type', message: 'PV: mounting type is required.' }] });
    render(
      <GeometryStoreProvider store={store}>
        <FilenameBar documentHost={documentHostHarness()} saveStatus="idle" saveError={null}
          buildErrorItems={[{ source: 'build', severity: 'warning', message: 'Opening the model updated 2 values. Save to keep them.\nWall 1 area 1 → 2; Wall 2 area 3 → 4.' }]} />
      </GeometryStoreProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Build Error (1)' }));
    expect(screen.getByText('Opening the model updated 2 values. Save to keep them.')).toBeInTheDocument();
    expect(screen.getByText(/Wall 1 area 1 → 2/).closest('details')).not.toBeNull();
  });

  it.each([true, undefined])('renders no readiness chip for a %s verdict', (verdict) => {
    renderFilenameBar(verdict);

    expect(screen.queryByRole('button', { name: /Build Error|Not validated/ })).not.toBeInTheDocument();
  });
});


describe('FilenameBar migration review', () => {
  it('requires an explicit choice for selected affected elements and keeps others unresolved', async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const wall = (id: string) => ({ id, name: `Party ${id}`, type: 'BuildingElementPartyWall' as const, zoneId: 'z', width: 2, height: 3, area: 6, parent_element: null, coordinates: [], extra_json: { u_value: .25 } });
    store.setState({ sourceCsvVersion: 2, elementsById: { a: wall('a'), b: wall('b') }, elementIds: ['a', 'b'] });
    const documentHost = documentHostHarness();
    render(<GeometryStoreProvider store={store}><FilenameBar documentHost={documentHost} saveStatus="idle" saveError={null} /></GeometryStoreProvider>);
    expect(screen.queryByRole('combobox', { name: 'U-value meaning' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(documentHost.save).not.toHaveBeenCalled();
    expect(store.getState().elementsById.a.extra_json?.u_value_interpretation).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade CSV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply and save' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Party a/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Party b/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Party b/ }));
    const apply = screen.getByRole('button', { name: 'Apply', exact: true });
    expect(apply).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'U-value meaning' }), 'whole_wall');
    await user.click(apply);
    expect(store.getState().getCsvMigrationIssues().map(issue => issue.elementName)).toEqual(['Party b']);
    expect(store.getState().elementsById.a.extra_json?.u_value_whole_wall).toBe(.25);
    expect(screen.getByRole('combobox', { name: 'U-value meaning' })).toHaveValue('');
    expect(documentHost.save).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /Party b/ })).toBeChecked();
    await user.selectOptions(screen.getByRole('combobox', { name: 'U-value meaning' }), 'half_construction');
    await user.click(screen.getByRole('button', { name: 'Apply and save' }));
    expect(store.getState().getCsvMigrationIssues()).toEqual([]);
    expect(store.getState().elementsById.b.extra_json?.u_value_interpretation).toBe('half_construction');
    expect(documentHost.save).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Check party-wall U-values' })).not.toBeInTheDocument();
  });
});

describe('FilenameBar build error rows', () => {
  it('collapses schema errors under the converter error on the same element and navigates to its input', async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const element = (id: string, name: string) => ({ id, name, type: 'BuildingElementTransparent' as const, zoneId: 'z1', coordinates: [{ x: 0, y: 0, z: 3 }] });
    store.setState({
      zones: [{ id: 'z1', name: 'Zone 1' }] as never,
      elementsById: { w1: element('w1', 'Window 1'), w10: element('w10', 'Window 10') } as never,
      elementIds: ['w1', 'w10'],
    });
    render(
      <GeometryStoreProvider store={store}>
        <FilenameBar
          documentHost={documentHostHarness()}
          saveStatus="idle"
          saveError={null}
          buildError="Schema validation failed"
          buildErrorItems={[
            { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Window 1/mid_height', message: 'Whole-window and airflow-division mid-heights disagree.' },
            { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Window 1/window_part_list/0', message: '"mid_height" is a required property' },
            { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Window 10/window_part_list/0', message: '"free_area_height" is a required property' },
          ]}
        />
      </GeometryStoreProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Build Error (2)' }));
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByText('Details (+1 related)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Whole-window and airflow-division mid-heights disagree.' }));
    expect(store.getState().selection).toEqual({ type: 'element', id: 'w1', focusFieldKey: 'mid_height' });
    expect(store.getState().currentFloorZ).toBe(3);
  });
});

describe('FilenameBar action placement', () => {
  it('renders save-placed actions beside Save and the rest with the leading actions', () => {
    const store = createGeometryStore();
    const contributions = defineFilenameActionContributions<FilenameBarActionContext, ReactNode>({
      filenameActions: [
        { id: 'lead', render: () => <button type="button">Lead</button> },
        { id: 'menu', placement: 'save', render: () => <button type="button">Save menu</button> },
      ],
    });
    const { container } = render(
      <GeometryStoreProvider store={store}>
        <FilenameBar
          documentHost={documentHostHarness()}
          saveStatus="idle"
          saveError={null}
          filenameActionContributions={contributions}
        />
      </GeometryStoreProvider>,
    );
    const saveStack = container.querySelector('.filename-bar-save-stack')!;
    expect(saveStack.contains(screen.getByRole('button', { name: 'Save menu' }))).toBe(true);
    expect(container.querySelector('.filename-bar-left')!.contains(screen.getByRole('button', { name: 'Lead' }))).toBe(true);
  });
});
