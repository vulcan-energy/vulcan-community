// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GeometryDocumentHostPort } from '../../../../geometry-document/src';
import { FilenameBar } from '../FilenameBar';
import {
  createGeometryStore,
  GeometryStoreProvider,
} from '../../stores/geometryStore';

function documentHostHarness(): GeometryDocumentHostPort {
  const completed = async () => Object.freeze({ status: 'completed' as const });
  const document = Object.freeze({
    fileName: 'Model.csv',
    text: '',
    derivedResources: Object.freeze([]),
    sourceFiles: Object.freeze([]),
    revision: 0,
    persistedRevision: 0,
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

    await user.click(screen.getByRole('button', { name: 'Validation failed at last save' }));

    expect(screen.getByText(
      'This saved model is hidden from Scenarios until it passes validation on re-save.',
    )).toBeInTheDocument();
    // The readiness dropdown has nothing to copy; the header must not offer the
    // "Copy error" control that build-error mode renders.
    expect(screen.queryByRole('button', { name: 'Copy error' })).not.toBeInTheDocument();
  });

  it('does not double-render the persisted chip while live build errors are present', () => {
    renderFilenameBar(false, true);

    expect(screen.getByRole('button', { name: /Build Error/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validation failed at last save' })).not.toBeInTheDocument();
  });

  it.each([true, undefined])('renders no readiness chip for a %s verdict', (verdict) => {
    renderFilenameBar(verdict);

    expect(screen.queryByRole('button', { name: 'Validation failed at last save' })).not.toBeInTheDocument();
  });
});
