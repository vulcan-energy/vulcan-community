// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  GeometryFilesMenu,
  type GeometryFilesMenuDocument,
  type GeometryFilesMenuProps,
} from '../files/GeometryFilesMenu';

const documents = Object.freeze([
  Object.freeze({
    id: 'opaque-house-id',
    fileName: 'House.csv',
    modifiedAt: '2026-07-22T10:00:00.000Z',
    storageVersion: 'house:v7',
    projectGroupIds: Object.freeze(['opaque-project-id']),
    summary: Object.freeze({ elements: 12, zones: 2, spaces: 3 }),
  }),
  Object.freeze({
    id: 'opaque-flat-id',
    fileName: 'Flat.csv',
    modifiedAt: null,
    storageVersion: 'flat:v2',
    projectGroupIds: Object.freeze([]),
    summary: Object.freeze({ elements: 5, zones: 1, spaces: 1 }),
  }),
]) satisfies readonly GeometryFilesMenuDocument[];

const defaultProps = {
  workspace: Object.freeze({
    status: 'connected' as const,
    directoryName: 'My Models',
    canChoose: true,
  }),
  documents,
  projects: Object.freeze([
    Object.freeze({
      id: 'opaque-project-id',
      name: 'Retrofit',
      description: 'Current retrofit options',
      storageVersion: 'project:v3',
    }),
  ]),
  activeDocumentId: 'opaque-house-id',
  filter: Object.freeze({ kind: 'all' as const }),
  isLoading: false,
  isBusy: false,
  error: null,
  notice: null,
  onFilterChange: vi.fn(),
  onRefresh: vi.fn(),
  onOpenDocument: vi.fn(),
  onDuplicateDocument: vi.fn(),
  onDeleteDocument: vi.fn(),
} satisfies GeometryFilesMenuProps;

function renderMenu(overrides: Partial<GeometryFilesMenuProps> = {}) {
  const props = { ...defaultProps, ...overrides } as GeometryFilesMenuProps;
  render(<GeometryFilesMenu {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
  return props;
}

describe('shared Geometry Files menu', () => {
  it('preserves the historic Files shell without adding a visible workspace banner', () => {
    renderMenu();

    expect(screen.getByRole('button', { name: 'Files menu' })).toHaveTextContent('Files');
    expect(screen.queryByText('My Models')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open workspace folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load House.csv' })).toHaveClass('active');
    expect(screen.getByText('12 elements')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/Users/');
    expect(document.body.textContent).not.toContain('FileSystemDirectoryHandle');
  });

  it('targets the clicked opaque document for open, duplicate and confirmed delete', () => {
    const onOpenDocument = vi.fn();
    const onDuplicateDocument = vi.fn();
    const onDeleteDocument = vi.fn();
    renderMenu({ onOpenDocument, onDuplicateDocument, onDeleteDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Load Flat.csv' }));
    expect(onOpenDocument).toHaveBeenCalledWith(documents[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Flat.csv' }));
    expect(onDuplicateDocument).toHaveBeenCalledWith(documents[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Flat.csv' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Flat.csv?' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onDeleteDocument).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDeleteDocument).toHaveBeenCalledWith(documents[1]);
    expect(onDeleteDocument).not.toHaveBeenCalledWith(documents[0]);
  });

  it('searches case-insensitively and distinguishes a filtered empty result', () => {
    renderMenu();
    const search = screen.getByRole('textbox', { name: 'Search models' });

    fireEvent.change(search, { target: { value: '  FLAT  ' } });
    expect(screen.getByRole('button', { name: 'Load Flat.csv' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load House.csv' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No matching files.')).toBeInTheDocument();
  });

  it('resets search and the project submenu when the trigger closes Files', () => {
    renderMenu();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'flat' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    expect(screen.getByRole('menu', { name: 'Project filter and actions' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));

    expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Filter base models by project' }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu', { name: 'Project filter and actions' }))
      .not.toBeInTheDocument();
  });

  it('renders only supplied capabilities and keeps Community actions in the same menu', () => {
    const onChooseWorkspace = vi.fn();
    const onImportCsv = vi.fn();
    const onOpenPortable = vi.fn();
    renderMenu({
      workspace: Object.freeze({
        status: 'disconnected',
        canChoose: true,
      }),
      documents: Object.freeze([]),
      projects: Object.freeze([]),
      activeDocumentId: null,
      onChooseWorkspace,
      onRefresh: undefined,
      onImportCsv,
      onOpenPortable,
      onDuplicateDocument: undefined,
      onDeleteDocument: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(onChooseWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Vulcan document' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Batch/i)).not.toBeInTheDocument();
  });

  it('preserves current unsaved-row safeguards and project membership rules', () => {
    const unsaved = Object.freeze({
      id: 'opaque-unsaved-id',
      fileName: 'Pending.csv',
      modifiedAt: null,
      storageVersion: 'pending:v0',
      projectGroupIds: Object.freeze([]),
      isSaved: false,
    });
    const onSetDocumentMembership = vi.fn();
    renderMenu({
      documents: Object.freeze([...documents, unsaved]),
      activeDocumentId: unsaved.id,
      onSetDocumentMembership,
    });

    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplicate Pending.csv' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Pending.csv' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    const add = screen.getByRole('button', {
      name: 'Save current model before adding it to Retrofit',
    });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onSetDocumentMembership).not.toHaveBeenCalled();
  });

  it('preserves the historic single-field keyboard project creation layout', () => {
    const onCreateProject = vi.fn();
    renderMenu({ onCreateProject });

    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    const name = screen.getByRole('textbox', { name: 'New project name' });
    fireEvent.change(name, { target: { value: 'Keyboard project' } });
    fireEvent.keyDown(name, { key: 'Enter' });

    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onCreateProject).toHaveBeenCalledWith({
      name: 'Keyboard project',
      description: '',
    });
    expect(screen.queryByRole('menu', { name: 'Project filter and actions' }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    expect(screen.getByRole('textbox', { name: 'New project name' })).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: 'New project description' })).not.toBeInTheDocument();
  });

  it('disables every mutating control while a Files operation is busy', () => {
    const callbacks = {
      onChangeWorkspace: vi.fn(),
      onDisconnectWorkspace: vi.fn(),
      onRefresh: vi.fn(),
      onOpenDocument: vi.fn(),
      onDuplicateDocument: vi.fn(),
      onDeleteDocument: vi.fn(),
      onSetDocumentMembership: vi.fn(),
      onCreateProject: vi.fn(),
      onRenameProject: vi.fn(),
      onDeleteProject: vi.fn(),
      onNewDocument: vi.fn(),
      onImportCsv: vi.fn(),
      onOpenPortable: vi.fn(),
      onDownloadCsv: vi.fn(),
      onDownloadPortable: vi.fn(),
      onImportCad: vi.fn(),
    };
    const busyProps = {
      ...defaultProps,
      ...callbacks,
      isBusy: true,
    } satisfies GeometryFilesMenuProps;
    const { rerender } = render(<GeometryFilesMenu {...busyProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));

    expect(screen.getByRole('button', { name: 'Change folder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Load House.csv' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Duplicate House.csv' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete House.csv' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New Model' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open Vulcan document' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Import from CAD file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download CSV' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download .vulcan' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    expect(screen.getByRole('button', { name: 'Remove current file from Retrofit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rename Retrofit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Retrofit' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'New project name' }), {
      target: { value: 'Busy project' },
    });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();

    rerender(
      <GeometryFilesMenu
        {...busyProps}
        workspace={Object.freeze({ status: 'disconnected', canChoose: true })}
        onChooseWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeDisabled();

    rerender(
      <GeometryFilesMenu
        {...busyProps}
        workspace={Object.freeze({
          status: 'permission-required',
          canChoose: true,
          directoryName: 'My Models',
        })}
        onReconnectWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
  });

  it('blocks confirmations that were opened before a busy transition', () => {
    const onDeleteDocument = vi.fn();
    const onDeleteProject = vi.fn();
    const readyProps = {
      ...defaultProps,
      onDeleteDocument,
      onDeleteProject,
    } satisfies GeometryFilesMenuProps;
    const { rerender } = render(<GeometryFilesMenu {...readyProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Flat.csv' }));
    rerender(<GeometryFilesMenu {...readyProps} isBusy />);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Flat.csv?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(onDeleteDocument).not.toHaveBeenCalled();

    rerender(<GeometryFilesMenu {...readyProps} />);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Flat.csv?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(onDeleteDocument).toHaveBeenCalledWith(documents[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Files menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Filter base models by project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Retrofit' }));
    rerender(<GeometryFilesMenu {...readyProps} isBusy />);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Retrofit?' })).getByRole('button', {
        name: 'Delete project',
      }),
    );
    expect(onDeleteProject).not.toHaveBeenCalled();

    rerender(<GeometryFilesMenu {...readyProps} />);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Retrofit?' })).getByRole('button', {
        name: 'Delete project',
      }),
    );
    expect(onDeleteProject).toHaveBeenCalledWith(defaultProps.projects[0]);
  });
});
