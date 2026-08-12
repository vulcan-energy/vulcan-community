// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useContext, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import './FilesDropdownPrimitives.css';
import './ElementCreator.css';
import { useShallow } from 'zustand/react/shallow';
import { SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M, ZONE_NAME_SUGGESTIONS, roundToTwoDecimals, roundToFourDecimals } from '../geometry/constants';
import { normalizeHorizontalAdjacentPlanPitch } from '../geometry/adjacentPlanPitch';
import { calculatePolygonArea, isAdjacentConditionedInternalFloorDoubled } from '../lib/polygonSync';
import {
  useGeometryStore,
  useGeometryStoreApi,
  APPLIANCE_KEYS,
  validateZone,
  deriveWallProperties,
  isGlobalObject,
  getAdjacentPartyWallUiToggleLabel,
} from '../stores/geometryStore';
import {
  bindElementFormModule,
  type ElementFormInstance,
  type ElementFormRenderCtx,
} from './elementForms/types';
import { electricBatteryFormModule } from './elementForms/electricBattery';
import { thermalBridgeLinearFormModule } from './elementForms/thermalBridgeLinear';
import { thermalBridgePointFormModule } from './elementForms/thermalBridgePoint';
import { getLightingFieldValue, lightingFormModule } from './elementForms/lighting';
import { ParentElementDropdown } from './ParentElementDropdown';
import { applianceFormModule } from './elementForms/appliance';
import { hotWaterDemandFormModule } from './elementForms/hotWaterDemand';
import { combustionAppliancesFormModule } from './elementForms/combustionAppliances';
import { onSiteGenerationFormModule } from './elementForms/onSiteGeneration';
import { windowShadingFormModule } from './elementForms/windowShading';
import { contextShadingFormModule } from './elementForms/contextShading';
import { ventsFormModule } from './elementForms/vents';
import { mechanicalVentilationFormModule } from './elementForms/mechanicalVentilation';
import { mechanicalVentilationDuctworkFormModule } from './elementForms/mechanicalVentilationDuctwork';
import { mechanicalVentilationTerminalFormModule } from './elementForms/mechanicalVentilationTerminal';
import { waterPipeworkFormModule } from './elementForms/waterPipework';
import { wetEmitterFormModule } from './elementForms/wetEmitter';
import { formatSystemPresetName, systemFormModule } from './elementForms/system';
import { useServiceLineFormState } from './elementForms/serviceLine';
import {
  useDecimalInput,
  decimalInputProps,
  numericDraftValueOrDefault,
  readExtraJsonRecord,
  formatConditionalDecimals,
  HORIZONTAL_POLYGON_PITCH_OPTIONS,
  HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER,
  horizontalPolygonSurfaceSelectValue,
} from './elementForms/formPrimitives';
// Not formPrimitives' useDecimalInput: that wrapper doesn't forward `syncExternal`, and the
// single-element pitch input needs it (see pitchDraftInput below) so the draft re-syncs from
// `pitch` on selection/preset/dormer changes without threading a `.setValue()` call through
// every one of those call sites, mirroring width/height's simpler "no confirm-dialog side
// effects" case.
import { useNumericDraftInput } from './numericDraftInput';
import {
  useGeometrySchemaPort,
  useGeometrySourceComparisonPort,
} from '../../../geometry-editor-host/src/editorServicePorts';
import type { GeometrySourceComparisonPort } from '../../../geometry-editor-host/src/sourceComparisonPort';
import { getElementShape, isTypeShapeCompatible, convertShapeCoordinates } from '../lib/shapeUtils';
import {
  isVulcanUiPartyFloorElement,
  VULCAN_UI_PARTY_ELEMENT_KEY,
} from '../lib/assemblyMaterialFabric';
import { ELEMENT_TYPE_ORDER } from '../lib/elementTypeMetadata';
import { generateUniqueElementName } from '../lib/elementAutoNaming';
import {
  getAreaBasedElementExportGeometry,
  getElementGrossArea,
  getOpaqueOpeningArea,
  isUnheatedPitchedRoofPlanAreaElement,
  getTransparentExportMidHeight,
} from '../lib/elementArea';
import {
  buildSlopedPolygonRectangleDimensionPatch,
  deriveSlopedElementDimensions,
  getPolygonScalarDimensionSemantics,
  slopedPolygonNeedsRectangleRebuild,
} from '../lib/slopedElementDimensions';
import {
  getUnheatedPitchedRoofCeilingElevationM,
  mergeUnheatedPitchedRoofCeilingElevationExtraJson,
  readAuthoredUnheatedPitchedRoofCeilingElevationM,
  UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
  type UnheatedPitchedRoofCeilingElevationSource,
} from '../lib/unheatedPitchedRoofCeiling';
import { buildProfileLineFaceFromTopHeights, extractTopHeightsFromExtraJson } from '../lib/profileLineFace';
import {
  listElementPresetOptions,
} from '../geometry/parameterLibraryCatalog';
import {
  calculateDerivedFloorArea,
  calculateDerivedHeight,
  calculateDerivedBaseHeight,
  calculateDerivedWindowMidHeight,
  calculateBaseHeightPatchForFloorMove,
  withEffectiveStoreyHeights,
} from '../lib/zoneDerivation';
import {
  deriveTransparentOpeningDerivedValues,
} from '../lib/transparentOpeningDerivedFields';
import { elementBaseElevationMForTb } from '../lib/geometry3dMapper';
import {
  computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement,
  computeWeightedExternalWallAssemblyThicknessForGroundElement,
  applyComputedGroundUValueAutofill,
  groundExposedPerimeterManualFlag,
  syncGroundExposedPerimetersFromWalls,
  syncSuspendedGroundFabricFromWalls,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
  GROUND_U_VALUE_MANUAL_KEY,
  THICKNESS_WALLS_MANUAL_KEY,
  THERMAL_TRANSM_WALLS_MANUAL_KEY,
} from '../lib/groundSuspendedFabricSync';
import {
  computeGroundUValueFromElementModel,
  defaultSuspendedAreaPerPerimeterVent,
  parseWindShieldLocation,
} from '../lib/groundUValueCalculator';
import { computeGroundExposedPerimeterDetails } from '../lib/groundExposedPerimeter';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementPartyWall,
  BuildingElementTransparent,
  OnSiteGeneration,
  SpaceLabel,
  ThermalBridgeLinear,
  ElementType,
  Element,
  Zone,
} from '../geometry/types';
import {
  thermalBridgeLinearHasPositiveRun,
} from '../lib/thermalBridgeLinearGeometry';
import {
  getServiceLineLengthFromCoordinates,
  isServiceLineElementType,
  normalizeServiceLineCoordinatesForMode,
  serviceLineModeFromShapeValue,
  serviceLineShapeValueForMode,
} from '../lib/serviceLineDrawModes';
import { mergeServiceLineExtraJsonFloorId } from '../lib/elementCanvasFloor';
import {
  getParentControlledFloorZ,
  isElementFloorControlledByParent,
} from '../lib/parentControlledFloor';
import { ProfileHeightsPopover } from './ProfileHeightsPopover';
import { useKeyedState } from '../hooks/useKeyedState';
import {
  applyCompassOrientationToSlopedPolygonCoords,
  orientation360FromSegmentOutwardModelXY,
  orientation360SlopedFromFirstEdge,
} from '../lib/openingSegmentOutward';
import {
  getPvFootprintDimensionsFromPreset,
  readPvFootprintFlags,
  rebuildPvRectangleFromBottomEdge,
  derivePvDimensionsFromCoords,
} from '../lib/pvPanelFootprint';
import { deriveFromHostRoof } from '../lib/pvHostDerivation';
import { findSuspendedGroundSurfaceForLineElement } from '../lib/suspendedFloorGeometry';
import { findLinkedBasementGroundForLineElement } from '../lib/basementGeometry';
import { fhsFloorLabelForCanvasFloor } from '../lib/storeySemantics';
import {
  getParentByName,
  getParentOrientation360,
  buildHostedLinearParentPatch,
} from '../lib/parentOrientation';
import type { MvhrDuctRole, MvhrTerminalRole } from '../lib/mvhrDuctwork';
import { useMvhrDuctTerminalManager } from './MvhrDuctTerminalManager';
import {
  buildDormerBundleDraft,
  computeAutoDormerBundleName,
  getDormerBundleElementIds,
  getDormerBundleInfo,
  getDormerBundleMetadata,
  getDormerBundleName,
  getDormerThermalOverrideExtraJson,
  isDormerAnchorElement,
  isDormerBundleNameManual,
  isValidDormerHost,
  type DormerBundleRole,
  type DormerThermalOverrides,
  type DormerThermalSectionKey,
  type DormerType,
  type DormerBundleParameters,
} from '../lib/dormerGeometry';
import {
  emptyGeometryInspectorContributions,
  GeometryInspectorEvidenceContext,
  unavailableGeometryWorkspaceResourcePort,
  type GeometryInspectorContributions,
  type GeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src';
import {
  type ExternalDetailCataloguePort,
} from '../geometry/thermalBridge/externalDetailContracts';

const ELEMENT_NAME_INPUT_ID = 'geometry-element-name-input';
const GROUND_LINE_HEIGHT_EXTRA_KEY = '_ground_line_height_m';
const CREATE_SPACE_HEAT_SYSTEM_OPTION = '__create_space_heat_system__';
const DEFAULT_WET_DISTRIBUTION_PRESET_ID = 'wet_distribution';

type SpaceHeatSystemEmitterDropdownProps = {
  linkedEmitters: Element[];
  availableEmitters: Element[];
  onToggleEmitter: (emitterId: string, checked: boolean) => void;
  onCreateRadiator: () => void;
};

const SpaceHeatSystemEmitterDropdown: React.FC<SpaceHeatSystemEmitterDropdownProps> = ({
  linkedEmitters,
  availableEmitters,
  onToggleEmitter,
  onCreateRadiator,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0, width: 0, maxHeight: 320 });
  const [isPositioned, setIsPositioned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const linkedIds = useMemo(() => new Set(linkedEmitters.map((emitter) => emitter.id)), [linkedEmitters]);
  const emitterRows = useMemo(() => {
    const seen = new Set<string>();
    return [...linkedEmitters, ...availableEmitters].filter((emitter) => {
      if (seen.has(emitter.id)) return false;
      seen.add(emitter.id);
      return true;
    });
  }, [availableEmitters, linkedEmitters]);

  const triggerText = linkedEmitters.length > 0
    ? `${linkedEmitters.length} emitter${linkedEmitters.length === 1 ? '' : 's'} linked`
    : emitterRows.length > 0 ? 'Select linked emitters' : 'No emitters linked';

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportMargin = 12;
    const menuGap = 4;
    const maxHeight = Math.min(360, Math.max(220, window.innerHeight - rect.bottom - viewportMargin - menuGap));
    setMenuPosition({
      x: Math.max(viewportMargin, Math.min(rect.left, window.innerWidth - rect.width - viewportMargin)),
      y: rect.bottom + menuGap,
      width: rect.width,
      maxHeight,
    });
    setIsPositioned(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(updateMenuPosition, 0);
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const menu = isOpen ? (
    <div
      ref={menuRef}
      className="files-dropdown space-heat-emitter-dropdown"
      style={{
        left: isPositioned ? menuPosition.x : -9999,
        top: isPositioned ? menuPosition.y : -9999,
        width: menuPosition.width,
        minWidth: menuPosition.width,
        maxWidth: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        position: 'fixed',
        zIndex: 10000,
        opacity: isPositioned ? 1 : 0,
        pointerEvents: isPositioned ? 'auto' : 'none',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      <div className="files-dropdown-content space-heat-emitter-dropdown__content">
        {emitterRows.length === 0 ? (
          <div className="files-dropdown-empty space-heat-emitter-dropdown__empty">
            No wet emitters in this zone.
          </div>
        ) : (
          emitterRows.map((emitter) => {
            const checked = linkedIds.has(emitter.id);
            const label = emitter.name?.trim() || 'WetEmitter';
            return (
              <label
                key={emitter.id}
                className={`files-dropdown-item space-heat-emitter-dropdown__row${checked ? ' space-heat-emitter-dropdown__row--checked' : ''}`}
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggleEmitter(emitter.id, event.currentTarget.checked)}
                />
                <span className="space-heat-emitter-dropdown__label">{label}</span>
              </label>
            );
          })
        )}
      </div>
      <div className="space-heat-emitter-dropdown__footer">
        <button
          type="button"
          className="files-dropdown-item space-heat-emitter-dropdown__create"
          onClick={() => {
            onCreateRadiator();
            setIsOpen(false);
          }}
        >
          Create Radiator
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-heat-emitter-dropdown__container">
      <button
        type="button"
        ref={triggerRef}
        className={`standard-dropdown standard-dropdown-md standard-dropdown-ghost space-heat-emitter-dropdown__trigger${isOpen ? ' space-heat-emitter-dropdown__trigger--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          if (!isOpen) setIsPositioned(false);
          setIsOpen(!isOpen);
        }}
      >
        <span className="space-heat-emitter-dropdown__trigger-text">{triggerText}</span>
      </button>
      {typeof document !== 'undefined' && menu ? ReactDOM.createPortal(menu, document.body) : null}
    </div>
  );
};

function hasReliableGroundExposedPerimeter(
  details: ReturnType<typeof computeGroundExposedPerimeterDetails> | null | undefined,
): boolean {
  if (!details) return false;
  if (details.valueM > 0) return true;
  return details.shapePerimeterM > 0 && details.linkedBoundaryPerimeterM >= Math.max(0, details.shapePerimeterM - 0.05);
}
// Utility function for consistent 2 decimal place formatting
const formatToTwoDecimals = (value: number | string | undefined): string => {
  if (value === undefined || value === null || value === '') return '0.00';
  const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const calculateZoneVolume = (
  floorArea: number | string | undefined,
  height: number | string | undefined,
): number | undefined => {
  const parsedFloorArea = typeof floorArea === 'number' ? floorArea : parseFloat(String(floorArea ?? '')) || 0;
  const parsedHeight = typeof height === 'number' ? height : parseFloat(String(height ?? '')) || 0;

  if (!(parsedFloorArea > 0) || !(parsedHeight > 0)) {
    return undefined;
		      }

  return roundToTwoDecimals(parsedFloorArea * parsedHeight);
};

const readPositiveZoneNumber = (value: number | ''): number | null => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};

const INLINE_FIELD_NOTE_STYLE: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  lineHeight: 1.35,
  minWidth: 0,
};
const EDITOR_FIELD_ACTION_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
};
const EDITOR_FIELD_ACTION_FIELD_STYLE: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
};
// MVHR_MANAGER_* styles and LucideSvgIcon moved to MvhrDuctTerminalManager.tsx
// with the manager cluster itself — see that file's header comment.

function assemblyLayerToken(layer: unknown, library: BundledAssemblyLibrary | null): string {
  if (!layer || typeof layer !== 'object') return 'layer';
  const layerRecord = layer as Record<string, unknown>;
  const kind = layerRecord.kind;
  if (kind === 'solid') {
    const materialId = typeof layerRecord.materialId === 'string' ? layerRecord.materialId : '';
    if (!materialId) return 'solid';
    const material = library?.materialsById?.get(materialId);
    return material?.shortName?.trim() || material?.name?.trim() || materialId;
  }
  if (kind === 'cavity') {
    if (layerRecord.ventilation === 'well_ventilated') return 'ventilated cavity';
    const cavityType = typeof layerRecord.cavityType === 'string' ? layerRecord.cavityType : '';
    return cavityType ? cavityType.replace(/_/g, ' ') : 'cavity';
  }
  return 'layer';
}

function assemblyDisplayName(
  envelope: VulcanAssemblyV1Envelope | null | undefined,
  library: BundledAssemblyLibrary | null,
): string {
  const assemblyId = envelope?.assemblyId;
  if (typeof assemblyId !== 'string' || assemblyId.trim() === '') return 'Applied assembly';
  const id = assemblyId.trim();
  if (id !== 'calculator:layered') {
    const fromLibrary = library?.examples?.find((row) => row.id === id)?.name?.trim();
    return fromLibrary || id;
  }
  const layers = Array.isArray(envelope?.assemblySnapshot?.layers) ? envelope.assemblySnapshot.layers : [];
  if (layers.length === 0) return 'Layered assembly';
  const parts = layers.slice(0, 2).map((layer) => assemblyLayerToken(layer, library));
  const summary = parts.join(' + ');
  return layers.length > 2 ? `${summary} + ${layers.length - 2} more` : summary;
}

function assemblyTypeLabelFromMode(mode: unknown): string {
  switch (mode) {
    case 'BuildingElementOpaque':
      return 'Opaque element';
    case 'BuildingElementGround':
      return 'Ground floor';
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
      return 'Adjacent unconditioned';
    case 'BuildingElementAdjacentConditionedSpace':
      return 'Adjacent conditioned';
    case 'BuildingElementPartyWall':
      return 'Party wall';
    default:
      return 'Assembly';
  }
}

const parseLiveDecimalInput = (value: string): number => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function areDormerThermalOverridesEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return !left && !right;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((key, index) => key !== rightKeys[index])) return false;

  return leftKeys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];

    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue)) return false;
      if (leftValue.length !== rightValue.length) return false;
      return leftValue.every((item, index) => {
        const otherItem = rightValue[index];
        if (item && typeof item === 'object' && otherItem && typeof otherItem === 'object') {
          return areDormerThermalOverridesEqual(
            item as Record<string, unknown>,
            otherItem as Record<string, unknown>,
          );
        }
        return item === otherItem;
      });
    }

    if (leftValue && typeof leftValue === 'object' && rightValue && typeof rightValue === 'object') {
      return areDormerThermalOverridesEqual(
        leftValue as Record<string, unknown>,
        rightValue as Record<string, unknown>,
      );
    }

    return leftValue === rightValue;
  });
}


import { FieldValidationIndicator, ValidationIndicator, ValidationPill } from './ValidationIndicator';
import { StandardCard } from './StandardCard';
import { StandardInput } from './StandardInput';
import { ResetFieldButton } from './ResetFieldButton';
import { aggregateSpaceLabelsForZone } from '../lib/spaceLabelDerivation';
import { StandardDropdown } from './StandardDropdown';
import { ElementTypePicker } from './ElementTypePicker';
import { PresetDropdown } from './PresetDropdown';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { LazyInlineFallback, LazyModalFallback } from './LazyModuleFallback';
import type { AssemblyElementMode, VulcanAssemblyV1Envelope } from '../lib/assemblyTypes';
import { parseVulcanAssemblyV1FromExtraJson } from '../lib/assemblyAppliedUi';
import type { BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import { Tooltip } from './Tooltip';
import { createElementCreatorFieldPresentationResolver } from './elementCreatorFieldPresentation';
import { syncSpaceHeatSystemZoneNameInExtraJson } from '../lib/spaceHeatSystemSync';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import {
  buildSpaceHeatSystemPresetExtraJson,
  firstSpaceHeatSystemType,
  firstRecordEntry,
  getSystemElementSourceFromState,
  isWetDistributionSpaceHeatSystem,
  resolveHeatSourceWetReferenceName,
  spaceHeatSystemUsesHeatSourceWet,
  SYSTEM_SOURCE_META_KEY,
  readSelectedSystemElement,
  SYSTEM_SUBCATEGORY_TO_DIR,
  type SystemElementSource,
  updateSpaceHeatSystemHeatSourceNameInExtraJson,
} from './systemEditorUtils';
import { isExternalLineWall } from '../geometry/thermalBridge/proposeExternalCorners';
import { groundFloorTypeSupportsViewerElevation } from '../lib/groundFloorSubtype';

const loadAdvancedFieldsEditor = () => import('./AdvancedFieldsEditor');
const loadAssemblyCalculatorModal = () => import('./AssemblyCalculatorModal');

const prefetchAdvancedFieldsEditor = () => {
  void loadAdvancedFieldsEditor();
};

const prefetchAssemblyCalculatorModal = () => {
  void loadAssemblyCalculatorModal();
};

const intentPrefetchHandlers = (prefetch: () => void) => ({
  onPointerEnter: prefetch,
  onFocus: prefetch,
  onMouseDown: prefetch,
});

const AdvancedFieldsEditor = React.lazy(async () => {
  const module = await loadAdvancedFieldsEditor();
  return { default: module.AdvancedFieldsEditor };
});

const AssemblyCalculatorModal = React.lazy(async () => {
  const module = await loadAssemblyCalculatorModal();
  return { default: module.AssemblyCalculatorModal };
});

// PendingSystemAction moved to elementForms/system.tsx with the rest of
// System's exclusive state — imported back only where the modal's title/
// message ternaries need to read `.kind`/`.value`/`.target`, via
// systemFormState.pendingSystemAction's own inferred type.

type AdvancedFieldsElementPatch = Partial<Element> & {
  extra_json?: unknown;
  subcategory?: unknown;
  system_preset?: unknown;
  zoneId?: unknown;
};
// ElementOfType<T> (the WetEmitter subcategory dropdown's value-cast helper)
// moved to elementForms/wetEmitter.tsx with its only remaining call site —
// grep-verified zero other callers in this file.

// formatSystemPresetName moved to elementForms/system.tsx with the rest of
// System's exclusive state — imported back above for the DeleteConfirmModal's
// message text (its one remaining orchestrator call site).

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function unheatedPitchedRoofCeilingElevationSourceLabel(
  source: UnheatedPitchedRoofCeilingElevationSource,
): string {
  switch (source) {
    case 'authored':
      return 'manual';
    case 'wall-top':
      return 'wall tops';
    case 'storey-ceiling':
      return 'floor stack';
    case 'roof-base':
      return 'roof base';
  }
}

// Define Selection type locally
type Selection = {
  type: 'zone' | 'element' | 'global' | 'dormer';
  id: string;
  isPlaceholder?: boolean;
  focusFieldKey?: string;
} | null;

const ELEMENT_TYPES = ELEMENT_TYPE_ORDER;
const PRESET_ELEMENT_TYPES = ['BuildingElementOpaque', 'BuildingElementTransparent', 'OnSiteGeneration'];

const SCHEMA_BASE_HEIGHT_ELEVATION_TYPES = new Set<ElementType>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'OnSiteGeneration',
]);

const BUILDING_FABRIC_LINE_PITCH_TYPES = new Set<ElementType>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementGround',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

const VIEWER_ELEVATION_ENDPOINT_TYPES = new Set<ElementType>([
  'ThermalBridgeLinear',
  'WaterPipework',
  'MechanicalVentilationDuctwork',
]);

const EXISTING_VIEWER_ELEVATION_FIELD_TYPES = new Set<ElementType>([
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

const DOMAIN_ELEVATION_FIELD_TYPES = new Set<ElementType>([
  'Vents',
  'MechanicalVentilation',
  'MechanicalVentilationTerminal',
]);

function elementUsesDedicatedElevationControls(type: ElementType): boolean {
  return (
    SCHEMA_BASE_HEIGHT_ELEVATION_TYPES.has(type) ||
    VIEWER_ELEVATION_ENDPOINT_TYPES.has(type) ||
    EXISTING_VIEWER_ELEVATION_FIELD_TYPES.has(type) ||
    DOMAIN_ELEVATION_FIELD_TYPES.has(type)
  );
}

function elementSupportsGenericElevationControl(
  type: ElementType,
  element?: Element | null,
  draftGroundFloorType?: unknown,
): boolean {
  if (elementUsesDedicatedElevationControls(type)) return false;
  if (type !== 'BuildingElementGround') return true;
  const floorType = draftGroundFloorType || (element as { floor_type?: unknown } | null | undefined)?.floor_type;
  return groundFloorTypeSupportsViewerElevation(floorType);
}

function readViewerElevationValue(element: Element): number | '' {
  const viewer = (element as { _base_height?: unknown })._base_height;
  if (typeof viewer === 'number' && Number.isFinite(viewer)) return roundToTwoDecimals(viewer);
  if (element.type === 'ThermalBridgePoint') {
    const z = element.coordinates?.[0]?.z;
    return typeof z === 'number' && Number.isFinite(z) ? roundToTwoDecimals(z) : '';
  }
  return '';
}

const ADJACENT_LIKE_ELEMENT_TYPES: ElementType[] = [
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
];

type AdjacentLikeElement =
  | BuildingElementAdjacentConditionedSpace
  | BuildingElementAdjacentUnconditionedSpace_Simple
  | BuildingElementPartyWall;

type AreaBasedExportElement =
  | BuildingElementOpaque
  | BuildingElementTransparent
  | AdjacentLikeElement;

function isAdjacentLikeElement(element: Element): element is AdjacentLikeElement {
  return (
    element.type === 'BuildingElementAdjacentConditionedSpace'
    || element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
    || element.type === 'BuildingElementPartyWall'
  );
}

function isAreaBasedExportElement(element: Element): element is AreaBasedExportElement {
  return (
    element.type === 'BuildingElementOpaque'
    || element.type === 'BuildingElementTransparent'
    || isAdjacentLikeElement(element)
  );
}

const PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES = new Set([
  'unfilled_unsealed',
  'unfilled_sealed',
  'filled_sealed',
  'filled_unsealed',
]);

interface ElementCreatorProps {
  selection: Selection;
  selectionContext?: Selection;
  setSelection: (selection: Selection) => void;
  /**
   * When false, renders without StandardCard chrome so it can be embedded in CanvasPanel.
   * Defaults to true for backwards compatibility.
   */
  useCard?: boolean;
  /**
   * When true, renders AdvancedFieldsEditor without inner borders/backgrounds.
   */
  advancedFlat?: boolean;
  // Modal state and handlers for external management
  zoneDeleteModal?: {
    isOpen: boolean;
    zoneId: string | null;
    zoneName: string | null;
    childElements: Array<{ name: string; type: string }>;
  };
  elementDeleteModal?: {
    isOpen: boolean;
    elementId: string | null;
    elementName: string | null;
  };
  onZoneDelete?: () => void;
  onConfirmZoneDelete?: () => void;
  onCancelZoneDelete?: () => void;
  onElementDelete?: () => void;
  onConfirmElementDelete?: () => void;
  onCancelElementDelete?: () => void;
  /** Opens Space Labeller (replaces details panel) for the given zone. */
  onOpenSpaceLabeller?: (zoneId: string) => void;
  onStartMvhrDuctDraw?: (args: { role: MvhrDuctRole; parentName: string }) => void;
  onStartMvhrTerminalDraw?: (args: { role: MvhrTerminalRole; parentName: string }) => void;
  /** Canonical document-host filename for validation and evidence lookups. */
  documentFileName?: string;
  inspectorContributions?: GeometryInspectorContributions;
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
  externalDetailCataloguePort?: ExternalDetailCataloguePort;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactSelectedValidationMessage(message: string, element: Element | null | undefined): string {
  let compact = message.trim().replace(/\s+/g, ' ');
  if (element?.name) {
    const name = escapeRegExp(element.name);
    compact = compact.replace(new RegExp(`^${name}\\s*(?:\\([^)]*\\))?:\\s*`, 'i'), '');
  }
  if (element?.type) {
    compact = compact.replace(new RegExp(`^\\(?${escapeRegExp(element.type)}\\)?:\\s*`, 'i'), '');
  }
  return compact;
}

const toCamelCase = (value: string) => value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

// Helper function to check if element type is global
const isGlobalElementType = (type: ElementType): boolean => {
  return ['WaterPipework', 'Appliance', 'HotWaterDemand', 'ContextShading', 'Vents', 'MechanicalVentilation', 'CombustionAppliances', 'MechanicalVentilationDuctwork', 'MechanicalVentilationTerminal'].includes(type);
};

/**
 * Signature of the fields `syncSuspendedGroundFabricFromWalls` /
 * `syncGroundExposedPerimetersFromWalls` consume. Returns `''` for elements neither sync reads.
 */
function buildSuspendedGroundFabricSignaturePart(el: Element): string {
  if (el.type === 'BuildingElementGround') {
    const extra = readExtraJsonRecord(el.extra_json);
    return [
      el.id,
      el.type,
      el.name ?? '',
      el.zoneId ?? '',
      el.floorId ?? '',
      JSON.stringify(el.coordinates ?? []),
      (el as { floor_type?: string }).floor_type ?? '',
      (el as { perimeter?: number }).perimeter ?? '',
      (el as { thickness_walls?: number }).thickness_walls ?? '',
      extra.thermal_transm_walls ?? '',
      extra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY] === true ? 'perimeter-manual' : '',
      extra[THICKNESS_WALLS_MANUAL_KEY] === true ? 'thick-manual' : '',
      extra[THERMAL_TRANSM_WALLS_MANUAL_KEY] === true ? 'transm-manual' : '',
    ].join('|');
  }

  if (el.type === 'BuildingElementOpaque') {
    const pitch = (el as { pitch?: number }).pitch ?? 90;
    if (Math.abs(pitch - 90) > 10) return '';
    return [
      el.id,
      el.type,
      el.name ?? '',
      el.zoneId ?? '',
      el.floorId ?? '',
      (el as { parent_element?: string | null }).parent_element ?? '',
      (el as { location?: string }).location ?? '',
      JSON.stringify(el.coordinates ?? []),
      pitch,
      (el as { area?: number }).area ?? '',
      JSON.stringify(el.extra_json ?? {}),
    ].join('|');
  }

  if (
    el.type === 'BuildingElementAdjacentConditionedSpace' ||
    el.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    el.type === 'BuildingElementPartyWall'
  ) {
    return [
      el.id,
      el.type,
      el.name ?? '',
      el.zoneId ?? '',
      el.floorId ?? '',
      (el as { parent_element?: string | null }).parent_element ?? '',
      JSON.stringify(el.coordinates ?? []),
      (el as { area?: number }).area ?? '',
      JSON.stringify(el.extra_json ?? {}),
    ].join('|');
  }

  return '';
}

const SelectedElementValidationRows = React.memo(function SelectedElementValidationRows({
  activeFilename,
  onFocusField,
  sourceComparisonPort,
  selectionId,
}: {
  activeFilename: string;
  onFocusField: (fieldKey: string) => void;
  sourceComparisonPort: GeometrySourceComparisonPort;
  selectionId: string;
}) {
  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot,
  );
  const { selectedElement, elementsById, activeCsvValidationInfo, validateElement } = useGeometryStore(
    useShallow((s) => ({
      selectedElement: s.elementsById[selectionId] ?? null,
      elementsById: s.elementsById,
      activeCsvValidationInfo: activeFilename ? s.csvValidationCache[activeFilename] : undefined,
      validateElement: s.validateElement,
    })),
  );

  const validationRows = useMemo(() => {
    void sourceComparisonSnapshot.revision;
    if (!selectedElement) return null;

    const validation = validateElement(selectedElement, elementsById);
    const schemaIssues = (() => {
      if (!activeFilename || !selectedElement.name) return [] as string[];
      const errors = activeCsvValidationInfo?.wasmValidation?.errors || [];
      const name = selectedElement.name;
      const issues = errors
        .filter((err) => (err.path || '').includes(name) || err.message.includes(name))
        .map((err) => `Schema: ${err.path ? `${err.path}: ` : ''}${err.message}`);
      return Array.from(new Set(issues));
    })();

    const comparisonInfoPillItems = sourceComparisonPort.elementInfo(selectedElement.id)?.items ?? [];

    return { validation, schemaIssues, comparisonInfoPillItems };
  }, [activeCsvValidationInfo, activeFilename, elementsById, selectedElement, sourceComparisonPort, sourceComparisonSnapshot.revision, validateElement]);

  if (!selectedElement || !validationRows) return null;
  const { validation, schemaIssues, comparisonInfoPillItems } = validationRows;
  const hasLivePills = validation.hasIssues || validation.hasWarnings || comparisonInfoPillItems.length > 0;
  const hasSavedFileIssues = schemaIssues.length > 0;
  if (!hasLivePills && !hasSavedFileIssues) return null;

  return (
    <div className="element-editor-status-row">
      {hasLivePills && (
        <div className="element-editor-pill-row">
          {validation.hasIssues && validation.issues.map((issue, i) => (
            <ValidationPill
              key={`issue-${i}`}
              message={compactSelectedValidationMessage(issue.message, selectedElement)}
              title={issue.message}
              variant="error"
              onClick={issue.fieldKey ? () => onFocusField(issue.fieldKey!) : undefined}
            />
          ))}
          {validation.hasWarnings && validation.warnings.map((warning, i) => (
            <ValidationPill
              key={`warning-${i}`}
              message={compactSelectedValidationMessage(warning.message, selectedElement)}
              title={warning.message}
              variant="warning"
              onClick={warning.fieldKey ? () => onFocusField(warning.fieldKey!) : undefined}
            />
          ))}
          {comparisonInfoPillItems.map((info, i) => (
            <ValidationPill
              key={`comparison-${i}`}
              message={compactSelectedValidationMessage(info.message, selectedElement)}
              title={info.message}
              variant="info"
              onClick={info.fieldKey ? () => onFocusField(info.fieldKey!) : undefined}
            />
          ))}
        </div>
      )}
      {hasSavedFileIssues && (
        <div className="element-editor-pill-row">
          {schemaIssues.map((issue, i) => (
            <ValidationPill
              key={`schema-issue-${i}`}
              message={`Saved: ${compactSelectedValidationMessage(issue, selectedElement)}`}
              title={`Saved CSV validation: ${issue}`}
              variant="warning"
            />
          ))}
        </div>
      )}
    </div>
  );
});

export const ElementCreator = React.memo(function ElementCreator(props: ElementCreatorProps) {
  if (!props.selection) {
    const content = (
      <div className="element-creator empty">Select or create a zone/element to begin.</div>
    );
    return props.useCard !== false ? (
      <StandardCard title="Element Creator">{content}</StandardCard>
    ) : content;
  }

  const content = <ElementCreatorContent {...props} selection={props.selection} />;
  const EvidenceProvider = props.inspectorContributions?.evidence?.Provider;
  return EvidenceProvider ? (
    <EvidenceProvider
      selection={props.selection}
      documentFileName={props.documentFileName}
    >
      {content}
    </EvidenceProvider>
  ) : content;
});

const ElementCreatorContent: React.FC<ElementCreatorProps & { selection: NonNullable<ElementCreatorProps['selection']> }> = ({
  selection,
  selectionContext,
  setSelection,
  useCard = true,
  advancedFlat = false,
  onZoneDelete,
  onElementDelete,
  onOpenSpaceLabeller,
  onStartMvhrDuctDraw,
  onStartMvhrTerminalDraw,
  documentFileName,
  inspectorContributions = emptyGeometryInspectorContributions,
  workspaceResourcePort = unavailableGeometryWorkspaceResourcePort,
  externalDetailCataloguePort,
}) => {
  const geometryStore = useGeometryStoreApi();
  const schemaPort = useGeometrySchemaPort();
  const sourceComparisonPort = useGeometrySourceComparisonPort();
  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot,
  );
  const evidenceBridge = useContext(GeometryInspectorEvidenceContext);
  const DetailedJunctionControl =
    inspectorContributions.detailedJunctionSolver?.Control;
  const productCatalogue = inspectorContributions.productCatalogue;

  useEffect(() => {
    const handle = window.setTimeout(prefetchAdvancedFieldsEditor, 250);
    return () => {
      window.clearTimeout(handle);
    };
  }, []);

  // Geometry store: data via shallow selector, stable function refs individually
  const { zones, elementsById, elementIds, floors, complianceSettings, defaultThermalBridging, bundledAssemblyLibrary } = useGeometryStore(
    useShallow((s) => ({
      zones: s.zones,
      elementsById: s.elementsById,
      elementIds: s.elementIds,
      floors: s.floors,
      complianceSettings: s.complianceSettings,
      defaultThermalBridging: s.defaultThermalBridging,
      bundledAssemblyLibrary: s.bundledAssemblyLibrary,
    }))
  );
  const addZone = useGeometryStore((s) => s.addZone);
  const addElement = useGeometryStore((s) => s.addElement);
  const updateElement = useGeometryStore((s) => s.updateElement);
  const flipElementOrientation = useGeometryStore((s) => s.flipElementOrientation);
  const isElementNameManual = useGeometryStore((s) => s.isElementNameManual);
  const resetElementNameToAuto = useGeometryStore((s) => s.resetElementNameToAuto);
  const convertThermalBridgeLineMode = useGeometryStore((s) => s.convertThermalBridgeLineMode);
  const getElementById = useGeometryStore((s) => s.getElementById);
  const getZoneById = useGeometryStore((s) => s.getZoneById);
  const spaceLabelIds = useGeometryStore((s) => s.spaceLabelIds);
  const spaceLabelsById = useGeometryStore((s) => s.spaceLabelsById);
  const removePlaceholder = useGeometryStore((s) => s.removePlaceholder);
  const updateZone = useGeometryStore((s) => s.updateZone);
  const removeElement = useGeometryStore((s) => s.removeElement);
  const duplicateElement = useGeometryStore((s) => s.duplicateElement);
  const setSelectedElementIds = useGeometryStore((s) => s.setSelectedElementIds);
  const setCurrentFloorZ = useGeometryStore((s) => s.setCurrentFloorZ);
  const validateElement = useGeometryStore((s) => s.validateElement);
  const defaultsLookup = useGeometryStore((s) => s.getDefaultsLookup());
  const resolvedSelectionContext = selectionContext ?? selection;
  // Stable version counter for the currently selected element.
  // This replaces the unstable `elementsById[selection?.id || '']` dependency
  // in the data-loading useEffect, so it only re-fires when the *selected*
  // element changes — not when any other element is modified.
  const selectedElementV = useGeometryStore(
    (s) => selection?.id ? (s.elementsById[selection.id]?._v ?? 0) : -1
  );
  const allElements = useMemo(() => Object.values(elementsById) as Element[], [elementsById]);

  const latestElementsByIdRef = useRef(elementsById);
  useEffect(() => {
    latestElementsByIdRef.current = elementsById;
  }, [elementsById]);
  const [suspendedGroundFabricSignatureCache] = useState(
    () => new WeakMap<Element, string>(),
  );
  const suspendedGroundFabricSyncSignature = useMemo(() => {
    // Elements are replaced (not mutated) on write, so a per-element cache keyed on identity
    // re-serialises only what changed instead of the whole model on every store update.
    const parts: string[] = [];
    for (const el of allElements) {
      let part = suspendedGroundFabricSignatureCache.get(el);
      if (part === undefined) {
        part = buildSuspendedGroundFabricSignaturePart(el);
        suspendedGroundFabricSignatureCache.set(el, part);
      }
      if (part !== '') parts.push(part);
    }
    return parts.join('\n');
  }, [allElements, suspendedGroundFabricSignatureCache]);

  useEffect(() => {
    const latest = latestElementsByIdRef.current;
    syncSuspendedGroundFabricFromWalls(latest, updateElement, defaultsLookup);
    syncGroundExposedPerimetersFromWalls(latest, updateElement);
  }, [defaultsLookup, suspendedGroundFabricSyncSignature, updateElement]);

  const primaryFhsZoneId = useMemo(
    () => zones.find((zone) => !zone.isPlaceholder)?.id,
    [zones],
  );

  const selectedZoneValidation = useMemo(() => {
    if (selection?.type !== 'zone') return null;
    const zone = getZoneById(selection.id);
    if (!zone) return null;
    return validateZone(zone, {
      elementsById,
      complianceValidationEnabled: complianceSettings.complianceValidationEnabled || false,
      defaultThermalBridging,
      primaryFhsZoneId,
    });
  }, [
    selection,
    getZoneById,
    elementsById,
    complianceSettings.complianceValidationEnabled,
    defaultThermalBridging,
    primaryFhsZoneId,
  ]);

  /** Space footprints in the selected zone with no `room_type` — shown next to Space labeller (critical chip). */
  const zoneUnlabeledSpaceFootprintCount = useMemo(() => {
    if (selection?.type !== 'zone' || !selection.id) return 0;
    const zone = getZoneById(selection.id);
    if (!zone) return 0;
    return spaceLabelIds
      .map((id) => spaceLabelsById[id])
      .filter((sl): sl is SpaceLabel => Boolean(sl) && sl.zoneId === zone.id)
      .filter((sl) => !String(sl.room_type || '').trim()).length;
  }, [selection, getZoneById, spaceLabelIds, spaceLabelsById]);

  const activeFilename = documentFileName ??
    sessionStorage.getItem('geometry-builder-filename') ??
    '';

  // The persisted element name from the store (not the local editing state)
  const persistedElementName = useMemo(() => {
    void selectedElementV;
    if (selection?.type !== 'element' && selection?.type !== 'global') return '';
    return selection?.id ? getElementById(selection.id)?.name || '' : '';
  }, [selection?.id, selection?.type, getElementById, selectedElementV]);

  // When FHS validation is enabled, use the FHS schema consistently for tooltip
  // and advanced-field resolution instead of the blended default schema.
  const useFHSSchema = !!complianceSettings.complianceValidationEnabled;
  const applianceKeyOptions = useMemo(() => {
    const schemaKeys = schemaPort.availability === 'available'
      ? schemaPort.getApplianceKeys(useFHSSchema ? 'fhs' : 'core')
      : [];
    if (schemaKeys.length > 0) return schemaKeys;
    // The canonical base vocabulary remains available before an injected schema is loaded.
    return [...(APPLIANCE_KEYS as readonly string[])];
  }, [schemaPort, useFHSSchema]);

  const zoneComparisonInfoPillItems = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return selection?.type === 'zone'
        ? sourceComparisonPort.zoneInfo(selection.id)?.items ?? []
        : [];
    },
    [selection?.id, selection?.type, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );

  const comparisonFieldIndicators = useMemo(() => {
    void sourceComparisonSnapshot.revision;
    if (!(selection?.type === 'element' || selection?.type === 'global')) return {};
    return sourceComparisonPort.elementInfo(selection.id)?.fieldIndicators ?? {};
  }, [selection?.id, selection?.type, sourceComparisonPort, sourceComparisonSnapshot.revision]);

  const globalComparisonFieldIndicators = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return sourceComparisonPort.globalInfo()?.fieldIndicators ?? {};
    },
    [sourceComparisonPort, sourceComparisonSnapshot.revision],
  );

  const zoneComparisonFieldIndicators = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return selection?.type === 'zone'
        ? sourceComparisonPort.zoneInfo(selection.id)?.fieldIndicators ?? {}
        : {};
    },
    [selection?.id, selection?.type, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );

  const [comparisonFocusRequest, setComparisonFocusRequest] = useState<{ fieldKey: string; version: number } | null>(null);
  const [baseFieldNodes] = useState(() => new Map<string, HTMLDivElement>());
  const sourceAssignment = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return selection?.type === 'element' && persistedElementName
        ? sourceComparisonPort.assignmentForElement(persistedElementName)
        : null;
    },
    [persistedElementName, selection?.type, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );
  const comparisonDerivedBadge = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return selection?.type === 'element'
        ? sourceComparisonPort.elementInfo(selection.id)?.derivedBadge ?? null
        : null;
    },
    [selection?.id, selection?.type, sourceComparisonPort, sourceComparisonSnapshot.revision],
  );

  const registerBaseFieldRef = (fieldKey: string) => (node: HTMLDivElement | null) => {
    if (node) baseFieldNodes.set(fieldKey, node);
    else baseFieldNodes.delete(fieldKey);
  };

  const registerBaseFieldRefs = (fieldKeys: string | string[]) => (node: HTMLDivElement | null) => {
    const keys = Array.isArray(fieldKeys) ? fieldKeys : [fieldKeys];
    for (const key of keys) {
      const camelKey = toCamelCase(key);
      if (node) {
        baseFieldNodes.set(key, node);
        baseFieldNodes.set(camelKey, node);
      } else {
        baseFieldNodes.delete(key);
        baseFieldNodes.delete(camelKey);
      }
    }
  };

  const focusBaseField = useCallback((fieldKey: string) => {
    const node = baseFieldNodes.get(fieldKey);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = node.querySelector('input, select, textarea') as HTMLElement | null;
    if (input) input.focus();
  }, [baseFieldNodes]);

  const focusFieldKey = useCallback((fieldKey: string) => {
    const baseKey = baseFieldNodes.has(fieldKey) ? fieldKey : toCamelCase(fieldKey);
    if (baseFieldNodes.has(baseKey)) {
      focusBaseField(baseKey);
      return;
    }
    setComparisonFocusRequest({ fieldKey, version: Date.now() });
  }, [baseFieldNodes, focusBaseField]);

  useEffect(() => {
    if (!selection?.focusFieldKey) return;
    // This effect consumes an explicit cross-panel focus request from the selection store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    focusFieldKey(selection.focusFieldKey);
  }, [focusFieldKey, selection?.focusFieldKey, selection?.id]);

  const handleSourceUnassign = async () => {
    if (!sourceAssignment || !persistedElementName) return;
    try {
      await sourceComparisonPort.unassignElement(persistedElementName);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update source assignment');
    }
  };

  const renderFieldLabelWithComparisonIndicator = (
    label: string,
    elementType: string,
    indicatorMessages?: readonly string[],
    evidenceFieldKey?: string,
  ) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {renderFieldLabel(label, elementType, evidenceFieldKey)}
      {indicatorMessages && indicatorMessages.length > 0 && (
        <ValidationIndicator
          hasIssues
          issues={indicatorMessages}
          size="small"
          variant="info"
        />
      )}
    </div>
  );

  // Zone creation state
  const [zoneName, setZoneName] = useState('');
  const zoneFloorAreaInput = useDecimalInput('', undefined, { commitOnChange: true, formatOnBlur: 'preserve' });
  const zoneHeightInput = useDecimalInput('', undefined, { commitOnChange: true, formatOnBlur: 'preserve' });
  const syncZoneFloorAreaValue = zoneFloorAreaInput.syncValue;
  const syncZoneHeightValue = zoneHeightInput.syncValue;
  const zoneFloorArea = zoneFloorAreaInput.value;
  const zoneHeight = zoneHeightInput.value;
  const [simplifiedThermalBridging, setSimplifiedThermalBridging] = useState<boolean>(false);
  const zoneVolume = useMemo(
    () => calculateZoneVolume(zoneFloorArea, zoneHeight),
    [zoneFloorArea, zoneHeight],
  );
  const isPrimaryFhsZoneSelection =
    selection?.type === 'zone'
    && (
      (primaryFhsZoneId ? selection.id === primaryFhsZoneId : zones.every((zone) => zone.isPlaceholder))
    );
  const showFhsAreaSplit = !!complianceSettings.complianceValidationEnabled && isPrimaryFhsZoneSelection;
  const showFhsPrimaryZoneNote =
    !!complianceSettings.complianceValidationEnabled
    && selection?.type === 'zone'
    && !isPrimaryFhsZoneSelection;
  const fhsSpaceLabelAggregate = useMemo(() => {
    if (selection?.type !== 'zone' || !showFhsAreaSplit) return null;
    const list = spaceLabelIds
      .map((id) => spaceLabelsById[id])
      .filter((sl): sl is SpaceLabel => !!sl && sl.zoneId === selection.id);
    return aggregateSpaceLabelsForZone(list, selection.id);
  }, [selection, showFhsAreaSplit, spaceLabelIds, spaceLabelsById]);

  const isExistingZoneSelection = useCallback((target: Selection = selection): target is NonNullable<Selection> & { type: 'zone' } => {
    return !!target && target.type === 'zone' && !target.isPlaceholder;
  }, [selection]);

  const isExistingElementSelection = useCallback((target: Selection = selection): target is NonNullable<Selection> & { type: 'element' | 'global' } => {
    return !!target && (target.type === 'element' || target.type === 'global') && !target.isPlaceholder;
  }, [selection]);

  const buildLightingCommitPatch = (
    existingElement: Element,
    overrides: Partial<Element>,
  ): Partial<Element> => {
    const next = { ...overrides } as Record<string, unknown>;

    const rawEfficacy = Object.prototype.hasOwnProperty.call(overrides, 'efficacy')
      ? (overrides as Record<string, unknown>).efficacy
      : getLightingFieldValue(existingElement, 'efficacy');
    const rawCount = Object.prototype.hasOwnProperty.call(overrides, 'count')
      ? (overrides as Record<string, unknown>).count
      : getLightingFieldValue(existingElement, 'count');
    const rawPower = Object.prototype.hasOwnProperty.call(overrides, 'power')
      ? (overrides as Record<string, unknown>).power
      : getLightingFieldValue(existingElement, 'power');

    const efficacy = typeof rawEfficacy === 'number' && rawEfficacy > 0 ? rawEfficacy : undefined;
    const count = typeof rawCount === 'number' && rawCount > 0 ? rawCount : undefined;
    const powerValue = typeof rawPower === 'number' && rawPower > 0 ? rawPower : undefined;

    next.efficacy = efficacy;
    next.count = count;
    next.power = powerValue;
    next.bulbs = {
      led: {
        count,
        power: powerValue,
        efficacy,
      },
    };

    return next as Partial<Element>;
  };

  const getZoneNameForElementZoneId = useCallback((zoneId: unknown): string | null => {
    if (typeof zoneId !== 'string' || !zoneId.trim()) return null;
    return getZoneById(zoneId)?.name?.trim() || null;
  }, [getZoneById]);

  function withSyncedSpaceHeatSystemZone(
    existingElement: Element,
    overrides: Partial<Element>,
  ): Partial<Element> {
    if (existingElement.type !== 'System') return overrides;

    const nextSubcategory = Object.prototype.hasOwnProperty.call(overrides, 'subcategory')
      ? (overrides as Record<string, unknown>).subcategory
      : existingElement.subcategory;
    if (nextSubcategory !== 'SpaceHeatSystem') return overrides;

    const nextZoneId = Object.prototype.hasOwnProperty.call(overrides, 'zoneId')
      ? (overrides as Record<string, unknown>).zoneId
      : existingElement.zoneId;
    const sourceExtraJson = Object.prototype.hasOwnProperty.call(overrides, 'extra_json')
      ? (overrides as Record<string, unknown>).extra_json
      : existingElement.extra_json;
    const syncedExtraJson = syncSpaceHeatSystemZoneNameInExtraJson(
      sourceExtraJson,
      getZoneNameForElementZoneId(nextZoneId),
    );
    if (!syncedExtraJson) return overrides;
    if (
      syncedExtraJson === sourceExtraJson &&
      !Object.prototype.hasOwnProperty.call(overrides, 'extra_json')
    ) {
      return overrides;
    }
    return {
      ...overrides,
      extra_json: syncedExtraJson,
    };
  }

  const getDuplicateNameIssueRef = useRef<() => string | null>(() => null);

  function commitExistingZoneDraft(overrides: Partial<Zone> = {}) {
    if (!isExistingZoneSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'name') && getDuplicateNameIssueRef.current()) return;
    try {
      updateZone(currentSelection.id, overrides);
    } catch { /* swallow: best-effort */ }
  }

  function commitExistingElementDraft(overrides: Partial<Element> = {}) {
    if (!isExistingElementSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    if (Object.prototype.hasOwnProperty.call(overrides, 'name') && getDuplicateNameIssueRef.current()) return;

    const existingElement = getElementById(currentSelection.id);
    if (!existingElement) return;

    const next = { ...overrides } as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(next, 'parent_element')) {
      next.parent_element = next.parent_element ? next.parent_element : null;
    }

    const isLightingCommit = existingElement.type === 'Lighting'
      && ['efficacy', 'count', 'power', 'simplified_lighting'].some((field) =>
        Object.prototype.hasOwnProperty.call(next, field),
      );
    const patch = isLightingCommit
      ? buildLightingCommitPatch(existingElement, next as Partial<Element>)
      : withSyncedSpaceHeatSystemZone(existingElement, next as Partial<Element>);

    try {
      updateElement(currentSelection.id, patch);
    } catch { /* swallow: best-effort */ }
  }
  const commitExistingElementDraftRef = useRef(commitExistingElementDraft);
  useEffect(() => {
    commitExistingElementDraftRef.current = commitExistingElementDraft;
  });

  const commitElementNumericField = (field: string) => (value: number | '') => {
    commitExistingElementDraft({ [field]: value } as Partial<Element>);
  };

  const isSelectedSlopedFabricPolygon = () => {
    if (!isExistingElementSelection()) return false;
    const currentSelection = selection as Exclude<Selection, null>;
    const element = getElementById(currentSelection.id);
    if (!element) return false;
    if (
      element.type !== 'BuildingElementOpaque' &&
      element.type !== 'BuildingElementTransparent' &&
      !ADJACENT_LIKE_ELEMENT_TYPES.includes(element.type as ElementType)
    ) {
      return false;
    }
    return getElementShape(element) === 'sloped-polygon';
  };

  const widthInputValueForCommitRef = useRef<number | ''>('');
  const heightInputValueForCommitRef = useRef<number | ''>('');

  const commitElementWidthField = (value: number | '') => {
    if (value === '') return;
    const width = typeof value === 'number' ? value : undefined;
    const overrides: Record<string, unknown> = { width: value };
    if (
      !isSelectedSlopedFabricPolygon() &&
      (
        elementType === 'BuildingElementOpaque'
        || elementType === 'BuildingElementTransparent'
        || ADJACENT_LIKE_ELEMENT_TYPES.includes(elementType)
      )
    ) {
      const height = typeof heightInputValueForCommitRef.current === 'number'
        ? heightInputValueForCommitRef.current
        : undefined;
      overrides.area = width !== undefined && height !== undefined ? width * height : undefined;
    }
    commitExistingElementDraft(overrides as Partial<Element>);
  };

  const commitElementHeightField = (value: number | '') => {
    if (value === '') return;
    const height = typeof value === 'number' ? value : undefined;
    const overrides: Record<string, unknown> = { height: value };
    if (
      !isSelectedSlopedFabricPolygon() &&
      (
        elementType === 'BuildingElementOpaque'
        || elementType === 'BuildingElementTransparent'
        || ADJACENT_LIKE_ELEMENT_TYPES.includes(elementType)
      )
    ) {
      const width = typeof widthInputValueForCommitRef.current === 'number'
        ? widthInputValueForCommitRef.current
        : undefined;
      overrides.area = width !== undefined && height !== undefined ? width * height : undefined;
    }
    commitExistingElementDraft(overrides as Partial<Element>);
  };

  // Element creation state
  const [elementName, setElementName] = useState('');
  const elementNameEditingRef = useRef(false);
  const [elementType, setElementType] = useState<ElementType>('BuildingElementOpaque');
  const [elementZoneId, setElementZoneId] = useState<string>('');
  const [elementFloorId, setElementFloorId] = useState<string>('');

  // Form fields for different element types
  const widthInput = useDecimalInput('', commitElementWidthField, { commitOnChange: true });
  const heightInput = useDecimalInput('', commitElementHeightField, { commitOnChange: true });
  useEffect(() => {
    widthInputValueForCommitRef.current = widthInput.value;
    heightInputValueForCommitRef.current = heightInput.value;
  }, [heightInput.value, widthInput.value]);
  const areaInput = useDecimalInput('', commitElementNumericField('area'), { commitOnChange: true });
  const selectedDraftElement = selection?.id
    && (selection.type === 'element' || selection.type === 'global')
    ? getElementById(selection.id)
    : undefined;
  const selectedDraftKey = selectedDraftElement
    ? `${selectedDraftElement.id}\0${selectedElementV}`
    : 'new';
  const selectedDraftPitch = selectedDraftElement && 'pitch' in selectedDraftElement
    ? selectedDraftElement.pitch
    : undefined;
  const [pitch, setPitch] = useKeyedState(
    selectedDraftKey,
    typeof selectedDraftPitch === 'number' && Number.isFinite(selectedDraftPitch)
      ? selectedDraftPitch
      : 90,
  );
  // Draft-string commit for the single-element typed pitch input (Opaque/Transparent/
  // Adjacent-like: the three literal-copy blocks below all bind to this one instance, since
  // only one renders at a time for a given elementType and hooks must run unconditionally).
  // Was previously a plain controlled `<input value={formatConditionalDecimals(pitch)}>` with
  // `parseFloat(e.target.value)` re-deriving the displayed value every keystroke: typing "22."
  // parsed to 22, which snapped the visible field back to "22" mid-type (the trailing "."
  // vanished), so the next keystroke landed on the wrong digit — decimal entry was effectively
  // impossible. `useNumericDraftInput` decouples the *displayed* raw string (`inputValue`) from
  // the *committed* value: the field echoes exactly what was typed while editing, and only
  // reformats (to 2dp) on blur. Values commit at 2dp (roundToTwoDecimals) to match the CSV
  // writer/importer (both round to 2dp), so a save/load/save cycle is idempotent from the
  // first cycle. `syncExternal: true` re-syncs the draft from `pitch` whenever it changes
  // externally (selection change, preset load, dormer/parent inherit, etc.) without threading
  // `.setValue()` through every one of those call sites.
  const commitTypedPitch = (parsed: number | ''): void => {
    if (parsed === '') return;
    const newPitch = roundToTwoDecimals(parsed);

    if (selection.type === 'element') {
      const currentElement = getElementById(selection.id);
      if (currentElement) {
        const currentShape = getElementShape(currentElement);

        // For polygons: only allow 0° or 180° (horizontal surfaces)
        if (currentShape === 'polygon' && newPitch !== 0 && newPitch !== 180) {
          const ok = window.confirm(
            `Polygon elements should have pitch 0° (horizontal up) or 180° (horizontal down). Convert to sloped polygon shape to use angled pitch ${newPitch}°?`
          );
          if (ok) {
            // Keep same coordinates, just update pitch - sloped-polygon uses same coordinate structure.
            const patch: Partial<Element> = { pitch: newPitch } as Partial<Element>;
            if (currentElement.type === 'BuildingElementAdjacentConditionedSpace') {
              const extra = readExtraJsonRecord(currentElement.extra_json);
              if (VULCAN_UI_PARTY_ELEMENT_KEY in extra) {
                const nextExtra = { ...extra };
                delete nextExtra[VULCAN_UI_PARTY_ELEMENT_KEY];
                patch.extra_json = nextExtra;
              }
            }
            updateElement(currentElement.id, patch);
            setPitch(newPitch);
            return;
          } else {
            // Reset to 0° if user cancels
            setPitch(0);
            updateElement(selection.id, { pitch: 0 });
            return;
          }
        }

        // For lines: suggest polygon conversion for horizontal surfaces
        if (currentShape === 'line' && (newPitch === 0 || newPitch === 180)) {
          const ok = window.confirm(
            `Pitch ${newPitch}° suggests a horizontal surface. Convert to polygon shape?`
          );
          if (ok) {
            const nextCoords = convertShapeCoordinates(currentElement as any, 'polygon');
            updateElement(currentElement.id, { coordinates: nextCoords, pitch: newPitch });
          }
        }
      }
    }

    // Typed pitch passes through at 2dp (exact intent); only drag interactions round to a whole degree.
    setPitch(newPitch);
    // Only update pitch, don't touch coordinates
    if (selection.type === 'element') {
      updateElement(selection.id, { pitch: newPitch });
    }
  };
  const pitchDraftInput = useNumericDraftInput(pitch, commitTypedPitch, {
    commitOnChange: true,
    formatOnBlur: 'fixed2',
    syncExternal: true,
  });
  const baseHeightInput = useDecimalInput('', commitElementNumericField('base_height'), { commitOnChange: true });
  const commitUnheatedPitchedRoofCeilingElevation = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    const element = getElementById(currentSelection.id);
    if (!element || element.type !== 'BuildingElementOpaque') return;
    commitExistingElementDraft({
      extra_json: mergeUnheatedPitchedRoofCeilingElevationExtraJson(element.extra_json, value),
    } as Partial<Element>);
  };
  const unheatedPitchedRoofCeilingElevationInput = useDecimalInput(
    '',
    commitUnheatedPitchedRoofCeilingElevation,
    { commitOnChange: true },
  );
  const commitAdjacentViewerBaseHeight = (value: number | '') => {
    if (value === '') {
      commitExistingElementDraft({
        _base_height: undefined,
        base_height: undefined,
      } as Partial<Element>);
      return;
    }
    if (typeof value === 'number') {
      commitExistingElementDraft({
        _base_height: roundToTwoDecimals(value),
        base_height: undefined,
      } as Partial<Element>);
    }
  };
  const adjacentViewerBaseHeightInput = useDecimalInput(
    '',
    commitAdjacentViewerBaseHeight,
    { commitOnChange: true },
  );
  const commitElementElevation = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    const el = getElementById(currentSelection.id);
    if (!el) return;
    const elevation = typeof value === 'number' && Number.isFinite(value) ? roundToTwoDecimals(value) : '';
    const hasAuthoredViewerElevation = Object.prototype.hasOwnProperty.call(el, '_base_height');

    if (elevation === '' && el.type !== 'ThermalBridgePoint' && !hasAuthoredViewerElevation) {
      return;
    }

    if (el.type === 'ThermalBridgePoint') {
      const coords = Array.isArray(el.coordinates) && el.coordinates.length > 0
        ? el.coordinates
        : [{ x: 0, y: 0, z: 0 }];
      const [first, ...rest] = coords;
      const prevZ = typeof first?.z === 'number' && Number.isFinite(first.z) ? first.z : 0;
      const nextZ = elevation === '' ? prevZ : elevation;
      commitExistingElementDraft({
        coordinates: [{ ...first, z: nextZ }, ...rest],
      } as Partial<Element>);
      return;
    }

    if (SCHEMA_BASE_HEIGHT_ELEVATION_TYPES.has(el.type)) {
      commitExistingElementDraft({
        base_height: elevation === '' ? undefined : elevation,
      } as Partial<Element>);
      return;
    }

    commitExistingElementDraft({
      _base_height: elevation === '' ? undefined : elevation,
      ...(isAdjacentLikeElement(el) ? { base_height: undefined } : {}),
    } as Partial<Element>);
  };
  const elementElevationInput = useDecimalInput(
    '',
    commitElementElevation,
    { commitOnChange: true },
  );
  const commitPartyWallCavityResistance = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    const el = getElementById(currentSelection.id);
    if (!el || el.type !== 'BuildingElementPartyWall') return;
    const nextExtra = {
      ...readExtraJsonRecord(el.extra_json),
      party_wall_cavity_type: 'defined_resistance',
    } as Record<string, unknown>;
    if (typeof value === 'number' && Number.isFinite(value)) {
      nextExtra.thermal_resistance_cavity = value;
    } else {
      delete nextExtra.thermal_resistance_cavity;
    }
    commitExistingElementDraft({ extra_json: nextExtra } as Partial<Element>);
  };
  const partyWallCavityResistanceInput = useDecimalInput(
    '',
    commitPartyWallCavityResistance,
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const [isUnheatedPitchedRoof, setIsUnheatedPitchedRoof] = useState<boolean>(false);
  const [isExternalDoor, setIsExternalDoor] = useState<boolean>(false);
  const [assemblyCalculatorOpen, setAssemblyCalculatorOpen] = useState(false);
  /** When set, assembly modal edits this dormer thermal part (see `assemblyInitialSnapshot` after dormer helpers). */
  const [dormerAssemblySection, setDormerAssemblySection] = useState<DormerThermalSectionKey | null>(null);
  const [profileHeightsPopoverOpen, setProfileHeightsPopoverOpen] = useKeyedState(
    selection?.id ?? 'none',
    false,
  );
  const selectedParentElementValue = selectedDraftElement && 'parent_element' in selectedDraftElement
    ? String((selectedDraftElement as { parent_element?: string | null }).parent_element ?? '').trim()
    : '';
  const [parentElement, setParentElement] = useKeyedState(
    selectedDraftKey,
    selectedParentElementValue,
  );
  const [selectedDormerType, setSelectedDormerType] = useState<DormerType>('mono-pitch');
  const [dormerDepth, setDormerDepth] = useState<number>(1.5);
  const [dormerRoofIsUnheatedPitchedRoof, setDormerRoofIsUnheatedPitchedRoof] = useState<boolean>(false);
  const freeAreaHeightInput = useDecimalInput('', commitElementNumericField('free_area_height'), { commitOnChange: true });
  const midHeightInput = useDecimalInput('', commitElementNumericField('mid_height'), { commitOnChange: true });
  const maxWindowOpenAreaInput = useDecimalInput('', commitElementNumericField('max_window_open_area'), { commitOnChange: true });
  const totalAreaInput = useDecimalInput('', commitElementNumericField('total_area'), { commitOnChange: true });
  const commitGroundPerimeter = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    const currentSelection = selection as Exclude<Selection, null>;
    const element = getElementById(currentSelection.id);
    if (!element || element.type !== 'BuildingElementGround') {
      commitExistingElementDraft({ perimeter: value } as Partial<Element>);
      return;
    }

    const extra = readExtraJsonRecord(element.extra_json);
    const nextExtra = { ...extra };
    const autoDetails = computeGroundExposedPerimeterDetails(latestElementsByIdRef.current, element);
    const autoValue = hasReliableGroundExposedPerimeter(autoDetails) ? autoDetails.valueM : null;

    if (value === '') {
      delete nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
      commitExistingElementDraft({
        ...(autoValue != null ? { perimeter: autoValue } : {}),
        extra_json: nextExtra,
      } as Partial<Element>);
      return;
    }

    const rounded = roundToTwoDecimals(value);
    if (autoValue != null && Math.abs(rounded - autoValue) <= 0.01) {
      delete nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
    } else {
      nextExtra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY] = true;
    }
    commitExistingElementDraft({
      perimeter: rounded,
      extra_json: nextExtra,
    } as Partial<Element>);
  };
  const perimeterInput = useDecimalInput('', commitGroundPerimeter, { commitOnChange: true });
  const [floorType, setFloorType] = useState<'' | 'Heated_basement' | 'Slab_no_edge_insulation' | 'Slab_edge_insulation' | 'Suspended_floor' | 'Unheated_basement'>('');
  const depthBasementFloorInput = useDecimalInput('', commitElementNumericField('depth_basement_floor'), { commitOnChange: true });
  const thicknessWallsInput = useDecimalInput('', commitElementNumericField('thickness_walls'), { commitOnChange: true });
  const groundLineHeightInput = useDecimalInput('', (value) => {
    const element = selection?.type === 'element' ? getElementById(selection.id) : null;
    if (!element || element.type !== 'BuildingElementGround') return;
    const extra = readExtraJsonRecord(element.extra_json);
    updateElement(element.id, {
      extra_json: {
        ...extra,
        [GROUND_LINE_HEIGHT_EXTRA_KEY]: typeof value === 'number' ? value : undefined,
      },
    } as Partial<Element>);
  }, { commitOnChange: true });
  const serviceLine = useServiceLineFormState({
    commitElementNumericField,
    selection,
    isExistingElementSelection,
    getElementById,
    commitExistingElementDraftRef,
    selectedElementV,
  });
  const widthInputSetValueRef = useRef(widthInput.syncValue);
  const heightInputSetValueRef = useRef(heightInput.syncValue);
  const areaInputSetValueRef = useRef(areaInput.syncValue);
  const midHeightInputSetValueRef = useRef(midHeightInput.syncValue);
  const maxWindowOpenAreaInputSetValueRef = useRef(maxWindowOpenAreaInput.syncValue);
  const totalAreaInputSetValueRef = useRef(totalAreaInput.syncValue);
  useEffect(() => {
    widthInputSetValueRef.current = widthInput.syncValue;
    heightInputSetValueRef.current = heightInput.syncValue;
    areaInputSetValueRef.current = areaInput.syncValue;
    midHeightInputSetValueRef.current = midHeightInput.syncValue;
    maxWindowOpenAreaInputSetValueRef.current = maxWindowOpenAreaInput.syncValue;
    totalAreaInputSetValueRef.current = totalAreaInput.syncValue;
  }, [
    areaInput.syncValue,
    heightInput.syncValue,
    maxWindowOpenAreaInput.syncValue,
    midHeightInput.syncValue,
    totalAreaInput.syncValue,
    widthInput.syncValue,
  ]);

  const numbersClose = useCallback((a: number | null | undefined, b: number | null | undefined, eps = 1e-6): boolean => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(a - b) <= eps;
  }, []);

  const handleDetailedJunctionHostReadinessAction = useCallback(
    (action: {
      elementId: string;
      kind: 'assembly_calculator' | 'open_host_element';
    }) => {
      const el = elementsById[action.elementId];
      if (!el || (el.type !== 'BuildingElementOpaque' && el.type !== 'BuildingElementGround')) {
        return;
      }
      setDormerAssemblySection(null);
      const selectionType = isGlobalObject(el) ? ('global' as const) : ('element' as const);
      setSelection({ type: selectionType, id: action.elementId });
      setSelectedElementIds([action.elementId]);
      if (action.kind === 'assembly_calculator') {
        setAssemblyCalculatorOpen(false);
        requestAnimationFrame(() => {
          setAssemblyCalculatorOpen(true);
        });
      } else {
        setAssemblyCalculatorOpen(false);
      }
    },
    [
      elementsById,
      setAssemblyCalculatorOpen,
      setDormerAssemblySection,
      setSelection,
      setSelectedElementIds,
    ],
  );

  // Derived base_height from floor Z-level and cumulative floor heights below.
  // Effective storey heights bake in wall-derived heights + user overrides.
  const derivedBaseHeight = useMemo(() => {
    const z = parseInt(elementFloorId, 10);
    if (isNaN(z) || z <= 0) return 0;
    return calculateDerivedBaseHeight(z, withEffectiveStoreyHeights(floors, allElements));
  }, [elementFloorId, floors, allElements]);

  const baseHeightResetTarget = useMemo(() => {
    if (selection?.type === 'element') {
      const el = elementsById[selection.id];
      if (el?.type === 'BuildingElementOpaque' && isExternalLineWall(el)) {
        const suspendedTarget = findSuspendedGroundSurfaceForLineElement(el, allElements);
        if (suspendedTarget) {
          return {
            value: roundToTwoDecimals(suspendedTarget.surfaceM),
            note: 'suspended floor upper surface',
            title: 'Reset to suspended floor upper surface',
          };
        }
        const basementTarget = findLinkedBasementGroundForLineElement(el, allElements);
        if (basementTarget) {
          const isUnheatedBasement = basementTarget.ground.floor_type === 'Unheated_basement';
          return {
            value: roundToTwoDecimals(basementTarget.targetBaseHeightM),
            note: isUnheatedBasement
              ? 'unheated basement wall height above ground'
              : 'basement floor surface',
            title: isUnheatedBasement
              ? 'Reset to unheated basement wall height'
              : 'Reset to basement floor surface',
          };
        }
      }
    }
    return derivedBaseHeight > 0
      ? {
          value: derivedBaseHeight,
          note: 'cumulative floor heights',
          title: 'Reset to height derived from floors below',
        }
      : null;
  }, [selection, elementsById, allElements, derivedBaseHeight]);

  // Soft host link: when the selected element is an OnSiteGeneration with `_pvHostRoofId`, expose
  // the derived base_height/pitch/orientation360 from that host roof so the UI can show a "From
  // <roof name>" hint and a Reset button.
  const onSiteHostDerivation = useMemo(() => {
    if (!selection || selection.type !== 'element') return null;
    const el = elementsById[selection.id];
    if (!el || el.type !== 'OnSiteGeneration') return null;
    const panel = el as OnSiteGeneration;
    const hostId = panel._pvHostRoofId;
    if (!hostId) return null;
    const host = elementsById[hostId];
    if (!host || host.type !== 'BuildingElementOpaque') return null;
    const derived = deriveFromHostRoof(
      panel,
      host as BuildingElementOpaque,
      withEffectiveStoreyHeights(floors, allElements),
    );
    return { hostId, hostName: host.name, derived };
  }, [selection, elementsById, floors, allElements]);

  const widthInputValue = widthInput.value;
  const heightInputValue = heightInput.value;
  const baseHeightInputValue = baseHeightInput.value;
  const freeAreaHeightInputValue = freeAreaHeightInput.value;

  /** Opening mid-height: base + height/2 (matches HEM / engine convention). */
  const derivedWindowMidHeight = useMemo(() => {
    const h = Number(heightInputValue) || 0;
    const baseM =
      typeof baseHeightInputValue === 'number' &&
      baseHeightInputValue > 0
        ? baseHeightInputValue
        : derivedBaseHeight;
    return calculateDerivedWindowMidHeight(baseM, h);
  }, [baseHeightInputValue, derivedBaseHeight, heightInputValue]);

  /** Max openable area from geometry: width x free-area height, capped by total window area. */
  const derivedWindowMaxOpenArea = useMemo(() => {
    const w = Number(widthInputValue) || 0;
    const h = Number(heightInputValue) || 0;
    const freeH = Number(freeAreaHeightInputValue) || 0;
    if (w <= 0 || freeH <= 0) return 0;
    const raw = w * freeH;
    const cap = h > 0 ? w * h : raw;
    return roundToTwoDecimals(Math.min(raw, cap));
  }, [freeAreaHeightInputValue, heightInputValue, widthInputValue]);

  const prevDerivedWindowMidHeightRef = useRef<number | null>(null);
  const prevDerivedWindowMaxOpenAreaRef = useRef<number | null>(null);

  // Keep derived window fields in sync while preserving manual overrides:
  // auto-update only when the current value still matches the previous derived value
  // (or is empty), so user-entered custom values are not clobbered.
  useEffect(() => {
    if (elementType !== 'BuildingElementTransparent') {
      prevDerivedWindowMidHeightRef.current = derivedWindowMidHeight;
      prevDerivedWindowMaxOpenAreaRef.current = derivedWindowMaxOpenArea;
      return;
    }

    const nextMid = derivedWindowMidHeight;
    const prevMid = prevDerivedWindowMidHeightRef.current;
    const currentMid = typeof midHeightInput.value === 'number' ? midHeightInput.value : null;
    const shouldSyncMid =
      !midHeightInput.isEditing &&
      (currentMid == null || currentMid <= 0 || prevMid == null || Math.abs(currentMid - prevMid) <= 0.005);
    if (nextMid > 0 && shouldSyncMid && (currentMid == null || Math.abs(currentMid - nextMid) > 0.005)) {
      midHeightInputSetValueRef.current(nextMid);
      // Repair legacy/stale saved values when the editor first opens. Normal edits are already
      // canonicalized in the store, so this branch is otherwise a no-op for existing elements.
      if (isExistingElementSelection()) {
        commitExistingElementDraftRef.current({ mid_height: nextMid });
      }
    }
    prevDerivedWindowMidHeightRef.current = nextMid;

    const nextOpenArea = derivedWindowMaxOpenArea;
    const prevOpenArea = prevDerivedWindowMaxOpenAreaRef.current;
    const currentOpenArea =
      typeof maxWindowOpenAreaInput.value === 'number' ? maxWindowOpenAreaInput.value : null;
    const shouldSyncOpenArea =
      !maxWindowOpenAreaInput.isEditing &&
      (
        currentOpenArea == null ||
        (nextOpenArea > 0 && currentOpenArea <= 0) ||
        prevOpenArea == null ||
        Math.abs(currentOpenArea - prevOpenArea) <= 0.005
      );
    if (
      shouldSyncOpenArea &&
      (currentOpenArea == null || Math.abs(currentOpenArea - nextOpenArea) > 0.005)
    ) {
      maxWindowOpenAreaInputSetValueRef.current(nextOpenArea);
      if (isExistingElementSelection()) {
        commitExistingElementDraftRef.current({ max_window_open_area: nextOpenArea });
      }
    }
    prevDerivedWindowMaxOpenAreaRef.current = nextOpenArea;
  }, [
    elementType,
    derivedWindowMidHeight,
    derivedWindowMaxOpenArea,
    midHeightInput.value,
    maxWindowOpenAreaInput.value,
    midHeightInput.isEditing,
    maxWindowOpenAreaInput.isEditing,
    isExistingElementSelection,
  ]);

  // Auto-fill base_height when floor changes and current value is 0 (new element or unset)
  useEffect(() => {
    const z = parseInt(elementFloorId, 10);
    if (isNaN(z) || z <= 0) return;
    if (baseHeightInput.isEditing) return;
    if (baseHeightInput.value !== 0 && baseHeightInput.value !== '') return;
    if (derivedBaseHeight > 0) {
      baseHeightInput.setValue(derivedBaseHeight);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementFloorId, derivedBaseHeight]);

  // Calculate current orientation based on global offset
  const getCurrentOrientation = (element: Element): number => {
    if (!('orientation360' in element) || element.orientation360 === undefined) {
      return 0;
    }

    // For walls, we need to recalculate the orientation based on current global offset
    if (
      (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') &&
      element.coordinates?.length === 2
    ) {
      // Get the element's coordinates to recalculate orientation
      const coordinates = element.coordinates;
      if (coordinates && coordinates.length >= 2) {
        const start = coordinates[0];
        const end = coordinates[1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;

        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
          return element.orientation360 || 0; // Degenerate case
        }

        // Recalculate the outward-facing orientation with the current global offset.
        const globalOffset = geometryStore.getState().globalOrientationOffset;
        const outwardOrientation = orientation360FromSegmentOutwardModelXY(start.x, start.y, end.x, end.y, 0);
        const recalculatedOrientation = ((outwardOrientation ?? (element.orientation360 || 0)) - globalOffset + 360) % 360;

        return recalculatedOrientation;
      }
    }

    // Sloped PV / sloped roof / sloped opaque·transparent polygon: derive from first edge (bottom), same as draw + polygon sync
    if (
      (element.type === 'OnSiteGeneration' ||
        element.type === 'BuildingElementOpaque' ||
        element.type === 'BuildingElementTransparent') &&
      element.coordinates &&
      element.coordinates.length >= 2
    ) {
      const pitch = (element as { pitch?: number }).pitch;
      if (pitch !== undefined && pitch > 0 && pitch < 90) {
        const start = element.coordinates[0];
        const end = element.coordinates[1];
        if (Math.abs(end.x - start.x) >= 0.01 || Math.abs(end.y - start.y) >= 0.01) {
          const recalculated =
            orientation360SlopedFromFirstEdge(
              start.x,
              start.y,
              end.x,
              end.y,
              geometryStore.getState().globalOrientationOffset,
            ) ?? element.orientation360;
          return recalculated ?? element.orientation360 ?? 0;
        }
      }
    }

    // For other elements, return stored value
    return element.orientation360;
  };

  const [orientation360, setOrientation360] = useKeyedState(
    selectedDraftKey,
    selectedDraftElement ? Math.round(getCurrentOrientation(selectedDraftElement)) : 0,
  );

  // Apply edited orientation360: rotate sloped polygons in plan (first-edge compass), or 2-point lines around the first endpoint
  const applyOrientationToGeometry = (desiredOrientationDeg: number) => {
    if (!selection || selection.type !== 'element') return;
    const el = getElementById(selection.id);
    if (!el || !el.coordinates || el.coordinates.length < 2) return;

    const shape = getElementShape(el as Element);
    if (shape === 'sloped-polygon' && el.coordinates.length >= 3) {
      const globalOffset = geometryStore.getState().globalOrientationOffset;
      const next = applyCompassOrientationToSlopedPolygonCoords(
        el.coordinates as Array<{ x: number; y: number; z: number }>,
        desiredOrientationDeg,
        globalOffset,
      );
      if (next) {
        updateElement(selection.id, { coordinates: next });
        return;
      }
      commitElementNumericField('orientation360')(desiredOrientationDeg);
      return;
    }

    if (el.coordinates.length !== 2) return;
    const [A, B] = el.coordinates as Array<{ x: number; y: number; z: number }>;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len <= 0) return;
    // `orientation360` for 2-point lines is the outward-facing compass bearing.
    const offset = geometryStore.getState().globalOrientationOffset;
    const desiredOutwardDeg = (desiredOrientationDeg + offset + 360) % 360;
    const desiredWallDirectionDeg = (180 - desiredOutwardDeg + 360) % 360; // mathematical tangent angle, 0=East
    const rad = desiredWallDirectionDeg * Math.PI / 180;
    const newB = { x: A.x + len * Math.cos(rad), y: A.y + len * Math.sin(rad), z: B.z };
    updateElement(selection.id, { coordinates: [A, newB] });
  };

  const roundToInt = (value: number) => Math.round(value ?? 0);

  // NEW: CSV v3 element state variables
  // WindowShading's own exclusive state (linkedWindow/shadingType/depthInput/
  // transparencyInput) now lives in its module (elementForms/windowShading.tsx).
  // distanceInput is shared with ContextShading and the not-yet-extracted wall
  // family (see ElementFormSharedCtx) and stays here.
  const distanceInput = useDecimalInput('', commitElementNumericField('distance'), { commitOnChange: true });

  // MechanicalVentilationDuctwork's exclusive state now lives in its module
  // (elementForms/mechanicalVentilationDuctwork.tsx).

  // MechanicalVentilationTerminal's exclusive state now lives in its module
  // (elementForms/mechanicalVentilationTerminal.tsx).

  // WetEmitter's subcategory/unitNumberInput exclusive state now lives in its
  // module (elementForms/wetEmitter.tsx). spaceHeatSystem stays here, bridged
  // to that module via ElementFormSharedCtx (see that field's doc comment and
  // the module's header "SEAM RESOLUTION" note): the picker callback below
  // both displays and writes it, and is defined/depended-on before the
  // module's own state would exist in render order, so it cannot receive that
  // state as a call-time argument. spaceHeatSystemOptions/
  // selectedSpaceHeatSystemForEmitter/handleEditSelectedWetEmitterSpaceHeatSystem
  // also stay here: they are consumed only by the orchestrator-owned
  // renderSpaceHeatSystemPicker callback (slice-5 brief decision (f).1), never
  // by the module's own renderPanel.
  const [spaceHeatSystem, setSpaceHeatSystem] = useState<string>('');
  const spaceHeatSystemOptions = useMemo(() => {
    const options = [{ value: '', label: 'Select a SpaceHeatSystem' }];
    for (const element of allElements) {
      if (
        element.type === 'System'
        && element.subcategory === 'SpaceHeatSystem'
        && !element.isPlaceholder
        && element.name
      ) {
        options.push({ value: element.name, label: element.name });
      }
    }
    if (spaceHeatSystem && !options.some((option) => option.value === spaceHeatSystem)) {
      options.push({ value: spaceHeatSystem, label: `${spaceHeatSystem} (missing)` });
    }
    options.push({ value: CREATE_SPACE_HEAT_SYSTEM_OPTION, label: 'Create new SpaceHeatSystem...' });
    return options;
  }, [allElements, spaceHeatSystem]);
  const selectedSpaceHeatSystemForEmitter = useMemo(() => {
    const systemName = spaceHeatSystem.trim();
    if (!systemName) return null;
    return allElements.find((element) => (
      element.type === 'System'
      && (element as { subcategory?: unknown }).subcategory === 'SpaceHeatSystem'
      && element.name === systemName
      && !element.isPlaceholder
    )) ?? null;
  }, [allElements, spaceHeatSystem]);
  const handleEditSelectedWetEmitterSpaceHeatSystem = useCallback(() => {
    if (!selectedSpaceHeatSystemForEmitter) return;
    setSelection({ type: 'element', id: selectedSpaceHeatSystemForEmitter.id });
    setSelectedElementIds([selectedSpaceHeatSystemForEmitter.id]);
  }, [selectedSpaceHeatSystemForEmitter, setSelection, setSelectedElementIds]);

  // WaterPipework's exclusive state now lives in its module
  // (elementForms/waterPipework.tsx).

  // ContextShading's exclusive state now lives in its module
  // (elementForms/contextShading.tsx).

  // Vents' exclusive state now lives in its module (elementForms/vents.tsx).

  // MechanicalVentilation's exclusive state now lives in its module
  // (elementForms/mechanicalVentilation.tsx).

  // MechanicalVentilationTerminal's own commit helpers/inputs now live in its
  // module (elementForms/mechanicalVentilationTerminal.tsx).

  // Vents' optimistic DISPLAY write when a parent wall/window is chosen — mirrors
  // the parent's pitch/orientation360 into the shared inputs so the panel shows the
  // inherited values immediately, without Vents reading/owning the shared pitch
  // state directly (see ElementFormSharedCtx).
  const applyParentPitchOrientationForDisplay = (
    parentPitch: number | undefined,
    parentOrientation: number | undefined,
  ) => {
    if (typeof parentPitch === 'number') setPitch(parentPitch);
    if (typeof parentOrientation === 'number') setOrientation360(parentOrientation);
  };

  const elementFormStateCtx = {
    elementType,
    commitElementNumericField,
    commitExistingElementDraft,
    applianceKeyOptions,
    selection,
    getElementById,
    updateElement,
    getGlobalOrientationOffset: () => geometryStore.getState().globalOrientationOffset,
    getCurrentOrientation,
    selectedElementV,
    shared: {
      heightInput,
      distanceInput,
      areaInput,
      parentElement,
      setParentElement,
      pitch,
      setPitch,
      orientation360,
      setOrientation360,
      applyOrientationToGeometry,
      applyParentPitchOrientationForDisplay,
      spaceHeatSystem,
      setSpaceHeatSystem,
    },
    elementIds,
    elementsById,
    serviceLine,
    workspaceResourcePort,
    getZoneNameForElementZoneId,
  };
  // ElectricBattery
  const electricBatteryFormState = electricBatteryFormModule.useFormState(elementFormStateCtx);
  // ThermalBridgeLinear
  const thermalBridgeLinearFormState = thermalBridgeLinearFormModule.useFormState(elementFormStateCtx);
  // ThermalBridgePoint
  const thermalBridgePointFormState = thermalBridgePointFormModule.useFormState(elementFormStateCtx);
  // Lighting
  const lightingFormState = lightingFormModule.useFormState(elementFormStateCtx);
  // Appliance
  const applianceFormState = applianceFormModule.useFormState(elementFormStateCtx);
  // HotWaterDemand
  const hotWaterDemandFormState = hotWaterDemandFormModule.useFormState(elementFormStateCtx);
  // CombustionAppliances
  const combustionAppliancesFormState = combustionAppliancesFormModule.useFormState(elementFormStateCtx);
  // OnSiteGeneration
  const onSiteGenerationFormState = onSiteGenerationFormModule.useFormState(elementFormStateCtx);
  // WindowShading
  const windowShadingFormState = windowShadingFormModule.useFormState(elementFormStateCtx);
  // ContextShading
  const contextShadingFormState = contextShadingFormModule.useFormState(elementFormStateCtx);
  // Vents
  const ventsFormState = ventsFormModule.useFormState(elementFormStateCtx);
  // MechanicalVentilation
  const mechanicalVentilationFormState = mechanicalVentilationFormModule.useFormState(elementFormStateCtx);
  // MechanicalVentilationDuctwork
  const mechanicalVentilationDuctworkFormState = mechanicalVentilationDuctworkFormModule.useFormState(elementFormStateCtx);
  // MechanicalVentilationTerminal
  const mechanicalVentilationTerminalFormState = mechanicalVentilationTerminalFormModule.useFormState(elementFormStateCtx);
  // WaterPipework
  const waterPipeworkFormState = waterPipeworkFormModule.useFormState(elementFormStateCtx);
  // WetEmitter
  const wetEmitterFormState = wetEmitterFormModule.useFormState(elementFormStateCtx);
  // System
  const systemFormState = systemFormModule.useFormState(elementFormStateCtx);
  const elementFormInstances = {
    ElectricBattery: bindElementFormModule(electricBatteryFormModule, electricBatteryFormState),
    ThermalBridgeLinear: bindElementFormModule(thermalBridgeLinearFormModule, thermalBridgeLinearFormState),
    ThermalBridgePoint: bindElementFormModule(thermalBridgePointFormModule, thermalBridgePointFormState),
    Lighting: bindElementFormModule(lightingFormModule, lightingFormState),
    Appliance: bindElementFormModule(applianceFormModule, applianceFormState),
    HotWaterDemand: bindElementFormModule(hotWaterDemandFormModule, hotWaterDemandFormState),
    CombustionAppliances: bindElementFormModule(combustionAppliancesFormModule, combustionAppliancesFormState),
    OnSiteGeneration: bindElementFormModule(onSiteGenerationFormModule, onSiteGenerationFormState),
    WindowShading: bindElementFormModule(windowShadingFormModule, windowShadingFormState),
    ContextShading: bindElementFormModule(contextShadingFormModule, contextShadingFormState),
    Vents: bindElementFormModule(ventsFormModule, ventsFormState),
    MechanicalVentilation: bindElementFormModule(mechanicalVentilationFormModule, mechanicalVentilationFormState),
    MechanicalVentilationDuctwork: bindElementFormModule(
      mechanicalVentilationDuctworkFormModule,
      mechanicalVentilationDuctworkFormState,
    ),
    MechanicalVentilationTerminal: bindElementFormModule(
      mechanicalVentilationTerminalFormModule,
      mechanicalVentilationTerminalFormState,
    ),
    WaterPipework: bindElementFormModule(waterPipeworkFormModule, waterPipeworkFormState),
    WetEmitter: bindElementFormModule(wetEmitterFormModule, wetEmitterFormState),
    System: bindElementFormModule(systemFormModule, systemFormState),
  } satisfies Partial<Record<ElementType, ElementFormInstance>>;

  // Floor-move base-height sync, shared across several families; OnSiteGeneration's
  // share now writes through its module state (see onSiteGeneration.tsx header).
  const syncFloorMoveHeightInputs = useCallback((heightPatch: {
    base_height?: number;
    _base_height?: number;
    mid_height?: number;
  } | null) => {
    if (!heightPatch) return;
    if (typeof heightPatch.base_height === 'number') {
      const nextBaseHeight = roundToTwoDecimals(heightPatch.base_height);
      baseHeightInput.setValue(nextBaseHeight);
      onSiteGenerationFormState.onSiteBaseHeightInput.setValue(nextBaseHeight);
    }
    if (typeof heightPatch._base_height === 'number') {
      adjacentViewerBaseHeightInput.setValue(roundToTwoDecimals(heightPatch._base_height));
    }
    if (typeof heightPatch.mid_height === 'number') {
      midHeightInput.setValue(roundToTwoDecimals(heightPatch.mid_height));
    }
  }, [adjacentViewerBaseHeightInput, baseHeightInput, midHeightInput, onSiteGenerationFormState.onSiteBaseHeightInput]);

  // System's own exclusive state now lives in its module (via systemFormState
  // above, elementForms/system.tsx) — see that module's header for the full
  // memo-partition writeup. isSystemElementType stays here (below) since
  // handleAdvancedFieldsChange (orchestrator-retained) still needs it.
  const elementFieldPresentation = createElementCreatorFieldPresentationResolver({
    mode: useFHSSchema ? 'fhs' : 'core',
    schemaPort,
    elementType,
    floorType: floorType || undefined,
    wetEmitterSubtype: wetEmitterFormState.subcategory || undefined,
    hotWaterSubtype: hotWaterDemandFormState.hotWaterSubcategory || undefined,
    ventilationSubtype: mechanicalVentilationFormState.ventType || undefined,
    systemSubtype: systemFormState.systemSubcategory || undefined,
    pitch,
    isExternalDoor,
  });
  const resolveElementFieldPresentation = elementFieldPresentation.resolve;
  const fieldUnit = elementFieldPresentation.unit;

  // Helper function to render a field label with tooltip and optional evidence pill
  const renderFieldLabel = (fieldLabel: string, targetElementType?: string, evidenceFieldKey?: string) => {
    const presentation = resolveElementFieldPresentation(
      fieldLabel,
      targetElementType,
      evidenceFieldKey,
    );
    const evPill = evidenceFieldKey
      ? evidenceBridge.renderFieldIndicator(evidenceFieldKey)
      : null;

    const labelContent = (
      <div className="element-label" style={{ fontWeight: 500, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{presentation?.label ?? fieldLabel}</span>
        {evPill}
      </div>
    );

    if (presentation?.tooltipInfo) {
      return (
        <Tooltip
          content={formatSchemaInfoForTooltip(presentation.tooltipInfo)}
          useFHSSchema={useFHSSchema}
          position="right"
          maxWidth={350}
        >
          {labelContent}
        </Tooltip>
      );
    }
    return labelContent;
  };

  // traceSystemFlow moved into elementForms/system.tsx's useFormState per
  // slice-5 brief decision (f).2 — that's now the primary/canonical copy,
  // used by the moved store-sync effect/commitSystemSelectionUpdate/
  // handlePcdbSystemApply. This reduced copy stays here only for
  // handleAdvancedFieldsChange below (CRITICAL EXCLUSION, orchestrator-
  // retained): it drops the localUiMode/localSubcategory/localSystemPreset
  // debug fields, which now live exclusively in the module's state and
  // aren't reachable from here. Dev-only console.debug instrumentation
  // behind window.__TRACE_SYSTEM_PCDB, no test coverage — see system.tsx's
  // module header for the full writeup of this one non-verbatim deviation.
  const traceSystemFlow = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      if (typeof window === 'undefined') return;
      if (((window as unknown) as Record<string, unknown>).__TRACE_SYSTEM_PCDB !== true) return;
      const currentSelection = selection;
      const selected = readSelectedSystemElement(
        currentSelection,
        (id) => getElementById(id) as {
          type?: unknown;
          extra_json?: unknown;
          system_preset?: unknown;
          subcategory?: unknown;
        } | undefined,
      );
      const selectedExtra =
        selected &&
        selected.extra_json &&
        typeof selected.extra_json === 'object' &&
        !Array.isArray(selected.extra_json)
          ? (selected.extra_json as Record<string, unknown>)
          : null;
      const hasStorePcdb =
        !!selectedExtra &&
        !!selectedExtra._pcdb &&
        typeof selectedExtra._pcdb === 'object' &&
        !Array.isArray(selectedExtra._pcdb);
      console.debug('[SystemTrace]', event, {
        at: new Date().toISOString(),
        selectionId: currentSelection?.id ?? null,
        selectionType: currentSelection?.type ?? null,
        selectionPlaceholder: !!currentSelection?.isPlaceholder,
        storeSystemPreset: selected ? (selected.system_preset ?? null) : null,
        storeHasPcdb: hasStorePcdb,
        ...payload,
      });
    },
    [selection, getElementById],
  );
  // selectedSystemElement (the narrower memo) moved entirely into
  // elementForms/system.tsx — its only consumers (systemSourceFromStore, the
  // store-sync effect) moved with it. selectedSystemElementFull stays here
  // too: the six selectedSpaceHeatSystem* memos below (all orchestrator-
  // retained — see system.tsx's module header for why) derive from it, while
  // the module re-derives its own separate copy for its renderPanel's PCDB
  // branch. See system.tsx's header for the full memo-partition table.
  const selectedSystemElementFull = useMemo(() => {
    void selectedElementV;
    if (elementType !== 'System') return null;
    if (!selection?.id || selection.isPlaceholder) return null;
    if (selection.type !== 'element' && selection.type !== 'global') return null;
    const element = getElementById(selection.id);
    return element?.type === 'System' ? element : null;
  }, [elementType, selection?.id, selection?.isPlaceholder, selection?.type, selectedElementV, getElementById]);
  const heatSourceWetReferenceOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const element of allElements) {
      const value = resolveHeatSourceWetReferenceName(element);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = element.name && element.name !== value ? `${element.name} (${value})` : value;
      options.push({ value, label });
    }
    return options;
  }, [allElements]);
  const singleHeatSourceWetReferenceName = useMemo(
    () => heatSourceWetReferenceOptions.length === 1 ? heatSourceWetReferenceOptions[0].value : null,
    [heatSourceWetReferenceOptions],
  );
  const selectedSpaceHeatSystemHeatSourceName = useMemo(() => {
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return '';
    const entry = firstRecordEntry(readExtraJsonRecord(selectedSystemElementFull.extra_json).SpaceHeatSystem);
    const heatSource = readExtraJsonRecord(entry?.[1]?.HeatSource);
    return typeof heatSource.name === 'string' ? heatSource.name : '';
  }, [selectedSystemElementFull]);
  const selectedSpaceHeatSystemType = useMemo(() => {
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return null;
    return firstSpaceHeatSystemType(selectedSystemElementFull.extra_json);
  }, [selectedSystemElementFull]);
  const selectedSpaceHeatSystemIsWetDistribution = useMemo(() => {
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return false;
    return (
      isWetDistributionSpaceHeatSystem(selectedSystemElementFull.extra_json) ||
      (
        selectedSpaceHeatSystemType === null &&
        selectedSystemElementFull.system_preset === DEFAULT_WET_DISTRIBUTION_PRESET_ID
      )
    );
  }, [selectedSpaceHeatSystemType, selectedSystemElementFull]);
  const selectedSpaceHeatSystemUsesHeatSourceWet = useMemo(() => {
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return false;
    return (
      selectedSpaceHeatSystemIsWetDistribution ||
      spaceHeatSystemUsesHeatSourceWet(selectedSystemElementFull.extra_json)
    );
  }, [selectedSpaceHeatSystemIsWetDistribution, selectedSystemElementFull]);
  const selectedSpaceHeatSystemHeatSourceElement = useMemo(() => {
    if (!selectedSpaceHeatSystemHeatSourceName) return null;
    return allElements.find((element) => (
      resolveHeatSourceWetReferenceName(element) === selectedSpaceHeatSystemHeatSourceName
    )) ?? null;
  }, [allElements, selectedSpaceHeatSystemHeatSourceName]);
  const selectedSpaceHeatSystemLinkedEmitterElements = useMemo(() => {
    if (!selectedSpaceHeatSystemIsWetDistribution) return [];
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return [];
    const systemName = selectedSystemElementFull.name;
    return allElements
      .filter((element) => element.type === 'WetEmitter' && (element as { space_heat_system?: string }).space_heat_system === systemName)
      .filter((element) => !element.isPlaceholder);
  }, [allElements, selectedSpaceHeatSystemIsWetDistribution, selectedSystemElementFull]);
  const selectedSpaceHeatSystemAvailableEmitterElements = useMemo(() => {
    if (!selectedSpaceHeatSystemIsWetDistribution) return [];
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return [];
    const systemZoneId = selectedSystemElementFull.zoneId || '';
    return allElements.filter((element) => {
      if (element.type !== 'WetEmitter' || element.isPlaceholder) return false;
      if (systemZoneId && element.zoneId !== systemZoneId) return false;
      const linkedSystem = (element as { space_heat_system?: string }).space_heat_system?.trim() ?? '';
      return linkedSystem === '';
    });
  }, [allElements, selectedSpaceHeatSystemIsWetDistribution, selectedSystemElementFull]);
  // systemSourceFromStore/systemUiModeFromStore, commitSystemSelectionUpdate,
  // and the "System UI mode follows persisted source-of-truth" store-sync
  // effect all moved into elementForms/system.tsx's useFormState (slice-5
  // brief decision (f).2) — see that module's header. withSystemSourceMeta
  // below is the one small pure helper duplicated in both files (this copy
  // for createSpaceHeatSystemForCurrentEmitter just below, which stays
  // orchestrator-owned per decision (f).1's CONSERVATIVE six).
  const withSystemSourceMeta = useCallback(
    (extraJson: Record<string, unknown> | null | undefined, source: SystemElementSource): Record<string, unknown> | null => {
      if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) return null;
      return { ...extraJson, [SYSTEM_SOURCE_META_KEY]: source };
    },
    [],
  );

  const createSpaceHeatSystemForCurrentEmitter = useCallback(async () => {
    if (!isExistingElementSelection()) return;
    const current = getElementById(selection.id);
    if (!current || current.type !== 'WetEmitter') return;

    const currentZone = current.zoneId ? getZoneById(current.zoneId) : undefined;
    const zonePrefix = currentZone?.name?.trim() ? `${currentZone.name.trim()} ` : '';
    const emitterTypeLabel =
      current.subcategory === 'ufh'
        ? 'UFH'
        : current.subcategory === 'fancoil'
          ? 'fan coil'
          : 'radiator';
    const existingSystemNames = allElements
      .filter((element) => element.type === 'System')
      .map((element) => element.name)
      .filter(Boolean);
    const systemName = generateUniqueElementName(
      `${zonePrefix}${emitterTypeLabel} system`,
      existingSystemNames,
    );

    const dir = SYSTEM_SUBCATEGORY_TO_DIR.SpaceHeatSystem;
    try {
      const raw = await workspaceResourcePort.readText(
        `input/batch_parameters/${dir}/${DEFAULT_WET_DISTRIBUTION_PRESET_ID}.json`,
      );
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const zoneName = currentZone?.name?.trim() || null;
      const extraJson = withSystemSourceMeta(
        buildSpaceHeatSystemPresetExtraJson(
          parsed,
          systemName,
          zoneName,
          singleHeatSourceWetReferenceName,
        ),
        'presets',
      ) ?? {
        [SYSTEM_SOURCE_META_KEY]: 'presets',
      };
      const anchor = current.coordinates?.[0] ?? { x: 0, y: 0, z: 0 };
      addElement({
        name: systemName,
        type: 'System',
        subcategory: 'SpaceHeatSystem',
        system_preset: DEFAULT_WET_DISTRIBUTION_PRESET_ID,
        zoneId: current.zoneId,
        coordinates: [{
          x: anchor.x + 0.75,
          y: anchor.y + 0.75,
          z: anchor.z ?? 0,
        }],
        parent_element: null,
        extra_json: extraJson,
      } as Omit<Element, 'id'>);
      setSpaceHeatSystem(systemName);
      updateElement(current.id, { space_heat_system: systemName } as Partial<Element>);
    } catch (error) {
      console.warn('[WetEmitter] Failed to create SpaceHeatSystem from preset', error);
      alert(`Failed to create SpaceHeatSystem from "${DEFAULT_WET_DISTRIBUTION_PRESET_ID}".`);
    }
  }, [
    addElement,
    allElements,
    getElementById,
    getZoneById,
    selection,
    isExistingElementSelection,
    singleHeatSourceWetReferenceName,
    updateElement,
    withSystemSourceMeta,
    workspaceResourcePort,
  ]);

  const handleSpaceHeatSystemDropdownChange = useCallback(
    (value: string) => {
      if (value === CREATE_SPACE_HEAT_SYSTEM_OPTION) {
        void createSpaceHeatSystemForCurrentEmitter();
        return;
      }
      const nextValue = value || '';
      setSpaceHeatSystem(nextValue);
      commitExistingElementDraftRef.current({ space_heat_system: nextValue || undefined } as Partial<Element>);
    },
    [createSpaceHeatSystemForCurrentEmitter],
  );

  // The preset-options-loading effect, systemPresetDropdownOptions, and
  // selectedSystemPresetLabel all moved into elementForms/system.tsx's
  // useFormState — their only consumer was System's own renderPanel, now
  // module-owned.

  const isSystemElementType = elementType === 'System';

  // systemSwitchNeedsWarning, applySystemSubcategoryChange/
  // handleSystemSubcategoryChange, applySystemPresetChange/
  // handleSystemPresetChange all moved into elementForms/system.tsx's
  // useFormState — see that module's header.
  //
  // handleSpaceHeatSystemHeatSourceChange below is a deliberate exception to
  // the brief's per-family inventory (which listed it as moving too): it
  // shares one JSX flex-row with handleEditSelectedSpaceHeatSystemHeatSource
  // (decision (f).1's CONSERVATIVE six, orchestrator-only) and can't be
  // split from it without fragmenting that row across the module boundary —
  // see the widened renderSpaceHeatSystemEmitterManager below and
  // system.tsx's module header for the full writeup.
  const handleSpaceHeatSystemHeatSourceChange = useCallback(
    (value: string) => {
      if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return;
      if (!selectedSpaceHeatSystemUsesHeatSourceWet) return;
      const nextExtraJson = updateSpaceHeatSystemHeatSourceNameInExtraJson(
        selectedSystemElementFull.extra_json,
        selectedSystemElementFull.name || 'Space heating',
        value,
      );
      nextExtraJson[SYSTEM_SOURCE_META_KEY] = 'custom';
      systemFormState.setSystemExtraJson(nextExtraJson);
      updateElement(selectedSystemElementFull.id, {
        extra_json: nextExtraJson,
      } as Partial<Element>);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- systemFormState itself is a fresh object every render (elementForms/system.tsx's useFormState returns a plain object literal, not memoized); systemFormState.setSystemExtraJson is the stable useState setter within it, already listed.
    [selectedSpaceHeatSystemUsesHeatSourceWet, selectedSystemElementFull, updateElement, systemFormState.setSystemExtraJson],
  );

  const handleEditSelectedSpaceHeatSystemHeatSource = useCallback(() => {
    if (!selectedSpaceHeatSystemHeatSourceElement) return;
    setSelection({ type: 'element', id: selectedSpaceHeatSystemHeatSourceElement.id });
    setSelectedElementIds([selectedSpaceHeatSystemHeatSourceElement.id]);
  }, [selectedSpaceHeatSystemHeatSourceElement, setSelection, setSelectedElementIds]);

  const handleSpaceHeatSystemEmitterToggle = useCallback(
    (emitterId: string, checked: boolean) => {
      if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return;
      if (!selectedSpaceHeatSystemIsWetDistribution) return;
      const emitter = allElements.find((element) => element.id === emitterId && element.type === 'WetEmitter');
      if (!emitter) return;
      updateElement(emitter.id, {
        space_heat_system: checked ? selectedSystemElementFull.name : undefined,
      } as Partial<Element>);
    },
    [allElements, selectedSpaceHeatSystemIsWetDistribution, selectedSystemElementFull, updateElement],
  );

  const handleCreateRadiatorForSelectedSpaceHeatSystem = useCallback(() => {
    if (!selectedSystemElementFull || selectedSystemElementFull.subcategory !== 'SpaceHeatSystem') return;
    if (!selectedSpaceHeatSystemIsWetDistribution) return;
    const systemName = selectedSystemElementFull.name?.trim();
    if (!systemName) return;

    const existingNames = allElements
      .map((element) => element.name)
      .filter((name): name is string => Boolean(name));
    const radiatorName = generateUniqueElementName('Radiator', existingNames);
    const anchor = selectedSystemElementFull.coordinates?.[0] ?? { x: 0, y: 0, z: 0 };
    const z = typeof anchor.z === 'number' && Number.isFinite(anchor.z) ? anchor.z : 0;
    const y = typeof anchor.y === 'number' && Number.isFinite(anchor.y) ? anchor.y : 0;
    const x = typeof anchor.x === 'number' && Number.isFinite(anchor.x) ? anchor.x : 0;
    const zoneId = selectedSystemElementFull.zoneId || elementZoneId || undefined;
    const floorId = selectedSystemElementFull.floorId || elementFloorId || undefined;

    addElement({
      name: radiatorName,
      type: 'WetEmitter',
      subcategory: 'radiator',
      zoneId,
      floorId,
      parent_element: null,
      coordinates: [
        { x: x + 0.75, y, z },
        { x: x + 1.75, y, z },
      ],
      unit_number: 1,
      space_heat_system: systemName,
    } as Omit<Element, 'id'>);

    setTimeout(() => {
      const state = geometryStore.getState();
      const created = state.elementIds
        .map((id) => state.elementsById[id])
        .find((element) => element?.type === 'WetEmitter' && element.name === radiatorName);
      if (!created) return;
      state.setSelection({ type: 'element', id: created.id });
      state.setSelectedElementIds([created.id]);
    }, 0);
  }, [
    addElement,
    allElements,
    elementFloorId,
    elementZoneId,
    geometryStore,
    selectedSpaceHeatSystemIsWetDistribution,
    selectedSystemElementFull,
  ]);

  // handlePcdbSystemApply, clearSystemToPcdbShell,
  // applyFirstSamplePresetAfterPcdb, requestSystemUiMode, and
  // confirmSystemSourceSwitch all moved into elementForms/system.tsx's
  // useFormState — see that module's header. The orchestrator reads the
  // module's own confirmSystemSourceSwitch via systemFormState (see the
  // DeleteConfirmModal in the JSX tail below).

  const hasAppliedPcdbSystemData = useMemo(() => {
    void selectedElementV;
    const productCatalogue = inspectorContributions.productCatalogue;
    if (elementType !== 'System' || !productCatalogue) return false;
    if (!selection?.id || selection.isPlaceholder) return false;
    if (selection.type !== 'element' && selection.type !== 'global') return false;
    const el = getElementById(selection.id) as { type?: string; extra_json?: unknown } | undefined;
    if (!el || el.type !== 'System') return false;
    return productCatalogue.hasAppliedSystemData(el.extra_json);
  }, [
    elementType,
    inspectorContributions.productCatalogue,
    selection?.id,
    selection?.isPlaceholder,
    selection?.type,
    selectedElementV,
    getElementById,
  ]);

  // ── Element presets (for Opaque / Transparent) ──────────────────────────────
  const [elementPreset, setElementPreset] = useState<string>('');
  const [elementPresetOptionsVersion, setElementPresetOptionsVersion] = useState(0);
  const elementPresetOptionsKey = PRESET_ELEMENT_TYPES.includes(elementType)
    ? `${elementType}\0${elementPresetOptionsVersion}`
    : 'unsupported';
  const emptyElementPresetOptions = useMemo<Array<{
    value: string;
    label: string;
    source: 'system' | 'user';
  }>>(() => [], []);
  const [elementPresetOptions, setElementPresetOptions] = useKeyedState(
    elementPresetOptionsKey,
    emptyElementPresetOptions,
  );
  const prevLoadedSelectionIdRef = useRef<string | null>(null);
  const lateNumericInputSettersRef = useRef({
    freeAreaFraction: (value: number | '') => { void value; },
    dormerWidth: (value: number | '') => { void value; },
    dormerFrontWallHeight: (value: number | '') => { void value; },
    dormerRoofPitch: (value: number | '') => { void value; },
    gableRoofPitch: (value: number | '') => { void value; },
    dormerWindowWidth: (value: number | '') => { void value; },
    dormerWindowHeight: (value: number | '') => { void value; },
    dormerWindowSillHeight: (value: number | '') => { void value; },
    dormerFrameAreaFraction: (value: number | '') => { void value; },
  });
  const resetFormFieldsRef = useRef<() => void>(() => undefined);

  // Build preset options by scanning files. The manifest only marks library-owned files.
  useEffect(() => {
    if (!PRESET_ELEMENT_TYPES.includes(elementType)) return;
    let cancelled = false;
    (async () => {
      const options = (
        await listElementPresetOptions(workspaceResourcePort, elementType)
      ).map((option) => ({
        value: option.id,
        label: option.label,
        source: option.source === 'library' ? 'system' as const : 'user' as const,
      }));
      if (!cancelled) {
        setElementPresetOptions(options);
        // Don't clear elementPreset here — the "load element data" effect
        // already restores/clears it based on extra_json._element_preset.
        // Clearing here would race with the restore and wipe a valid preset.
      }
    })();
    return () => { cancelled = true; };
  }, [elementPresetOptionsKey, elementType, setElementPresetOptions, workspaceResourcePort]);

  // Apply element preset: load file on-demand, write to store immediately,
  // and keep the local form state aligned with the applied values.
  const applyElementPreset = async (presetKey: string) => {
    if (!selection || !(selection.type === 'element' || selection.type === 'global') || !selection.id) return;

    try {
      const raw = await workspaceResourcePort.readText(
        `input/batch_parameters/element_presets/${presetKey}.json`,
      );
      const data = JSON.parse(raw);

      // Separate metadata + extra_json from top-level element properties
      const { extra_json: presetExtraJson, ...metadataAndTopLevelProps } = data;
      const topLevelProps = { ...metadataAndTopLevelProps };
      delete topLevelProps.type;
      delete topLevelProps.label;
      delete topLevelProps.source;
      delete topLevelProps.security_risk;

      const storeUpdate: Record<string, any> = { ...topLevelProps };

      // Auto-compute area for transparent elements (width * height)
      if (data.type === 'BuildingElementTransparent' && data.width != null && data.height != null) {
        storeUpdate.area = data.width * data.height;
      }

      // Deep-merge preset extra_json with existing element extra_json (preserve user edits)
      // Also persist the preset key so the dropdown can be restored on re-select
      const existingElement = getElementById(selection.id);
      const existingExtraJson = (existingElement as any)?.extra_json || {};
      storeUpdate.extra_json = {
        ...existingExtraJson,
        ...(presetExtraJson && typeof presetExtraJson === 'object' ? presetExtraJson : {}),
        _element_preset: presetKey,
      };

      if (
        data.type === 'OnSiteGeneration' &&
        existingElement &&
        (existingElement as any).coordinates?.length >= 2
      ) {
        const { longM, shortM } = getPvFootprintDimensionsFromPreset(data);
        const flags = readPvFootprintFlags(storeUpdate.extra_json);
        storeUpdate.coordinates = rebuildPvRectangleFromBottomEdge(
          (existingElement as any).coordinates[0],
          (existingElement as any).coordinates[1],
          longM,
          shortM,
          flags.flipUpslope,
          flags.bottomIsLong,
          typeof storeUpdate.pitch === 'number'
            ? storeUpdate.pitch
            : typeof (existingElement as any).pitch === 'number'
              ? (existingElement as any).pitch
              : undefined,
        );
      }

      updateElement(selection.id, storeUpdate);
      setElementPreset(presetKey);

      if (typeof storeUpdate.width === 'number') widthInput.setValue(roundToTwoDecimals(storeUpdate.width));
      if (typeof storeUpdate.height === 'number') heightInput.setValue(roundToTwoDecimals(storeUpdate.height));
      if (typeof storeUpdate.pitch === 'number') setPitch(storeUpdate.pitch);
      if (typeof storeUpdate.base_height === 'number') baseHeightInput.setValue(roundToTwoDecimals(storeUpdate.base_height));
      if (typeof storeUpdate.frame_area_fraction === 'number') {
        lateNumericInputSettersRef.current.freeAreaFraction(
          roundToTwoDecimals(storeUpdate.frame_area_fraction),
        );
      }
      if (typeof storeUpdate.free_area_height === 'number') freeAreaHeightInput.setValue(roundToTwoDecimals(storeUpdate.free_area_height));
      if (typeof storeUpdate.mid_height === 'number') midHeightInput.setValue(roundToTwoDecimals(storeUpdate.mid_height));
      if (typeof storeUpdate.max_window_open_area === 'number') maxWindowOpenAreaInput.setValue(roundToTwoDecimals(storeUpdate.max_window_open_area));
      if (typeof storeUpdate.is_unheated_pitched_roof === 'boolean') setIsUnheatedPitchedRoof(storeUpdate.is_unheated_pitched_roof);
      if (typeof storeUpdate.is_external_door === 'boolean') setIsExternalDoor(storeUpdate.is_external_door);
      if (data.type === 'OnSiteGeneration') {
        if (typeof storeUpdate.peak_power === 'number') onSiteGenerationFormState.peakPowerInput.setValue(roundToTwoDecimals(storeUpdate.peak_power));
        if (typeof storeUpdate.pitch === 'number') onSiteGenerationFormState.onSitePitchInput.setValue(storeUpdate.pitch);
        if (typeof storeUpdate.orientation360 === 'number') onSiteGenerationFormState.onSiteOrientationInput.setValue(Math.round(storeUpdate.orientation360));
        if (typeof storeUpdate.base_height === 'number') onSiteGenerationFormState.onSiteBaseHeightInput.setValue(roundToTwoDecimals(storeUpdate.base_height));
        if (typeof storeUpdate.width === 'number') onSiteGenerationFormState.onSiteWidthInput.setValue(roundToTwoDecimals(storeUpdate.width));
        if (typeof storeUpdate.height === 'number') onSiteGenerationFormState.onSiteHeightInput.setValue(roundToTwoDecimals(storeUpdate.height));
      }
    } catch (e) {
      console.warn(`[ElementPresets] Failed to load preset ${presetKey}`, e);
    }
  };

  // ── Save / update element presets ───────────────────────────────────────────
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetLabelInput, setPresetLabelInput] = useState('');
  const presetLabelInputRef = useRef<HTMLInputElement>(null);

  // Build the preset JSON payload from the current element
  const buildPresetJson = (el: any, label: string): Record<string, any> | null => {
    let presetJson: Record<string, any>;
    if (el.type === 'BuildingElementOpaque') {
      presetJson = {
        type: el.type, label, source: 'user',
        height: el.height, pitch: el.pitch, base_height: el.base_height,
        is_unheated_pitched_roof: el.is_unheated_pitched_roof ?? false,
        is_external_door: el.is_external_door ?? false,
      };
    } else if (el.type === 'BuildingElementTransparent') {
      presetJson = {
        type: el.type, label, source: 'user',
        height: el.height, width: el.width, pitch: el.pitch,
        base_height: el.base_height, frame_area_fraction: el.frame_area_fraction,
        free_area_height: el.free_area_height, mid_height: el.mid_height,
        max_window_open_area: el.max_window_open_area,
      };
    } else if (el.type === 'OnSiteGeneration') {
      presetJson = {
        type: el.type,
        label,
        source: 'user',
        generation_type: el.generation_type ?? 'PhotovoltaicSystem',
        peak_power: el.peak_power,
        pitch: el.pitch,
        orientation360: el.orientation360,
        base_height: el.base_height,
        width: el.width,
        height: el.height,
      };
    } else {
      return null;
    }
    if (el.extra_json && typeof el.extra_json === 'object') {
      const cleanExtra = { ...el.extra_json };
      delete cleanExtra._element_preset;
      if (Object.keys(cleanExtra).length > 0) {
        presetJson.extra_json = cleanExtra;
      }
    }
    return presetJson;
  };

  const handleSaveAsPreset = () => {
    if (!selection || !selection.id) return;
    setPresetLabelInput('');
    setIsSavingPreset(true);
    setTimeout(() => presetLabelInputRef.current?.focus(), 50);
  };

  const confirmSavePreset = async () => {
    const label = presetLabelInput.trim();
    if (!label || !selection?.id) {
      setIsSavingPreset(false);
      return;
    }
    try {
      const element = getElementById(selection.id);
      if (!element) throw new Error('Element not found');
      const el = element as any;

      const presetKey = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      if (!presetKey) {
        console.warn('[ElementPresets] Label produced an empty filename');
        setIsSavingPreset(false);
        return;
      }
      const filename = presetKey + '.json';
      const presetJson = buildPresetJson(el, label);
      if (!presetJson) { setIsSavingPreset(false); return; }

      await workspaceResourcePort.ensureDirectory('input/batch_parameters/element_presets');
      await workspaceResourcePort.writeText(
        `input/batch_parameters/element_presets/${filename}`,
        JSON.stringify(presetJson, null, 2)
      );

      /**
       * Re-read at apply time. `el` was read before the two awaited workspace writes above, so
       * merging the preset key into *its* `extra_json` would revert anything written during that
       * window (an adopted thermal-bridge solve, an assembly apply, a JsonForms edit).
       */
      const existingExtraJson = readExtraJsonRecord(getElementById(selection.id)?.extra_json);
      updateElement(selection.id, {
        extra_json: { ...existingExtraJson, _element_preset: presetKey },
      });
      setElementPresetOptionsVersion((version) => version + 1);
      setElementPreset(presetKey);
    } catch (e) {
      console.warn('[ElementPresets] Failed to save preset', e);
    } finally {
      setIsSavingPreset(false);
    }
  };

  // Update the currently selected user preset in-place with current element values
  const handleUpdatePreset = async () => {
    if (!elementPreset || !selection?.id) return;
    const opt = elementPresetOptions.find(o => o.value === elementPreset);
    if (!opt || opt.source !== 'user') return;
    try {
      const element = getElementById(selection.id);
      if (!element) return;
      const presetJson = buildPresetJson(element as any, opt.label);
      if (!presetJson) return;

      await workspaceResourcePort.writeText(
        `input/batch_parameters/element_presets/${elementPreset}.json`,
        JSON.stringify(presetJson, null, 2)
      );
      // Refresh options so the dropdown reflects any field changes
      setElementPresetOptionsVersion((version) => version + 1);
    } catch (e) {
      console.warn('[ElementPresets] Failed to update preset', e);
    }
  };

  // ── Delete a user preset ───────────────────────────────────────────────────
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null);

  const handleDeletePreset = (presetKey: string) => {
    setPresetToDelete(presetKey);
  };

  const confirmDeletePreset = async () => {
    const presetKey = presetToDelete;
    if (!presetKey) return;
    setPresetToDelete(null);
    try {
      const filename = presetKey + '.json';

      // Delete the file
      await workspaceResourcePort.removeFile(
        `input/batch_parameters/element_presets/${filename}`,
      );

      // Clear selection if this was the active preset
      if (elementPreset === presetKey) {
        setElementPreset('');
        if (selection?.id) {
          const el = getElementById(selection.id) as any;
          if (el?.extra_json?._element_preset === presetKey) {
            const rest = { ...el.extra_json };
            delete rest._element_preset;
            updateElement(selection.id, { extra_json: rest });
          }
        }
      }

      setElementPresetOptionsVersion((version) => version + 1);
    } catch (e) {
      console.warn('[ElementPresets] Failed to delete preset', e);
    }
  };

  // Load element data when selected
  /* eslint-disable react-hooks/set-state-in-effect -- Selection changes intentionally hydrate the complete inspector draft in one transaction. */
  useEffect(() => {
    if (!selection) {
      return;
    }
    if (selection.type === 'element' && selection.id) {
      const element = getElementById(selection.id);

      if (element) {
        // Reset all fields first, before setting any values
        resetFormFieldsRef.current();
        // Restore or clear preset dropdown depending on whether this is a new selection
        const isNewSelection = selection.id !== prevLoadedSelectionIdRef.current;
        if (isNewSelection) {
          // Restore preset from extra_json if the element was created/edited with one
          const storedPreset = (element as any).extra_json?._element_preset;
          setElementPreset(typeof storedPreset === 'string' ? storedPreset : '');
          prevLoadedSelectionIdRef.current = selection.id;
        }

        // Now set the element data
        setElementName(getDormerBundleName(element) || element.name);
        setElementType(element.type as ElementType);
        if (element.type !== 'Vents') {
          setElementZoneId(element.zoneId || ''); // Handle undefined zoneId
        }
        setElementFloorId(element.floorId || ''); // Set floor assignment
        elementElevationInput.setValue(readViewerElevationValue(element));
        // Keep floorId aligned with the element geometry on load so the visible floor row
        // and the derived base-height helper use the same source of truth.
        try {
          const buildingElementTypes: ElementType[] = ['BuildingElementOpaque','BuildingElementTransparent','BuildingElementGround','BuildingElementAdjacentConditionedSpace','BuildingElementAdjacentUnconditionedSpace_Simple','BuildingElementPartyWall'];
          if (buildingElementTypes.includes(element.type as ElementType)) {
            const z = element?.coordinates?.[0]?.z;
            const zInt = typeof z === 'number' ? Math.floor(z) : undefined;
            if (zInt !== undefined) {
              const syncedFloorId = String(zInt);
              if (element.floorId !== syncedFloorId) {
                updateElement(element.id, { floorId: syncedFloorId });
              }
              setElementFloorId(syncedFloorId);
            }
          }
        } catch { /* swallow: best-effort */ }

        // Set fields based on element type
        if (element.type === 'BuildingElementOpaque' || element.type === 'BuildingElementTransparent') {
          // Round numeric values to 2dp when loading from file
          const width = 'width' in element && typeof element.width === 'number' ? roundToTwoDecimals(element.width) : (element.width ?? '');
          const height = 'height' in element && typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
          const area = 'area' in element && typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
          const pitch = 'pitch' in element && typeof element.pitch === 'number' ? element.pitch : (element.pitch ?? 90);
          const orientation = roundToInt(getCurrentOrientation(element));
          const baseHeight = 'base_height' in element && typeof element.base_height === 'number' ? roundToTwoDecimals(element.base_height) : (element.base_height ?? '');

          widthInput.setValue(width);
          heightInput.setValue(height);
          setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
          areaInput.setValue(area);
          setPitch(pitch);
          setOrientation360(orientation);
          baseHeightInput.setValue(baseHeight);

          // Window-specific fields (only for BuildingElementTransparent)
          if (element.type === 'BuildingElementTransparent') {
            const frameAreaFraction = 'frame_area_fraction' in element && typeof element.frame_area_fraction === 'number'
              ? roundToTwoDecimals(element.frame_area_fraction) : (element.frame_area_fraction ?? '');
            const freeAreaHeight = 'free_area_height' in element && typeof element.free_area_height === 'number'
              ? roundToTwoDecimals(element.free_area_height) : (element.free_area_height ?? '');
            const midHeight = 'mid_height' in element && typeof element.mid_height === 'number'
              ? roundToTwoDecimals(element.mid_height) : (element.mid_height ?? '');
            const maxWindowOpenArea = 'max_window_open_area' in element && typeof element.max_window_open_area === 'number'
              ? roundToTwoDecimals(element.max_window_open_area) : (element.max_window_open_area ?? '');

            lateNumericInputSettersRef.current.freeAreaFraction(frameAreaFraction);
            freeAreaHeightInput.setValue(freeAreaHeight);
            midHeightInput.setValue(midHeight);
            maxWindowOpenAreaInput.setValue(maxWindowOpenArea);

            const storeSnapshot = geometryStore.getState();
            const transparentDerived = deriveTransparentOpeningDerivedValues(
              element,
              {},
              {
                effectiveFloors: withEffectiveStoreyHeights(
                  storeSnapshot.floors || [],
                  Object.values(storeSnapshot.elementsById || {}),
                ),
              },
            );
            prevDerivedWindowMidHeightRef.current = transparentDerived.midHeight;
            prevDerivedWindowMaxOpenAreaRef.current = transparentDerived.maxWindowOpenArea;
          }

          if (element.type === 'BuildingElementOpaque') {
            setIsUnheatedPitchedRoof(!!(element as any).is_unheated_pitched_roof);
            setIsExternalDoor(!!(element as any).is_external_door);
            unheatedPitchedRoofCeilingElevationInput.setValue(
              readAuthoredUnheatedPitchedRoofCeilingElevationM(element) ?? '',
            );

            const dormerMetadata = getDormerBundleMetadata(element);
            if (dormerMetadata) {
              setSelectedDormerType(dormerMetadata.dormerType);
              lateNumericInputSettersRef.current.dormerWidth(roundToTwoDecimals(dormerMetadata.dormerWidth));
              setDormerDepth(roundToTwoDecimals(dormerMetadata.dormerDepth));
              lateNumericInputSettersRef.current.dormerFrontWallHeight(roundToTwoDecimals(dormerMetadata.frontWallHeight));
              lateNumericInputSettersRef.current.dormerRoofPitch(dormerMetadata.dormerRoofPitch);
              lateNumericInputSettersRef.current.gableRoofPitch(dormerMetadata.gableRoofPitch);
              setDormerRoofIsUnheatedPitchedRoof(!!dormerMetadata.isUnheatedPitchedRoof);
              lateNumericInputSettersRef.current.dormerWindowWidth(roundToTwoDecimals(dormerMetadata.windowWidth));
              lateNumericInputSettersRef.current.dormerWindowHeight(roundToTwoDecimals(dormerMetadata.windowHeight));
              lateNumericInputSettersRef.current.dormerWindowSillHeight(roundToTwoDecimals(dormerMetadata.windowSillHeight));
              lateNumericInputSettersRef.current.dormerFrameAreaFraction(roundToTwoDecimals(dormerMetadata.frameAreaFraction));
            }
          }
        } else if (element.type === 'BuildingElementGround') {
          // Round numeric values to 2dp when loading from file
          const width = 'width' in element && typeof element.width === 'number' ? roundToTwoDecimals(element.width) : (element.width ?? '');
          const height = 'height' in element && typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
          const area = 'area' in element && typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
          const totalArea = 'total_area' in element && typeof element.total_area === 'number' ? roundToTwoDecimals(element.total_area) : (element.total_area ?? '');
          const perimeter = 'perimeter' in element && typeof element.perimeter === 'number' ? roundToTwoDecimals(element.perimeter) : (element.perimeter ?? '');
          const depthBasementFloor = 'depth_basement_floor' in element && typeof element.depth_basement_floor === 'number'
            ? roundToTwoDecimals(element.depth_basement_floor) : (element.depth_basement_floor ?? '');
          const thicknessWalls = 'thickness_walls' in element && typeof element.thickness_walls === 'number'
            ? roundToTwoDecimals(element.thickness_walls) : (element.thickness_walls ?? '');
          const extra = readExtraJsonRecord((element as any).extra_json);
          const groundLineHeight = readFiniteNumber(extra[GROUND_LINE_HEIGHT_EXTRA_KEY]) ?? '';

          widthInput.setValue(width);
          heightInput.setValue(height);
          setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
          areaInput.setValue(area);
          totalAreaInput.setValue(totalArea);
          perimeterInput.setValue(perimeter);
          setFloorType('floor_type' in element ? element.floor_type ?? '' : '');
          depthBasementFloorInput.setValue(depthBasementFloor);
          thicknessWallsInput.setValue(thicknessWalls);
          groundLineHeightInput.setValue(groundLineHeight);
        } else if (isAdjacentLikeElement(element)) {
          // Round numeric values to 2dp when loading from file
          const derivedLineWidth =
            element.coordinates?.length === 2
              ? roundToTwoDecimals(
                  deriveWallProperties(
                    element,
                    geometryStore.getState().globalOrientationOffset,
                  ).width,
                )
              : '';
          const width =
            'width' in element && typeof element.width === 'number' && element.width > 0
              ? roundToTwoDecimals(element.width)
              : derivedLineWidth;
          const height = typeof element.height === 'number' ? roundToTwoDecimals(element.height) : (element.height ?? '');
          const area = typeof element.area === 'number' ? roundToTwoDecimals(element.area) : (element.area ?? '');
          // 90° = vertical / wall convention in the model when pitch is unknown (line elements). The store/CSV
          // may still hold 90 for an internal floor polygon until the user sets 0/180 in the surface-facing control.
          const pitch = typeof element.pitch === 'number' ? element.pitch : (element.pitch ?? 90);
          const adjacentExtra = readExtraJsonRecord((element as { extra_json?: unknown }).extra_json);
          widthInput.setValue(width);
          heightInput.setValue(height);
          setParentElement('parent_element' in element ? element.parent_element ?? '' : '');
          areaInput.setValue(area);
          setPitch(pitch);
          const cavityResistance = readFiniteNumber(adjacentExtra.thermal_resistance_cavity);
          partyWallCavityResistanceInput.setValue(
            cavityResistance == null ? '' : formatConditionalDecimals(cavityResistance),
          );
          const adj = element as { _base_height?: number; base_height?: number };
          let viewerPlotM: number | '' = '';
          if (typeof adj._base_height === 'number' && Number.isFinite(adj._base_height)) {
            viewerPlotM = roundToTwoDecimals(adj._base_height);
          } else if (typeof adj.base_height === 'number' && Number.isFinite(adj.base_height)) {
            viewerPlotM = roundToTwoDecimals(adj.base_height);
          }
          adjacentViewerBaseHeightInput.setValue(viewerPlotM);
        } else if (element.type === 'ThermalBridgeLinear') {
          elementFormInstances.ThermalBridgeLinear.hydrate(element);
        } else if (element.type === 'ThermalBridgePoint') {
          elementFormInstances.ThermalBridgePoint.hydrate(element);
        }
        // NEW: Load CSV v3 element types
        else if (element.type === 'WindowShading') {
          elementFormInstances.WindowShading.hydrate(element);
        } else if (element.type === 'Lighting') {
          elementFormInstances.Lighting.hydrate(element);
        } else if (element.type === 'MechanicalVentilationDuctwork') {
          elementFormInstances.MechanicalVentilationDuctwork.hydrate(element);
        } else if (element.type === 'MechanicalVentilationTerminal') {
          elementFormInstances.MechanicalVentilationTerminal.hydrate(element);
        } else if (element.type === 'WetEmitter') {
          elementFormInstances.WetEmitter.hydrate(element);
        } else if (element.type === 'WaterPipework') {
          elementFormInstances.WaterPipework.hydrate(element);
        } else if (element.type === 'Appliance') {
          elementFormInstances.Appliance.hydrate(element);
        } else if (element.type === 'HotWaterDemand') {
          elementFormInstances.HotWaterDemand.hydrate(element);
        } else if (element.type === 'ContextShading') {
          elementFormInstances.ContextShading.hydrate(element);
        }
        // NEW: Load InfiltrationVentilation element types
        else if (element.type === 'Vents') {
          elementFormInstances.Vents.hydrate(element);
        } else if (element.type === 'MechanicalVentilation') {
          elementFormInstances.MechanicalVentilation.hydrate(element);
        } else if (element.type === 'CombustionAppliances') {
          elementFormInstances.CombustionAppliances.hydrate(element);
        } else if (element.type === 'OnSiteGeneration') {
          elementFormInstances.OnSiteGeneration.hydrate(element);
        } else if (element.type === 'ElectricBattery') {
          elementFormInstances.ElectricBattery.hydrate(element);
        } else if (element.type === 'System') {
          elementFormInstances.System.hydrate(element);
        }
      }
    } else if (selection.type === 'global' && selection.id) {
      const element = getElementById(selection.id);

      if (element) {
        // Set the element data directly without resetting all fields
        setElementName(element.name);
        setElementType(element.type as ElementType);
        // System / on-site / battery can still carry a zoneId for FHS; other legacy "global" types do not
        if (
          element.type === 'System' ||
          element.type === 'OnSiteGeneration' ||
          element.type === 'ElectricBattery'
        ) {
          setElementZoneId(element.zoneId || '');
        } else {
          setElementZoneId(''); // Global objects don't have zoneId
        }
        setElementFloorId(element.floorId || ''); // Set floor assignment
        elementElevationInput.setValue(readViewerElevationValue(element));

        // Set fields based on global element type
        if (element.type === 'WaterPipework') {
          elementFormInstances.WaterPipework.hydrate(element);
        } else if (element.type === 'Appliance') {
          elementFormInstances.Appliance.hydrate(element);
        } else if (element.type === 'HotWaterDemand') {
          elementFormInstances.HotWaterDemand.hydrate(element);
        } else if (element.type === 'ContextShading') {
          elementFormInstances.ContextShading.hydrate(element);
        }
        // NEW: Load InfiltrationVentilation element types
        else if (element.type === 'Vents') {
          elementFormInstances.Vents.hydrate(element);
        } else if (element.type === 'MechanicalVentilationDuctwork') {
          elementFormInstances.MechanicalVentilationDuctwork.hydrate(element);
        } else if (element.type === 'MechanicalVentilationTerminal') {
          elementFormInstances.MechanicalVentilationTerminal.hydrate(element);
        } else if (element.type === 'MechanicalVentilation') {
          elementFormInstances.MechanicalVentilation.hydrate(element);
        } else if (element.type === 'CombustionAppliances') {
          elementFormInstances.CombustionAppliances.hydrate(element);
        } else if (element.type === 'OnSiteGeneration') {
          elementFormInstances.OnSiteGeneration.hydrate(element);
        } else if (element.type === 'ElectricBattery') {
          elementFormInstances.ElectricBattery.hydrate(element);
        } else if (element.type === 'System') {
          elementFormInstances.System.hydrate(element);
        }
      }
    } else if (selection.type === 'zone' && selection.id) {
      const zone = getZoneById(selection.id);

      if (zone) {
        setZoneName(zone.name);
        zoneFloorAreaInput.setValue(zone.floorArea);
        zoneHeightInput.setValue(zone.height);
        setSimplifiedThermalBridging(zone.simplifiedThermalBridging || false);
      }
    }
  // This is selection-keyed form hydration. Re-running on every input-controller identity change
  // would overwrite in-progress edits; targeted sync effects below handle store mutations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.id, selection?.type, getElementById, getZoneById, geometryStore]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedZoneSyncMetrics = useGeometryStore(
    useShallow((s) => {
      if (selection?.type !== 'zone' || !selection.id) return null;
      const z = s.zones.find((zz) => zz.id === selection.id);
      if (!z) return null;
      return {
        floorArea: z.floorArea,
        height: z.height,
      };
    }),
  );

  useEffect(() => {
    if (selection?.type !== 'zone' || !selectedZoneSyncMetrics) return;
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- local draft-input state setter, not a parent callback.
    syncZoneFloorAreaValue(selectedZoneSyncMetrics.floorArea);
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- local draft-input state setter, not a parent callback.
    syncZoneHeightValue(selectedZoneSyncMetrics.height);
  }, [
    selectedZoneSyncMetrics,
    selection?.id,
    selection?.type,
    syncZoneFloorAreaValue,
    syncZoneHeightValue,
  ]);

  // Keep suspended-ground wall thickness input aligned with the store when `updateElement` bumps `_v`
  // (auto-sync from assemblies, "Use assembly", etc.). The main selection loader intentionally avoids
  // re-running on every selected-element mutation, so we mirror only `thickness_walls` here.
  const thicknessWallsSetValueRef = useRef(thicknessWallsInput.syncValue);
  useEffect(() => {
    thicknessWallsSetValueRef.current = thicknessWallsInput.syncValue;
  }, [thicknessWallsInput.syncValue]);
  useEffect(() => {
    if (selection?.type !== 'element' || !selection.id) return;
    const el = getElementById(selection.id);
    if (!el || el.type !== 'BuildingElementGround') return;
    const tw =
      'thickness_walls' in el && typeof el.thickness_walls === 'number' && Number.isFinite(el.thickness_walls)
        ? roundToTwoDecimals(el.thickness_walls)
        : '';
    thicknessWallsSetValueRef.current(tw);
  }, [selection?.id, selection?.type, selectedElementV, getElementById]);

  // Auto-calculate total_area for BuildingElementGround when area changes
  useEffect(() => {
    if (elementType === 'BuildingElementGround' && areaInput.value && areaInput.value > 0) {
      totalAreaInputSetValueRef.current(areaInput.value);
    }
  }, [elementType, areaInput.value]);

  // Add effect to handle placeholder discard/auto-save
  useEffect(() => {
    if (selection && selection.isPlaceholder) {
      // Only run if selection is a placeholder
      const currentSelection = geometryStore.getState().selection;
      if (!currentSelection || currentSelection.id !== selection.id) {
        // Check if the item is actually filled by looking at the store data, not form state
        let filled = false;
        if (selection.type === 'zone') {
          const zone = getZoneById(selection.id);
          filled = !!zone && !zone.isPlaceholder && (
            !!zone.name || (typeof zone.volume === 'number' && zone.volume > 0) || (typeof zone.floorArea === 'number' && zone.floorArea > 0)
          );
        } else if (selection.type === 'element') {
          const element = getElementById(selection.id);
          filled = !!element && (!('isPlaceholder' in element && element.isPlaceholder)) && (
            !!element.name ||
            ('width' in element && typeof element.width === 'number' && element.width > 0) ||
            ('height' in element && typeof element.height === 'number' && element.height > 0) ||
            ('area' in element && typeof element.area === 'number' && element.area > 0)
          );
        } else if (selection.type === 'global') {
          const element = getElementById(selection.id);
          // For global objects, consider them filled if they exist and have their required properties
          // Global objects are created with default values, so we check for the presence of type-specific properties
          // Don't check isPlaceholder flag for global objects since they should stay visible until user fills them
          filled = !!element && (
            // WaterPipework: check for pipework-specific properties
            (element.type === 'WaterPipework' && 'simplified_pipework' in element) ||
            // Appliance: check for appliance-specific properties
            (element.type === 'Appliance' && 'appliancekey' in element) ||
            // HotWaterDemand: check for hot water-specific properties
            (element.type === 'HotWaterDemand' && 'subcategory' in element) ||
            // ContextShading: check for shading-specific properties
            (element.type === 'ContextShading' && 'shading_type' in element) ||
            // NEW: InfiltrationVentilation types
            // Vents: check for vents-specific properties
            (element.type === 'Vents' && 'mid_height_air_flow_path' in element) ||
            // MechanicalVentilation: check for mechanical ventilation-specific properties
            (element.type === 'MechanicalVentilation' && 'vent_type' in element) ||
            (element.type === 'MechanicalVentilationDuctwork' && 'duct_type' in element) ||
            (element.type === 'MechanicalVentilationTerminal' && 'terminal_type' in element) ||
            // CombustionAppliances: check for combustion appliances-specific properties
            (element.type === 'CombustionAppliances' && 'appliance_type' in element)
          );
        }

        if (!filled) {
          removePlaceholder('zone', selection.id);
          // Don't set selection to null here as it might already be set to something else
        }
      }
    }
  }, [selection, getZoneById, getElementById, geometryStore, removePlaceholder]); // Add store functions to dependencies

  const getDormerBundleNameIssue = (candidateName: string, currentBundleId?: string | null): string | null => {
    const trimmed = candidateName.trim();
    if (!trimmed) return null;

    const seenBundles = new Set<string>();
    const duplicate = Object.values(elementsById).some((element) => {
      const metadata = getDormerBundleMetadata(element);
      if (!metadata) return false;
      if (seenBundles.has(metadata.bundle_id)) return false;
      seenBundles.add(metadata.bundle_id);
      if (metadata.bundle_id === currentBundleId) return false;
      return (getDormerBundleName(element) || '').trim() === trimmed;
    });

    return duplicate ? `Dormer name "${trimmed}" already exists` : null;
  };

  function getDuplicateNameIssue(): string | null {
    if (!selection) return null;

    if (selection.type === 'zone') {
      const trimmed = zoneName.trim();
      if (!trimmed) return null;
      const duplicate = zones.some((zone) => zone.id !== selection.id && zone.name === trimmed);
      return duplicate ? `Zone name "${trimmed}" already exists` : null;
    }

    const trimmed = elementName.trim();
    if (!trimmed) return null;
    const currentElement = getElementById(selection.id);
    if (!currentElement) return null;
    const currentDormerMetadata = getDormerBundleMetadata(currentElement);
    if (resolvedSelectionContext?.type === 'dormer' && currentDormerMetadata) {
      return getDormerBundleNameIssue(trimmed, currentDormerMetadata.bundle_id);
    }
    const isGlobalElement = isGlobalElementType(currentElement.type as ElementType);
    const duplicate = Object.values(elementsById).some((element) => {
      if (element.id === selection.id) return false;
      if (element.name !== trimmed) return false;
      if (isGlobalElement) {
        return element.type === currentElement.type && isGlobalElementType(element.type as ElementType);
      }
      return element.zoneId === currentElement.zoneId;
    });
    return duplicate ? `Element name "${trimmed}" already exists${isGlobalElement ? ' for this type' : ' in this zone'}` : null;
  }
  useEffect(() => {
    getDuplicateNameIssueRef.current = getDuplicateNameIssue;
  });

  // Helper function to check field validation issues
  const getFieldValidationIssue = (fieldName: string, value: unknown): string | null => {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : NaN;
    if (!selection || selection.type === 'zone') {
      // Zone validation
      switch (fieldName) {
	        case 'name':
	          return !zoneName || zoneName.trim() === '' ? 'Name is required' : getDuplicateNameIssue();
	        case 'floorArea':
	          return !Number.isFinite(numericValue) || numericValue <= 0 ? 'Floor Area cannot be 0' : null;
        case 'livingroom_area':
        case 'restofdwelling_area':
          return null; // FHS split comes from space labels; validate at zone level
	        case 'height':
	          return !Number.isFinite(numericValue) || numericValue <= 0 ? 'Height cannot be 0' : null;
        case 'volume':
          return null; // Derived field, no validation needed
        default:
          return null;
      }
    } else {
      // Element validation
      switch (fieldName) {
        case 'name':
          return !elementName || elementName.trim() === '' ? 'Name is required' : getDuplicateNameIssue();
        case 'width':
          return (!value || value === 0) && ['BuildingElementOpaque', 'BuildingElementTransparent', ...ADJACENT_LIKE_ELEMENT_TYPES].includes(elementType) ? 'Width cannot be 0' : null;
        case 'height':
          if (elementType === 'ContextShading') {
            return typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ? 'Height must be greater than 0' : null;
          }
          return (!value || value === 0) && ['BuildingElementOpaque', 'BuildingElementTransparent', ...ADJACENT_LIKE_ELEMENT_TYPES].includes(elementType) ? 'Height cannot be 0' : null;
        case 'area':
          // Ground slabs store authoritative area; opaque/transparent/adjacent fabric derive from width×height (line) or footprint (polygon).
          if (elementType === 'BuildingElementGround') {
            return (!value || value === 0) ? 'Area cannot be 0' : null;
          }
          return null;
        case 'freeAreaHeight':
          return value === 0 && ['BuildingElementOpaque', 'BuildingElementTransparent'].includes(elementType) ? 'Free Area Height should not be 0' : null;
        case 'midHeight':
          return value === 0 && ['BuildingElementOpaque', 'BuildingElementTransparent'].includes(elementType) ? 'Mid Height should not be 0' : null;
        case 'maxWindowOpenArea':
          return value === 0 && ['BuildingElementOpaque', 'BuildingElementTransparent'].includes(elementType) ? 'Max Window Open Area should not be 0' : null;
        case 'totalArea':
          return (!value || value === 0) && elementType === 'BuildingElementGround' ? 'Total Area cannot be 0' : null;
        case 'perimeter':
          return (!value || value === 0) && elementType === 'BuildingElementGround' ? 'Perimeter cannot be 0' : null;
        case 'length':
          if (elementType === 'ThermalBridgeLinear' && selection?.type === 'element') {
            const el = getElementById(selection.id) as ThermalBridgeLinear | undefined;
            const lenVal = typeof value === 'number' ? value : 0;
            if (el && thermalBridgeLinearHasPositiveRun({ ...el, length: lenVal })) return null;
            return 'Length cannot be 0';
          }
          return (!value || value === 0) && ['MechanicalVentilationDuctwork', 'WaterPipework'].includes(elementType)
            ? 'Length cannot be 0'
            : null;
        case 'distance':
          return (!value || value === 0) && ['WindowShading', 'ContextShading'].includes(elementType) ? 'Distance cannot be 0' : null;
        case 'windowShadingHeight':
          return (!value || value === 0) && elementType === 'WindowShading' && windowShadingFormState.shadingType === 'object' ? 'Height cannot be 0' : null;
        case 'windowShadingTransparency':
          return (
            value === '' ||
            value === undefined ||
            numericValue < 0 ||
            numericValue > 1
          ) && elementType === 'WindowShading' && windowShadingFormState.shadingType === 'object' ? 'Transparency must be between 0 and 1' : null;
        case 'windowShadingDepth':
          return (!value || value === 0) && elementType === 'WindowShading' && windowShadingFormState.shadingType !== 'object' ? 'Depth cannot be 0' : null;
        case 'unitNumber':
          return (!value || value === 0) && elementType === 'WetEmitter' && ['radiator', 'fancoil'].includes(wetEmitterFormState.subcategory) ? 'Unit Number cannot be 0' : null;
        case 'flowrate':
          if (
            elementType === 'HotWaterDemand' &&
            hotWaterDemandFormState.hotWaterSubcategory !== 'InstantElecShower' &&
            hotWaterDemandFormState.hotWaterSubcategory !== 'Bath'
          ) {
            if (!value || value === 0) {
              return 'Flowrate cannot be 0';
            }
            // Core schema validations (red errors)
            if (hotWaterDemandFormState.hotWaterSubcategory === 'OtherWaterUseDetails' && numericValue < 0.1) {
              return 'Flowrate must be at least 0.1 L/min';
            }
            if (numericValue > 15) {
              return 'Flowrate cannot exceed 15 L/min';
            }
            // Note: FHS wrapper requirement (flowrate < 8.0 for MixerShower) is handled
            // as a warning in validateElement(), not as a field-level error
          }
          return null;
        case 'size':
          return (!value || value === 0) && elementType === 'HotWaterDemand' && hotWaterDemandFormState.hotWaterSubcategory === 'Bath' ? 'Size cannot be 0' : null;
        case 'ratedPower':
          return (!value || value === 0) && elementType === 'HotWaterDemand' && hotWaterDemandFormState.hotWaterSubcategory === 'InstantElecShower' ? 'Rated Power cannot be 0' : null;
        case 'midHeightAirFlowPath':
          return (!value || value === 0) && elementType === 'Vents' ? 'Mid Height Air Flow Path cannot be 0' : null;
        case 'areaCm2':
          return (!value || value === 0) && elementType === 'Vents' ? 'Area (cm²) cannot be 0' : null;
        case '_base_height':
          return null;
        default:
          return null;
      }
    }
  };

  function resetFormFields() {
    setElementName('');
    setElementType('BuildingElementOpaque');
    widthInput.setValue('');
    heightInput.setValue('');
    areaInput.setValue('');
    setPitch(90);
    setOrientation360(0);
    baseHeightInput.setValue('');
    unheatedPitchedRoofCeilingElevationInput.setValue('');
    adjacentViewerBaseHeightInput.setValue('');
    elementElevationInput.setValue('');
    setIsUnheatedPitchedRoof(false);
    setDormerRoofIsUnheatedPitchedRoof(false);
    setIsExternalDoor(false);
    setParentElement('');
    lateNumericInputSettersRef.current.freeAreaFraction('');
    freeAreaHeightInput.setValue('');
    midHeightInput.setValue('');
    maxWindowOpenAreaInput.setValue('');
    totalAreaInput.setValue('');
    perimeterInput.setValue('');
    setFloorType('');
    groundLineHeightInput.setValue('');
    depthBasementFloorInput.setValue('');
    thicknessWallsInput.setValue('');
    // ThermalBridgeLinear/MechanicalVentilationDuctwork/WaterPipework each call
    // resetServiceLine(state.serviceLine) from their own module reset() (via the
    // elementFormInstances loop below); no direct call needed here now that all
    // three of the group's readers own their own reset.

    // NEW: CSV v3 element state variables
    // WindowShading's own reset lines now live in its module (via the
    // elementFormInstances loop below). distanceInput is shared with
    // ContextShading and the not-yet-extracted wall family; stays here.
    distanceInput.setValue('');

    // MechanicalVentilationDuctwork's own reset lines now live in its module
    // (via the elementFormInstances loop below).

    // MechanicalVentilationTerminal's own reset lines now live in its module
    // (via the elementFormInstances loop below).

    // WetEmitter's subcategory/unitNumberInput reset lines now live in its
    // module (via the elementFormInstances loop below). spaceHeatSystem is
    // shared with the orchestrator-owned System<->WetEmitter bridge (see
    // ElementFormSharedCtx) and is reset directly here, like parentElement/
    // distanceInput above.
    setSpaceHeatSystem('');

    // WaterPipework's own reset lines now live in its module (via the
    // elementFormInstances loop below).

    // ContextShading's own reset lines now live in its module (via the
    // elementFormInstances loop below).

    // NEW: InfiltrationVentilation element state variables
    // Vents' own reset lines now live in its module (via the
    // elementFormInstances loop below).

    // MechanicalVentilation's own reset lines now live in its module (via the
    // elementFormInstances loop below).

    // System's own reset lines now live in its module (via the
    // elementFormInstances loop below).

    // Floor assignment
    setElementFloorId('');

    // Zone properties
    zoneFloorAreaInput.setValue('');
    zoneHeightInput.setValue('');
    setSimplifiedThermalBridging(false);

    // Extracted form families own their share of the reset.
    for (const instance of Object.values(elementFormInstances)) {
      instance.reset();
    }
  }
  useLayoutEffect(() => {
    resetFormFieldsRef.current = resetFormFields;
  });

	  const handleAddZone = () => {
	    if (!zoneName) {
	      alert('Please enter a zone name');
	      return;
	    }
	    try {
	      const submittedFloorArea = readPositiveZoneNumber(zoneFloorArea);
	      if (submittedFloorArea == null) {
	        alert('Please enter a floor area greater than 0');
	        return;
	      }
	      const submittedHeight = readPositiveZoneNumber(zoneHeight);
	      if (submittedHeight == null) {
	        alert('Please enter a height greater than 0');
	        return;
	      }
	      const submittedLivingroomArea: number | undefined = undefined;
	      const submittedRestOfDwellingArea: number | undefined = undefined;

      // Determine if the user has overridden derived values.
      // Compare submitted values to live derived values — if they differ,
      // the user wants a manual override; if they match, auto-track geometry.
      let floorAreaUserOverride = false;
      let heightUserOverride = false;
      if (selection && selection.type === 'zone') {
        const allElements = Object.values(elementsById) as import('../geometry/types').Element[];
        const { floorArea: derivedArea } = calculateDerivedFloorArea(selection.id, allElements);
        floorAreaUserOverride = derivedArea > 0 && submittedFloorArea !== undefined && submittedFloorArea > 0
          && Math.abs(submittedFloorArea - derivedArea) > 0.005;

        const derivedH = calculateDerivedHeight(selection.id, allElements);
        heightUserOverride = derivedH > 0 && submittedHeight !== undefined && submittedHeight > 0
          && Math.abs(submittedHeight - derivedH) > 0.005;
      }

      if (selection && selection.type === 'zone') {
        if (selection.isPlaceholder) {
	          updateZone(selection.id, {
	            name: zoneName,
	            floorArea: submittedFloorArea,
	            height: submittedHeight,
	            volume: zoneVolume,
            livingroom_area: submittedLivingroomArea,
            restofdwelling_area: submittedRestOfDwellingArea,
            isPlaceholder: false,
            simplifiedThermalBridging: simplifiedThermalBridging,
            _floorAreaUserOverride: floorAreaUserOverride,
            _heightUserOverride: heightUserOverride
          });
          setSelection({ type: 'zone', id: selection.id });
        } else {
	          updateZone(selection.id, {
	            name: zoneName,
	            floorArea: submittedFloorArea,
	            height: submittedHeight,
	            volume: zoneVolume,
            livingroom_area: submittedLivingroomArea,
            restofdwelling_area: submittedRestOfDwellingArea,
            simplifiedThermalBridging: simplifiedThermalBridging,
            _floorAreaUserOverride: floorAreaUserOverride,
            _heightUserOverride: heightUserOverride
          });
        }
      } else {
	        addZone({
	          name: zoneName,
	          floorArea: submittedFloorArea,
	          height: submittedHeight,
	          volume: zoneVolume,
          livingroom_area: submittedLivingroomArea,
          restofdwelling_area: submittedRestOfDwellingArea,
          simplifiedThermalBridging: simplifiedThermalBridging
        });
        setZoneName('');
        zoneFloorAreaInput.setValue('');
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to add zone');
    }
  };

  const handleZoneDelete = () => {
    onZoneDelete?.();
  };

  // Element delete handlers
  const handleElementDelete = () => {
    onElementDelete?.();
  };

  const mergeDormerExtraJson = (
    existingExtraJson: Record<string, unknown> | undefined,
    nextExtraJson: Record<string, unknown> | undefined,
  ) => {
    const preserved = { ...(existingExtraJson || {}) };
    delete preserved.dormer_bundle;
    delete preserved.geometry_face;
    delete preserved.parent_netting_area;
    return { ...preserved, ...(nextExtraJson || {}) };
  };

  const getDormerBundleElements = useCallback((bundleId: string) =>
    getDormerBundleElementIds(elementsById, bundleId)
      .map((id) => elementsById[id])
      .filter((element): element is Element => Boolean(element)), [elementsById]);

  const dormerDraftValuesRef = useRef({
    dormerWidth: 2,
    frontWallHeight: 1.2,
    dormerRoofPitch: 15,
    gableRoofPitch: 35,
    windowWidth: 1.2,
    windowHeight: 1,
    windowSillHeight: 0.6,
    frameAreaFraction: 0.25,
  });

  const regenerateDormerAnchor = (
    anchorId: string,
    overrides: {
      bundleName?: string;
      hostName?: string;
      parameters?: Partial<DormerBundleParameters>;
      thermalOverrides?: DormerThermalOverrides;
    } = {},
  ) => {
    const anchor = getElementById(anchorId);
    if (!anchor || anchor.type !== 'BuildingElementOpaque') {
      throw new Error('Dormer anchor element not found.');
    }

    const metadata = getDormerBundleMetadata(anchor);
    if (!metadata) {
      throw new Error('This element is not a dormer anchor.');
    }

    const targetHostName = (overrides.hostName ?? parentElement ?? metadata.host_element_name ?? '').trim();
    const host = Object.values(elementsById).find(
      (element) => element.type === 'BuildingElementOpaque' && element.name === targetHostName,
    );
    if (!host || !isValidDormerHost(host)) {
      throw new Error('Dormers must stay attached to a valid sloped roof polygon.');
    }

    const nextParameters: DormerBundleParameters = {
      dormerType: selectedDormerType,
      windowCenterPlanPoint: metadata.windowCenterPlanPoint,
      dormerWidth: dormerDraftValuesRef.current.dormerWidth,
      dormerDepth,
      frontWallHeight: dormerDraftValuesRef.current.frontWallHeight,
      dormerRoofPitch: dormerDraftValuesRef.current.dormerRoofPitch,
      gableRoofPitch: dormerDraftValuesRef.current.gableRoofPitch,
      isUnheatedPitchedRoof: dormerRoofIsUnheatedPitchedRoof,
      windowWidth: dormerDraftValuesRef.current.windowWidth,
      windowHeight: dormerDraftValuesRef.current.windowHeight,
      windowSillHeight: dormerDraftValuesRef.current.windowSillHeight,
      frameAreaFraction: dormerDraftValuesRef.current.frameAreaFraction,
      ...(overrides.parameters || {}),
    };

    const names = {
      frontWall: anchor.name,
      leftCheekWall: metadata.cheek_wall_names[0],
      rightCheekWall: metadata.cheek_wall_names[1],
      roofs: metadata.roof_names,
      window: metadata.window_name,
    };
    const suppliedBundleName = overrides.bundleName;
    const bundleName = (
      suppliedBundleName?.trim()
      || elementName.trim()
      || getDormerBundleName(anchor)
      || metadata.bundle_name
      || anchor.name
    ).trim();
    if (!bundleName) {
      throw new Error('Dormer name is required.');
    }
    if (suppliedBundleName !== undefined) {
      const duplicateNameIssue = getDormerBundleNameIssue(bundleName, metadata.bundle_id);
      if (duplicateNameIssue) {
        throw new Error(duplicateNameIssue);
      }
    }

    const draft = buildDormerBundleDraft({
      host,
      dormerType: nextParameters.dormerType,
      windowCenterPlanPoint: nextParameters.windowCenterPlanPoint,
      placementDefaults: {
        dormerWidth: nextParameters.dormerWidth,
        dormerDepth: nextParameters.dormerDepth,
        frontWallHeight: nextParameters.frontWallHeight,
        dormerRoofPitch: nextParameters.dormerRoofPitch,
        gableRoofPitch: nextParameters.gableRoofPitch,
        windowWidth: nextParameters.windowWidth,
        windowHeight: nextParameters.windowHeight,
        windowSillHeight: nextParameters.windowSillHeight,
        frameAreaFraction: nextParameters.frameAreaFraction,
      },
      names,
      bundleName,
      bundleId: metadata.bundle_id,
      floors,
      thermalOverrides: overrides.thermalOverrides ?? metadata.thermal_overrides,
      globalOrientationOffset: geometryStore.getState().globalOrientationOffset,
    });

    if (!draft) {
      throw new Error('Unable to regenerate this dormer from the current parameters.');
    }

    const zoneId = host.zoneId || elementZoneId || anchor.zoneId;
    const floorId = host.floorId || elementFloorId || anchor.floorId;

    updateElement(anchorId, {
      name: names.frontWall,
      zoneId,
      floorId,
      parent_element: host.name,
      ...draft.frontWall,
      extra_json: mergeDormerExtraJson(anchor.extra_json, draft.frontWall.extra_json),
    });

    const existingChildrenByName = new Map(
      Object.values(elementsById)
        .filter((element) => element.id !== anchorId)
        .map((element) => [element.name, element] as const),
    );

    const siblingDefinitions = draft.members.filter((member) => member.role !== 'front-wall-anchor');
    const expectedMemberNames = new Set(draft.members.map((member) => member.name));
    Object.values(elementsById)
      .filter((element) => element.id !== anchorId)
      .filter((element) => getDormerBundleInfo(element)?.bundle_id === metadata.bundle_id)
      .filter((element) => !expectedMemberNames.has(element.name))
      .forEach((element) => removeElement(element.id));

    siblingDefinitions.forEach((definition) => {
      const existingChild = existingChildrenByName.get(definition.name);
      const payload = {
        name: definition.name,
        type: definition.type,
        zoneId,
        floorId,
        parent_element: definition.parent,
        ...definition.updates,
        extra_json: mergeDormerExtraJson(
          existingChild?.extra_json,
          definition.updates.extra_json,
        ),
      };

      if (existingChild) {
        updateElement(existingChild.id, payload as Partial<Element>, true);
      } else {
        addElement(payload as Omit<Element, 'id'>);
      }
    });

    const geometryState = geometryStore.getState();
    const regeneratedElementIds = getDormerBundleElementIds(geometryState.elementsById, metadata.bundle_id);
    setSelectedElementIds(regeneratedElementIds);
    setSelection({ type: 'dormer', id: metadata.bundle_id });
  };

  const handleSaveDormerAnchor = (anchorId: string) => {
    regenerateDormerAnchor(anchorId);
  };

  const handleDuplicateDormerBundle = (anchorId: string) => {
    const anchor = getElementById(anchorId);
    if (!anchor || anchor.type !== 'BuildingElementOpaque') {
      throw new Error('Dormer anchor element not found.');
    }

    const metadata = getDormerBundleMetadata(anchor);
    if (!metadata) {
      throw new Error('This element is not a dormer anchor.');
    }

    const hostName = (metadata.host_element_name || anchor.parent_element || '').trim();
    const host = Object.values(elementsById).find(
      (element) => element.type === 'BuildingElementOpaque' && element.name === hostName,
    );
    if (!host || !isValidDormerHost(host)) {
      throw new Error('Dormers must stay attached to a valid sloped roof polygon.');
    }

    const existingNames = Object.values(elementsById)
      .map((element) => element.name)
      .filter((name): name is string => Boolean(name));

    const seenBundleIds = new Set<string>();
    const existingBundleNames = Object.values(elementsById)
      .flatMap((element) => {
        const bundleInfo = getDormerBundleMetadata(element);
        if (!bundleInfo || seenBundleIds.has(bundleInfo.bundle_id)) return [];
        seenBundleIds.add(bundleInfo.bundle_id);
        const bundleName = getDormerBundleName(element)?.trim();
        return bundleName ? [bundleName] : [];
      });

    const placementDefaults = {
      dormerWidth: metadata.dormerWidth,
      dormerDepth: metadata.dormerDepth,
      frontWallHeight: metadata.frontWallHeight,
      dormerRoofPitch: metadata.dormerRoofPitch,
      gableRoofPitch: metadata.gableRoofPitch,
      isUnheatedPitchedRoof: metadata.isUnheatedPitchedRoof,
      windowWidth: metadata.windowWidth,
      windowHeight: metadata.windowHeight,
      windowSillHeight: metadata.windowSillHeight,
      frameAreaFraction: metadata.frameAreaFraction,
    };

    const duplicateOffsets = [
      { x: 0.5, y: 0.5 },
      { x: 0.35, y: 0.35 },
      { x: -0.5, y: 0.5 },
      { x: 0.5, y: -0.5 },
    ];

    const duplicateDraft = duplicateOffsets
      .map(({ x, y }) =>
        buildDormerBundleDraft({
          host,
          dormerType: metadata.dormerType,
          windowCenterPlanPoint: {
            x: metadata.windowCenterPlanPoint.x + x,
            y: metadata.windowCenterPlanPoint.y + y,
          },
          existingNames,
          existingBundleNames,
          placementDefaults,
          floors,
          thermalOverrides: metadata.thermal_overrides,
          globalOrientationOffset: geometryStore.getState().globalOrientationOffset,
        }),
      )
      .find((draft): draft is NonNullable<typeof draft> => Boolean(draft));

    if (!duplicateDraft) {
      throw new Error('Unable to place the duplicated dormer on the current host roof.');
    }

    const zoneId = host.zoneId || elementZoneId || anchor.zoneId;
    const floorId = host.floorId || elementFloorId || anchor.floorId;

    duplicateDraft.members.forEach((member) => {
      addElement({
        name: member.name,
        type: member.type,
        zoneId,
        floorId,
        parent_element: member.parent === host.name ? host.name : member.parent,
        ...member.updates,
      } as Omit<Element, 'id'>);
    });

    const geometryState = geometryStore.getState();
    const duplicatedElementIds = geometryState.elementIds.filter((id) => {
      const element = geometryState.elementsById[id];
      return getDormerBundleMetadata(element)?.bundle_id === duplicateDraft.bundleId;
    });
    setSelectedElementIds(duplicatedElementIds);
    setSelection({ type: 'dormer', id: duplicateDraft.bundleId });
  };

  const selectedIsDormerAnchorRef = useRef(false);
  const buildNewElementDataRef = useRef<() => Partial<Element>>(() => ({}));

  const handleSaveElement = () => {
    if (!elementName.trim() || (!isGlobalElementType(elementType) && !elementZoneId)) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      if (selection.type === 'element' && selection.id && selectedIsDormerAnchorRef.current) {
        handleSaveDormerAnchor(selection.id);
        return;
      }

      const elementData = buildNewElementDataRef.current();
      if ((selection.type === 'element' || selection.type === 'global') && selection.id) {
        const existingElement = getElementById(selection.id);
        if (existingElement && existingElement.isPlaceholder) {
          elementData.isPlaceholder = false;
        }

        // For existing elements, preserve coordinates to prevent position reset
        if (existingElement && !existingElement.isPlaceholder) {
          // Remove orientation360 from updates to prevent coordinate recalculation
          const safeUpdates: Partial<Element> & { orientation360?: unknown } = { ...elementData };
          delete safeUpdates.orientation360;
          updateElement(selection.id, safeUpdates);
        } else {
          updateElement(selection.id, elementData);
        }

        if (existingElement && existingElement.isPlaceholder) {
          setSelection({ type: selection.type, id: selection.id });
        }
      } else {
        addElement(elementData as Omit<Element, 'id'>);
        setSelection(null);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save element');
    }
  };
  const handleAddZoneRef = useRef(handleAddZone);
  const handleSaveElementRef = useRef(handleSaveElement);
  useEffect(() => {
    handleAddZoneRef.current = handleAddZone;
    handleSaveElementRef.current = handleSaveElement;
  });

  // Submit on Enter: Update Zone or Update Element depending on selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (selection?.type === 'zone' && selection.isPlaceholder) {
          e.preventDefault();
          handleAddZoneRef.current();
        } else if ((selection?.type === 'element' || selection?.type === 'global') && selection.isPlaceholder) {
          e.preventDefault();
          handleSaveElementRef.current();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selection, zoneName, zoneFloorArea, zoneHeight, zoneVolume, elementName, elementType, elementZoneId]);

  // ── Memoised selected-element derivations ──
  // These are used repeatedly in JSX, so we compute them once per render
  // instead of calling getElementById + calculatePolygonArea multiple times.

  const selectedElement = useMemo(() => {
    void selectedElementV;
    if (!selection?.id) return null;
    return getElementById(selection.id) ?? null;
  }, [selection?.id, getElementById, selectedElementV]);

  const selectedDormerMetadata = getDormerBundleMetadata(selectedElement);
  const selectedIsDormerAnchor = isDormerAnchorElement(selectedElement);
  useEffect(() => {
    selectedIsDormerAnchorRef.current = selectedIsDormerAnchor;
  }, [selectedIsDormerAnchor]);
  useEffect(() => {
    if (!selection || (selection.type !== 'element' && selection.type !== 'global')) return;
    if (selectedIsDormerAnchor) return;
    if (elementName === persistedElementName) return;
    if (typeof document !== 'undefined') {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl?.id === ELEMENT_NAME_INPUT_ID) return;
    }
    if (elementNameEditingRef.current) return;
    setElementName(persistedElementName);
  }, [selection, selectedIsDormerAnchor, elementName, persistedElementName]);
  // Whether the selected element's name is a manual override (auto-naming off).
  // Dormer anchors rename their whole bundle through a different path, so they
  // are excluded here.
  const selectedNameIsManual = useMemo(() => {
    if (!selectedElement || selectedIsDormerAnchor) return false;
    if (selection?.type !== 'element' && selection?.type !== 'global') return false;
    return isElementNameManual(selectedElement.id);
  }, [selectedElement, selectedIsDormerAnchor, selection?.type, isElementNameManual]);
  const handleResetNameToAuto = useCallback(() => {
    if (!selectedElement || selectedIsDormerAnchor) return;
    // Reset from persisted state, not the (possibly half-edited) input buffer.
    const nextName = resetElementNameToAuto(selectedElement.id);
    if (nextName != null) {
      elementNameEditingRef.current = false;
      setElementName(nextName);
    }
  }, [resetElementNameToAuto, selectedElement, selectedIsDormerAnchor, setElementName]);
  const selectionRepresentsDormer = resolvedSelectionContext?.type === 'dormer' && selectedIsDormerAnchor;
  const selectedDormerBundleElements = useMemo(() => {
    if (!selectedDormerMetadata) return [] as Element[];
    return getDormerBundleElements(selectedDormerMetadata.bundle_id);
  }, [selectedDormerMetadata, getDormerBundleElements]);
  const commitDormerAnchorChanges = (
    overrides: {
      bundleName?: string;
      hostName?: string;
      parameters?: Partial<DormerBundleParameters>;
    } = {},
  ) => {
    if (!selection?.id || !selectedIsDormerAnchor) return;
    try {
      regenerateDormerAnchor(selection.id, overrides);
    } catch { /* swallow: best-effort */ }
  };
  const commitTransparentFrameAreaFraction = (value: number | '') => {
    if (!isExistingElementSelection()) return;
    commitExistingElementDraft({
      frame_area_fraction: value === '' ? undefined : value,
    } as Partial<Element>);
  };
  const freeAreaFractionInput = useDecimalInput(
    '',
    commitTransparentFrameAreaFraction,
    { commitOnChange: false, formatOnBlur: 'preserve' },
  );
  const freeAreaFraction = freeAreaFractionInput.value;
  const commitDormerNumericParameter =
    <K extends keyof DormerBundleParameters>(key: K) =>
    (value: number | '') => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      commitDormerAnchorChanges({
        parameters: { [key]: value } as Partial<DormerBundleParameters>,
      });
    };
  const dormerWidthInput = useDecimalInput(
    2,
    commitDormerNumericParameter('dormerWidth'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerFrontWallHeightInput = useDecimalInput(
    1.2,
    commitDormerNumericParameter('frontWallHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerRoofPitchInput = useDecimalInput(
    15,
    commitDormerNumericParameter('dormerRoofPitch'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const gableRoofPitchInput = useDecimalInput(
    35,
    commitDormerNumericParameter('gableRoofPitch'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowWidthInput = useDecimalInput(
    1.2,
    commitDormerNumericParameter('windowWidth'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowHeightInput = useDecimalInput(
    1,
    commitDormerNumericParameter('windowHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWindowSillHeightInput = useDecimalInput(
    0.6,
    commitDormerNumericParameter('windowSillHeight'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerFrameAreaFractionInput = useDecimalInput(
    0.25,
    commitDormerNumericParameter('frameAreaFraction'),
    { commitOnChange: true, formatOnBlur: 'preserve' },
  );
  const dormerWidth = numericDraftValueOrDefault(dormerWidthInput.value, 2);
  const dormerFrontWallHeight = numericDraftValueOrDefault(dormerFrontWallHeightInput.value, 1.2);
  const dormerRoofPitch = numericDraftValueOrDefault(dormerRoofPitchInput.value, 15);
  const gableRoofPitch = numericDraftValueOrDefault(gableRoofPitchInput.value, 35);
  const dormerWindowWidth = numericDraftValueOrDefault(dormerWindowWidthInput.value, 1.2);
  const dormerWindowHeight = numericDraftValueOrDefault(dormerWindowHeightInput.value, 1);
  const dormerWindowSillHeight = numericDraftValueOrDefault(dormerWindowSillHeightInput.value, 0.6);
  const dormerFrameAreaFraction = numericDraftValueOrDefault(dormerFrameAreaFractionInput.value, 0.25);
  useLayoutEffect(() => {
    lateNumericInputSettersRef.current = {
      freeAreaFraction: freeAreaFractionInput.setValue,
      dormerWidth: dormerWidthInput.setValue,
      dormerFrontWallHeight: dormerFrontWallHeightInput.setValue,
      dormerRoofPitch: dormerRoofPitchInput.setValue,
      gableRoofPitch: gableRoofPitchInput.setValue,
      dormerWindowWidth: dormerWindowWidthInput.setValue,
      dormerWindowHeight: dormerWindowHeightInput.setValue,
      dormerWindowSillHeight: dormerWindowSillHeightInput.setValue,
      dormerFrameAreaFraction: dormerFrameAreaFractionInput.setValue,
    };
    dormerDraftValuesRef.current = {
      dormerWidth,
      frontWallHeight: dormerFrontWallHeight,
      dormerRoofPitch,
      gableRoofPitch,
      windowWidth: dormerWindowWidth,
      windowHeight: dormerWindowHeight,
      windowSillHeight: dormerWindowSillHeight,
      frameAreaFraction: dormerFrameAreaFraction,
    };
  }, [
    dormerFrameAreaFraction,
    dormerFrameAreaFractionInput.setValue,
    dormerFrontWallHeight,
    dormerFrontWallHeightInput.setValue,
    dormerRoofPitch,
    dormerRoofPitchInput.setValue,
    dormerWidth,
    dormerWidthInput.setValue,
    dormerWindowHeight,
    dormerWindowHeightInput.setValue,
    dormerWindowSillHeight,
    dormerWindowSillHeightInput.setValue,
    dormerWindowWidth,
    dormerWindowWidthInput.setValue,
    freeAreaFractionInput.setValue,
    gableRoofPitch,
    gableRoofPitchInput.setValue,
  ]);

  // Dormers have no `_nameAutoSync` flag, so the bundle name's auto/manual state
  // is inferred from its pattern. Resetting regenerates the whole bundle through
  // `regenerateDormerAnchor` rather than the normal element rename path.
  const selectedDormerNameIsManual = useMemo(() => {
    if (!selectedElement || !selectedIsDormerAnchor) return false;
    return isDormerBundleNameManual(selectedElement);
  }, [selectedElement, selectedIsDormerAnchor]);
  const handleResetDormerNameToAuto = () => {
    if (!selectedElement || !selectedIsDormerAnchor) return;
    const autoName = computeAutoDormerBundleName(selectedElement, elementsById);
    if (!autoName) return;
    elementNameEditingRef.current = false;
    commitDormerAnchorChanges({ bundleName: autoName });
    setElementName(autoName);
  };
  const showResetNameButton = selectedNameIsManual || selectedDormerNameIsManual;
  const handleResetName = () => {
    if (selectedIsDormerAnchor) {
      handleResetDormerNameToAuto();
    } else {
      handleResetNameToAuto();
    }
  };

  const dormerThermalRepresentatives = useMemo(() => {
    if (!selectedDormerMetadata) {
      return {
        frontWall: null,
        cheekWalls: null,
        roofs: null,
        window: null,
      };
    }
    const pickByRoles = (roles: DormerBundleRole[]) =>
      selectedDormerBundleElements.find((element) => {
        const role = getDormerBundleInfo(element)?.role;
        return role ? roles.includes(role) : false;
      }) ?? null;

    return {
      frontWall: pickByRoles(['front-wall-anchor']),
      cheekWalls: pickByRoles(['left-cheek-wall', 'right-cheek-wall']),
      roofs: pickByRoles(['roof', 'front-roof', 'left-roof', 'right-roof']),
      window: pickByRoles(['window']),
    };
  }, [selectedDormerBundleElements, selectedDormerMetadata]);

  const buildDormerThermalEditorData = (
    sectionKey: DormerThermalSectionKey,
    element: Element | null,
  ): Element | null => {
    if (!selectedDormerMetadata || !element) return null;
    const metadataOverride = selectedDormerMetadata.thermal_overrides[sectionKey];
    const fallbackOverride = getDormerThermalOverrideExtraJson(
      element.extra_json as Record<string, unknown> | undefined,
    );
    return {
      ...element,
      extra_json: metadataOverride ?? fallbackOverride ?? {},
    };
  };

  const commitDormerThermalSectionChanges = (
    sectionKey: DormerThermalSectionKey,
    updatedData: Partial<Element> & { extra_json?: Record<string, unknown> },
  ) => {
    if (!selectedDormerMetadata || !selection?.id || !selectedIsDormerAnchor) return;
    const nextOverride = getDormerThermalOverrideExtraJson(updatedData.extra_json);
    const currentOverride = selectedDormerMetadata.thermal_overrides[sectionKey];
    if (areDormerThermalOverridesEqual(currentOverride, nextOverride)) {
      return;
    }
    const nextThermalOverrides: DormerThermalOverrides = {
      ...selectedDormerMetadata.thermal_overrides,
      [sectionKey]: nextOverride,
    };
    try {
      regenerateDormerAnchor(selection.id, {
        thermalOverrides: nextThermalOverrides,
      });
    } catch { /* swallow: best-effort */ }
  };

  const dormerAssemblyRepresentative = useMemo((): Element | null => {
    if (!dormerAssemblySection) return null;
    switch (dormerAssemblySection) {
      case 'front_wall':
        return dormerThermalRepresentatives.frontWall;
      case 'cheek_walls':
        return dormerThermalRepresentatives.cheekWalls;
      case 'roofs':
        return dormerThermalRepresentatives.roofs;
      case 'window':
        return dormerThermalRepresentatives.window;
      default:
        return null;
    }
  }, [dormerAssemblySection, dormerThermalRepresentatives]);

  const assemblyInitialSnapshot = useMemo((): VulcanAssemblyV1Envelope['assemblySnapshot'] | null => {
    void selectedElementV;
    if (selection?.type !== 'element') return null;
    if (selectedIsDormerAnchor && dormerAssemblySection && dormerAssemblyRepresentative && selectedDormerMetadata) {
      const metadataOverride = selectedDormerMetadata.thermal_overrides[dormerAssemblySection];
      const fallbackOverride = getDormerThermalOverrideExtraJson(
        dormerAssemblyRepresentative.extra_json as Record<string, unknown> | undefined,
      );
      const ex = metadataOverride ?? fallbackOverride ?? {};
      const v = (ex as Record<string, unknown>).vulcan_assembly_v1;
      if (!v || typeof v !== 'object' || v === null) return null;
      const snap = (v as { assemblySnapshot?: unknown }).assemblySnapshot;
      if (!snap || typeof snap !== 'object') return null;
      const layers = (snap as { layers?: unknown }).layers;
      if (!Array.isArray(layers) || layers.length === 0) return null;
      return snap as VulcanAssemblyV1Envelope['assemblySnapshot'];
    }
    const el = getElementById(selection.id);
    const ex = el?.extra_json;
    if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null;
    const v = (ex as Record<string, unknown>).vulcan_assembly_v1;
    if (!v || typeof v !== 'object' || v === null) return null;
    const snap = (v as { assemblySnapshot?: unknown }).assemblySnapshot;
    if (!snap || typeof snap !== 'object') return null;
    const layers = (snap as { layers?: unknown }).layers;
    if (!Array.isArray(layers) || layers.length === 0) return null;
    return snap as VulcanAssemblyV1Envelope['assemblySnapshot'];
  }, [
    selection,
    selectedElementV,
    getElementById,
    selectedIsDormerAnchor,
    dormerAssemblySection,
    dormerAssemblyRepresentative,
    selectedDormerMetadata,
  ]);

  const appliedAssemblyEnvelope = useMemo(() => {
    void selectedElementV;
    if (selection?.type !== 'element') return null;
    if (selectedIsDormerAnchor && dormerAssemblySection && dormerAssemblyRepresentative && selectedDormerMetadata) {
      const metadataOverride = selectedDormerMetadata.thermal_overrides[dormerAssemblySection];
      const fallbackOverride = getDormerThermalOverrideExtraJson(
        dormerAssemblyRepresentative.extra_json as Record<string, unknown> | undefined,
      );
      const ex = metadataOverride ?? fallbackOverride ?? {};
      return parseVulcanAssemblyV1FromExtraJson(ex);
    }
    const el = getElementById(selection.id);
    return parseVulcanAssemblyV1FromExtraJson(el?.extra_json);
  }, [
    selection,
    selectedElementV,
    getElementById,
    selectedIsDormerAnchor,
    dormerAssemblySection,
    dormerAssemblyRepresentative,
    selectedDormerMetadata,
  ]);

  const renderAssemblyActionControl = useCallback(
    (
      envelope: VulcanAssemblyV1Envelope | null | undefined,
      onEdit: () => void,
    ): React.ReactNode => {
      if (!envelope) {
        return (
          <button
            type="button"
            className="btn editor-action-btn editor-action-btn--secondary"
            {...intentPrefetchHandlers(prefetchAssemblyCalculatorModal)}
            onClick={() => {
              prefetchAssemblyCalculatorModal();
              onEdit();
            }}
          >
            Assembly calculator
          </button>
        );
      }

      const assemblyName = assemblyDisplayName(envelope, bundledAssemblyLibrary);
      const assemblyType = assemblyTypeLabelFromMode(envelope.assemblySnapshot?.elementMode);
      const compactLabel = `${assemblyName} · ${assemblyType}`;
      return (
        <div
          className="assembly-action-control"
          title={compactLabel}
        >
          <div className="assembly-action-control__body">
            <div className="assembly-action-control__eyebrow">
              {assemblyType}
            </div>
            <div className="assembly-action-control__name">
              {assemblyName}
            </div>
          </div>
          <button
            type="button"
            className="btn editor-action-btn editor-action-btn--secondary"
            {...intentPrefetchHandlers(prefetchAssemblyCalculatorModal)}
            onClick={() => {
              prefetchAssemblyCalculatorModal();
              onEdit();
            }}
          >
            Edit
          </button>
        </div>
      );
    },
    [bundledAssemblyLibrary],
  );

  const assemblyModalElementMode: AssemblyElementMode = (() => {
    if (selectedIsDormerAnchor && dormerAssemblyRepresentative) {
      return dormerAssemblyRepresentative.type as AssemblyElementMode;
    }
    return elementType as AssemblyElementMode;
  })();

  const assemblyModalPitchDeg = (() => {
    if (selectedIsDormerAnchor && dormerAssemblyRepresentative) {
      if (dormerAssemblyRepresentative.type === 'BuildingElementGround') return 180;
      const rep = dormerAssemblyRepresentative as Element & { pitch?: number };
      const p = rep.pitch;
      return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 90;
    }
    return elementType === 'BuildingElementGround' ? 180 : pitch;
  })();

  const assemblyModalGroundFloorType = (() => {
    if (assemblyModalElementMode !== 'BuildingElementGround') return undefined;
    if (selectedIsDormerAnchor && dormerAssemblyRepresentative?.type === 'BuildingElementGround') {
      const ft = (dormerAssemblyRepresentative as { floor_type?: typeof floorType }).floor_type;
      return ft || floorType || undefined;
    }
    if (elementType === 'BuildingElementGround') return floorType || undefined;
    return undefined;
  })();


  const selectedShape = useMemo(() => {
    return selectedElement ? getElementShape(selectedElement) : null;
  }, [selectedElement]);
  const canFlipSelectedWallOrientation = useMemo(() => {
    if (selection?.type !== 'element') return false;
    if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return false;
    const opaqueElement = selectedElement as BuildingElementOpaque;
    if (opaqueElement.parent_element || opaqueElement.is_external_door === true) return false;
    if (selectedShape !== 'line') return false;
    const coordinates = opaqueElement.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return false;
    const [start, end] = coordinates;
    return Math.hypot(end.x - start.x, end.y - start.y) > 0.01;
  }, [selection?.type, selectedElement, selectedShape]);

  useEffect(() => {
    if (!selectedElement || (selection?.type !== 'element' && selection?.type !== 'global')) return;
    if (
      selectedElement.type !== 'BuildingElementOpaque' &&
      selectedElement.type !== 'BuildingElementTransparent' &&
      !isAdjacentLikeElement(selectedElement)
    ) {
      return;
    }

    const width =
      typeof selectedElement.width === 'number'
        ? roundToTwoDecimals(selectedElement.width)
        : (selectedElement.width ?? '');
    const height =
      typeof selectedElement.height === 'number'
        ? roundToTwoDecimals(selectedElement.height)
        : (selectedElement.height ?? '');
    const area =
      typeof selectedElement.area === 'number'
        ? roundToTwoDecimals(selectedElement.area)
        : (selectedElement.area ?? '');
    widthInputSetValueRef.current(width);
    heightInputSetValueRef.current(height);
    areaInputSetValueRef.current(area);
  }, [selection?.id, selection?.type, selectedElement]);

  // Surface-facing control must read pitch from the store (`selectedElement`), not only local
  // `pitch` state — they can diverge, which made re-picking 0 a no-op and mis-saved CSV.
  const horizontalPolygonControlPitch = useMemo(() => {
    if (selection?.type !== 'element' || !selectedElement) return pitch;
    if (!isAdjacentLikeElement(selectedElement) || getElementShape(selectedElement) !== 'polygon') {
      return pitch;
    }
    const p = (selectedElement as { pitch?: number }).pitch;
    if (typeof p === 'number' && Number.isFinite(p)) {
      return Math.round(p);
    }
    return pitch;
  }, [selection?.type, selectedElement, pitch]);

  // 90° is the wall/line default; a flat horizontal polygon must be 0 or 180. Heal to match parse/export.
  useLayoutEffect(() => {
    if (selection?.type !== 'element' || !selection.id) return;
    const el = getElementById(selection.id);
    if (!el || !isAdjacentLikeElement(el)) return;
    if (getElementShape(el) !== 'polygon') return;
    const p = (el as { pitch?: number }).pitch;
    if (typeof p !== 'number' || !Number.isFinite(p)) return;
    const coords = (el as { coordinates?: Array<{ x: number; y: number; z: number }> }).coordinates;
    const healed = normalizeHorizontalAdjacentPlanPitch(p, coords);
    if (healed !== undefined && healed !== p) {
      updateElement(el.id, { pitch: healed });
    }
  }, [selection?.id, selection?.type, getElementById, updateElement, selectedElement, selectedElementV]);

  const derivedPolygonArea = useMemo((): number => {
    if (!selectedElement?.coordinates || selectedElement.coordinates.length < 3) return 0;
    try { return roundToTwoDecimals(calculatePolygonArea(selectedElement.coordinates)); } catch { return 0; }
  }, [selectedElement]);

  const derivedGroundArea = useMemo((): number => {
    if (selectedElement?.type !== 'BuildingElementGround') return 0;
    if (selectedShape === 'line' && selectedElement.coordinates?.length === 2) {
      const [a, b] = selectedElement.coordinates;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const lineHeight = typeof groundLineHeightInput.value === 'number' && Number.isFinite(groundLineHeightInput.value)
        ? Math.max(0, groundLineHeightInput.value)
        : 0;
      return roundToTwoDecimals(length * lineHeight);
    }
    return roundToTwoDecimals(derivedPolygonArea);
  }, [selectedElement, selectedShape, groundLineHeightInput.value, derivedPolygonArea]);

  const derivedGroundEffectiveArea = useMemo((): number => {
    if (selectedElement?.type !== 'BuildingElementGround') return 0;
    if (selectedShape === 'line') return derivedGroundArea;
    if (typeof selectedElement.area === 'number' && Number.isFinite(selectedElement.area) && selectedElement.area > 0) {
      return roundToTwoDecimals(selectedElement.area);
    }
    return derivedGroundArea;
  }, [selectedElement, selectedShape, derivedGroundArea]);

  const derivedGroundShapePerimeter = useMemo((): number => {
    if (selectedElement?.type !== 'BuildingElementGround' || !selectedElement.coordinates || selectedElement.coordinates.length < 2) {
      return 0;
    }
    if (selectedShape === 'line' && selectedElement.coordinates.length === 2) {
      const [a, b] = selectedElement.coordinates;
      return roundToTwoDecimals(Math.hypot(b.x - a.x, b.y - a.y));
    }
    if (selectedElement.coordinates.length < 3) return 0;
    let perimeter = 0;
    for (let i = 0; i < selectedElement.coordinates.length; i++) {
      const current = selectedElement.coordinates[i];
      const next = selectedElement.coordinates[(i + 1) % selectedElement.coordinates.length];
      perimeter += Math.hypot(next.x - current.x, next.y - current.y);
    }
    return roundToTwoDecimals(perimeter);
  }, [selectedElement, selectedShape]);

  const groundPerimeterDetails = useMemo(() => {
    if (selectedElement?.type !== 'BuildingElementGround') return null;
    return computeGroundExposedPerimeterDetails(elementsById, selectedElement as BuildingElementGround);
  }, [selectedElement, elementsById]);

  const groundPerimeterManual = useMemo((): boolean => {
    if (selectedElement?.type !== 'BuildingElementGround') return false;
    return groundExposedPerimeterManualFlag(readExtraJsonRecord(selectedElement.extra_json));
  }, [selectedElement]);

  const derivedGroundPerimeter = useMemo((): number => {
    if (selectedElement?.type !== 'BuildingElementGround') return 0;
    if (
      groundPerimeterManual &&
      typeof selectedElement.perimeter === 'number' &&
      Number.isFinite(selectedElement.perimeter) &&
      selectedElement.perimeter >= 0
    ) {
      return roundToTwoDecimals(selectedElement.perimeter);
    }
    const details = groundPerimeterDetails;
    if (details && hasReliableGroundExposedPerimeter(details)) {
      return details.valueM;
    }
    return derivedGroundShapePerimeter;
  }, [selectedElement, groundPerimeterManual, groundPerimeterDetails, derivedGroundShapePerimeter]);

  const groundPerimeterBreakdownText = useMemo((): string | null => {
    if (selectedElement?.type !== 'BuildingElementGround' || !groundPerimeterDetails) return null;
    const exposed = groundPerimeterDetails.exposedRuns
      .slice(0, 3)
      .map((run) => `${run.label} ${formatConditionalDecimals(run.lengthM)} m`);
    const exposedSuffix =
      groundPerimeterDetails.exposedRuns.length > exposed.length
        ? ` +${groundPerimeterDetails.exposedRuns.length - exposed.length} more`
        : '';
    const excluded = groundPerimeterDetails.excludedRuns
      .slice(0, 2)
      .map((run) => `${run.label}${run.reason ? ` (${run.reason})` : ''} ${formatConditionalDecimals(run.lengthM)} m`);
    const excludedText = excluded.length > 0 ? ` Excluded: ${excluded.join(', ')}.` : '';
    if (hasReliableGroundExposedPerimeter(groundPerimeterDetails)) {
      const sourceText = exposed.length > 0 ? ` from ${exposed.join(', ')}${exposedSuffix}` : '';
      return `${groundPerimeterManual ? 'Manual override.' : 'Auto exposed perimeter:'} ${formatConditionalDecimals(groundPerimeterDetails.valueM)} m${sourceText}.${excludedText}`;
    }
    if (groundPerimeterDetails.linkedLineCount > 0 && excluded.length > 0) {
      return `No external exposed wall runs on this floor outline.${excludedText}`;
    }
    return `No exposed wall runs found on this floor outline. Drawn outline is ${formatConditionalDecimals(groundPerimeterDetails.shapePerimeterM)} m.`;
  }, [selectedElement, groundPerimeterDetails, groundPerimeterManual]);

  const resetGroundPerimeterToAuto = useCallback(() => {
    const details = groundPerimeterDetails;
    if (selectedElement?.type !== 'BuildingElementGround' || !details || !hasReliableGroundExposedPerimeter(details)) {
      return;
    }
    const extra = { ...readExtraJsonRecord(selectedElement.extra_json) };
    delete extra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY];
    updateElement(selectedElement.id, {
      perimeter: details.valueM,
      extra_json: extra,
    } as Partial<Element>);
  }, [selectedElement, groundPerimeterDetails, updateElement]);

  useEffect(() => {
    if (selection?.type !== 'element') return;
    const current = getElementById(selection.id);
    if (!current || current.type !== 'BuildingElementGround') return;

    const floorTypeForCalc = floorType || current.floor_type || undefined;
    const extra = readExtraJsonRecord(current.extra_json);
    let nextExtra: Record<string, unknown> = { ...extra };
    let changed = false;

    if (floorTypeForCalc === 'Suspended_floor') {
      // Defaults only when fields are missing (JsonForms often stores numbers as strings — use readFiniteNumber).
      if (readFiniteNumber(nextExtra.height_upper_surface) == null) {
        nextExtra.height_upper_surface = SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M;
        changed = true;
      }
      const parsedShield = parseWindShieldLocation(nextExtra.shield_fact_location);
      if (nextExtra.shield_fact_location !== parsedShield) {
        nextExtra.shield_fact_location = parsedShield;
        changed = true;
      }
      // Treat 0 as unset: JsonForms often shows 0 while the field was never meaningfully filled; Part F default should apply.
      const apv = readFiniteNumber(nextExtra.area_per_perimeter_vent);
      if (apv == null || apv === 0) {
        const derivedDefault = defaultSuspendedAreaPerPerimeterVent(derivedGroundArea, derivedGroundPerimeter);
        if (derivedDefault != null) {
          // Must not use roundToTwoDecimals: 0.0015 m²/m (Part F minimum) rounds to 0 and retriggers this effect forever.
          const roundedVent = roundToFourDecimals(derivedDefault);
          if (!numbersClose(apv, roundedVent)) {
            nextExtra.area_per_perimeter_vent = roundedVent;
            changed = true;
          }
        }
      }
    }

    const depthBasementFloor = readFiniteNumber(current.depth_basement_floor);
    const thicknessWalls = typeof thicknessWallsInput.value === 'number' && Number.isFinite(thicknessWallsInput.value)
      ? thicknessWallsInput.value
      : readFiniteNumber(current.thickness_walls) ?? 0;

    const needsBasementDepth =
      floorTypeForCalc === 'Heated_basement' || floorTypeForCalc === 'Unheated_basement';
    const basementDepthOk =
      !needsBasementDepth
      || (depthBasementFloor != null && Number.isFinite(depthBasementFloor) && depthBasementFloor > 0);

    const uComputed =
      derivedGroundArea > 0 && derivedGroundPerimeter > 0 && thicknessWalls > 0 && basementDepthOk
        ? computeGroundUValueFromElementModel(current, nextExtra, floorTypeForCalc, {
            totalArea: derivedGroundArea,
            perimeter: derivedGroundPerimeter,
            thicknessWalls,
            ...(needsBasementDepth && depthBasementFloor != null ? { depthBasementFloorM: depthBasementFloor } : {}),
          })
        : null;

    const uSync = applyComputedGroundUValueAutofill(nextExtra, uComputed);
    if (uSync.changed) {
      nextExtra = uSync.extra;
      changed = true;
    }

    const syncAreaForLine = selectedShape === 'line' ? derivedGroundArea : null;
    const needsGroundSync =
      !numbersClose(readFiniteNumber(current.total_area), derivedGroundArea)
      || !numbersClose(readFiniteNumber(current.perimeter), derivedGroundPerimeter)
      || (syncAreaForLine != null && !numbersClose(readFiniteNumber(current.area), syncAreaForLine));

    if (!changed && !needsGroundSync) return;

    updateElement(current.id, {
      ...(needsGroundSync ? {
        total_area: derivedGroundArea,
        perimeter: derivedGroundPerimeter,
        ...(syncAreaForLine != null ? { area: syncAreaForLine } : {}),
      } : {}),
      ...(changed ? { extra_json: nextExtra } : {}),
    } as Partial<Element>);
  }, [
    selection,
    selectedElementV,
    getElementById,
    updateElement,
    floorType,
    thicknessWallsInput.value,
    derivedGroundArea,
    derivedGroundPerimeter,
    selectedShape,
    numbersClose,
  ]);

  const liveWidthValue = parseLiveDecimalInput(widthInput.inputValue);
  const liveHeightValue = parseLiveDecimalInput(heightInput.inputValue);
  const liveRectArea = useMemo(
    () => roundToTwoDecimals(liveWidthValue * liveHeightValue),
    [liveWidthValue, liveHeightValue],
  );
  const selectedSlopedDimensions = useMemo(() => {
    if (!selectedElement || selectedShape !== 'sloped-polygon') return null;
    if (
      selectedElement.type !== 'BuildingElementOpaque' &&
      selectedElement.type !== 'BuildingElementTransparent' &&
      !ADJACENT_LIKE_ELEMENT_TYPES.includes(selectedElement.type)
    ) {
      return null;
    }
    return deriveSlopedElementDimensions({ ...selectedElement, pitch });
  }, [selectedElement, selectedShape, pitch]);
  const selectedSlopedDimensionNotes = useMemo(() => {
    if (!selectedElement || !selectedSlopedDimensions) return null;
    const semantics = getPolygonScalarDimensionSemantics(
      selectedElement.coordinates,
      selectedSlopedDimensions.width,
    );
    if (!semantics?.usesEquivalentWidth) return null;
    return {
      width: 'Width is equivalent: surface area divided by height, preserving area for tapered shapes.',
      height: 'Height is the true up-slope length of this sloped shape.',
    };
  }, [selectedElement, selectedSlopedDimensions]);
  const selectedPvDimensionNotes = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'OnSiteGeneration') return null;
    const pitchValue = typeof selectedElement.pitch === 'number' ? selectedElement.pitch : pitch;
    const derivedDimensions = derivePvDimensionsFromCoords(selectedElement.coordinates, pitchValue);
    if (!derivedDimensions) return null;
    const semantics = getPolygonScalarDimensionSemantics(
      selectedElement.coordinates,
      derivedDimensions.width,
    );
    if (!semantics?.usesEquivalentWidth) return null;
    return {
      width: 'Width is the low edge of this PV footprint.',
      height: 'Height is equivalent: plan footprint area divided by low-edge width, then pitch-corrected.',
    };
  }, [selectedElement, pitch]);
  const showSlopedWidthReset =
    !!selectedSlopedDimensions &&
    !!selectedElement &&
    (selectedElement as { _widthUserOverride?: boolean })._widthUserOverride === true &&
    Math.abs(liveWidthValue - selectedSlopedDimensions.width) > 0.01;
  const showSlopedHeightReset =
    !!selectedSlopedDimensions &&
    !!selectedElement &&
    (selectedElement as { _heightUserOverride?: boolean })._heightUserOverride === true &&
    Math.abs(liveHeightValue - selectedSlopedDimensions.height) > 0.01;
  const resetSlopedWidthToCanvas = useCallback(() => {
    if (!selectedSlopedDimensions) return;
    widthInput.setValue(selectedSlopedDimensions.width);
    commitExistingElementDraftRef.current({
      width: selectedSlopedDimensions.width,
      _widthUserOverride: false,
    } as Partial<Element>);
  }, [selectedSlopedDimensions, widthInput]);
  const resetSlopedHeightToCanvas = useCallback(() => {
    if (!selectedSlopedDimensions) return;
    heightInput.setValue(selectedSlopedDimensions.height);
    commitExistingElementDraftRef.current({
      height: selectedSlopedDimensions.height,
      _heightUserOverride: false,
    } as Partial<Element>);
  }, [selectedSlopedDimensions, heightInput]);
  const selectedSlopedTransparentNeedsRebuild = useMemo(() => {
    if (
      selectedElement?.type !== 'BuildingElementTransparent' ||
      selectedShape !== 'sloped-polygon' ||
      !selectedSlopedDimensions
    ) {
      return false;
    }
    return slopedPolygonNeedsRectangleRebuild({
      coordinates: selectedElement.coordinates,
      widthM: selectedSlopedDimensions.width,
      heightM: selectedSlopedDimensions.height,
      pitchDegrees: typeof selectedElement.pitch === 'number' ? selectedElement.pitch : pitch,
    });
  }, [selectedElement, selectedShape, selectedSlopedDimensions, pitch]);
  const showSlopedTransparentRebuildOpening =
    selectedElement?.type === 'BuildingElementTransparent' &&
    selectedShape === 'sloped-polygon' &&
    selectedSlopedTransparentNeedsRebuild;
  const rebuildSelectedSlopedTransparentOpening = () => {
    if (
      selectedElement?.type !== 'BuildingElementTransparent' ||
      selectedShape !== 'sloped-polygon' ||
      !selectedSlopedDimensions
    ) return;
    const nextWidth =
      typeof widthInput.value === 'number' && widthInput.value > 0
        ? widthInput.value
        : selectedSlopedDimensions.width;
    const nextHeight =
      typeof heightInput.value === 'number' && heightInput.value > 0
        ? heightInput.value
        : selectedSlopedDimensions.height;
    const patch = buildSlopedPolygonRectangleDimensionPatch({
      coordinates: selectedElement.coordinates,
      widthM: nextWidth,
      heightM: nextHeight,
      pitchDegrees: typeof selectedElement.pitch === 'number' ? selectedElement.pitch : pitch,
    });
    if (!patch) return;
    if (typeof patch.width === 'number') widthInput.setValue(patch.width);
    if (typeof patch.height === 'number') heightInput.setValue(patch.height);
    if (typeof patch.area === 'number') areaInput.setValue(patch.area);
    commitExistingElementDraftRef.current(patch);
  };
  const selectedFieldValidationByKey = useMemo(() => {
    const result = new Map<string, { message: string; variant: 'error' | 'warning' }>();
    if (!selectedElement) return result;
    const validation = validateElement(selectedElement, elementsById);
    for (const issue of validation.issues) {
      if (issue.fieldKey && !result.has(issue.fieldKey)) {
        result.set(issue.fieldKey, { message: issue.message, variant: 'error' });
      }
    }
    for (const warning of validation.warnings) {
      if (warning.fieldKey && !result.has(warning.fieldKey)) {
        result.set(warning.fieldKey, { message: warning.message, variant: 'warning' });
      }
    }
    return result;
  }, [elementsById, selectedElement, validateElement]);
  const getFieldValidationState = (fieldName: string, value: unknown) => {
    const error = getFieldValidationIssue(fieldName, value);
    if (error) return { message: error, variant: 'error' as const };
    return selectedFieldValidationByKey.get(fieldName) ?? null;
  };

  // For opaque walls, show the net area that save/validation use.
  // Gross/openings remain visible as helper information for context.
  const selectedOpaqueAreaSummary = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return null;
    const draftElement = { ...selectedElement, pitch } as Element;
    const grossArea = selectedShape === 'polygon' || selectedShape === 'sloped-polygon'
      ? getElementGrossArea(draftElement)
      : liveRectArea;
    const subtractedArea = getOpaqueOpeningArea(selectedElement, elementsById);
    const clampedNet = Math.max(0, grossArea - subtractedArea);
    return {
      grossArea: roundToTwoDecimals(grossArea),
      netArea: roundToTwoDecimals(clampedNet),
      subtractedArea: roundToTwoDecimals(subtractedArea),
      usesUnheatedPitchedRoofPlanArea: isUnheatedPitchedRoofPlanAreaElement(draftElement),
    };
  }, [selectedElement, selectedShape, pitch, liveRectArea, elementsById]);

  const canMarkUnheatedPitchedRoof = elementType === 'BuildingElementOpaque' && selectedShape === 'sloped-polygon';
  const canMarkExternalDoor = elementType === 'BuildingElementOpaque'
    && selectedShape === 'line'
    && typeof pitch === 'number'
    && Number.isFinite(pitch)
    && Math.round(pitch) === 90;
  const unheatedPitchedRoofCeilingElevationSuggestion = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'BuildingElementOpaque') return null;
    const draftRoof = {
      ...selectedElement,
      pitch,
      base_height: typeof baseHeightInput.value === 'number'
        ? baseHeightInput.value
        : selectedElement.base_height,
      is_unheated_pitched_roof: true,
      extra_json: mergeUnheatedPitchedRoofCeilingElevationExtraJson(selectedElement.extra_json, ''),
    } as BuildingElementOpaque;
    return getUnheatedPitchedRoofCeilingElevationM(
      draftRoof,
      allElements,
      withEffectiveStoreyHeights(floors, allElements),
    );
  }, [selectedElement, pitch, baseHeightInput.value, allElements, floors]);

  const canUseProfileTop = useMemo(() => {
    if (!selectedElement || selectedShape !== 'line') return false;
    const t = selectedElement.type;
    if (
      t !== 'BuildingElementOpaque'
      && t !== 'BuildingElementTransparent'
      && !ADJACENT_LIKE_ELEMENT_TYPES.includes(t)
    ) {
      return false;
    }
    if (selectedIsDormerAnchor) return false;
    const ex = selectedElement.extra_json;
    if (ex && typeof ex === 'object' && !Array.isArray(ex) && (ex as Record<string, unknown>).dormer_bundle) {
      return false;
    }
    if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
      const gf = (ex as Record<string, unknown>).geometry_face;
      if (gf && typeof gf === 'object' && gf !== null && !Array.isArray(gf)) {
        if ((gf as Record<string, unknown>).kind === 'planar-face-3d') return false;
      }
    }
    return true;
  }, [selectedElement, selectedShape, selectedIsDormerAnchor]);

  const profileInitialHeights = useMemo(() => {
    const fromExtra = selectedElement ? extractTopHeightsFromExtraJson(selectedElement.extra_json) : null;
    if (fromExtra && fromExtra.length >= 2) return fromExtra;
    const h =
      selectedElement && 'height' in selectedElement && typeof (selectedElement as { height?: number }).height === 'number'
        ? (selectedElement as { height: number }).height
        : typeof heightInput.value === 'number'
          ? heightInput.value
          : 0;
    return [h, h];
  }, [selectedElement, heightInput.value]);

  const applyLineProfileHeights = useCallback(
    (heights: number[]) => {
      if (!isExistingElementSelection()) return;
      const el = getElementById(selection.id);
      if (!el) return;
      const face = buildProfileLineFaceFromTopHeights(heights);
      if (!face) return;
      const prevEx =
        el.extra_json && typeof el.extra_json === 'object' && !Array.isArray(el.extra_json)
          ? { ...(el.extra_json as Record<string, unknown>) }
          : {};
      const mergedExtra = { ...prevEx, geometry_face: face };
      const draft: Element = { ...el, extra_json: mergedExtra };
      if (!isAreaBasedExportElement(draft)) {
        return;
      }
      const exp = getAreaBasedElementExportGeometry(draft);
      const gross = getElementGrossArea(draft);
      let patch: Partial<Element> = {
        extra_json: mergedExtra,
        width: exp.width,
        height: exp.height,
        area: roundToTwoDecimals(gross),
      };
      if (draft.type === 'BuildingElementTransparent') {
        patch = {
          ...patch,
          mid_height: getTransparentExportMidHeight(draft as BuildingElementTransparent),
        };
      }
      commitExistingElementDraftRef.current(patch);
      widthInput.setValue(roundToTwoDecimals(exp.width));
      heightInput.setValue(roundToTwoDecimals(exp.height));
      if (draft.type === 'BuildingElementTransparent') {
        midHeightInput.setValue(
          roundToTwoDecimals(getTransparentExportMidHeight(draft as BuildingElementTransparent)),
        );
      }
    },
    [
      selection,
      isExistingElementSelection,
      getElementById,
      widthInput,
      heightInput,
      midHeightInput,
    ],
  );

  const clearLineProfile = useCallback(() => {
    if (!isExistingElementSelection()) return;
    const el = getElementById(selection.id);
    if (!el || !el.extra_json || typeof el.extra_json !== 'object' || Array.isArray(el.extra_json)) return;
    const ex = { ...(el.extra_json as Record<string, unknown>) };
    if (!Object.prototype.hasOwnProperty.call(ex, 'geometry_face')) return;
    delete ex.geometry_face;
    const w = 'width' in el && typeof (el as { width?: number }).width === 'number' ? (el as { width: number }).width : 0;
    const h = 'height' in el && typeof (el as { height?: number }).height === 'number' ? (el as { height: number }).height : 0;
    const bh =
      'base_height' in el && typeof (el as { base_height?: number }).base_height === 'number'
        ? (el as { base_height: number }).base_height
        : 0;
    const patch: Partial<Element> = {
      extra_json: ex,
      area: roundToTwoDecimals(w * h),
    };
    if (el.type === 'BuildingElementTransparent') {
      commitExistingElementDraftRef.current({
        ...patch,
        mid_height: roundToTwoDecimals(bh + h / 2),
      } as Partial<Element>);
    } else {
      commitExistingElementDraftRef.current(patch);
    }
  }, [selection, isExistingElementSelection, getElementById]);

  const buildNewElementData = (): Partial<Element> => {
    const viewerElevationPatch =
      elementSupportsGenericElevationControl(elementType, null, floorType) &&
      typeof elementElevationInput.value === 'number' &&
      Number.isFinite(elementElevationInput.value)
        ? { _base_height: roundToTwoDecimals(elementElevationInput.value) }
        : {};
    const baseData = {
      name: elementName.trim(),
      zoneId: elementZoneId,
      floorId: elementFloorId,
      type: elementType,
      ...viewerElevationPatch,
    };

	    switch (elementType) {
		      case 'BuildingElementOpaque':
		        {
		          const width = widthInput.value;
		          const height = heightInput.value;
		          const coldRoofCeilingExtraJson =
		            isUnheatedPitchedRoof && typeof unheatedPitchedRoofCeilingElevationInput.value === 'number'
		              ? mergeUnheatedPitchedRoofCeilingElevationExtraJson(
		                  undefined,
		                  unheatedPitchedRoofCeilingElevationInput.value,
		                )
		              : undefined;
		        return {
		          ...baseData,
		          width,
		          height,
		          area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
		          pitch,
		          orientation360: roundToInt(orientation360),
		          base_height: baseHeightInput.value === '' ? undefined : baseHeightInput.value,
	          is_unheated_pitched_roof: isUnheatedPitchedRoof,
	          is_external_door: isExternalDoor,
		          parent_element: parentElement,
		          ...(coldRoofCeilingExtraJson ? { extra_json: coldRoofCeilingExtraJson } : {}),
		        } as Partial<Element>;
		        }

	      case 'BuildingElementTransparent':
	        {
	          const width = widthInput.value;
	          const height = heightInput.value;
	        return {
	          ...baseData,
	          width,
	          height,
	          area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
          pitch,
          orientation360: roundToInt(orientation360),
	          base_height: baseHeightInput.value === '' ? undefined : baseHeightInput.value,
          parent_element: parentElement,
	          frame_area_fraction: freeAreaFraction === '' ? undefined : freeAreaFraction,
          free_area_height: freeAreaHeightInput.value,
          mid_height: midHeightInput.value,
	          max_window_open_area: maxWindowOpenAreaInput.value,
	        } as Partial<Element>;
	        }

      case 'BuildingElementGround':
        {
          const derivedArea = derivedGroundArea;
          const derivedPerimeter = derivedGroundPerimeter;
          const extraJsonGround = typeof groundLineHeightInput.value === 'number'
            ? { [GROUND_LINE_HEIGHT_EXTRA_KEY]: groundLineHeightInput.value }
            : undefined;
	        return {
	          ...baseData,
	          width: widthInput.value,
	            area: derivedArea,
          pitch,
            total_area: derivedArea,
          perimeter: derivedPerimeter,
	          floor_type: floorType || undefined,
	          depth_basement_floor: depthBasementFloorInput.value === '' ? undefined : depthBasementFloorInput.value,
	          thickness_walls: thicknessWallsInput.value === '' ? undefined : thicknessWallsInput.value,
          extra_json: extraJsonGround,
        } as Partial<Element>;
        }

	      case 'BuildingElementAdjacentConditionedSpace':
	      case 'BuildingElementAdjacentUnconditionedSpace_Simple':
	      case 'BuildingElementPartyWall':
	        {
	          const width = widthInput.value;
	          const height = heightInput.value;
	        return {
	          ...baseData,
	          width,
	          height,
	          area: typeof width === 'number' && typeof height === 'number' ? width * height : undefined,
	          pitch
	        } as Partial<Element>;
	        }

	      case 'ThermalBridgeLinear':
	        return elementFormInstances.ThermalBridgeLinear.buildElementData({ baseData, elementZoneId });

      case 'ThermalBridgePoint':
        return elementFormInstances.ThermalBridgePoint.buildElementData({ baseData, elementZoneId });

      // NEW: CSV v3 element types
      case 'WindowShading':
        return elementFormInstances.WindowShading.buildElementData({ baseData, elementZoneId });

      case 'Lighting':
        return elementFormInstances.Lighting.buildElementData({ baseData, elementZoneId });

	      case 'MechanicalVentilationDuctwork':
	        return elementFormInstances.MechanicalVentilationDuctwork.buildElementData({ baseData, elementZoneId });

      case 'MechanicalVentilationTerminal':
        return elementFormInstances.MechanicalVentilationTerminal.buildElementData({ baseData, elementZoneId });

      case 'WetEmitter':
        return elementFormInstances.WetEmitter.buildElementData({ baseData, elementZoneId });

	      case 'WaterPipework':
	        return elementFormInstances.WaterPipework.buildElementData({ baseData, elementZoneId });

      case 'Appliance':
        return elementFormInstances.Appliance.buildElementData({ baseData, elementZoneId });

      case 'HotWaterDemand':
        return elementFormInstances.HotWaterDemand.buildElementData({ baseData, elementZoneId });

	      case 'ContextShading':
	        return elementFormInstances.ContextShading.buildElementData({ baseData, elementZoneId });

      // NEW: InfiltrationVentilation element types
      case 'Vents':
        return elementFormInstances.Vents.buildElementData({ baseData, elementZoneId });

      case 'MechanicalVentilation':
        return elementFormInstances.MechanicalVentilation.buildElementData({ baseData, elementZoneId });

      case 'CombustionAppliances':
        return elementFormInstances.CombustionAppliances.buildElementData({ baseData, elementZoneId });

      case 'OnSiteGeneration': {
        return elementFormInstances.OnSiteGeneration.buildElementData({ baseData, elementZoneId });
      }

      case 'ElectricBattery': {
        return elementFormInstances.ElectricBattery.buildElementData({ baseData, elementZoneId });
      }

      case 'System':
        return elementFormInstances.System.buildElementData({ baseData, elementZoneId, getZoneNameForElementZoneId });

      default:
        return <div>Select an element type to see attributes</div>;
    }
  };
  useEffect(() => {
    buildNewElementDataRef.current = buildNewElementData;
  });

  // Helper functions for AdvancedFieldsEditor
  const getElementSubtype = (): string | undefined => {
    switch (elementType) {
      case 'BuildingElementGround': {
        // Persisted `floor_type` on the element (store) is authoritative; local `floorType` can lag after updates.
        if (selection.type === 'element' || selection.type === 'global') {
          const el = getElementById(selection.id);
          const persisted =
            el && typeof (el as { floor_type?: string }).floor_type === 'string'
              ? (el as { floor_type: string }).floor_type
              : undefined;
          if (persisted) return persisted;
        }
        return floorType || undefined;
      }
      case 'MechanicalVentilation':
        return elementFormInstances.MechanicalVentilation.subtype();
      case 'WetEmitter':
        return elementFormInstances.WetEmitter.subtype();
      case 'Appliance':
        return elementFormInstances.Appliance.subtype();
      case 'HotWaterDemand':
        return elementFormInstances.HotWaterDemand.subtype();
      case 'WindowShading':
        return elementFormInstances.WindowShading.subtype();
      case 'ContextShading':
        return elementFormInstances.ContextShading.subtype();
      case 'CombustionAppliances':
        return elementFormInstances.CombustionAppliances.subtype();
      case 'OnSiteGeneration':
        return elementFormInstances.OnSiteGeneration.subtype();
      case 'ElectricBattery':
        return elementFormInstances.ElectricBattery.subtype();
      case 'System':
        return elementFormInstances.System.subtype();
      default:
        return undefined;
    }
  };

  const getCurrentElementData = () => {
    if (selection.type === 'element' || selection.type === 'global') {
      const element = getElementById(selection.id);
      return element || {};
    }
    return {};
  };

  const getCurrentElementExtraJson = () => {
    const current = getCurrentElementData();
    return readExtraJsonRecord('extra_json' in current ? current.extra_json : undefined);
  };

  const resyncGroundThicknessWallsFromAssemblies = useCallback(() => {
    if (selection?.type !== 'element') return;
    const current = getElementById(selection.id);
    if (!current || current.type !== 'BuildingElementGround') return;
    const th = computeWeightedExternalWallAssemblyThicknessForGroundElement(elementsById, current);
    if (th == null) return;
    const ex = readExtraJsonRecord(current.extra_json);
    const rest = { ...ex };
    delete rest[THICKNESS_WALLS_MANUAL_KEY];
    updateElement(current.id, {
      thickness_walls: th,
      extra_json: rest,
    } as Partial<Element>);
  }, [selection, getElementById, elementsById, updateElement]);

  const groundWallThicknessAutofill = useMemo(() => {
    if (selection?.type !== 'element') return { valueM: null, areaTotalM2: 0, sources: [], candidateCount: 0 };
    const current = getElementById(selection.id);
    if (!current || current.type !== 'BuildingElementGround') {
      return { valueM: null, areaTotalM2: 0, sources: [], candidateCount: 0 };
    }
    return computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement(elementsById, current);
  }, [selection, getElementById, elementsById]);

  const liveThicknessWallsValue = (() => {
    const raw = thicknessWallsInput.inputValue.trim();
    if (raw === '') return null;
    const parsed = parseLiveDecimalInput(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  const handleAdvancedFieldsChange = useCallback((updatedData: AdvancedFieldsElementPatch) => {
    let nextUpdatedData: AdvancedFieldsElementPatch = updatedData;
    // This will be called when advanced fields change
    // The data is already updated in the AdvancedFieldsEditor
    // We just need to trigger a re-render or update the store
    if (isSystemElementType) {
      const currentSystemElement = readSelectedSystemElement(
        selection,
        (id) => getElementById(id) as {
          type?: unknown;
          extra_json?: unknown;
          system_preset?: unknown;
          subcategory?: unknown;
        } | undefined,
      );
      const currentSystemSource =
        currentSystemElement
          ? getSystemElementSourceFromState(currentSystemElement.system_preset, currentSystemElement.extra_json)
          : 'presets';
      const updatedExtra =
        updatedData &&
        typeof updatedData === 'object' &&
        updatedData.extra_json &&
        typeof updatedData.extra_json === 'object' &&
        !Array.isArray(updatedData.extra_json)
          ? (updatedData.extra_json as Record<string, unknown>)
          : null;
      if (currentSystemSource === 'pcdb') {
        traceSystemFlow('advanced-fields-system-skipped-pcdb-source', {
          updatedHasPcdb:
            !!updatedExtra?._pcdb &&
            typeof updatedExtra._pcdb === 'object' &&
            !Array.isArray(updatedExtra._pcdb),
        });
        return;
      }
      if (currentSystemElement) {
        const currentExtra = readExtraJsonRecord(currentSystemElement.extra_json);
        const nextExtra = readExtraJsonRecord(updatedData?.extra_json);
        const extraUnchanged = areDormerThermalOverridesEqual(currentExtra, nextExtra);
        const presetUnchanged =
          (currentSystemElement.system_preset == null ? '' : String(currentSystemElement.system_preset)) ===
          (updatedData?.system_preset == null ? '' : String(updatedData.system_preset));
        const subcategoryUnchanged =
          (currentSystemElement.subcategory == null ? '' : String(currentSystemElement.subcategory)) ===
          (updatedData?.subcategory == null ? '' : String(updatedData.subcategory));
        if (extraUnchanged && presetUnchanged && subcategoryUnchanged) {
          traceSystemFlow('advanced-fields-system-noop-skipped');
          return;
        }
      }
      traceSystemFlow('advanced-fields-change', {
        updatedHasPcdb:
          !!updatedExtra?._pcdb &&
          typeof updatedExtra._pcdb === 'object' &&
          !Array.isArray(updatedExtra._pcdb),
        updatedExtraKeys: updatedExtra ? Object.keys(updatedExtra) : [],
      });
      if (currentSystemSource === 'presets' && updatedExtra) {
        nextUpdatedData = {
          ...updatedData,
          extra_json: {
            ...updatedExtra,
            [SYSTEM_SOURCE_META_KEY]: 'custom',
          },
        };
      }
    }
    if (
      isSystemElementType &&
      nextUpdatedData &&
      typeof nextUpdatedData === 'object' &&
      (selection.type === 'element' || selection.type === 'global')
    ) {
      const currentElement = getElementById(selection.id);
      if (currentElement?.type === 'System' && currentElement.subcategory === 'SpaceHeatSystem') {
        const sourceExtraJson = Object.prototype.hasOwnProperty.call(nextUpdatedData, 'extra_json')
          ? nextUpdatedData.extra_json
          : currentElement.extra_json;
        const nextZoneId = Object.prototype.hasOwnProperty.call(nextUpdatedData, 'zoneId')
          ? nextUpdatedData.zoneId
          : currentElement.zoneId;
        const syncedExtraJson = syncSpaceHeatSystemZoneNameInExtraJson(
          sourceExtraJson,
          getZoneNameForElementZoneId(nextZoneId),
        );
        if (syncedExtraJson && syncedExtraJson !== sourceExtraJson) {
          nextUpdatedData = {
            ...nextUpdatedData,
            extra_json: syncedExtraJson,
          };
        }
      }
    }
    if (selection.type === 'element' || selection.type === 'global') {

      updateElement(selection.id, nextUpdatedData);
    }
  }, [getElementById, getZoneNameForElementZoneId, isSystemElementType, selection, traceSystemFlow, updateElement]);

  const renderDormerThermalAccordionSection = (
    title: string,
    description: string,
    sectionKey: DormerThermalSectionKey,
    element: Element | null,
  ) => {
    const currentData = buildDormerThermalEditorData(sectionKey, element);
    if (!currentData) return null;

    return (
      <details
        key={sectionKey}
        className="dormer-editor-section"
      >
        <summary>
          {title}
        </summary>
        <div className="dormer-editor-section__body">
          <div className="dormer-editor-section__description" style={INLINE_FIELD_NOTE_STYLE}>
            {description}
          </div>
          {sectionKey !== 'window' &&
            element &&
              element.type !== 'BuildingElementTransparent' &&
              (element.type === 'BuildingElementOpaque' ||
                element.type === 'BuildingElementGround' ||
                ADJACENT_LIKE_ELEMENT_TYPES.includes(element.type)) && (
              <div className="dormer-editor-section__action">
                {renderAssemblyActionControl(
                  parseVulcanAssemblyV1FromExtraJson(currentData.extra_json),
                  () => {
                    setDormerAssemblySection(sectionKey);
                    setAssemblyCalculatorOpen(true);
                  },
                )}
              </div>
            )}
          <React.Suspense fallback={<LazyInlineFallback label="Opening advanced fields..." />}>
            <AdvancedFieldsEditor
              elementType={currentData.type}
              subtype={getElementSubtype()}
              currentData={currentData}
              onChange={(updatedData) => {
                commitDormerThermalSectionChanges(
                  sectionKey,
                  updatedData as Partial<Element> & { extra_json?: Record<string, unknown> },
                );
              }}
              collapsible={false}
              fieldIndicators={comparisonFieldIndicators}
              evidenceFieldKeys={evidenceBridge.linkedFieldKeys}
              focusFieldKey={comparisonFocusRequest?.fieldKey}
              focusFieldVersion={comparisonFocusRequest?.version}
              flat={advancedFlat}
              useFHSSchema={useFHSSchema}
              inspectorContributions={inspectorContributions}
              workspaceResourcePort={workspaceResourcePort}
              className="advanced-fields-section"
            />
          </React.Suspense>
        </div>
      </details>
    );
  };

  const profileTopControl =
    canUseProfileTop && isExistingElementSelection() ? (
      <>
        <button
          type="button"
          className="btn btn-ghost btn-sm element-editor-input-action"
          onClick={() => setProfileHeightsPopoverOpen((open) => !open)}
          style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
        >
          Profile top
        </button>
        <ProfileHeightsPopover
          open={profileHeightsPopoverOpen}
          onClose={() => setProfileHeightsPopoverOpen(false)}
          initialHeights={profileInitialHeights}
          onApply={applyLineProfileHeights}
          onClear={clearLineProfile}
        />
      </>
    ) : null;

  const applyHostedParentElement = useCallback(
    (value: string, emptyParentValue: string | null) => {
      setParentElement(value);
      const parent = getParentByName(elementsById, elementIds, value);
      if (parent) {
        if ('pitch' in parent && typeof parent.pitch === 'number') {
          setPitch(parent.pitch);
        }
        const parentOrientation = getParentOrientation360(
          parent,
          geometryStore.getState().globalOrientationOffset,
        );
        if (typeof parentOrientation === 'number') {
          setOrientation360(parentOrientation);
        }
      }

      if (selection?.type !== 'element') return;
      const current = getElementById(selection.id);
      updateElement(
        selection.id,
        buildHostedLinearParentPatch(
          current,
          parent,
          value,
          emptyParentValue,
          geometryStore.getState().globalOrientationOffset,
        ),
      );
    },
    [
      elementIds,
      elementsById,
      geometryStore,
      getElementById,
      selection,
      setOrientation360,
      setParentElement,
      setPitch,
      updateElement,
    ],
  );

  const renderLinearDimensionsFields = (
    fieldRef: (fieldKey: string) => (el: HTMLDivElement | null) => void,
    options: { widthStep: string; heightStep: string; includeProfileTop?: boolean },
  ) => {
    const widthValidation = getFieldValidationState('width', liveWidthValue);
    const heightValidation = getFieldValidationState('height', liveHeightValue);
    return (
      <>
        {renderFieldLabel('Width (m):', elementType, 'width')}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={fieldRef('width')}
        >
          <StandardInput
            {...decimalInputProps(widthInput)}
            unit={fieldUnit('width')}
            step={options.widthStep}
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          {showSlopedWidthReset ? (
            <ResetFieldButton
              align="inline"
              title={`Use shape-calculated sloped width (${selectedSlopedDimensions?.width ?? ''} m)`}
              ariaLabel="Use shape calculated width"
              label="Use shape calculated"
              onClick={resetSlopedWidthToCanvas}
            />
          ) : null}
          <FieldValidationIndicator
            hasIssue={!!widthValidation}
            issue={widthValidation?.message}
            variant={widthValidation?.variant}
          />
        </div>
        {selectedSlopedDimensionNotes?.width ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedSlopedDimensionNotes.width}
          </div>
        ) : null}
        {renderFieldLabel('Height (m):', elementType, 'height')}
        <div
          className="element-input"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          ref={fieldRef('height')}
        >
          <StandardInput
            {...decimalInputProps(heightInput)}
            unit={fieldUnit('height')}
            step={options.heightStep}
            min="0"
            variant="ghost"
            size="md"
            className="flex-1"
          />
          {showSlopedHeightReset ? (
            <ResetFieldButton
              align="inline"
              title={`Use shape-calculated sloped height (${selectedSlopedDimensions?.height ?? ''} m)`}
              ariaLabel="Use shape calculated height"
              label="Use shape calculated"
              onClick={resetSlopedHeightToCanvas}
            />
          ) : null}
          {options.includeProfileTop ? profileTopControl : null}
          <FieldValidationIndicator
            hasIssue={!!heightValidation}
            issue={heightValidation?.message}
            variant={heightValidation?.variant}
          />
        </div>
        {selectedSlopedDimensionNotes?.height ? (
          <div style={INLINE_FIELD_NOTE_STYLE}>
            {selectedSlopedDimensionNotes.height}
          </div>
        ) : null}
      </>
    );
  };

  // MVHR duct/terminal manager cluster (selectedMvhrUnit, select/create/draw
  // helpers, the manager render function, MVHR_MANAGER_* styles) moved to
  // MvhrDuctTerminalManager.tsx — see that file's header comment. Called
  // unconditionally here, in the same position the inline block used to
  // occupy, so Rules of Hooks are satisfied exactly as before.
  const renderMvhrDuctAndTerminalManager = useMvhrDuctTerminalManager({
    selection,
    elementsById,
    getElementById,
    addElement,
    updateElement,
    setSelection,
    setSelectedElementIds,
    geometryStore,
    onStartMvhrDuctDraw,
    onStartMvhrTerminalDraw,
  });

  // System<->WetEmitter cross-creation bridge callbacks (slice-5 brief decision
  // (f).1, CONSERVATIVE option): the six handlers above (createSpaceHeat
  // SystemForCurrentEmitter, handleSpaceHeatSystemDropdownChange,
  // handleCreateRadiatorForSelectedSpaceHeatSystem,
  // handleEditSelectedWetEmitterSpaceHeatSystem,
  // handleEditSelectedSpaceHeatSystemHeatSource,
  // handleSpaceHeatSystemEmitterToggle) stay orchestrator-owned — they read/
  // write allElements, addElement, setSelection/setSelectedElementIds, none of
  // which the generic ctx exposes — and are injected into the two per-family
  // form modules as zero-arg render callbacks, same precedent as
  // renderMvhrDuctAndTerminalManager above. Store-level cross-creation
  // consolidation (stage 4) is explicitly out of scope for this slice. These
  // wrap the exact JSX the legacy inline panels rendered, so
  // moving/registering them here is a zero-behaviour-change step.
  //
  // STAGE 3 WIDENING: decision (f).1's own text maps THREE handlers — not
  // just two — onto renderSpaceHeatSystemEmitterManager (handleEditSelected
  // SpaceHeatSystemHeatSource, handleSpaceHeatSystemEmitterToggle,
  // handleCreateRadiatorForSelectedSpaceHeatSystem). Stage 1 only wired the
  // emitter-dropdown block below because System's own panel was still
  // inline then, so the heat-source dropdown + its "Edit" jump-link were
  // still directly reachable from the same scope. Now that
  // elementForms/system.tsx owns System's panel, handleEditSelectedSpace
  // HeatSystemHeatSource's call site (the "Edit" button beside the
  // heat-source dropdown) would otherwise sit inside module code with no
  // access to this orchestrator closure — so this callback's JSX boundary
  // widens to cover the whole "Heat source select + Edit + Emitters"
  // fragment, verbatim from the legacy inline panel, not just the
  // SpaceHeatSystemEmitterDropdown. handleSpaceHeatSystemHeatSourceChange
  // (the heat-source dropdown's onChange) stays here too as a result — it
  // shares that one flex row with the orchestrator-only Edit button and
  // can't be split from it without fragmenting a single JSX row across the
  // module boundary, even though the brief's per-family inventory listed it
  // under System's "source-switch machinery" to move. This is a pure
  // JSX-boundary move with zero behaviour change: the legacy gate
  // `systemSubcategory === 'SpaceHeatSystem' && selectedSpaceHeatSystemUsesHeatSourceWet`
  // is preserved by AND-splitting it — elementForms/system.tsx's renderPanel
  // checks `systemSubcategory === 'SpaceHeatSystem'` (module-owned state) at
  // its call site before invoking this callback, and this callback keeps
  // the `selectedSpaceHeatSystemUsesHeatSourceWet` half, which itself
  // re-derives the STORE's subcategory via selectedSystemElementFull,
  // independent of the module's local draft state. heatSourceWetReference
  // Options/selectedSpaceHeatSystemHeatSourceName/...HeatSourceElement/
  // ...IsWetDistribution/...LinkedEmitterElements/...AvailableEmitterElements
  // consequently all stay orchestrator-owned too — this callback is their
  // only remaining consumer. See elementForms/system.tsx's header for the
  // full per-memo partition table this widening produces.
  //
  // Both callbacks below are now invoked exclusively through
  // formRenderCtx.renderSpaceHeatSystemPicker() / .renderSpaceHeatSystemEmitterManager()
  // from wetEmitter.tsx/system.tsx's own renderPanel — the eslint-plugin-
  // react-hooks "refs" false positive noted in earlier slices (see
  // eslint.config.js's header comment on the 7.1.1 pin) does not fire across
  // that module boundary, confirmed by the eslint gate on both new/changed
  // files staying clean.
  const renderSpaceHeatSystemPicker = (): React.ReactNode => (
    <>
      {renderFieldLabel('Space heat system:', elementType)}
      <div
        className="element-input"
        style={EDITOR_FIELD_ACTION_ROW_STYLE}
        ref={registerBaseFieldRefs('space_heat_system')}
      >
        <div style={EDITOR_FIELD_ACTION_FIELD_STYLE}>
          <StandardDropdown
            value={spaceHeatSystem}
            onChange={handleSpaceHeatSystemDropdownChange}
            options={spaceHeatSystemOptions}
            variant="ghost"
            size="md"
          />
        </div>
        {selectedSpaceHeatSystemForEmitter ? (
          <button
            type="button"
            className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
            onClick={handleEditSelectedWetEmitterSpaceHeatSystem}
          >
            Edit
          </button>
        ) : null}
      </div>
    </>
  );

  const renderSpaceHeatSystemEmitterManager = (): React.ReactNode => (
    selectedSpaceHeatSystemUsesHeatSourceWet ? (
      <>
        {renderFieldLabel('Heat source:', elementType)}
        <div className="element-input" style={EDITOR_FIELD_ACTION_ROW_STYLE}>
          <div style={EDITOR_FIELD_ACTION_FIELD_STYLE}>
            <StandardDropdown
              value={selectedSpaceHeatSystemHeatSourceName}
              onChange={handleSpaceHeatSystemHeatSourceChange}
              options={[
                {
                  value: '',
                  label: heatSourceWetReferenceOptions.length > 0
                    ? 'Select heat source'
                    : 'Create HeatSourceWet first',
                  disabled: heatSourceWetReferenceOptions.length === 0,
                },
                ...heatSourceWetReferenceOptions,
              ]}
              variant="ghost"
              size="md"
            />
          </div>
          {selectedSpaceHeatSystemHeatSourceElement ? (
            <button
              type="button"
              className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
              onClick={handleEditSelectedSpaceHeatSystemHeatSource}
            >
              Edit
            </button>
          ) : null}
        </div>
        {selectedSpaceHeatSystemIsWetDistribution ? (
          <>
            {renderFieldLabel('Emitters:', elementType)}
            <div className="element-input">
              <SpaceHeatSystemEmitterDropdown
                linkedEmitters={selectedSpaceHeatSystemLinkedEmitterElements}
                availableEmitters={selectedSpaceHeatSystemAvailableEmitterElements}
                onToggleEmitter={handleSpaceHeatSystemEmitterToggle}
                onCreateRadiator={handleCreateRadiatorForSelectedSpaceHeatSystem}
              />
            </div>
          </>
        ) : null}
      </>
    ) : null
  );

  const renderAttributePanel = () => {
    const formRenderCtx: ElementFormRenderCtx = {
      elementType,
      fieldUnit,
      renderFieldLabel,
      renderFieldLabelWithComparisonIndicator,
      registerBaseFieldRefs,
      registerBaseFieldRef,
      getFieldValidationIssue,
      comparisonFieldIndicators,
      globalComparisonFieldIndicators,
      commitExistingElementDraft,
      selection,
      getElementById,
      updateElement,
      getGlobalOrientationOffset: () => geometryStore.getState().globalOrientationOffset,
      onSiteHostDerivation,
      selectedPvDimensionNotes,
      elementZoneId,
      elementIds,
      elementsById,
      thermalBridgeJunction: {
        DetailedJunctionControl,
        onHostReadinessAction: handleDetailedJunctionHostReadinessAction,
      },
      renderMvhrDuctAndTerminalManager,
      productCatalogue,
      renderSpaceHeatSystemPicker,
      renderSpaceHeatSystemEmitterManager,
    };
    switch (elementType) {
      case 'BuildingElementOpaque':
        return selectedIsDormerAnchor ? (
          <>
            {renderFieldLabel('Host Roof:', elementType, 'parent_element')}
            <div className="element-input">
              <ParentElementDropdown
                value={parentElement}
                onChange={(value) => {
                  setParentElement(value);
                  commitDormerAnchorChanges({ hostName: value });
                }}
                elementType={elementType}
                zoneId={elementZoneId}
                placeholder="Select the sloped roof hosting this dormer"
                selfId={selection.type === 'element' ? selection.id : undefined}
              />
              <div style={INLINE_FIELD_NOTE_STYLE}>
                Changes regenerate the dormer roof, cheek walls, window, and roof cutout instantly.
              </div>
            </div>
            {renderFieldLabel('Dormer Shape:', elementType)}
            <div className="element-input">
              <StandardDropdown
                value={selectedDormerType}
                onChange={(value) => {
                  const nextValue = value as DormerType;
                  setSelectedDormerType(nextValue);
                  commitDormerAnchorChanges({ parameters: { dormerType: nextValue } });
                }}
                options={[
                  { value: 'mono-pitch', label: 'Mono-pitch' },
                  { value: 'gable-front', label: 'Gable-front' },
                  { value: 'hip', label: 'Hip' },
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Dormer Width (m):', elementType, 'width')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerWidthInput)}
                unit={fieldUnit('width')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Dormer Depth (derived):', elementType, 'depth')}
            <div className="element-input">
              <StandardInput
	                  type="text"
	                  inputMode="numeric"
                value={formatConditionalDecimals(dormerDepth)}
                unit={fieldUnit('depth')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
                readOnly
              />
            </div>
            {renderFieldLabel('Front Wall Height (m):', elementType, 'height')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerFrontWallHeightInput)}
                unit={fieldUnit('height')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            {selectedDormerType === 'mono-pitch' ? (
              <>
                {renderFieldLabel('Dormer Roof Pitch (degrees):', elementType, 'pitch')}
                <div className="element-input">
                  <StandardInput
                    {...decimalInputProps(dormerRoofPitchInput)}
                    unit={fieldUnit('pitch')}
                    step="1"
                    min="0"
                    max="89"
                    variant="ghost"
                    size="md"
                  />
                </div>
              </>
            ) : (
              <>
                {renderFieldLabel('Side Roof Pitch (degrees):', elementType, 'pitch')}
                <div className="element-input">
                  <StandardInput
                    {...decimalInputProps(gableRoofPitchInput)}
                    unit={fieldUnit('pitch')}
                    step="1"
                    min="1"
                    max="89"
                    variant="ghost"
                    size="md"
                  />
                </div>
              </>
            )}
            {renderFieldLabel('Unheated Pitched Roof', elementType)}
            <div className="element-input">
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  className="styled-checkbox"
                  checked={!!dormerRoofIsUnheatedPitchedRoof}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setDormerRoofIsUnheatedPitchedRoof(checked);
                    commitDormerAnchorChanges({ parameters: { isUnheatedPitchedRoof: checked } });
                  }}
                  id="dormer-unheated-pitched-roof"
                />
                <span className="checkbox-custom"></span>
              </label>
            </div>
            {renderFieldLabel('Window Width (m):', 'BuildingElementTransparent', 'width')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerWindowWidthInput)}
                unit={fieldUnit('width', 'BuildingElementTransparent')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Window Height (m):', 'BuildingElementTransparent', 'height')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerWindowHeightInput)}
                unit={fieldUnit('height', 'BuildingElementTransparent')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Window Sill Height (m):', 'BuildingElementTransparent', 'base_height')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerWindowSillHeightInput)}
                unit={fieldUnit('base_height', 'BuildingElementTransparent')}
                step="0.1"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Window Frame Area Fraction:', 'BuildingElementTransparent', 'frame_area_fraction')}
            <div className="element-input">
              <StandardInput
                {...decimalInputProps(dormerFrameAreaFractionInput)}
                unit={fieldUnit('frame_area_fraction', 'BuildingElementTransparent')}
                step="0.01"
                min="0"
                max="1"
                variant="ghost"
                size="md"
              />
            </div>
          </>
        ) : (
          <>
            {renderFieldLabel('Parent Element:', elementType, 'parent_element')}
            <div className="element-input">
              <ParentElementDropdown
                value={parentElement}
                onChange={(value) => applyHostedParentElement(value, null)}
                elementType={elementType}
                zoneId={elementZoneId}
                placeholder="Select a parent opaque element (optional)"
                selfId={selection.type === 'element' ? selection.id : undefined}
              />
            </div>
            {selectedShape !== 'polygon' && (
              renderLinearDimensionsFields(registerBaseFieldRefs, {
                widthStep: '0.1',
                heightStep: '0.1',
                includeProfileTop: true,
              })
            )}
            {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRef('area')}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={formatToTwoDecimals(selectedOpaqueAreaSummary ? selectedOpaqueAreaSummary.netArea : (selectedShape === 'polygon' ? derivedPolygonArea : liveRectArea))}
                unit={fieldUnit('area')}
                readOnly
                variant="ghost"
                size="md"
              />
              {selectedOpaqueAreaSummary && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Gross area: {formatToTwoDecimals(selectedOpaqueAreaSummary.grossArea)} m²
                  {selectedOpaqueAreaSummary.subtractedArea > 0
                    ? ` · Linked openings / cutouts subtracted: ${formatToTwoDecimals(selectedOpaqueAreaSummary.subtractedArea)} m²`
                    : ' · No linked openings or cutouts subtracted'}
                </div>
              )}
              {selectedOpaqueAreaSummary?.usesUnheatedPitchedRoofPlanArea ? (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Exported as horizontal ceiling/plan area for this unheated pitched roof; the sloped roof surface is not the heat-loss area.
                </div>
              ) : null}
            </div>
            {renderFieldLabel(selectedShape === 'polygon' ? 'Surface facing:' : 'Pitch (degrees):', elementType, 'pitch')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('pitch')}>
              {selectedShape === 'polygon' ? (
                <StandardDropdown
                  value={horizontalPolygonSurfaceSelectValue(horizontalPolygonControlPitch)}
                  onChange={(value) => {
                    if (value !== '0' && value !== '180') return;
                    const next = value === '180' ? 180 : 0;
                    setPitch(next);
                    if (selection.type === 'element') {
                      updateElement(selection.id, { pitch: next });
                    }
                  }}
                  options={HORIZONTAL_POLYGON_PITCH_OPTIONS}
                  placeholder={HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER}
                  unit={fieldUnit('pitch')}
                  variant="ghost"
                  size="md"
                  disabled={!!parentElement}
                />
              ) : (
                <StandardInput
                  type="text"
                  inputMode="decimal"
                  value={pitchDraftInput.inputValue}
                  unit={fieldUnit('pitch')}
                  onChange={pitchDraftInput.handleInputChange}
                  onBlur={pitchDraftInput.handleBlur}
                  min="0"
                  max="180"
                  readOnly={!!parentElement}
                  variant="ghost"
                  size="md"
                />
              )}
              {selectedShape !== 'polygon' && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  {pitch === 0
                    ? 'Facing up (horizontal)'
                    : pitch === 90
                      ? 'Vertical'
                      : pitch === 180
                        ? 'Facing down (horizontal)'
                        : 'Angled surface'}
                </div>
              )}
              {parentElement && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Inherited from parent: {parentElement}
                </div>
              )}
            </div>
            {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('orientation360')}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <StandardInput
                    type="text"
                    inputMode="numeric"
                    value={Number.isFinite(orientation360) ? orientation360 : 0}
                    unit={fieldUnit('orientation360')}
                    onChange={(e) => setOrientation360(Math.round(parseFloat(e.target.value) || 0))}
                    onBlur={(e) => {
                      const parsed = Math.round(parseFloat(e.currentTarget.value) || 0);
                      setOrientation360(parsed);
                      applyOrientationToGeometry(parsed);
                    }}
                    step="1"
                    min="0"
                    max="360"
                    readOnly={!!parentElement}
                    variant="ghost"
                    size="md"
                  />
                </div>
                {canFlipSelectedWallOrientation && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm element-editor-input-action"
                    title="Flip orientation by 180 degrees"
                    onClick={() => {
                      if (selection?.type === 'element') {
                        flipElementOrientation(selection.id);
                      }
                    }}
                    style={{
                      flex: '0 0 auto',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Flip 180°
                  </button>
                )}
              </div>
              {parentElement && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Inherited from parent: {parentElement}
                </div>
              )}
            </div>
            {renderFieldLabel('Base Height (m):', elementType, 'base_height')}
            <div
              className="element-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
              ref={registerBaseFieldRefs('base_height')}
            >
              <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
                <div
                  className={
                    baseHeightResetTarget && typeof baseHeightInput.value === 'number' && Math.abs(baseHeightInput.value - baseHeightResetTarget.value) > 0.01
                      ? 'custom-value'
                      : ''
                  }
                  style={{ flex: 1 }}
                >
                  <StandardInput
                    {...decimalInputProps(baseHeightInput)}
                    unit={fieldUnit('base_height')}
                    step="0.01"
                    min={baseHeightResetTarget && baseHeightResetTarget.value < 0 ? undefined : '0'}
                    variant="ghost"
                    size="md"
                    className="flex-1"
                    placeholder={baseHeightResetTarget ? String(baseHeightResetTarget.value) : undefined}
                  />
                </div>
                {baseHeightResetTarget && typeof baseHeightInput.value === 'number' && Math.abs(baseHeightInput.value - baseHeightResetTarget.value) > 0.01 && (
                  <ResetFieldButton
                    onClick={() => {
                      baseHeightInput.setValue(baseHeightResetTarget.value);
                      commitExistingElementDraft({ base_height: baseHeightResetTarget.value });
                    }}
                    align="inline"
                    title={baseHeightResetTarget.title}
                    ariaLabel="Reset Base Height"
                    label="Reset"
                  />
                )}
              </div>
              {baseHeightResetTarget ? (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  {typeof baseHeightInput.value === 'number' && Math.abs(baseHeightInput.value - baseHeightResetTarget.value) > 0.01
                    ? `Default: ${baseHeightResetTarget.value} m · ${baseHeightResetTarget.note}`
                    : `Suggested: ${baseHeightResetTarget.value} m · ${baseHeightResetTarget.note}`}
                </div>
              ) : null}
            </div>
            {canMarkUnheatedPitchedRoof ? (
              <>
                {renderFieldLabel('Unheated Pitched Roof', elementType)}
                <div className="element-input">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      className="styled-checkbox"
                      checked={!!isUnheatedPitchedRoof}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsUnheatedPitchedRoof(checked);
                        if (checked) setIsExternalDoor(false);
                        commitExistingElementDraft({
                          is_unheated_pitched_roof: checked,
                          ...(checked ? { is_external_door: false } : {}),
                        });
                      }}
                      id="unheated-pitched-roof"
                    />
                    <span className="checkbox-custom"></span>
                  </label>
	                </div>
	              </>
	            ) : null}
	            {canMarkUnheatedPitchedRoof && isUnheatedPitchedRoof ? (
	              <>
	                {renderFieldLabel(
	                  'Ceiling / heat-loss boundary elevation (m):',
	                  elementType,
	                  UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
	                )}
	                <div
	                  className="element-input"
	                  style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
	                  ref={registerBaseFieldRefs([
	                    UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
	                    'ceiling_elevation',
	                  ])}
	                >
	                  <StandardInput
	                    {...decimalInputProps(unheatedPitchedRoofCeilingElevationInput)}
	                    unit={fieldUnit(UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY)}
	                    step="0.01"
	                    min="0"
	                    variant="ghost"
	                    size="md"
	                    className="flex-1"
	                    placeholder={
	                      unheatedPitchedRoofCeilingElevationSuggestion
	                        ? String(unheatedPitchedRoofCeilingElevationSuggestion.value)
	                        : undefined
	                    }
	                  />
	                  {unheatedPitchedRoofCeilingElevationSuggestion ? (
	                    <div style={INLINE_FIELD_NOTE_STYLE}>
	                      Blank = automatic {unheatedPitchedRoofCeilingElevationSuggestion.value} m from {unheatedPitchedRoofCeilingElevationSourceLabel(unheatedPitchedRoofCeilingElevationSuggestion.source)}. Used for 3D and auto thermal bridges; HEM base height remains the roof-plane base.
	                    </div>
	                  ) : null}
	                </div>
	              </>
	            ) : null}
	            {canMarkExternalDoor ? (
	              <>
                {renderFieldLabel('External Door', elementType)}
                <div className="element-input">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      className="styled-checkbox"
                      checked={!!isExternalDoor}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setIsExternalDoor(checked);
                        if (checked) setIsUnheatedPitchedRoof(false);
                        commitExistingElementDraft({
                          is_external_door: checked,
                          ...(checked ? { is_unheated_pitched_roof: false } : {}),
                        });
                      }}
                      id="external-door"
                    />
                    <span className="checkbox-custom"></span>
                  </label>
                </div>
              </>
            ) : null}
          </>
        );

      case 'BuildingElementTransparent':
        return (
          <>
            {renderFieldLabel('Linked Wall:', elementType)}
            <div className="element-input">
              <ParentElementDropdown
                value={parentElement}
                onChange={(value) => applyHostedParentElement(value, '')}
                elementType={elementType}
                zoneId={elementZoneId}
                placeholder="Select a parent opaque element"
                selfId={selection.type === 'element' ? selection.id : undefined}
              />
            </div>
            {selectedShape !== 'polygon' && (
              renderLinearDimensionsFields(registerBaseFieldRef, {
                widthStep: '0.01',
                heightStep: '0.01',
                includeProfileTop: true,
              })
            )}
            {showSlopedTransparentRebuildOpening ? (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  className="btn editor-action-btn editor-action-btn--secondary"
                  onClick={rebuildSelectedSlopedTransparentOpening}
                >
                  Rebuild opening
                </button>
              </div>
            ) : null}
            {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
            <div className="element-input" ref={registerBaseFieldRef('area')}>
              <StandardInput
	                  type="text"
	                  inputMode="numeric"
                value={formatToTwoDecimals(selectedShape === 'polygon' ? derivedPolygonArea : liveRectArea)}
                unit={fieldUnit('area')}
                readOnly
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Free Area Height (m):', elementType)}
            <div
              className="element-input"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              ref={registerBaseFieldRef('freeAreaHeight')}
            >
              <StandardInput
                {...decimalInputProps(freeAreaHeightInput)}
                unit={fieldUnit('free_area_height')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('freeAreaHeight', freeAreaHeightInput.value)} issue={getFieldValidationIssue('freeAreaHeight', freeAreaHeightInput.value) || undefined} />
            </div>
            {renderFieldLabel('Mid Height (m):', elementType)}
            <div
              className="element-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
              ref={registerBaseFieldRef('midHeight')}
            >
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', width: '100%' }}>
                <div
                  className={
                    derivedWindowMidHeight > 0 &&
                    typeof midHeightInput.value === 'number' &&
                    Math.abs(midHeightInput.value - derivedWindowMidHeight) > 0.005
                      ? 'custom-value'
                      : ''
                  }
                  style={{ flex: 1 }}
                >
                  <StandardInput
                    {...decimalInputProps(midHeightInput)}
                    unit={fieldUnit('mid_height')}
                    step="0.01"
                    min="0"
                    variant="ghost"
                    size="md"
                    className="flex-1"
                    placeholder={derivedWindowMidHeight > 0 ? String(derivedWindowMidHeight) : undefined}
                  />
                </div>
                {derivedWindowMidHeight > 0 &&
                typeof midHeightInput.value === 'number' &&
                Math.abs(midHeightInput.value - derivedWindowMidHeight) > 0.005 ? (
                  <ResetFieldButton
                    onClick={() => {
                      midHeightInput.setValue(derivedWindowMidHeight);
                      commitExistingElementDraft({ mid_height: derivedWindowMidHeight });
                    }}
                    align="inline"
                    title={`Reset to ${derivedWindowMidHeight} m (base + height/2)`}
                    ariaLabel="Reset Mid Height"
                    label="Reset"
                  />
                ) : null}
                <FieldValidationIndicator
                  hasIssue={!!getFieldValidationIssue('midHeight', midHeightInput.value)}
                  issue={getFieldValidationIssue('midHeight', midHeightInput.value) || undefined}
                />
              </div>
              {derivedWindowMidHeight > 0 ? (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Default: {derivedWindowMidHeight} m (base_height + height / 2)
                </div>
              ) : null}
            </div>
            {renderFieldLabel('Max Window Open Area (m²):', elementType)}
            <div
              className="element-input"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              ref={registerBaseFieldRef('maxWindowOpenArea')}
            >
              <StandardInput
                {...decimalInputProps(maxWindowOpenAreaInput)}
                unit={fieldUnit('max_window_open_area')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              {typeof maxWindowOpenAreaInput.value === 'number' &&
              Math.abs(maxWindowOpenAreaInput.value - derivedWindowMaxOpenArea) > 0.005 ? (
                <button
                  type="button"
                  onClick={() => {
                    maxWindowOpenAreaInput.setValue(derivedWindowMaxOpenArea);
                    commitExistingElementDraft({ max_window_open_area: derivedWindowMaxOpenArea });
                  }}
                  className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
                  title={`Use suggested ${derivedWindowMaxOpenArea} m²`}
                  aria-label="Use suggested max window open area"
                >
                  Use Suggested
                </button>
              ) : null}
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('maxWindowOpenArea', maxWindowOpenAreaInput.value)} issue={getFieldValidationIssue('maxWindowOpenArea', maxWindowOpenAreaInput.value) || undefined} />
            </div>
            <div style={INLINE_FIELD_NOTE_STYLE}>
              Suggested from width x free area height (capped by total window area).
            </div>
            {renderFieldLabel('Frame Area Fraction:', elementType)}
            <div className="element-input" ref={registerBaseFieldRef('frame_area_fraction')}>
              <StandardInput
                {...decimalInputProps(freeAreaFractionInput)}
                unit={fieldUnit('frame_area_fraction')}
                step="0.01"
                min="0"
                max="1"
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel(selectedShape === 'polygon' ? 'Surface facing:' : 'Pitch (degrees):', elementType, 'pitch')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRef('pitch')}>
              {selectedShape === 'polygon' ? (
                <StandardDropdown
                  value={horizontalPolygonSurfaceSelectValue(horizontalPolygonControlPitch)}
                  unit={fieldUnit('pitch')}
                  onChange={(value) => {
                    if (value !== '0' && value !== '180') return;
                    const next = value === '180' ? 180 : 0;
                    setPitch(next);
                    if (selection.type === 'element') {
                      updateElement(selection.id, { pitch: next });
                    }
                  }}
                  options={HORIZONTAL_POLYGON_PITCH_OPTIONS}
                  placeholder={HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER}
                  variant="ghost"
                  size="md"
                />
	              ) : (
	                <StandardInput
                  type="text"
                  inputMode="decimal"
                  value={pitchDraftInput.inputValue}
                  unit={fieldUnit('pitch')}
                  onChange={pitchDraftInput.handleInputChange}
                  onBlur={pitchDraftInput.handleBlur}
                  min="0"
                  max="180"
                  variant="ghost"
                  size="md"
                />
              )}
              {selectedShape !== 'polygon' && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  {pitch === 0
                    ? 'Facing up (horizontal)'
                    : pitch === 90
                      ? 'Vertical'
                      : pitch === 180
                        ? 'Facing down (horizontal)'
                        : 'Angled surface'}
                </div>
              )}
            </div>
            {renderFieldLabel('Orientation (degrees):', elementType, 'orientation360')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRef('orientation360')}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={Number.isFinite(orientation360) ? orientation360 : getCurrentOrientation(getCurrentElementData() as Element)}
                unit={fieldUnit('orientation360')}
                onChange={(e) => setOrientation360(Math.round(parseFloat(e.target.value) || 0))}
                onBlur={(e) => {
                  const parsed = Math.round(parseFloat(e.currentTarget.value) || 0);
                  setOrientation360(parsed);
                  applyOrientationToGeometry(parsed);
                }}
                step="1"
                min="0"
                max="360"
                readOnly={!!parentElement}
                variant="ghost"
                size="md"
              />
              {parentElement && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Inherited from parent: {parentElement}
                </div>
              )}
            </div>
            {renderFieldLabel('Base Height (m):', elementType, 'base_height')}
            <div className="element-input" ref={registerBaseFieldRef('base_height')}>
              <StandardInput
                {...decimalInputProps(baseHeightInput)}
                unit={fieldUnit('base_height')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
          </>
        );

      case 'BuildingElementGround':
        return (
          <>
            {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
            <div className="element-input" ref={registerBaseFieldRef('area')}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={formatToTwoDecimals(derivedGroundEffectiveArea)}
                unit={fieldUnit('area')}
                readOnly
                variant="ghost"
                size="md"
              />
            </div>
            {renderFieldLabel('Total Area (m²):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs(['totalArea', 'total_area'])}>
              <StandardInput
                type="text"
                inputMode="numeric"
                value={formatConditionalDecimals(derivedGroundArea)}
                unit={fieldUnit('total_area')}
                readOnly
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('totalArea', derivedGroundArea)} issue={getFieldValidationIssue('totalArea', derivedGroundArea) || undefined} />
            </div>
            {renderFieldLabel('Perimeter (m):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs('perimeter')}>
              <StandardInput
                {...decimalInputProps(perimeterInput)}
                unit={fieldUnit('perimeter')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                className="flex-1"
              />
              {groundPerimeterManual && hasReliableGroundExposedPerimeter(groundPerimeterDetails) ? (
                <ResetFieldButton
                  align="inline"
                  title="Set perimeter to the exposed wall-linked perimeter"
                  ariaLabel="Use exposed perimeter"
                  label="Use exposed"
                  onClick={resetGroundPerimeterToAuto}
                />
              ) : null}
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('perimeter', derivedGroundPerimeter)} issue={getFieldValidationIssue('perimeter', derivedGroundPerimeter) || undefined} />
            </div>
            {groundPerimeterBreakdownText ? (
              <div style={INLINE_FIELD_NOTE_STYLE}>
                {groundPerimeterBreakdownText}
              </div>
            ) : null}
            {selectedShape === 'line' && (
              <>
                {renderFieldLabel('Ground Wall Height (m):', elementType)}
                <div className="element-input">
                  <StandardInput
                    {...decimalInputProps(groundLineHeightInput)}
                    unit={fieldUnit('height')}
                    step="0.01"
                    min="0"
                    variant="ghost"
                    size="md"
                  />
                </div>
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  Ground wall area is derived as line length x height.
                </div>
              </>
            )}
            {renderFieldLabel('Floor Type:', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs(['floorType', 'floor_type'])}>
              <StandardDropdown
                value={floorType}
                onChange={(value) => {
                  const nextValue = value as typeof floorType;
                  setFloorType(nextValue);
                  const patch = {
                    floor_type: nextValue || undefined,
                    ...(!groundFloorTypeSupportsViewerElevation(nextValue) ? { _base_height: undefined } : {}),
                  } as Partial<Element>;
                  if (!groundFloorTypeSupportsViewerElevation(nextValue)) {
                    elementElevationInput.setValue('');
                  }
                  commitExistingElementDraft(patch);
                }}
                options={[
                  { value: 'Heated_basement', label: 'Heated Basement' },
                  { value: 'Slab_no_edge_insulation', label: 'Slab No Edge Insulation' },
                  { value: 'Slab_edge_insulation', label: 'Slab Edge Insulation' },
                  { value: 'Suspended_floor', label: 'Suspended Floor' },
                  { value: 'Unheated_basement', label: 'Unheated Basement' }
                ]}
                variant="ghost"
                size="md"
              />
            </div>
            {/* Only show depth_basement_floor for Heated_basement and Unheated_basement */}
            {(floorType === 'Heated_basement' || floorType === 'Unheated_basement') && (
              <>
            {renderFieldLabel('Depth Basement Floor (m):', elementType)}
            <div className="element-input" ref={registerBaseFieldRefs(['depthBasementFloor', 'depth_basement_floor'])}>
              <StandardInput
                {...decimalInputProps(depthBasementFloorInput)}
                unit={fieldUnit('depth_basement_floor')}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
              />
            </div>
              </>
            )}
            {renderFieldLabel('Thickness Walls (m):', elementType)}
            <div
              className="element-input"
              ref={registerBaseFieldRefs(['thicknessWalls', 'thickness_walls'])}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', width: '100%', minWidth: 0 }}>
                <StandardInput
                  {...decimalInputProps(thicknessWallsInput)}
                  unit={fieldUnit('thickness_walls')}
                  step="0.01"
                  min="0"
                  variant="ghost"
                  size="md"
                  className={
                    groundWallThicknessAutofill.valueM != null ||
                    groundWallThicknessAutofill.candidateCount > 0
                      ? 'flex-1'
                      : undefined
                  }
                />
                {groundWallThicknessAutofill.valueM != null &&
                liveThicknessWallsValue != null &&
                Math.abs(liveThicknessWallsValue - groundWallThicknessAutofill.valueM) > 1e-5 ? (
                  <ResetFieldButton
                    align="inline"
                    title="Set thickness to the area-weighted assembly solid thickness from adjacent walls on this storey"
                    ariaLabel="Use Assembly wall thickness"
                    label="Use Assembly"
                    onClick={resyncGroundThicknessWallsFromAssemblies}
                  />
                ) : null}
              </div>
              {groundWallThicknessAutofill.sources.length > 0 ? (
                  <div
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      lineHeight: 1.45,
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    From assemblies:{' '}
                    {Array.from(
                      groundWallThicknessAutofill.sources.reduce((groups, source) => {
                        const key = source.thicknessM.toFixed(2);
                        const existing = groups.get(key);
                        if (existing) existing.push(source);
                        else groups.set(key, [source]);
                        return groups;
                      }, new Map<string, typeof groundWallThicknessAutofill.sources>()),
                    ).map(([thicknessKey, group], groupIndex) => (
                      <React.Fragment key={thicknessKey}>
                        {groupIndex > 0 ? ' · ' : null}
                        {group.map((source, index) => (
                          <React.Fragment key={source.elementId}>
                            {index > 0 ? ', ' : null}
                            <button
                              type="button"
                              onClick={() => setSelection({ type: 'element', id: source.elementId })}
                              style={{
                                border: 'none',
                                background: 'none',
                                padding: 0,
                                color: 'var(--accent-blue)',
                                cursor: 'pointer',
                                font: 'inherit',
                                textDecoration: 'underline',
                              }}
                              title={`${source.label}: ${source.areaM2.toFixed(2)} m², assembly solid thickness ${source.thicknessM.toFixed(2)} m`}
                            >
                              {source.label}
                            </button>
                          </React.Fragment>
                        ))}
                        {': '}
                        {thicknessKey} m
                      </React.Fragment>
                    ))}
                  </div>
                ) : groundWallThicknessAutofill.candidateCount > 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
                    Adjacent walls found on this storey, but none have an applied wall assembly thickness.
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
                    No adjacent wall assembly thickness available on this storey.
                  </div>
                )}
            </div>
          </>
        );

      case 'BuildingElementAdjacentConditionedSpace':
      case 'BuildingElementAdjacentUnconditionedSpace_Simple':
      case 'BuildingElementPartyWall': {
        const currentExtra = getCurrentElementExtraJson();
        const partyWallCavityType =
          typeof currentExtra.party_wall_cavity_type === 'string' ? currentExtra.party_wall_cavity_type : '';
        const partyWallLiningType =
          typeof currentExtra.party_wall_lining_type === 'string' ? currentExtra.party_wall_lining_type : '';
        const showPartyWallLining =
          elementType === 'BuildingElementPartyWall' &&
          PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES.has(partyWallCavityType);
        const showPartyWallCavityResistance =
          elementType === 'BuildingElementPartyWall' &&
          partyWallCavityType === 'defined_resistance';
        return (
          <>
            {selectedShape !== 'polygon' && (
              renderLinearDimensionsFields(registerBaseFieldRefs, {
                widthStep: '0.01',
                heightStep: '0.01',
                includeProfileTop: true,
              })
            )}
            {renderFieldLabel('Base Height:', elementType, '_base_height')}
            <div
              className="element-input"
              style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
              ref={registerBaseFieldRefs('_base_height')}
            >
              <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%' }}>
                <StandardInput
                  {...decimalInputProps(adjacentViewerBaseHeightInput)}
                  unit={fieldUnit('_base_height')}
                  step="0.01"
                  min="0"
                  variant="ghost"
                  size="md"
                  className="flex-1"
                  placeholder={derivedBaseHeight > 0 ? String(derivedBaseHeight) : undefined}
                />
                {derivedBaseHeight > 0 &&
                  typeof adjacentViewerBaseHeightInput.value === 'number' &&
                  Math.abs(adjacentViewerBaseHeightInput.value - derivedBaseHeight) > 0.01 && (
                    <ResetFieldButton
                      onClick={() => {
                        adjacentViewerBaseHeightInput.setValue(derivedBaseHeight);
                        commitExistingElementDraft({
                          _base_height: derivedBaseHeight,
                          base_height: undefined,
                        } as Partial<Element>);
                      }}
                      align="inline"
                      title="Use cumulative slab height for this storey (default 3D placement)"
                      ariaLabel="Reset base height to slab"
                      label="Reset"
                    />
                  )}
              </div>
              <div style={INLINE_FIELD_NOTE_STYLE}>
                Optional. Absolute metres above ground for the 3D view only
              </div>
            </div>
            {(() => {
              const showInternalFloorDoubling =
                selectedShape === 'polygon' &&
                !!selectedElement &&
                isAdjacentConditionedInternalFloorDoubled(selectedElement);
              const shownArea = selectedElement
                ? getElementGrossArea({
                    ...selectedElement,
                    width: liveWidthValue,
                    height: liveHeightValue,
                    pitch,
                  } as Element)
                : selectedShape === 'polygon'
                  ? showInternalFloorDoubling
                    ? derivedPolygonArea * 2
                    : derivedPolygonArea
                  : liveRectArea;
              const showInternalSurfaceDoubling =
                !!selectedElement &&
                selectedElement.type === 'BuildingElementAdjacentConditionedSpace' &&
                (selectedShape === 'line' || selectedShape === 'polygon' || selectedShape === 'sloped-polygon') &&
                !isVulcanUiPartyFloorElement(selectedElement);
              return (
                <>
                  {renderFieldLabelWithComparisonIndicator('Area (m²):', elementType, comparisonFieldIndicators.area, 'area')}
                  <div
                    className="element-input"
                    style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }}
                    ref={registerBaseFieldRef('area')}
                  >
                    <StandardInput
	                  type="text"
	                  inputMode="numeric"
                      value={formatToTwoDecimals(shownArea)}
                      unit={fieldUnit('area')}
                      readOnly
                      variant="ghost"
                      size="md"
                    />
                    {showInternalSurfaceDoubling && (
                      <div style={INLINE_FIELD_NOTE_STYLE}>
                        Doubled to account for both sides of the internal element
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
            {renderFieldLabel(selectedShape === 'polygon' ? 'Surface facing:' : 'Pitch (degrees):', elementType, 'pitch')}
            <div className="element-input" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'stretch' }} ref={registerBaseFieldRefs('pitch')}>
              {selectedShape === 'polygon' ? (
                <StandardDropdown
                  value={horizontalPolygonSurfaceSelectValue(horizontalPolygonControlPitch)}
                  unit={fieldUnit('pitch')}
                  onChange={(value) => {
                    if (value !== '0' && value !== '180') return;
                    const next = value === '180' ? 180 : 0;
                    setPitch(next);
                    if (selection.type === 'element') {
                      updateElement(selection.id, { pitch: next });
                    }
                  }}
                  options={HORIZONTAL_POLYGON_PITCH_OPTIONS}
                  placeholder={HORIZONTAL_POLYGON_SURFACE_PLACEHOLDER}
                  variant="ghost"
                  size="md"
                />
              ) : (
                <StandardInput
                  type="text"
                  inputMode="decimal"
                  value={pitchDraftInput.inputValue}
                  unit={fieldUnit('pitch')}
                  onChange={pitchDraftInput.handleInputChange}
                  onBlur={pitchDraftInput.handleBlur}
                  min="0"
                  max="180"
                  variant="ghost"
                  size="md"
                />
              )}
              {selectedShape !== 'polygon' && (
                <div style={INLINE_FIELD_NOTE_STYLE}>
                  {pitch === 0
                    ? 'Facing up (horizontal)'
                    : pitch === 90
                      ? 'Vertical'
                      : pitch === 180
                        ? 'Facing down (horizontal)'
                        : 'Angled surface'}
                </div>
              )}
            </div>
            {elementType === 'BuildingElementPartyWall' && (
              <>
                {renderFieldLabel('Party Wall Cavity Type:', elementType, 'party_wall_cavity_type')}
                <div className="element-input">
                  <StandardDropdown
                    value={partyWallCavityType}
                    onChange={(value) => {
                      if (selection.type !== 'element') return;
                      const nextExtra: Record<string, unknown> = {
                        ...currentExtra,
                        party_wall_cavity_type: value || undefined,
                      };
                      if (!PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES.has(String(value))) {
                        delete nextExtra.party_wall_lining_type;
                      }
	                      if (value !== 'defined_resistance') {
	                        delete nextExtra.thermal_resistance_cavity;
	                        partyWallCavityResistanceInput.setValue('');
	                      }
	                      updateElement(selection.id, { extra_json: nextExtra } as Partial<Element>);
                    }}
                    options={[
                      { value: 'solid', label: 'Solid' },
                      { value: 'unfilled_unsealed', label: 'Unfilled, unsealed' },
                      { value: 'unfilled_sealed', label: 'Unfilled, sealed' },
                      { value: 'filled_sealed', label: 'Filled, sealed' },
                      { value: 'filled_unsealed', label: 'Filled, unsealed' },
                      { value: 'defined_resistance', label: 'Defined resistance' },
                    ]}
                    placeholder="Select cavity type..."
                    variant="ghost"
                    size="md"
                  />
                </div>
                {showPartyWallLining && (
                  <>
                    {renderFieldLabel('Party Wall Lining Type:', elementType, 'party_wall_lining_type')}
                    <div className="element-input">
                      <StandardDropdown
                        value={partyWallLiningType}
                        onChange={(value) => {
                          if (selection.type !== 'element') return;
                          updateElement(selection.id, {
                            extra_json: {
                              ...currentExtra,
                              party_wall_cavity_type: partyWallCavityType || undefined,
                              party_wall_lining_type: value || undefined,
                            },
                          } as Partial<Element>);
                        }}
                        options={[
                          { value: 'wet_plaster', label: 'Wet plaster' },
                          { value: 'dry_lined', label: 'Dry lined' },
                        ]}
                        placeholder="Select lining type..."
                        variant="ghost"
                        size="md"
                      />
                    </div>
                  </>
                )}
                {showPartyWallCavityResistance && (
                  <>
                    {renderFieldLabel('Cavity Resistance (m²K/W):', elementType, 'thermal_resistance_cavity')}
                    <div className="element-input">
	                      <StandardInput
	                        {...decimalInputProps(partyWallCavityResistanceInput)}
	                        unit={fieldUnit('thermal_resistance_cavity')}
	                        step="0.01"
	                        min="0"
	                        variant="ghost"
	                        size="md"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        );
      }

      case 'ThermalBridgeLinear':
        return elementFormInstances.ThermalBridgeLinear.renderPanel(formRenderCtx);

      case 'ThermalBridgePoint':
        return elementFormInstances.ThermalBridgePoint.renderPanel(formRenderCtx);

      // NEW: CSV v3 element types
      case 'WindowShading':
        return elementFormInstances.WindowShading.renderPanel(formRenderCtx);

      case 'Lighting':
        return elementFormInstances.Lighting.renderPanel(formRenderCtx);

      case 'MechanicalVentilationDuctwork':
        return elementFormInstances.MechanicalVentilationDuctwork.renderPanel(formRenderCtx);

      case 'MechanicalVentilationTerminal':
        return elementFormInstances.MechanicalVentilationTerminal.renderPanel(formRenderCtx);

      case 'WetEmitter':
        return elementFormInstances.WetEmitter.renderPanel(formRenderCtx);

      case 'WaterPipework':
        return elementFormInstances.WaterPipework.renderPanel(formRenderCtx);

      case 'Appliance':
        return elementFormInstances.Appliance.renderPanel(formRenderCtx);

      case 'HotWaterDemand':
        return elementFormInstances.HotWaterDemand.renderPanel(formRenderCtx);

      case 'ContextShading':
        return elementFormInstances.ContextShading.renderPanel(formRenderCtx);

      // NEW: InfiltrationVentilation element types
      case 'Vents':
        return elementFormInstances.Vents.renderPanel(formRenderCtx);

      case 'MechanicalVentilation':
        return elementFormInstances.MechanicalVentilation.renderPanel(formRenderCtx);

      case 'CombustionAppliances':
        return elementFormInstances.CombustionAppliances.renderPanel(formRenderCtx);

      case 'OnSiteGeneration':
        return elementFormInstances.OnSiteGeneration.renderPanel(formRenderCtx);

      case 'System':
        return elementFormInstances.System.renderPanel(formRenderCtx);

      case 'ElectricBattery':
        return elementFormInstances.ElectricBattery.renderPanel(formRenderCtx);

      default:
        return <div>Select an element type to see attributes</div>;
    }
  };

  const selectedElementFloorState = (() => {
    if (selection.type !== 'element') return { value: '', parentControlled: false };
    const el = getElementById(selection.id);
    const parentControlled = isElementFloorControlledByParent(el, elementsById);
    const parentFloorZ = getParentControlledFloorZ(el, elementsById, floors);
    if (parentControlled && parentFloorZ !== undefined) {
      return { value: String(Math.floor(parentFloorZ)), parentControlled };
    }
    if (el && (el.type === 'ThermalBridgePoint' || isServiceLineElementType(el.type))) {
      const floorId = typeof el.floorId === 'string' ? el.floorId.trim() : '';
      if (!floorId) return { value: '', parentControlled };
      const mapped = floors.find((f) => f.id === floorId);
      if (mapped) return { value: String(mapped.zIndex), parentControlled };
      const asNum = Number(floorId);
      return { value: Number.isFinite(asNum) ? String(Math.floor(asNum)) : '', parentControlled };
    }
    const z = el?.coordinates?.[0]?.z;
    return { value: typeof z === 'number' ? String(Math.floor(z)) : '', parentControlled };
  })();
  const selectedElementFloorValue = selectedElementFloorState.value;

  const floorDropdownOptions = (() => {
    const zValues = new Set<number>();
    for (const floor of floors) {
      if (Number.isFinite(floor.zIndex)) zValues.add(Math.floor(floor.zIndex));
    }
    const selectedZ = selectedElementFloorValue === '' ? NaN : Number(selectedElementFloorValue);
    if (Number.isFinite(selectedZ)) zValues.add(Math.floor(selectedZ));
    if (zValues.size === 0) zValues.add(0);
    return [...zValues].sort((a, b) => a - b).map((z) => {
      return { value: String(z), label: fhsFloorLabelForCanvasFloor(z) };
    });
  })();

  const handleElementFloorChange = (value: string) => {
    const parsed = parseInt(value || '0', 10);
    if (!Number.isFinite(parsed)) return;
    const zInt = Math.floor(parsed);
    if (selection.type !== 'element') return;
    const el = getElementById(selection.id);
    if (!el) return;
    if (isElementFloorControlledByParent(el, elementsById)) return;
    if (el.type === 'ThermalBridgePoint' || isServiceLineElementType(el.type)) {
      // Physical-Z assignment is floorId-only; preserve coordinate z metres.
      const patch: Partial<Element> = {
        floorId: String(zInt),
      };
      if (isServiceLineElementType(el.type)) {
        patch.extra_json = mergeServiceLineExtraJsonFloorId(el, zInt);
      }
      updateElement(el.id, patch);
    } else if (Array.isArray(el.coordinates) && el.coordinates.length > 0) {
      const updated = el.coordinates.map((c) => ({ ...c, z: zInt }));
      const patch: Partial<Element> & { coordinates: typeof updated } = { coordinates: updated };
      const heightPatch = calculateBaseHeightPatchForFloorMove(
        el,
        zInt,
        floors,
      );
      if (heightPatch) {
        Object.assign(patch, heightPatch);
        syncFloorMoveHeightInputs(heightPatch);
      }
      updateElement(el.id, patch as Partial<Element>);
    } else {
      updateElement(el.id, { floorId: String(zInt) });
    }
    setElementFloorId(String(zInt));
    // Keep plan canvas / floor strip aligned with the element’s storey so it stays
    // fully visible and interactive (otherwise it looks “deselected” — other-floor opacity).
    setCurrentFloorZ(zInt);
  };

  const elementElevationPlaceholder = (() => {
    if (selection.type !== 'element' && selection.type !== 'global') return undefined;
    const el = getElementById(selection.id);
    if (!el) return undefined;
    if (!elementSupportsGenericElevationControl(elementType, el, floorType)) return undefined;
    const effectiveElevation = elementBaseElevationMForTb(
      el,
      withEffectiveStoreyHeights(floors, allElements),
    );
    return Number.isFinite(effectiveElevation)
      ? String(roundToTwoDecimals(effectiveElevation))
      : undefined;
  })();

  const renderElementElevationField = () => {
    if (selection.type !== 'element' && selection.type !== 'global') return null;
    const el = getElementById(selection.id);
    if (!el) return null;
    if (!elementSupportsGenericElevationControl(elementType, el, floorType)) return null;
    return (
      <>
        {renderFieldLabel('Elevation above model ground (m):', elementType, '_base_height')}
        <div className="element-input" ref={registerBaseFieldRefs(['_base_height', 'base_height', 'elevation'])}>
          <StandardInput
            {...decimalInputProps(elementElevationInput)}
            unit={fieldUnit('_base_height')}
            step="0.01"
            variant="ghost"
            size="md"
            className="flex-1"
            placeholder={elementElevationPlaceholder}
          />
          <FieldValidationIndicator
            hasIssue={!!getFieldValidationIssue('_base_height', elementElevationInput.value)}
            issue={getFieldValidationIssue('_base_height', elementElevationInput.value) || undefined}
          />
        </div>
      </>
    );
  };

  const body = (
      <div className={`element-creator${selection && selection.isPlaceholder ? ' placeholder' : ''}`}>
        {/* Header label when editing an element/global */}
        {(selection.type === 'element' || selection.type === 'global') && (
          <div className="element-editor-header">
            <span className="controls-label element-editor-header__title">
              {selectedIsDormerAnchor ? 'Edit Dormer' : 'Edit Element'}
            </span>
            <div className="element-editor-header__name" ref={registerBaseFieldRefs('name')}>
              <StandardInput
                id={ELEMENT_NAME_INPUT_ID}
                type="text"
                value={elementName}
                onChange={(e) => {
                  elementNameEditingRef.current = true;
                  setElementName(e.target.value);
                }}
                onFocus={() => {
                  elementNameEditingRef.current = true;
                }}
                onBlur={(e) => {
                  const nextName = e.currentTarget.value;
                  elementNameEditingRef.current = false;
                  setElementName(nextName);
                  if (selectedIsDormerAnchor) {
                    commitDormerAnchorChanges({ bundleName: nextName.trim() });
                  } else {
                    commitExistingElementDraft({ name: nextName.trim() });
                  }
                }}
                placeholder="Unique identifier"
                required
                variant="ghost"
                size="md"
                className="element-editor-name-input"
              />
              {showResetNameButton ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-small element-editor-reset-name-button element-editor-input-action"
                  title="Replace this manual name with the automatic name"
                  aria-label="Reset name to automatic"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleResetName}
                >
                  Reset to auto
                </button>
              ) : null}
              <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('name', elementName)} issue={getFieldValidationIssue('name', elementName) || undefined} />
            </div>
          </div>
        )}
        {evidenceBridge.renderSection({
          elementType,
          elementSubtype: getElementSubtype(),
          useFHSSchema,
        })}

        {/* Type/Shape/Floor metadata */}
        {(selection.type === 'element' || selection.type === 'global') && (
          <div className="element-editor-standard-fields">
            <div className="element-editor-meta-row">
              <div className="element-editor-meta-control element-editor-meta-control--type" ref={registerBaseFieldRefs('type')}>
                <ElementTypePicker
                  value={elementType}
                  onChange={(value) => {
                    const nextType = value;
                    const el = selection.type === 'element' ? getElementById(selection.id) : null;
                    if (!el) { setElementType(nextType); return; }
                    const shape = getElementShape(el as any);
                    if (isTypeShapeCompatible(nextType, shape)) {
                      setElementType(nextType);
                      updateElement(el.id, { type: nextType } as Partial<Element>);
                    } else {
                      const ok = window.confirm('Changing the element type may convert its shape. Continue?');
                      if (!ok) { return; }
                      setElementType(nextType);
                      updateElement(el.id, { type: nextType } as Partial<Element>);
                    }
                  }}
                  options={ELEMENT_TYPES.filter((type) => {
                      if (!useFHSSchema) return true;
                      // Keep legacy FHS-excluded types editable when selected, but prevent selecting them for new additions.
                      const excludedInFHS: ElementType[] = ['CombustionAppliances'];
                      return !excludedInFHS.includes(type) || elementType === type;
                    })}
                  placeholder="Select element type..."
                  ariaLabel="Element type"
                  className="element-editor-type-picker"
                />
              </div>
              {selection.type === 'element' && (
                <div className="element-editor-meta-control element-editor-meta-control--shape" ref={registerBaseFieldRefs('shape')}>
                  <StandardDropdown
                    value={(() => {
                      if (isServiceLineElementType(elementType)) {
                        return serviceLineShapeValueForMode(serviceLine.mode);
                      }
                      return selectedShape || 'line';
                    })()}
                    onChange={(shape) => {
                      const el = getElementById(selection.id);
                      if (!el) return;
                      if (isServiceLineElementType(elementType)) {
                        const nextMode = serviceLineModeFromShapeValue(shape);
                        if (elementType === 'ThermalBridgeLinear') {
                          convertThermalBridgeLineMode(el.id, nextMode);
                          return;
                        }
                        const nextCoords = normalizeServiceLineCoordinatesForMode(
                          el.coordinates as Array<{ x: number; y: number; z: number }> | undefined,
                          nextMode,
                        );
                        if (!nextCoords) return;
                        updateElement(el.id, {
                          coordinates: nextCoords,
                          length: getServiceLineLengthFromCoordinates(nextCoords),
                        } as Partial<Element>);
                        return;
                      }

                      if (shape === 'line' && getElementShape(el as any) === 'polygon') {
                        const ok = window.confirm('Converting polygon to line will keep the longest edge. Continue?');
                        if (!ok) return;
                      }

                      const next = convertShapeCoordinates(el as any, shape as any);
                      const updates: any = { coordinates: next };
                      if (el.type === 'BuildingElementAdjacentConditionedSpace' && shape !== 'polygon') {
                        const extra = readExtraJsonRecord(el.extra_json);
                        if (VULCAN_UI_PARTY_ELEMENT_KEY in extra) {
                          const nextExtra = { ...extra };
                          delete nextExtra[VULCAN_UI_PARTY_ELEMENT_KEY];
                          updates.extra_json = nextExtra;
                        }
                      }
                      if (shape === 'sloped-polygon') {
                        updates.pitch = (el as any).pitch || 30;
                      }
                      if (shape === 'line' && BUILDING_FABRIC_LINE_PITCH_TYPES.has(el.type as ElementType)) {
                        updates.pitch = 90;
                        setPitch(90);
                      }
                      if (el.type === 'BuildingElementOpaque') {
                        if (shape !== 'sloped-polygon') {
                          updates.is_unheated_pitched_roof = false;
                          setIsUnheatedPitchedRoof(false);
                        }
                        if (shape !== 'line') {
                          updates.is_external_door = false;
                          setIsExternalDoor(false);
                        }
                      }
                      updateElement(el.id, updates);
                    }}
                    options={(() => {
                      if (isServiceLineElementType(elementType)) {
                        return [
                          { value: 'tb-plan-line', label: 'Plan' },
                          { value: 'tb-vertical-line', label: 'Vertical' },
                          { value: 'tb-slope-line', label: 'Slope' },
                        ];
                      }
                      const shapes: Array<'point' | 'line' | 'polygon' | 'sloped-polygon'> = ['point', 'line', 'polygon', 'sloped-polygon'];
                      return shapes
                        .filter(shape => isTypeShapeCompatible(elementType, shape))
                        .map(shape => ({
                          value: shape,
                          label: shape === 'point' ? 'Point' : shape === 'line' ? 'Line' : shape === 'polygon' ? 'Polygon' : 'Slope'
                        }));
                    })()}
                    size="md"
                    variant="ghost"
                  />
                </div>
              )}
              {selection.type === 'element' && (
                <div className="element-editor-meta-control element-editor-meta-control--floor" ref={registerBaseFieldRefs(['floorId', 'floor_id'])}>
                  <StandardDropdown
                    value={selectedElementFloorValue}
                    onChange={handleElementFloorChange}
                    options={floorDropdownOptions}
                    placeholder="Floor"
                    variant="ghost"
                    size="md"
                    disabled={selectedElementFloorState.parentControlled}
                  />
                </div>
              )}
            </div>

            {/* Element preset selector – shown for Opaque/Transparent types */}
            {PRESET_ELEMENT_TYPES.includes(elementType) && elementPresetOptions.length > 0 && (
              <div className="element-editor-row">
                <div className="element-label">Preset:</div>
                <div className="element-editor-control">
                  <PresetDropdown
                    value={elementPreset}
                    onChange={(value) => {
                      setElementPreset(value);
                      if (value) {
                        applyElementPreset(value);
                      }
                    }}
                    options={elementPresetOptions}
                    onDelete={handleDeletePreset}
                    placeholder="None (manual)"
                    size="md"
                  />
                </div>
                {!isSavingPreset ? (
                  <div className="element-editor-preset-actions">
                    {/* Update current user preset in-place */}
                    {elementPreset && elementPresetOptions.find(o => o.value === elementPreset)?.source === 'user' && (
                      <button
                        type="button"
                        className="preset-icon-btn"
                        title="Update preset with current values"
                        onClick={handleUpdatePreset}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.5 2v6h-6" /><path d="M2.5 22v-6h6" />
                          <path d="M2.5 11.5a10 10 0 0 1 16.5-5.5L21.5 8" />
                          <path d="M21.5 12.5a10 10 0 0 1-16.5 5.5L2.5 16" />
                        </svg>
                      </button>
                    )}
                    {/* Save as new preset */}
                    <button
                      type="button"
                      className="preset-icon-btn"
                      title="Save current element as new preset"
                      onClick={handleSaveAsPreset}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="element-editor-preset-actions">
                    <input
                      ref={presetLabelInputRef}
                      type="text"
                      className="standard-input standard-input-md standard-input-ghost"
                      placeholder="Preset name..."
                      value={presetLabelInput}
                      onChange={(e) => setPresetLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmSavePreset();
                        if (e.key === 'Escape') setIsSavingPreset(false);
                      }}
                      style={{ width: 120 }}
                    />
                    {/* Confirm save */}
                    <button
                      type="button"
                      className="preset-icon-btn preset-icon-btn-confirm"
                      title="Confirm save"
                      onClick={confirmSavePreset}
                      disabled={!presetLabelInput.trim()}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    {/* Cancel */}
                    <button
                      type="button"
                      className="preset-icon-btn"
                      title="Cancel"
                      onClick={() => setIsSavingPreset(false)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Delete preset confirmation modal */}
            <DeleteConfirmModal
              isOpen={!!presetToDelete}
              onClose={() => setPresetToDelete(null)}
              onConfirm={confirmDeletePreset}
              title="Delete Preset"
              message="Are you sure you want to delete this preset?"
              itemName={elementPresetOptions.find(o => o.value === presetToDelete)?.label || presetToDelete || ''}
              itemType="file"
              itemTypeLabel="Preset"
              actionButtonText="Delete"
            />

            {/* Private-host source assignment, when one is registered. */}
            {(selection.type === 'element' || selection.type === 'global') && sourceAssignment && (
              <div className="element-editor-status-row">
                <div className="element-editor-status-chip">
                  <span className="element-editor-status-chip__label">{sourceAssignment.label}:</span>
                  <span>{sourceAssignment.sourceName}</span>
                  <button
                    type="button"
                    onClick={handleSourceUnassign}
                    title="Remove source assignment"
                    className="element-editor-status-chip__dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            {/* Private-host comparison basis, when one is registered. */}
            {(selection.type === 'element' || selection.type === 'global') && !sourceAssignment && comparisonDerivedBadge && (
              <div className="element-editor-status-row">
                <div className="element-editor-status-chip">
                  <span className="element-editor-status-chip__label">{sourceComparisonPort.label}:</span>
                  <span>{comparisonDerivedBadge.label}</span>
                </div>
              </div>
            )}

            {(selection.type === 'element' || selection.type === 'global') && (
              <SelectedElementValidationRows
                activeFilename={activeFilename}
                onFocusField={focusFieldKey}
                sourceComparisonPort={sourceComparisonPort}
                selectionId={selection.id}
              />
            )}
          </div>
        )}

        <div className="element-form">
          {selection.type === 'zone' ? (
            // Zone creation/edit form
            <div className="form-section">
              <h3 className="form-section-title">Zone Details</h3>
              {(() => {
                const zoneValidation = selectedZoneValidation;
                const hasAnyPills = (zoneValidation?.hasIssues || zoneValidation?.hasWarnings || zoneComparisonInfoPillItems.length > 0);
                if (!hasAnyPills) return null;
                return (
                  <div className="element-editor-pill-row element-editor-pill-row--zone">
                    {zoneValidation?.hasIssues && zoneValidation.issues.map((issue, i) => (
                      <ValidationPill key={`zone-issue-${i}`} message={issue.message} variant="error" onClick={issue.fieldKey ? () => focusFieldKey(issue.fieldKey!) : undefined} />
                    ))}
                    {zoneValidation?.hasWarnings && zoneValidation.warnings.map((warning, i) => (
                      <ValidationPill
                        key={`zone-warning-${i}`}
                        message={warning.message}
                        variant="warning"
                        onClick={warning.fieldKey ? () => focusFieldKey(warning.fieldKey!) : undefined}
                      />
                    ))}
                    {zoneComparisonInfoPillItems.map((info, i) => (
                      <ValidationPill key={`comparison-zone-${i}`} message={info.message} variant="info" onClick={info.fieldKey ? () => focusFieldKey(info.fieldKey!) : undefined} />
                    ))}
                  </div>
                );
              })()}
              <div className="element-form-grid">
                {!complianceSettings.complianceValidationEnabled ? (
                  <>
                    <div className="element-label">
                      Zone Name:
                    </div>
                    <div className="element-input" ref={registerBaseFieldRefs('name')}>
                      <StandardDropdown
                        value={zoneName}
                        onChange={(value) => {
                          setZoneName(value);
                          if (isExistingZoneSelection()) {
                            updateZone(selection.id, { name: value });
                          }
                        }}
                        options={ZONE_NAME_SUGGESTIONS.map(name => ({ value: name, label: name }))}
                        placeholder="Select a zone name"
                        variant="ghost"
                      />
                      <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('name', zoneName)} issue={getFieldValidationIssue('name', zoneName) || undefined} />
                    </div>
                  </>
                ) : null}
                {showFhsAreaSplit ? (
                  (() => {
                    const a = fhsSpaceLabelAggregate;
                    const t = a?.totalFloorAreaM2 ?? 0;
                    const liv = a?.livingAreaM2 ?? 0;
                    const rest = a?.restAreaM2 ?? 0;
                    const hasSplit = t > 0.005;
                    return (
                  <>
                <div className="element-label">Treated Floor split</div>
                <div className="element-input element-editor-full-row">
                  <div className="element-editor-stack">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>Treated floor (m²)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {hasSplit ? t.toFixed(1) : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>Living (m²)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {hasSplit ? liv.toFixed(1) : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 2 }}>Rest of dwelling (m²)</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {hasSplit ? rest.toFixed(1) : '—'}
                        </div>
                      </div>
                    </div>
                    {onOpenSpaceLabeller && isExistingZoneSelection() ? (
                      <div className="element-editor-inline-actions">
                        <button
                          type="button"
                          className="btn editor-action-btn editor-action-btn--secondary"
                          onClick={() => onOpenSpaceLabeller(selection.id)}
                        >
                          Open Space Labeller
                        </button>
                        {zoneUnlabeledSpaceFootprintCount > 0 ? (
                          <ValidationPill
                            variant="error"
                            message={
                              zoneUnlabeledSpaceFootprintCount === 1
                                ? '1 space is not yet labelled'
                                : `${zoneUnlabeledSpaceFootprintCount} spaces are not yet labelled`
                            }
                            onClick={() => onOpenSpaceLabeller(selection.id)}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {(() => {
                      const splitIssueMsgs = (selectedZoneValidation?.issues || [])
                        .filter(
                          (issue) =>
                            issue.fieldKey === 'floorArea' ||
                            issue.fieldKey === 'livingroom_area' ||
                            issue.fieldKey === 'restofdwelling_area',
                        )
                        .map((issue) => issue.message)
                        .filter((m): m is string => !!m);
                      if (splitIssueMsgs.length === 0) return null;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {splitIssueMsgs.map((msg, i) => (
                            <div key={`fhs-zsplit-${i}`} style={{ fontSize: 11, color: 'var(--error-text, var(--error-text))' }}>{msg}</div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                  </>
                    );
                  })()
                ) : (
                  <>
                <div className="element-label">
                  {renderFieldLabelWithComparisonIndicator('Floor Area (m²):', 'Zone', zoneComparisonFieldIndicators.floorArea, 'floorArea')}
                </div>
                <div className="element-input" ref={registerBaseFieldRefs(['floorArea', 'floor_area'])}>
                  {(() => {
                    // Calculate the geometry-derived floor area for reset-to-default support
                    const allElements = Object.values(elementsById) as import('../geometry/types').Element[];
                    const derived = selection?.type === 'zone'
                      ? calculateDerivedFloorArea(selection.id, allElements)
                      : { floorArea: 0, areaSource: undefined, contributingElements: [] };
                    const derivedValue = derived.floorArea;
                    const currentValue = Number(zoneFloorArea) || 0;
                    // Value is "custom" when the user has entered a value that differs from the derived value
                    const isCustom = derivedValue > 0 && Math.abs(currentValue - derivedValue) > 0.005;

                    return (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            width: '100%',
                            minWidth: 0,
                          }}
                        >
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', width: '100%', minWidth: 0 }}>
                            <div className={isCustom ? 'custom-value' : ''} style={{ flex: 1, minWidth: 0 }}>
                              <StandardInput
                                {...decimalInputProps(zoneFloorAreaInput)}
                                unit={fieldUnit('floorArea', 'Zone')}
                                onBlur={(e) => {
                                  const rawValue = e.currentTarget.value.trim();
                                  zoneFloorAreaInput.handleBlur(e);
                                  const parsed = rawValue === '' ? '' : Number(rawValue);
                                  const nextFloorArea = readPositiveZoneNumber(
                                    typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : '',
                                  );
                                  if (nextFloorArea != null) {
                                    commitExistingZoneDraft({ floorArea: nextFloorArea });
                                  }
                                }}
                                step="0.1"
                                min="0"
                                variant="ghost"
                                size="md"
                                placeholder={derivedValue > 0 ? String(derivedValue) : 'From geometry'}
                              />
                            </div>
                            {isCustom ? (
                              <ResetFieldButton
                                onClick={() => {
                                  zoneFloorAreaInput.setValue(derivedValue);
                                  if (selection?.type === 'zone') {
                                    updateZone(selection.id, {
                                      floorArea: derivedValue,
                                      _floorAreaUserOverride: false,
                                    });
                                  }
                                }}
                                align="inline"
                                title={`Reset to ${derivedValue} m²${derived.areaSource ? ` (${derived.areaSource})` : ''}`}
                                ariaLabel="Reset Floor Area"
                                label="Reset"
                              />
                            ) : null}
                          </div>
                        {derived.contributingElements.length > 0 ? (
                          <div
                            style={{
                              ...INLINE_FIELD_NOTE_STYLE,
                              lineHeight: 1.45,
                              width: '100%',
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <span style={{ flexShrink: 0, opacity: 0.92 }}>
                              {isCustom ? `Default: ${derivedValue} m² from` : 'From'}
                            </span>
                            <div
                              role="list"
                              style={{
                                display: 'flex',
                                flexWrap: 'nowrap',
                                gap: 8,
                                flex: 1,
                                minWidth: 0,
                                overflowX: 'auto',
                                paddingBottom: 2,
                                WebkitOverflowScrolling: 'touch',
                              }}
                            >
                              {derived.contributingElements.map((c) => (
                                <button
                                  key={c.elementId}
                                  type="button"
                                  role="listitem"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setSelection({ type: 'element', id: c.elementId })}
                                  title="Open this element in the editor"
                                  style={{
                                    flex: '0 0 auto',
                                    padding: '6px 10px',
                                    minHeight: 0,
                                    borderRadius: 999,
                                    fontSize: 12,
                                    lineHeight: 1.35,
                                    border: '1px solid color-mix(in srgb, var(--color-text-muted, var(--text-muted)) 35%, transparent)',
                                    background: 'color-mix(in srgb, var(--color-surface-elevated, var(--semantic-on-color)) 88%, transparent)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{ fontWeight: 600 }}>{c.elementName}</span>
                                  <span style={{ opacity: 0.85, marginLeft: 6 }}>{c.areaM2} m²</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : derivedValue <= 0 ? (
                          <div style={{ ...INLINE_FIELD_NOTE_STYLE, width: '100%' }}>
                            No floor geometry for TFA: add{' '}
                            <strong>BuildingElementGround</strong> or a horizontal floor polygon (opaque /
                            transparent / adjacent) with <strong>pitch 180°</strong> (facing down). Pitch{' '}
                            <strong>0°</strong> (facing up) is treated as a roof/ceiling surface, not treated floor
                            area.
                          </div>
                        ) : null}
                        </div>
                        <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('floorArea', zoneFloorArea)} issue={getFieldValidationIssue('floorArea', zoneFloorArea) || undefined} />
                      </>
                    );
                  })()}
                </div>
                  </>
                )}
                {showFhsPrimaryZoneNote ? (
                  <>
                    <div className="element-label">
                      FHS Area Split
                    </div>
                    <div className="element-input">
                      <div style={INLINE_FIELD_NOTE_STYLE}>
                        FHS area split is edited on the first zone only. Additional zones export as
                        {' '}<strong>livingroom_area = 0</strong> and{' '}
                        <strong>restofdwelling_area = zone floor area</strong> before FHS single-zone consolidation.
                      </div>
                    </div>
                  </>
                ) : null}
                <div className="element-label">
                  {renderFieldLabel('Height (m):', 'Zone', 'height')}
                </div>
                <div className="element-input" ref={registerBaseFieldRefs('height')}>
                  {(() => {
                    const allElementsH = Object.values(elementsById) as import('../geometry/types').Element[];
                    const derivedH = selection?.type === 'zone'
                      ? calculateDerivedHeight(selection.id, allElementsH)
                      : 0;
                    const currentH = Number(zoneHeight) || 0;
                    const isCustomH = derivedH > 0 && Math.abs(currentH - derivedH) > 0.005;

                    return (
                      <>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end' }}>
                          <div className={isCustomH ? 'custom-value' : ''} style={{ flex: 1 }}>
                            <StandardInput
                              {...decimalInputProps(zoneHeightInput)}
                              unit={fieldUnit('height', 'Zone')}
                              onBlur={(e) => {
                                const rawValue = e.currentTarget.value.trim();
                                zoneHeightInput.handleBlur(e);
                                const parsed = rawValue === '' ? '' : Number(rawValue);
                                const nextHeight = readPositiveZoneNumber(
                                  typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : '',
                                );
                                if (nextHeight != null) {
                                  commitExistingZoneDraft({ height: nextHeight });
                                }
                              }}
                              step="0.1"
                              min="0"
                              required
                              variant="ghost"
                              size="md"
                              placeholder={derivedH > 0 ? String(derivedH) : 'From walls'}
                            />
                          </div>
                          {isCustomH ? (
                            <ResetFieldButton
                              onClick={() => {
                                zoneHeightInput.setValue(derivedH);
                                if (selection?.type === 'zone') {
                                  updateZone(selection.id, { height: derivedH, _heightUserOverride: false });
                                }
                              }}
                              align="inline"
                              title={`Reset to ${derivedH} m (from wall heights)`}
                              ariaLabel="Reset Zone Height"
                              label="Reset"
                            />
                          ) : null}
                        </div>
                        {derivedH > 0 ? (
                          <div style={INLINE_FIELD_NOTE_STYLE}>
                            {isCustomH
                              ? `Default: ${derivedH} m · from wall heights`
                              : 'From wall heights'}
                          </div>
                        ) : null}
                        <FieldValidationIndicator hasIssue={!!getFieldValidationIssue('height', zoneHeight)} issue={getFieldValidationIssue('height', zoneHeight) || undefined} />
                      </>
                    );
                  })()}
                </div>
                <div className="element-label">
                  {renderFieldLabelWithComparisonIndicator('Volume (m³):', 'Zone', zoneComparisonFieldIndicators.volume, 'volume')}
                </div>
                <div className="element-input" ref={registerBaseFieldRef('volume')}>
                  <StandardInput
                    type="number"
                    value={formatToTwoDecimals(zoneVolume)}
                    unit={fieldUnit('volume', 'Zone')}
                    readOnly
                    variant="ghost"
                    size="md"
                    placeholder="Auto-calculated from floor area × effective height"
                  />
                </div>
                <div className="element-label">
                  Simplified Thermal Bridging
                </div>
                <div className="element-input" ref={registerBaseFieldRef('simplifiedThermalBridging')}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      className="styled-checkbox"
                      checked={simplifiedThermalBridging}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSimplifiedThermalBridging(checked);
                        if (isExistingZoneSelection()) {
                          updateZone(selection.id, { simplifiedThermalBridging: checked });
                        }
                      }}
                      id="simplified-thermal-bridging"
                    />
                    <span className="checkbox-custom"></span>
                  </label>
                  <FieldValidationIndicator
                    hasIssue={!!selectedZoneValidation?.issues.find((issue) => issue.fieldKey === 'simplifiedThermalBridging')}
                    issue={selectedZoneValidation?.issues.find((issue) => issue.fieldKey === 'simplifiedThermalBridging')?.message}
                  />
                  <FieldValidationIndicator
                    hasIssue={!!selectedZoneValidation?.warnings.find((warning) => warning.fieldKey === 'simplifiedThermalBridging')}
                    issue={selectedZoneValidation?.warnings.find((warning) => warning.fieldKey === 'simplifiedThermalBridging')?.message}
                    variant="warning"
                  />
                </div>
                {isExistingZoneSelection() && onOpenSpaceLabeller && !showFhsAreaSplit ? (
                  <div
                    className="element-editor-full-row element-editor-inline-actions"
                  >
                    <button
                      type="button"
                      className="btn editor-action-btn editor-action-btn--secondary"
                      onClick={() => onOpenSpaceLabeller(selection.id)}
                    >
                      Open Space Labeller
                    </button>
                    {zoneUnlabeledSpaceFootprintCount > 0 ? (
                      <ValidationPill
                        variant="error"
                        message={
                          zoneUnlabeledSpaceFootprintCount === 1
                            ? '1 space is not yet labelled'
                            : `${zoneUnlabeledSpaceFootprintCount} spaces are not yet labelled`
                        }
                        onClick={() => onOpenSpaceLabeller(selection.id)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : selection.type === 'element' || selection.type === 'global' ? (
            <>
              <div className="form-section">
                <h3 className="form-section-title">Element Details</h3>

                <div className="element-form-grid">
                  {/* Show zone for placeable elements; SpaceHeatSystem needs this even in FHS mode. */}
                  {!isGlobalElementType(elementType) &&
                    (!complianceSettings.complianceValidationEnabled ||
                      (elementType === 'System' && systemFormState.systemSubcategory === 'SpaceHeatSystem')) && (
                    <>
                      <div className="element-label">Zone:</div>
                      <div className="element-input" ref={registerBaseFieldRefs(['zoneId', 'zone_id'])}>
                        <StandardDropdown
                          value={elementZoneId}
                          onChange={(value) => {
                            setElementZoneId(value);
                            if (isExistingElementSelection()) {
                              commitExistingElementDraft({ zoneId: value || undefined });
                            }
                          }}
                          options={zones.map(zone => ({ value: zone.id, label: zone.name }))}
                          placeholder="Select a zone"
                          variant="ghost"
                        />
                      </div>
                    </>
                  )}
                  {/* Render dynamic attribute fields based on element type */}
                  {renderAttributePanel()}
                  {renderElementElevationField()}
                </div>

                {/* Advanced Fields Section - Outside grid for full width */}
                {selection.type === 'element' || selection.type === 'global' ? (
                  <div className="advanced-fields-full-width">
                    {selection.type === 'element' &&
                      !selection.isPlaceholder &&
                      !selectedIsDormerAnchor &&
                      elementType === 'BuildingElementAdjacentConditionedSpace' &&
                      selectedShape === 'polygon' && (
                      <div className="element-editor-stack element-editor-section-spacer">
                        <div>
                          {renderAssemblyActionControl(appliedAssemblyEnvelope, () => {
                            setDormerAssemblySection(null);
                            setAssemblyCalculatorOpen(true);
                          })}
                        </div>
                        <label
                          className="element-editor-checkbox-row"
                        >
                          <input
                            type="checkbox"
                            checked={isVulcanUiPartyFloorElement(selectedElement)}
                            onChange={(e) => {
                              const nextChecked = e.target.checked;
                              const prev = readExtraJsonRecord(selectedElement?.extra_json);
                              const next: Record<string, unknown> = { ...prev };
                              if (nextChecked) {
                                next[VULCAN_UI_PARTY_ELEMENT_KEY] = true;
                              } else {
                                delete next[VULCAN_UI_PARTY_ELEMENT_KEY];
                              }
                              // Fabric U/R/areal are halved by element type, not by this flag;
                              // the flag drives area (x2 internal surfaces) and junction codes.
                              // Recomputing here only restamped `appliedAt`.
                              commitExistingElementDraft({ extra_json: next });
                            }}
                          />
                          <span>
                            {selectedElement
                              ? getAdjacentPartyWallUiToggleLabel(selectedElement, elementsById)
                              : 'Party floor'}
                          </span>
                        </label>
                      </div>
                    )}
                    {selection.type === 'element' &&
                      !selection.isPlaceholder &&
                      !selectedIsDormerAnchor &&
                      (elementType === 'BuildingElementOpaque' ||
                        elementType === 'BuildingElementGround' ||
                        elementType === 'BuildingElementPartyWall' ||
                        elementType === 'BuildingElementAdjacentUnconditionedSpace_Simple') && (
                      <div className="element-editor-section-spacer">
                        {renderAssemblyActionControl(appliedAssemblyEnvelope, () => {
                          setDormerAssemblySection(null);
                          setAssemblyCalculatorOpen(true);
                        })}
                      </div>
                    )}
                    {selectedIsDormerAnchor ? (
                      <div className="dormer-editor-thermal-stack">
                        {renderDormerThermalAccordionSection(
                          'Front Wall Properties',
                          'Applies to the front dormer wall only.',
                          'front_wall',
                          dormerThermalRepresentatives.frontWall,
                        )}
                        {renderDormerThermalAccordionSection(
                          'Cheek Wall Properties',
                          'Applies to both cheek walls together.',
                          'cheek_walls',
                          dormerThermalRepresentatives.cheekWalls,
                        )}
                        {renderDormerThermalAccordionSection(
                          'Roof Properties',
                          'Applies to all dormer roof planes together.',
                          'roofs',
                          dormerThermalRepresentatives.roofs,
                        )}
                        {renderDormerThermalAccordionSection(
                          'Window Properties',
                          'Applies to the dormer window.',
                          'window',
                          dormerThermalRepresentatives.window,
                        )}
                      </div>
                    ) : hasAppliedPcdbSystemData ? (
                      null
                    ) : (
                      <React.Suspense fallback={<LazyInlineFallback label="Opening advanced fields..." />}>
                        <AdvancedFieldsEditor
                          elementType={elementType}
                          subtype={getElementSubtype()}
                          currentData={getCurrentElementData()}
                          onChange={handleAdvancedFieldsChange}
                          collapsible={false}
                          fieldIndicators={comparisonFieldIndicators}
                          evidenceFieldKeys={evidenceBridge.linkedFieldKeys}
                          focusFieldKey={comparisonFocusRequest?.fieldKey}
                          focusFieldVersion={comparisonFocusRequest?.version}
                          flat={advancedFlat}
                          useFHSSchema={useFHSSchema}
                          inspectorContributions={inspectorContributions}
                          workspaceResourcePort={workspaceResourcePort}
                          className="advanced-fields-section"
                        />
                      </React.Suspense>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {/* Sticky Form Actions */}
        {(selection.type === 'zone' || selection.type === 'element' || selection.type === 'global') && (
          <div className="element-creator-sticky-footer">
            <div
              className={`form-actions ${
                selection.type !== 'zone' && !selection.isPlaceholder
                  ? 'element-editor-actions-row element-editor-actions-row--three'
                  : 'element-editor-actions-row element-editor-actions-row--two'
              }`}
            >
              {selection.type === 'zone' ? (
                <>
                  <div className="element-editor-footer-group">
                    <button onClick={selection.isPlaceholder ? handleAddZone : () => setSelection(null)} className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary">
                      {selection.isPlaceholder ? 'Add Zone' : 'Done'}
                    </button>
                  </div>
                  <div className="element-editor-footer-group element-editor-footer-group--danger">
                    {selection.isPlaceholder ? (
                      <button
                        className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger"
                        onClick={() => { removePlaceholder('zone', selection.id); }}
                      >
                        Discard
                      </button>
                    ) : (
                      <button
                        className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger"
                        onClick={handleZoneDelete}
                      >
                        Delete Zone
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="element-editor-footer-group">
                    <button onClick={selection.isPlaceholder ? handleSaveElement : () => setSelection(null)} className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary">
                      {selection.isPlaceholder ? 'Add Element' : 'Done'}
                    </button>
                    {!selection.isPlaceholder && (
                      <button
                        className="btn editor-action-btn editor-action-btn--secondary"
                        onClick={() => {
                          if (selectionRepresentsDormer) {
                            try {
                              handleDuplicateDormerBundle(selection.id);
                            } catch (error) {
                              alert(error instanceof Error ? error.message : 'Failed to duplicate dormer');
                            }
                            return;
                          }
                          duplicateElement(selection.id);
                        }}
                      >
                        Duplicate
                      </button>
                    )}
                  </div>
                  <div className="element-editor-footer-group element-editor-footer-group--danger">
                    {selection.isPlaceholder ? (
                      <button
                        className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger"
                        onClick={() => { removePlaceholder('element', selection.id); }}
                      >
                        Discard
                      </button>
                    ) : (
                      <button
                        className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger"
                        onClick={handleElementDelete}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      {assemblyCalculatorOpen &&
        selection.type === 'element' &&
        !selection.isPlaceholder &&
        ((!selectedIsDormerAnchor &&
          (elementType === 'BuildingElementOpaque' ||
            elementType === 'BuildingElementGround' ||
            ADJACENT_LIKE_ELEMENT_TYPES.includes(elementType))) ||
          (selectedIsDormerAnchor &&
            dormerAssemblySection &&
            dormerAssemblyRepresentative &&
            dormerAssemblyRepresentative.type !== 'BuildingElementTransparent')) && (
          <React.Suspense fallback={<LazyModalFallback label="Opening assembly calculator..." />}>
            <AssemblyCalculatorModal
              isOpen={assemblyCalculatorOpen}
              onClose={() => {
                setAssemblyCalculatorOpen(false);
                setDormerAssemblySection(null);
              }}
              elementMode={assemblyModalElementMode}
              elementPitchDeg={assemblyModalPitchDeg}
              initialAssemblySnapshot={assemblyInitialSnapshot}
              appliedEnvelope={appliedAssemblyEnvelope}
              initialOpaqueSubtype={
                selectedIsDormerAnchor && dormerAssemblySection
                  ? dormerAssemblySection === 'roofs'
                    ? 'roof'
                    : 'wall'
                  : null
              }
              complianceValidationEnabled={!!complianceSettings.complianceValidationEnabled}
              groundFloorType={assemblyModalGroundFloorType}
              workspaceResourcePort={workspaceResourcePort}
              externalDetailCataloguePort={externalDetailCataloguePort}
              onApply={(patch) => {
                if (selection.type !== 'element') return;
                if (selectedIsDormerAnchor && dormerAssemblySection && dormerAssemblyRepresentative) {
                  const metadataOverride = selectedDormerMetadata?.thermal_overrides[dormerAssemblySection];
                  const fallbackOverride = getDormerThermalOverrideExtraJson(
                    dormerAssemblyRepresentative.extra_json as Record<string, unknown> | undefined,
                  );
                  const prev = { ...(metadataOverride ?? fallbackOverride ?? {}) } as Record<string, unknown>;
                  commitDormerThermalSectionChanges(dormerAssemblySection, {
                    extra_json: { ...prev, ...patch },
                  });
                  return;
                }
                const el = getElementById(selection.id);
                const prev =
                  el?.extra_json && typeof el.extra_json === 'object' && !Array.isArray(el.extra_json)
                    ? (el.extra_json as Record<string, unknown>)
                    : {};
                const nextExtra = { ...prev, ...patch };
                if (el?.type === 'BuildingElementGround') {
                  const depthBasementFloor = readFiniteNumber(el.depth_basement_floor);
                  const thicknessWalls =
                    typeof thicknessWallsInput.value === 'number' && Number.isFinite(thicknessWallsInput.value)
                      ? thicknessWallsInput.value
                      : readFiniteNumber(el.thickness_walls);
                  const floorTypeForApply = el.floor_type ?? assemblyModalGroundFloorType ?? undefined;
                  const needsBasementDepth =
                    floorTypeForApply === 'Heated_basement' || floorTypeForApply === 'Unheated_basement';
                  const uComputed = computeGroundUValueFromElementModel(el, nextExtra, floorTypeForApply, {
                    totalArea: derivedGroundArea,
                    perimeter: derivedGroundPerimeter,
                    ...(thicknessWalls != null ? { thicknessWalls } : {}),
                    ...(needsBasementDepth && depthBasementFloor != null ? { depthBasementFloorM: depthBasementFloor } : {}),
                  });
                  if (uComputed != null && Number.isFinite(uComputed) && uComputed > 0) {
                    nextExtra.u_value = Number(uComputed.toFixed(4));
                    delete nextExtra[GROUND_U_VALUE_MANUAL_KEY];
                  }
                }
                updateElement(selection.id, {
                  extra_json: nextExtra,
                });
              }}
            />
          </React.Suspense>
        )}
      {/* pendingSystemAction lives in elementForms/system.tsx's module state now
          (slice-5 brief item 8) — this modal stays orchestrator-tail-rendered
          rather than moving into System's renderPanel, because renderPanel
          only mounts while elementType === 'System'; moving the modal inside
          would make it vanish (unmount mid-confirm) the instant selection
          changes away, which this tail placement (mounted unconditionally in
          `body`) does not do. System's reset() now clears pendingSystemAction
          on every selection change (INTENTIONAL BEHAVIOUR FIX, decision (g)
          — legacy resetFormFields never did), so isOpen below already goes
          false on selection change; that fix is orthogonal to this modal's
          placement. See system.tsx's module header for the full writeup. */}
      <DeleteConfirmModal
        isOpen={!!systemFormState.pendingSystemAction}
        onClose={() => systemFormState.setPendingSystemAction(null)}
        onConfirm={systemFormState.confirmSystemSourceSwitch}
        title={
          systemFormState.pendingSystemAction?.kind === 'source'
            ? (systemFormState.pendingSystemAction.target === 'pcdb' ? 'Switch to PCDB?' : 'Switch to Sample?')
            : systemFormState.pendingSystemAction?.kind === 'subcategory'
              ? 'Change system category?'
              : systemFormState.pendingSystemAction?.value?.trim()
                ? 'Apply system preset?'
                : 'Clear system preset?'
        }
        message={
          systemFormState.pendingSystemAction?.kind === 'source'
            ? (
              systemFormState.pendingSystemAction.target === 'pcdb'
                ? 'This removes the current sample preset and any merged heating or cooling JSON on this system row. Continue?'
                : 'This removes the PCDB selection and any merged heating or cooling JSON, then loads the first preset for the selected category. Continue?'
            )
            : systemFormState.pendingSystemAction?.kind === 'subcategory'
              ? 'This clears the current system preset and any merged heating or cooling JSON on this system row. Continue?'
              : systemFormState.pendingSystemAction?.value?.trim()
                ? `This replaces the current system JSON with ${formatSystemPresetName(systemFormState.pendingSystemAction.value)}. Continue?`
                : 'This clears the current system preset and any merged heating or cooling JSON on this system row. Continue?'
        }
        itemType="element"
        itemTypeLabel="System"
        itemName={persistedElementName || undefined}
        actionButtonText="Continue"
        confirmVariant="primary"
        hideIrreversibleWarning
      />
      </div>
  );

  return useCard ? (
    <StandardCard title="Element Creator">{body}</StandardCard>
  ) : body;
};
