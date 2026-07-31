// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export {
  defineFilenameActionContributions,
  resolveFilenameActionContributions,
  type FilenameActionContribution,
  type FilenameActionContributions,
} from './filenameActionRegistry';

export {
  defineGeometryEditorContributions,
  pruneUnavailableCanvasPanelPositions,
  readCanvasPanelPosition,
  resetCanvasPanelPosition,
  resolveCanvasPanelContributions,
  setCanvasPanelPosition,
  type CanvasPanelContribution,
  type CanvasPanelPosition,
  type CanvasPanelPositions,
  type CanvasPanelToggle,
  type GeometryEditorContributions,
} from './canvasPanelRegistry';

export {
  projectCanvasPanelComposition,
  resolveCanvasPanelComposition,
  runCanvasPanelCompositionHarness,
  type CanvasPanelComposition,
  type CanvasPanelCompositionHarnessResult,
  type CanvasPanelToggleModel,
} from './canvasPanelComposition';

export {
  unavailableGeometryProjectContextPort,
  type GeometryProjectContextPort,
  type GeometryProjectContextProject,
  type GeometryProjectContextSnapshot,
  type GeometryProjectKind,
} from './projectContextPort';

export {
  defineGeometryInspectorContributions,
  emptyGeometryInspectorContributions,
  GeometryInspectorEvidenceContext,
  unavailableGeometryInspectorEvidenceBridge,
  type GeometryConstructionDetailCandidate,
  type GeometryConstructionDetailsContribution,
  type GeometryDetailedJunctionSolverContribution,
  type GeometryDetailedJunctionSolverProps,
  type GeometryInspectorContributions,
  type GeometryInspectorEvidenceBridge,
  type GeometryInspectorEvidenceContribution,
  type GeometryInspectorEvidenceProviderProps,
  type GeometryInspectorEvidenceSectionContext,
  type GeometryInspectorSelection,
  type GeometryProductCatalogueAdvancedHotWaterContext,
  type GeometryProductCatalogueContribution,
  type GeometryProductCatalogueSystemContext,
} from './inspectorContributions';

export {
  unavailableGeometryWorkspaceResourcePort,
  type GeometryWorkspaceResourceEntry,
  type GeometryWorkspaceResourceListOptions,
  type GeometryWorkspaceResourcePort,
} from './workspaceResourcePort';

export {
  unavailableGeometryCanvasEvidenceContribution,
  type GeometryCanvasEvidenceContribution,
  type GeometryCanvasEvidenceState,
  type GeometryCanvasOverlayEvidenceRequest,
} from './canvasEvidenceContribution';

export {
  unavailableGeometrySchemaPort,
  type GeometrySchemaMode,
  type GeometrySchemaNode,
  type GeometrySchemaParameterInfo,
  type GeometrySchemaPort,
} from './schemaPort';

export {
  unavailableGeometryModelSchemaProfilePort,
  type GeometryModelSchemaProfileElement,
  type GeometryModelSchemaProfilePort,
} from './modelSchemaProfilePort';

export {
  GeometryEditorServicePortsProvider,
  useGeometrySchemaPort,
  useGeometrySourceComparisonPort,
  useGeometryWorkspaceResourcePort,
  type GeometryEditorServicePortsProviderProps,
} from './editorServicePorts';

export {
  unavailableGeometrySourceComparisonPort,
  type GeometrySourceComparisonAssignment,
  type GeometrySourceComparisonElementInfo,
  type GeometrySourceComparisonGlobalInfo,
  type GeometrySourceComparisonInfoItem,
  type GeometrySourceComparisonMissingItem,
  type GeometrySourceComparisonPort,
  type GeometrySourceComparisonSnapshot,
  type GeometrySourceComparisonZoneInfo,
} from './sourceComparisonPort';
