// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import type {
  GeometryDocumentCatalogueEntry,
  GeometryDocumentCatalogueFilter,
  GeometryProjectGroupCatalogueEntry,
} from '../../../geometry-document/src/providerContracts';

export type GeometryFilesMenuDocumentSummary = Readonly<{
  elements: number;
  zones?: number;
  spaces?: number;
}>;

export type GeometryFilesMenuDocument = GeometryDocumentCatalogueEntry &
  Readonly<{
    summary?: GeometryFilesMenuDocumentSummary;
    /** A host may show a not-yet-persisted catalogue placeholder. */
    isSaved?: boolean;
  }>;

export type GeometryFilesMenuProject = GeometryProjectGroupCatalogueEntry;

export type GeometryFilesMenuProjectPresentationContext = Readonly<{
  isBusy: boolean;
  closeMenu: () => void;
}>;

export type GeometryFilesMenuWorkspace =
  | Readonly<{ status: 'disconnected'; canChoose: boolean }>
  | Readonly<{
      status: 'restoring';
      canChoose: boolean;
      directoryName?: string;
    }>
  | Readonly<{
      status: 'permission-required';
      canChoose: boolean;
      directoryName: string;
    }>
  | Readonly<{
      status: 'connected';
      canChoose: boolean;
      directoryName: string;
    }>;

export type GeometryFilesMenuProjectPresentation = Readonly<{
  renderCreateFields?: (
    context: GeometryFilesMenuProjectPresentationContext,
  ) => ReactNode;
  renderMetadata?: (
    project: GeometryFilesMenuProject,
    context: GeometryFilesMenuProjectPresentationContext,
  ) => ReactNode;
  renderActions?: (
    project: GeometryFilesMenuProject,
    context: GeometryFilesMenuProjectPresentationContext,
  ) => ReactNode;
  renderSelectedActions?: (
    project: GeometryFilesMenuProject,
    context: GeometryFilesMenuProjectPresentationContext,
  ) => ReactNode;
}>;

export type GeometryFilesMenuDirtyDialog = Readonly<{
  title: string;
  message: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}>;

export type GeometryFilesMenuActionOutcome = 'close-menu' | 'keep-menu-open';

export type GeometryFilesMenuProjectPanelState =
  | Readonly<{ status: 'hidden' }>
  | Readonly<{ status: 'workspace-required'; message: string }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      status: 'error';
      message: string;
      onRetry?: () => void;
    }>
  | Readonly<{ status: 'ready' }>;

export type GeometryFilesMenuProps = Readonly<{
  workspace: GeometryFilesMenuWorkspace;
  documents: readonly GeometryFilesMenuDocument[];
  projects: readonly GeometryFilesMenuProject[];
  activeDocumentId: string | null;
  /** Active model context for project membership when it is not in the visible catalogue. */
  projectMembershipDocument?: GeometryFilesMenuDocument | null;
  search?: string;
  filter: GeometryDocumentCatalogueFilter;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  notice?: string | null;
  activeConflict?: string | null;
  dirtyDialog?: GeometryFilesMenuDirtyDialog | null;
  /** Explicitly preserves the established project-panel loading/error states. */
  projectPanel?: GeometryFilesMenuProjectPanelState;
  projectFilterTitle?: string;
  filteredEmptyHint?: string;

  onChooseWorkspace?: () => void;
  onReconnectWorkspace?: () => void;
  onChangeWorkspace?: () => void;
  onDisconnectWorkspace?: () => void;
  onRefresh?: () => void;
  onSearchChange?: (search: string) => void;
  onFilterChange?: (filter: GeometryDocumentCatalogueFilter) => void;

  onOpenDocument: (document: GeometryFilesMenuDocument) => void;
  onDuplicateDocument?: (
    document: GeometryFilesMenuDocument,
  ) => void | GeometryFilesMenuActionOutcome | Promise<void | GeometryFilesMenuActionOutcome>;
  onDeleteDocument?: (document: GeometryFilesMenuDocument) => void;
  /**
   * `shared` renders the public confirmation dialog. `host` delegates directly
   * when an existing host lifecycle already owns confirmation.
   */
  documentDeleteConfirmation?: 'shared' | 'host';
  onSetDocumentMembership?: (
    document: GeometryFilesMenuDocument,
    projectGroupIds: readonly string[],
  ) => void;

  onCreateProject?: (input: Readonly<{ name: string; description: string }>) => void;
  onRenameProject?: (
    project: GeometryFilesMenuProject,
    input: Readonly<{ name: string; description: string }>,
  ) => void;
  onDeleteProject?: (project: GeometryFilesMenuProject) => void;
  /** `'host'` lets a host keep its own established confirmation modal. */
  projectDeleteConfirmation?: 'shared' | 'host';

  onNewDocument?: () => void;
  onImportCsv?: (files: ArrayLike<File>) => void;
  onOpenPortable?: (files: ArrayLike<File>) => void;
  onDownloadCsv?: () => void;
  onDownloadPortable?: () => void;
  onImportCad?: () => void;

  projectPresentation?: GeometryFilesMenuProjectPresentation;
}>;
