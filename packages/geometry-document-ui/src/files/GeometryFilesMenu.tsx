// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from './reactDomPortal';
import { GeometryFilesConfirmDialog } from './GeometryFilesDialog';
import { GeometryFilesDirtyDialog } from './GeometryFilesDirtyDialog';
import type {
  GeometryFilesMenuDocument,
  GeometryFilesMenuProject,
  GeometryFilesMenuProps,
} from './geometryFilesMenuContracts';
import './GeometryFilesMenu.css';

function filterMatchesProject(
  document: GeometryFilesMenuDocument,
  filter: GeometryFilesMenuProps['filter'],
): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'unassigned') return document.projectGroupIds.length === 0;
  return document.projectGroupIds.includes(filter.projectGroupId);
}

export function GeometryFilesMenu({
  workspace,
  documents,
  projects,
  activeDocumentId,
  projectMembershipDocument,
  search,
  filter,
  isLoading,
  isBusy,
  error,
  notice = null,
  activeConflict = null,
  dirtyDialog = null,
  projectPanel,
  projectFilterTitle = 'Filter local models by project.',
  filteredEmptyHint = 'Try All models or change project membership.',
  onChooseWorkspace,
  onReconnectWorkspace,
  onChangeWorkspace,
  onDisconnectWorkspace,
  onRefresh,
  onSearchChange,
  onFilterChange,
  onOpenDocument,
  onDuplicateDocument,
  onDeleteDocument,
  documentDeleteConfirmation = 'shared',
  onSetDocumentMembership,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  projectDeleteConfirmation = 'shared',
  onNewDocument,
  onImportCsv,
  onOpenPortable,
  onDownloadCsv,
  onDownloadPortable,
  onImportCad,
  projectPresentation,
}: GeometryFilesMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  const [pendingDeleteDocument, setPendingDeleteDocument] =
    useState<GeometryFilesMenuDocument | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] =
    useState<GeometryFilesMenuProject | null>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const portableInputRef = useRef<HTMLInputElement>(null);

  const closeMenuWithoutFocus = useCallback(() => {
    setIsOpen(false);
    setIsProjectMenuOpen(false);
    if (search === undefined) setSearchQuery('');
    else onSearchChange?.('');
    setEditingProjectId(null);
  }, [onSearchChange, search]);

  const closeMenu = useCallback((restoreFocus = false) => {
    closeMenuWithoutFocus();
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, [closeMenuWithoutFocus]);

  const projectPresentationContext = useMemo(
    () => Object.freeze({
      isBusy,
      closeMenu: closeMenuWithoutFocus,
    }),
    [closeMenuWithoutFocus, isBusy],
  );

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: rect.left, top: rect.bottom + 8 });
    setIsPositioned(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const positionFrame = requestAnimationFrame(updatePosition);
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(positionFrame);
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenu, isOpen]);

  useEffect(() => {
    if (!isProjectMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        projectButtonRef.current?.contains(target) ||
        projectMenuRef.current?.contains(target)
      ) {
        return;
      }
      setIsProjectMenuOpen(false);
      setEditingProjectId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isProjectMenuOpen]);

  const selectedProject = useMemo(
    () =>
      filter.kind === 'project'
        ? projects.find((project) => project.id === filter.projectGroupId) ?? null
        : null,
    [filter, projects],
  );
  const currentSearch = search ?? searchQuery;
  const normalizedSearch = currentSearch.trim().toLocaleLowerCase();
  const filteredByProject = useMemo(
    () => documents.filter((document) => filterMatchesProject(document, filter)),
    [documents, filter],
  );
  const visibleDocuments = useMemo(
    () =>
      normalizedSearch.length === 0
        ? filteredByProject
        : filteredByProject.filter((document) =>
            document.fileName.toLocaleLowerCase().includes(normalizedSearch),
          ),
    [filteredByProject, normalizedSearch],
  );
  const catalogueActiveDocument = useMemo(
    () => documents.find((document) => document.id === activeDocumentId) ?? null,
    [activeDocumentId, documents],
  );
  const activeDocument = projectMembershipDocument === undefined
    ? catalogueActiveDocument
    : projectMembershipDocument;
  const savedDocumentCount = useMemo(
    () => documents.filter((document) => document.isSaved !== false).length,
    [documents],
  );

  const projectDocumentCount = useCallback(
    (projectId: string) =>
      documents.filter((document) =>
        document.isSaved !== false && document.projectGroupIds.includes(projectId)).length,
    [documents],
  );

  const selectFilter = useCallback(
    (nextFilter: GeometryFilesMenuProps['filter']) => {
      onFilterChange?.(nextFilter);
      setIsProjectMenuOpen(false);
      setEditingProjectId(null);
    },
    [onFilterChange],
  );

  const commitProjectRename = useCallback(
    (project: GeometryFilesMenuProject) => {
      const name = editingProjectName.trim();
      if (!isBusy && name.length > 0 && name !== project.name) {
        onRenameProject?.(project, { name, description: project.description });
      }
      setEditingProjectId(null);
      setEditingProjectName('');
    },
    [editingProjectName, isBusy, onRenameProject],
  );

  const commitProjectCreate = useCallback(() => {
    const name = newProjectName.trim();
    if (isBusy || !onCreateProject || name.length === 0) return;
    onCreateProject({ name, description: '' });
    setNewProjectName('');
    setIsProjectMenuOpen(false);
  }, [isBusy, newProjectName, onCreateProject]);

  const workspaceCapability = useMemo(() => {
    if (workspace.status === 'permission-required' && onReconnectWorkspace) {
      return Object.freeze({
        label: 'Reconnect',
        title: 'Reconnect',
        action: onReconnectWorkspace,
      });
    }
    if (
      (workspace.status === 'disconnected' || workspace.status === 'restoring') &&
      workspace.canChoose &&
      onChooseWorkspace
    ) {
      return Object.freeze({
        label: 'Choose folder',
        title: 'Choose folder',
        action: onChooseWorkspace,
      });
    }
    if (workspace.status === 'connected' && onChangeWorkspace) {
      return Object.freeze({
        label: 'Change folder',
        title: `Change folder (${workspace.directoryName})`,
        action: onChangeWorkspace,
      });
    }
    if (workspace.status === 'connected' && onDisconnectWorkspace) {
      return Object.freeze({
        label: 'Disconnect',
        title: `Disconnect from ${workspace.directoryName}`,
        action: onDisconnectWorkspace,
      });
    }
    return Object.freeze({
      label: 'Open workspace folder',
      title: 'Open workspace folder',
      action: undefined,
    });
  }, [onChangeWorkspace, onChooseWorkspace, onDisconnectWorkspace, onReconnectWorkspace, workspace]);
  const resolvedProjectPanel = projectPanel ?? (
    projects.length > 0 || onCreateProject
      ? Object.freeze({ status: 'ready' as const })
      : Object.freeze({ status: 'hidden' as const })
  );

  const menu = isOpen ? (
    <div
      ref={menuRef}
      className={`geometry-files-menu files-dropdown ${isProjectMenuOpen ? 'files-dropdown--project-menu-open' : ''}`}
      style={{
        position: 'fixed',
        left: isPositioned ? position.left : -9999,
        top: isPositioned ? position.top : -9999,
        zIndex: 1000,
        opacity: isPositioned ? 1 : 0,
        pointerEvents: isPositioned ? 'auto' : 'none',
        transition: 'opacity 0.1s',
      }}
      aria-busy={isBusy}
    >
      <div className="files-dropdown-header">
        <input
          ref={searchRef}
          type="text"
          className="files-dropdown-search"
          aria-label="Search models"
          placeholder={`Search ${filteredByProject.length} models`}
          value={currentSearch}
          onChange={(event) => {
            if (search === undefined) setSearchQuery(event.target.value);
            else onSearchChange?.(event.target.value);
          }}
        />
        <div className="files-dropdown-header-actions">
          <button
            type="button"
            className="files-dropdown-action-btn"
            aria-label={workspaceCapability.label}
            title={workspaceCapability.title}
            disabled={Boolean(workspaceCapability.action) && isBusy}
            onClick={() => workspaceCapability.action?.()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" />
              <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          {workspace.status === 'connected' && onChangeWorkspace && onDisconnectWorkspace ? (
            <button
              type="button"
              className="files-dropdown-action-btn"
              aria-label="Disconnect"
              title={`Disconnect from ${workspace.directoryName}`}
              disabled={isBusy}
              onClick={onDisconnectWorkspace}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="2" />
                <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              className="files-dropdown-refresh"
              aria-label="Refresh files"
              title="Refresh files"
              onClick={onRefresh}
              disabled={isBusy}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <polyline points="23,4 23,10 17,10" stroke="currentColor" strokeWidth="2" />
                <polyline points="1,20 1,14 7,14" stroke="currentColor" strokeWidth="2" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {resolvedProjectPanel.status !== 'hidden' ? (
        <div className="files-dropdown-project-panel">
          {resolvedProjectPanel.status === 'loading' ? (
            <p className="files-dropdown-project-panel--status" role="status">
              Loading project list…
            </p>
          ) : null}
          {resolvedProjectPanel.status === 'error' ? (
            <div className="files-dropdown-project-panel--error" role="alert">
              <span>{resolvedProjectPanel.message}</span>
              {resolvedProjectPanel.onRetry ? (
                <button
                  type="button"
                  className="files-dropdown-project-panel--retry"
                  disabled={isBusy}
                  onClick={resolvedProjectPanel.onRetry}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {resolvedProjectPanel.status === 'workspace-required' ? (
            <p className="files-dropdown-project-panel--status">
              {resolvedProjectPanel.message}
            </p>
          ) : null}
          {resolvedProjectPanel.status === 'ready' ? <div className="fproj-toolbar">
            <div className="fproj-selector">
              <button
                ref={projectButtonRef}
                type="button"
                className="fproj-scope"
                title={projectFilterTitle}
                aria-label="Filter base models by project"
                aria-haspopup="menu"
                aria-expanded={isProjectMenuOpen}
                onClick={() => setIsProjectMenuOpen((open) => !open)}
              >
                <span className="fproj-scope-label">
                  {filter.kind === 'all'
                    ? 'All models'
                    : filter.kind === 'unassigned'
                      ? 'Unassigned'
                      : selectedProject?.name ?? 'All models'}
                </span>
                <span aria-hidden>⌄</span>
              </button>
              {isProjectMenuOpen ? (
                <div
                  ref={projectMenuRef}
                  className="fproj-menu"
                  role="menu"
                  aria-label="Project filter and actions"
                >
                  <button
                    type="button"
                    className={`fproj-menu-item ${filter.kind === 'all' ? 'fproj-menu-item--selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={filter.kind === 'all'}
                    onClick={() => selectFilter({ kind: 'all' })}
                  >
                    <span>All models</span>
                    <span className="fproj-menu-meta">{savedDocumentCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`fproj-menu-item ${filter.kind === 'unassigned' ? 'fproj-menu-item--selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={filter.kind === 'unassigned'}
                    onClick={() => selectFilter({ kind: 'unassigned' })}
                  >
                    <span>Unassigned</span>
                    <span className="fproj-menu-meta">
                      {documents.filter((document) =>
                        document.isSaved !== false && document.projectGroupIds.length === 0).length}
                    </span>
                  </button>
                  {projects.length > 0 ? <div className="fproj-menu-divider" /> : null}
                  {projects.map((project) => {
                    const selected = filter.kind === 'project' && filter.projectGroupId === project.id;
                    const editing = editingProjectId === project.id;
                    const member = activeDocument?.projectGroupIds.includes(project.id) ?? false;
                    const canChangeMembership = Boolean(
                      activeDocument && (member || activeDocument.isSaved !== false),
                    );
                    return (
                      <div
                        key={project.id}
                        className={`fproj-menu-project ${selected ? 'fproj-menu-project--selected' : ''}`}
                      >
                        {editing ? (
                          <input
                            className="fproj-menu-rename-input"
                            value={editingProjectName}
                            aria-label={`Rename ${project.name}`}
                            autoFocus
                            onChange={(event) => setEditingProjectName(event.target.value)}
                            onBlur={() => commitProjectRename(project)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitProjectRename(project);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setEditingProjectId(null);
                                setEditingProjectName('');
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="fproj-menu-project-select"
                            role="menuitemradio"
                            aria-checked={selected}
                            onClick={() => selectFilter({ kind: 'project', projectGroupId: project.id })}
                          >
                            <span className="fproj-menu-project-title"><span>{project.name}</span></span>
                            <span className="fproj-menu-meta">{projectDocumentCount(project.id)}</span>
                          </button>
                        )}
                        {!editing
                          ? projectPresentation?.renderMetadata?.(
                              project,
                              projectPresentationContext,
                            )
                          : null}
                        {activeDocument && onSetDocumentMembership ? (
                          <button
                            type="button"
                            className={`fproj-menu-membership-button ${member ? 'fproj-menu-membership-button--added' : ''}`}
                            disabled={isBusy || !canChangeMembership}
                            title={member
                              ? 'Remove current file'
                              : canChangeMembership
                                ? 'Add current file'
                                : 'Save this model before adding it to a project'}
                            aria-label={member
                              ? `Remove current file from ${project.name}`
                              : canChangeMembership
                                ? `Add current file to ${project.name}`
                                : `Save current model before adding it to ${project.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isBusy || !canChangeMembership) return;
                              const memberships = member
                                ? activeDocument.projectGroupIds.filter((id) => id !== project.id)
                                : [...activeDocument.projectGroupIds, project.id];
                              onSetDocumentMembership(activeDocument, memberships);
                            }}
                          >
                            {member ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                                <path d="M12 5v14M5 12h14" />
                              </svg>
                            )}
                          </button>
                        ) : null}
                        {!editing ? (
                          <div className="fproj-menu-project-actions">
                            {projectPresentation?.renderActions?.(
                              project,
                              projectPresentationContext,
                            )}
                            {onRenameProject ? (
                              <button
                                type="button"
                                className="fproj-menu-icon-button"
                                title={`Rename ${project.name}`}
                                aria-label={`Rename ${project.name}`}
                                disabled={isBusy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingProjectId(project.id);
                                  setEditingProjectName(project.name);
                                }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                            ) : null}
                            {onDeleteProject ? (
                              <button
                                type="button"
                                className="fproj-menu-icon-button fproj-menu-icon-button--danger"
                                title={`Delete ${project.name}`}
                                aria-label={`Delete ${project.name}`}
                                disabled={isBusy}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (projectDeleteConfirmation === 'host') {
                                    onDeleteProject(project);
                                  } else {
                                    setPendingDeleteProject(project);
                                  }
                                }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {onCreateProject ? (
                    <>
                      <div className="fproj-menu-divider" />
                      <div className="fproj-menu-create">
                        <input
                          value={newProjectName}
                          aria-label="New project name"
                          placeholder="New project name"
                          onChange={(event) => setNewProjectName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            commitProjectCreate();
                          }}
                        />
                        {projectPresentation?.renderCreateFields?.(
                          projectPresentationContext,
                        )}
                        <button
                          type="button"
                          disabled={isBusy || newProjectName.trim().length === 0}
                          onClick={commitProjectCreate}
                        >
                          Create
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="fproj-toolbar-actions">
              {selectedProject
                ? projectPresentation?.renderSelectedActions?.(
                    selectedProject,
                    projectPresentationContext,
                  )
                : null}
            </div>
          </div> : null}
        </div>
      ) : null}

      {activeConflict ? <div className="files-dropdown-error" role="alert">{activeConflict}</div> : null}
      {notice ? <div className="files-dropdown-notice" role="status">{notice}</div> : null}

      <div className="files-dropdown-divider" />
      <div className="files-dropdown-content">
        {error ? (
          <div className="files-dropdown-error" role="alert">
            <p>Error: {error}</p>
            {onRefresh ? (
              <button
                type="button"
                className="files-dropdown-retry"
                disabled={isBusy}
                onClick={onRefresh}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {isLoading ? (
          <div className="files-dropdown-loading" role="status">
            <p>Loading saved files...</p>
          </div>
        ) : filteredByProject.length === 0 && documents.length === 0 ? (
          <div className="files-dropdown-empty">
            <p>No saved models found.</p>
            <p>Save your current model to see it here.</p>
          </div>
        ) : filteredByProject.length === 0 ? (
          <div className="files-dropdown-empty">
            <p>No models match the current file list filter.</p>
            <p>{filteredEmptyHint}</p>
          </div>
        ) : visibleDocuments.length === 0 ? (
          <div className="files-dropdown-empty">
            <p>No matching files.</p>
            <p>Try a different search term.</p>
          </div>
        ) : (
          <div className="files-dropdown-list">
            {visibleDocuments.map((document) => {
              const isActive = document.id === activeDocumentId;
              const isSaved = document.isSaved !== false;
              const canOpen = isSaved || isActive;
              const projectNames = projects
                .filter((project) => document.projectGroupIds.includes(project.id))
                .map((project) => project.name);
              return (
                <div
                  key={document.id}
                  className={`files-dropdown-item-container ${isActive ? 'files-dropdown-item-container--active' : ''} ${isSaved ? '' : 'files-dropdown-item-container--pending'}`}
                >
                  <button
                    type="button"
                    className={`files-dropdown-item ${isActive ? 'active' : ''} ${isSaved ? '' : 'files-dropdown-item--pending'}`}
                    disabled={isBusy || !canOpen}
                    aria-label={isSaved
                      ? `Load ${document.fileName}`
                      : `${document.fileName} is in this project but has not been saved yet`}
                    title={isSaved
                      ? `Load ${document.fileName}`
                      : 'This model is in the project, but there is no saved CSV to load yet.'}
                    onClick={() => {
                      if (isBusy || !canOpen) return;
                      onOpenDocument(document);
                      closeMenu();
                    }}
                  >
                    <div className="files-dropdown-item-main">
                      <div className="files-dropdown-item-summary-row">
                        <div className="files-dropdown-item-name">{document.fileName}</div>
                        {isSaved && document.summary ? (
                          <div className="files-dropdown-item-stats">
                            {document.summary.elements} {document.summary.elements === 1 ? 'element' : 'elements'}
                          </div>
                        ) : null}
                      </div>
                      {filter.kind === 'all' && projectNames.length > 0 ? (
                        <div className="files-dropdown-item-projects">{projectNames.join(' · ')}</div>
                      ) : null}
                    </div>
                    <div className="files-dropdown-item-right">
                      {!isSaved ? <span className="files-dropdown-unsaved-chip">Unsaved</span> : null}
                      {isActive ? (
                        <div className="files-dropdown-item-current" aria-hidden>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" />
                          </svg>
                        </div>
                      ) : null}
                    </div>
                  </button>
                  {isSaved ? (
                    <div className="files-dropdown-item-actions">
                    {onDuplicateDocument ? (
                      <button
                        type="button"
                        className="files-dropdown-action-btn"
                        aria-label={`Duplicate ${document.fileName}`}
                        title={`Duplicate ${document.fileName}`}
                        disabled={isBusy}
                        onClick={() => {
                          const outcome = onDuplicateDocument(document);
                          if (outcome instanceof Promise) {
                            void outcome.then((result) => {
                              if (result !== 'keep-menu-open') closeMenu();
                            });
                          } else if (outcome !== 'keep-menu-open') {
                            closeMenu();
                          }
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                          <path d="M15 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>
                    ) : null}
                    {onDeleteDocument ? (
                      <button
                        type="button"
                        className="files-dropdown-action-btn files-dropdown-delete-btn"
                        aria-label={`Delete ${document.fileName}`}
                        title={`Delete ${document.fileName}`}
                        disabled={isBusy}
                        onClick={() => {
                          if (isBusy) return;
                          if (documentDeleteConfirmation === 'host') {
                            onDeleteDocument(document);
                          } else {
                            setPendingDeleteDocument(document);
                          }
                          closeMenu();
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M3 6h18" stroke="currentColor" strokeWidth="2" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>
                    ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {onNewDocument || onImportCsv || onOpenPortable || onDownloadCsv ||
      onDownloadPortable || onImportCad ? (
        <>
          <div className="files-dropdown-divider" />
          <div className="files-dropdown-footer">
            {onNewDocument ? (
              <button
                type="button"
                className="files-dropdown-new-btn files-dropdown-new-btn--primary"
                disabled={isBusy}
                onClick={() => {
                  if (isBusy) return;
                  onNewDocument();
                  closeMenu();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" />
                </svg>
                New Model
              </button>
            ) : null}
            {onImportCsv ? (
              <>
                <input
                  ref={csvInputRef}
                  hidden
                  type="file"
                  aria-label="Choose CSV file to import"
                  accept=".csv,text/csv"
                  disabled={isBusy}
                  onChange={(event) => {
                    if (!isBusy && event.currentTarget.files) onImportCsv(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  className="files-dropdown-new-btn"
                  disabled={isBusy}
                  onClick={() => csvInputRef.current?.click()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" />
                    <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="2" />
                    <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  Import CSV
                </button>
              </>
            ) : null}
            {onOpenPortable ? (
              <>
                <input
                  ref={portableInputRef}
                  hidden
                  type="file"
                  aria-label="Choose Vulcan document to open"
                  accept=".vulcan,application/vnd.vulcan.document+zip"
                  disabled={isBusy}
                  onChange={(event) => {
                    if (!isBusy && event.currentTarget.files) onOpenPortable(event.currentTarget.files);
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  className="files-dropdown-new-btn"
                  aria-label="Open Vulcan document"
                  disabled={isBusy}
                  onClick={() => portableInputRef.current?.click()}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" />
                    <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" />
                  </svg>
                  Open .vulcan
                </button>
              </>
            ) : null}
            {onDownloadCsv ? (
              <button type="button" className="files-dropdown-new-btn" onClick={onDownloadCsv}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" />
                  <polyline points="7,10 12,15 17,10" stroke="currentColor" strokeWidth="2" />
                  <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" />
                </svg>
                Download CSV
              </button>
            ) : null}
            {onDownloadPortable ? (
              <button type="button" className="files-dropdown-new-btn" onClick={onDownloadPortable}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" />
                  <polyline points="7,10 12,15 17,10" stroke="currentColor" strokeWidth="2" />
                  <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" />
                </svg>
                Download .vulcan
              </button>
            ) : null}
            {onImportCad ? (
              <button
                type="button"
                className="files-dropdown-new-btn"
                disabled={isBusy}
                onClick={() => {
                  if (isBusy) return;
                  onImportCad();
                  closeMenu();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" />
                  <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2" />
                  <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" />
                </svg>
                Import from CAD file
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="geometry-files-menu-root files-dropdown-container">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-nav filename-bar-action files-button"
        aria-label="Files menu"
        title="Files menu"
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) closeMenu();
          else {
            setIsPositioned(false);
            setIsOpen(true);
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" />
          <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" />
          <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" />
          <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" />
          <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span>Files</span>
      </button>
      {typeof document === 'undefined' || !menu ? null : createPortal(menu, document.body)}
      {pendingDeleteDocument ? (
        <GeometryFilesConfirmDialog
          title={`Delete ${pendingDeleteDocument.fileName}?`}
          message="The model will be removed from this workspace. This action cannot be undone."
          confirmLabel="Delete"
          onCancel={() => {
            setPendingDeleteDocument(null);
            triggerRef.current?.focus();
          }}
          onConfirm={() => {
            if (isBusy) return;
            const target = pendingDeleteDocument;
            setPendingDeleteDocument(null);
            onDeleteDocument?.(target);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
      {pendingDeleteProject ? (
        <GeometryFilesConfirmDialog
          title={`Delete ${pendingDeleteProject.name}?`}
          message="The project grouping will be removed. Its models will not be deleted."
          confirmLabel="Delete project"
          onCancel={() => setPendingDeleteProject(null)}
          onConfirm={() => {
            if (isBusy) return;
            const target = pendingDeleteProject;
            setPendingDeleteProject(null);
            onDeleteProject?.(target);
          }}
        />
      ) : null}
      {dirtyDialog ? <GeometryFilesDirtyDialog {...dirtyDialog} /> : null}
    </div>
  );
}
