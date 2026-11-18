// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DraftSafeNumberInput } from './DraftSafeNumberInput';
import { LayerEndRow, LayerRow, LayerRowName, LayerRows } from './LayerRow';
import { layerNumberInputStyle } from './layerRowStyle';
import { SearchableDescribedSelect } from './SearchableDescribedSelect';
import { AssemblyLibraryPicker } from './AssemblyLibraryPicker';
import { useKeyedState } from '../hooks/useKeyedState';
import './GlobalButtonSystem.css';
import {
  arealHeatCapacityJPerM2KFromBand,
  arealHeatCapacityWrite,
  CALCULATION_ENGINE_VERSION,
  computeIso6946CombinedConstructionResistance,
  computeOpaqueUAndTotals,
  computeSuspendedGroundFloorConstructionMeansFromVoid,
  moveLayerToGap,
  normalizeAssemblyLayers,
  resolveFabricArealHeatCapacityForElement,
  sumAssemblyArealHeatCapacity,
  sumConstructionResistanceSeriesOnly,
  validateAssemblyLayerLayout,
} from '../lib/assemblyCalculator';
import {
  cavityHeatFlowDirectionForPitch,
  cavityHeatFlowLabel,
  cavitySurfaceEmissivityLabel,
  DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M,
  effectiveCavityResistanceM2KPerW,
  explicitWellVentilatedExternalSurfaceResistanceM2KPerW,
  isExplicitWellVentilatedCavity,
  resolveAssemblyHeatTransferContext,
  resolveSuspendedGroundVentilatedVoidContext,
} from '../lib/assemblyCavityModel';
import {
  buildAnnexF_v1EnvelopeSnapshot,
  ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
  ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
  shouldPersistAnnexF_v1,
} from '../lib/iso6946AnnexF';
import {
  collectCavityLayerIndices,
  defaultAnnexFAirVoidLevelForCavityType,
  effectiveAnnexFAirVoidLevelForStack,
  ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS,
  resolveAnnexFPrimaryCavityLayerIndex,
  resolveAnnexFR1LayerIndex,
} from '../lib/annexFCavity';
import { computeAssemblyAnnexF, computeFabricUWritesFromConstructionR } from '../lib/fabricUWrites';
import { loadBundledAssemblyLibrary, upsertUserAssembly, type BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import { buildUserAssemblyExample, layersFromLibraryAssembly, libraryElementTypeForMode } from '../lib/assemblyUserLibrary';
import { libraryRowFigure } from '../lib/multiSelectAssemblyApply';
import {
  type FhsMassDistributionClass,
  fhsMassDistributionFromSuggestion,
  suggestMassDistributionClass,
} from '../lib/assemblyMassHeuristic';
import {
  buildAssemblyMaterialPickerSections,
  adjustConstructionResistanceForHeatedAdjacentElement,
  applyHeatedAdjacentHalfToArealJPerM2K,
  materialSelectableInAssemblyCalculator,
  shouldUseHeatedAdjacentHalfConstructionFabric,
} from '../lib/assemblyMaterialFabric';
import type {
  AssemblyElementMode,
  AssemblyLayer,
  AssemblyLayerCavity,
  AssemblyLayerSolid,
  ExternalDetailProfileLink,
  MaterialRow,
  RepeatingBridgeRow,
  VulcanAssemblyV1Envelope,
} from '../lib/assemblyTypes';
import { roundToTwoDecimals } from '../geometry/constants';
import type { GroundFloorType } from '../lib/groundFloor';
import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetRules } from '../../../geometry-editor-host/src/schemaPort';
import type {
  ExternalConstructionDetailProfile,
  ExternalDetailCataloguePort,
} from '../geometry/thermalBridge/externalDetailContracts';

export interface AssemblyLayersProps {
  elementMode: AssemblyElementMode;
  /**
   * Pitch (degrees) from the element editor — drives ISO 13789 surface films for the U-value.
   * Edit pitch on the element.
   */
  elementPitchDeg: number;
  /** The element's layers (`vulcan_assembly_v1`, or the ones a typed value set aside). */
  appliedEnvelope?: VulcanAssemblyV1Envelope | null;
  /** Each edit's patch, as it is made: the element's values follow the layers. */
  onApply: (extraJsonPatch: Record<string, unknown>) => void;
  /** Host-owned access to the currently selected workspace. */
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  /** The library as reloaded after a save, so the other pickers (Fabric tab, new elements) offer the saved row. */
  onLibrarySaved?: (library: BundledAssemblyLibrary) => void;
  /** Optional host-supplied recognised/manufacturer detail catalogue. */
  externalDetailCataloguePort?: ExternalDetailCataloguePort;
  /**
   * Wall or roof, from the element (`inferOpaqueSubtype`; a dormer's roofs section is a roof). For an opaque or
   * adjacent-conditioned element it picks the library rows, the library type a save files under, and the
   * inverted-roof correction.
   */
  opaqueSubtype: 'wall' | 'roof';
  /**
   * HEM ground `floor_type` when `elementMode` is ground. R_g split (`thermal_resist_insul`) is only meaningful for
   * suspended floors — when this is not `Suspended_floor`, the calculator uses a single construction R only.
   */
  groundFloorType?: GroundFloorType | null;
}

function newBridgeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `rb-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function emptySolidLayer(): AssemblyLayer {
  return { kind: 'solid', materialId: '', thickness_m: 0.1 };
}

function emptyCavityLayer(): AssemblyLayer {
  return {
    kind: 'cavity',
    ventilation: 'unventilated',
    gap_thickness_m: DEFAULT_EXPLICIT_UNVENTILATED_CAVITY_GAP_M,
    surface_emissivity: 'high',
  };
}

/** Studs, joists and rafters are timber, so a new repeating bridge starts as softwood. */
const DEFAULT_BRIDGE_MATERIAL_ID = 'mat.br443.timber_softwood';

function newRepeatingBridgeRow(defaultBridgeMaterialId: string): RepeatingBridgeRow {
  return {
    id: newBridgeId(),
    bridgeMaterialId: defaultBridgeMaterialId,
    definition: { mode: 'framing_fraction', framingFraction: 0.12 },
  };
}

function layerAnnexLabel(layer: AssemblyLayer, idx: number, materialsById: Map<string, MaterialRow>): string {
  if (layer.kind === 'cavity') {
    const gapMm =
      typeof layer.gap_thickness_m === 'number' && Number.isFinite(layer.gap_thickness_m)
        ? Math.round(layer.gap_thickness_m * 1000)
        : null;
    const descriptor =
      gapMm != null
        ? `${gapMm} mm ${cavitySurfaceEmissivityLabel(layer.surface_emissivity)} cavity`
        : `cavity (${layer.cavityType || 'legacy'})`;
    return `Layer ${idx + 1}: ${descriptor}`;
  }
  const m = materialsById.get(layer.materialId);
  const nm = m?.shortName ?? m?.name ?? layer.materialId;
  return `Layer ${idx + 1}: ${nm} (${(layer.thickness_m * 1000).toFixed(0)} mm)`;
}

const pickerMenuZ = 13000;

const assemblyStackNumberInputStyle = layerNumberInputStyle;

const assemblyFieldActionStyle: React.CSSProperties = {
  minHeight: 'var(--form-input-height)',
  height: 'var(--form-input-height)',
  borderRadius: 'var(--form-input-radius)',
};

function externalDetailProfileLink(
  profile: ExternalConstructionDetailProfile,
): ExternalDetailProfileLink {
  return {
    source: profile.source,
    profileId: profile.id,
    label: profile.label,
  };
}

function coerceExternalDetailProfileLink(
  raw: unknown,
  externalDetailCataloguePort?: ExternalDetailCataloguePort,
): ExternalDetailProfileLink | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === 'string' ? r.source.trim() : '';
  const profileId = typeof r.profileId === 'string' ? r.profileId.trim() : '';
  if (!source || !profileId) return null;
  const profile = externalDetailCataloguePort?.getProfile({ source, profileId, label: profileId });
  if (profile) return externalDetailProfileLink(profile);
  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : profileId;
  return { source, profileId, label };
}

/** What the user edits: the layers and the corrections they carry. */
interface AssemblyDraft {
  layers: AssemblyLayer[];
  externalDetailProfile: ExternalDetailProfileLink | null;
  /** When several cavity layers exist, which drives Annex F ΔU_g (inside → outside order in list). */
  annexFPrimaryCavityLayerIndex: number | null;
  annexFastenerEnabled: boolean;
  annexNf: number;
  annexChi: number;
  annexInvertedRoof: boolean;
  annexPMm: number;
  annexFTimesX: number;
}

/**
 * An element's layers, inline in its panel, inside to outside: the library picker, one row per
 * layer (a click opens it) and the corrections. Every edit applies at once (`onApply`), so the
 * element's U-value, heat capacity and mass distribution follow the layers, with undo.
 */
export const AssemblyLayers: React.FC<AssemblyLayersProps> = ({
  elementMode,
  elementPitchDeg,
  appliedEnvelope = null,
  onApply,
  workspaceResourcePort,
  onLibrarySaved,
  externalDetailCataloguePort,
  opaqueSubtype,
  groundFloorType = null,
}) => {
  // The target takes areal heat capacity as a number or as a class on its own scale.
  // The rule follows the target alone, not the model settings, so the layers need no store.
  const arealHeatCapacityInput = targetRules(useGeometrySchemaPort(), {}).arealHeatCapacity;
  const arealWrite = arealHeatCapacityWrite(arealHeatCapacityInput, elementMode);
  const arealScale = arealHeatCapacityInput.classes;
  const heatedAdjacentHalfConstruction = useMemo(
    () => shouldUseHeatedAdjacentHalfConstructionFabric(elementMode),
    [elementMode],
  );

  const supportsExternalDetails = externalDetailCataloguePort !== undefined;
  const initialDraft = useMemo(() => {
    const baseLayers =
      appliedEnvelope?.assemblySnapshot?.layers && appliedEnvelope.assemblySnapshot.layers.length > 0
        ? appliedEnvelope.assemblySnapshot.layers
        : null;
    let nextLayers: AssemblyLayer[] = baseLayers?.length ? normalizeAssemblyLayers(baseLayers) : [];
    if (appliedEnvelope?.annexF_v1) {
      const annex = appliedEnvelope.annexF_v1;
      const index = annex.airVoidLayerIndex;
      if (index >= 0 && index < nextLayers.length && nextLayers[index]?.kind === 'cavity') {
        nextLayers = [...nextLayers];
        nextLayers[index] = {
          ...nextLayers[index],
          annexFAirVoidLevelOverride: annex.airVoidLevel,
        } as AssemblyLayerCavity;
      }
    }

    const primarySnapshot = appliedEnvelope?.assemblySnapshot;
    const annex = appliedEnvelope?.annexF_v1;
    const primaryCavityLayerIndex =
      primarySnapshot &&
      typeof primarySnapshot === 'object' &&
      'annexFPrimaryCavityLayerIndex' in primarySnapshot
        ? (primarySnapshot as { annexFPrimaryCavityLayerIndex?: number | null }).annexFPrimaryCavityLayerIndex ?? null
        : annex?.airVoidLayerIndex ?? null;

    return {
      layers: nextLayers,
      /** A saved stack shows its errors at once; a blank one waits for the first edit. */
      fromSaved: !!baseLayers?.length,
      externalDetailProfile: supportsExternalDetails
        ? coerceExternalDetailProfileLink(
            appliedEnvelope?.assemblySnapshot?.externalDetailProfile,
            externalDetailCataloguePort,
          )
        : null,
      primaryCavityLayerIndex,
      fastenerEnabled: !!annex && annex.fastenerNf_per_m2 > 0 && annex.fastenerChi_W_per_m2K > 0,
      nf: annex?.fastenerNf_per_m2 ?? 0,
      chi: annex?.fastenerChi_W_per_m2K ?? 0,
      invertedRoof: annex?.invertedRoof ?? false,
      precipitation: annex?.p_mm_per_day ?? ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
      fTimesX: annex?.f_times_x ?? ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
    };
  }, [
    appliedEnvelope,
    externalDetailCataloguePort,
    supportsExternalDetails,
  ]);
  const draftResetKey = useMemo(() => JSON.stringify({
    appliedEnvelope,
    supportsExternalDetails,
  }), [appliedEnvelope, supportsExternalDetails]);

  const [library, setLibrary] = useState<BundledAssemblyLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useKeyedState<AssemblyDraft>(draftResetKey, {
    layers: initialDraft.layers,
    externalDetailProfile: initialDraft.externalDetailProfile,
    annexFPrimaryCavityLayerIndex: initialDraft.primaryCavityLayerIndex,
    annexFastenerEnabled: initialDraft.fastenerEnabled,
    annexNf: initialDraft.nf,
    annexChi: initialDraft.chi,
    annexInvertedRoof: initialDraft.invertedRoof,
    annexPMm: initialDraft.precipitation,
    annexFTimesX: initialDraft.fTimesX,
  });
  const { layers, externalDetailProfile, annexFastenerEnabled, annexNf, annexChi, annexInvertedRoof, annexPMm, annexFTimesX } = draft;
  const [layersEdited, setLayersEdited] = useKeyedState(draftResetKey, false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  /** The row open for its material, bridges and Remove. */
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [dragLayerIdx, setDragLayerIdx] = useState<number | null>(null);
  /** Gap index 0…n while dragging (line before row `k`, or after last when `n`). */
  const [dropInsertAt, setDropInsertAt] = useState<number | null>(null);
  const reloadLibrary = useCallback(async () => {
    const lib = await loadBundledAssemblyLibrary(workspaceResourcePort);
    setLibrary(lib);
    onLibrarySaved?.(lib);
  }, [onLibrarySaved, workspaceResourcePort]);

  useEffect(() => {
    let cancel = false;
    loadBundledAssemblyLibrary(workspaceResourcePort)
      .then((lib) => {
        if (!cancel) {
          setLibrary(lib);
          setLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancel) {
          const base = e instanceof Error ? e.message : 'Failed to load assembly library';
          const hint =
            ' Ensure the workspace folder is selected and contains input/assembly_library/ (e.g. extract the sample project or copy from the repo).';
          setLoadError(base.includes('Workspace') || base.includes('assembly_library') ? base + hint : base);
        }
      });
    return () => {
      cancel = true;
    };
  }, [workspaceResourcePort]);

  const libraryElementType = useMemo(
    () => libraryElementTypeForMode(elementMode, opaqueSubtype),
    [elementMode, opaqueSubtype],
  );

  const materialSectionsByLayer = useMemo(() => {
    if (!library) return [];
    return layers.map((L) =>
      buildAssemblyMaterialPickerSections(
        library,
        elementMode,
        L.kind === 'solid' ? L.materialId : undefined,
      ),
    );
  }, [library, elementMode, layers]);

  const firstMaterialId = useMemo(() => {
    if (!library) return '';
    const sorted = [...library.materialsById.values()]
      .filter((m) => materialSelectableInAssemblyCalculator(elementMode, m))
      .sort((a, b) => a.name.localeCompare(b.name));
    return sorted[0]?.id ?? '';
  }, [library, elementMode]);

  const defaultBridgeMaterialId = useMemo(
    () => (library?.materialsById.has(DEFAULT_BRIDGE_MATERIAL_ID) ? DEFAULT_BRIDGE_MATERIAL_ID : ''),
    [library],
  );

  const libraryAssemblyOptions = useMemo(() => {
    if (!library) return [];
    return library.examples.filter((ex) => ex.elementType === libraryElementType);
  }, [library, libraryElementType]);

  /** The library row these layers are, so the picker keeps its name until the layers change. */
  const chosenAssemblyId = useMemo(() => {
    if (!library) return '';
    const current = JSON.stringify(layers);
    const row = libraryAssemblyOptions.find((ex) =>
      JSON.stringify(layersFromLibraryAssembly(ex, library.materialsById, library.cavityResistanceByType)) === current);
    return row?.id ?? '';
  }, [library, libraryAssemblyOptions, layers]);

  const externalDetailProfiles = useMemo(
    () => externalDetailCataloguePort?.listProfiles() ?? [],
    [externalDetailCataloguePort],
  );

  const externalDetailProfileSections = useMemo(() => {
    if (!supportsExternalDetails) return [];
    const bySystem = new Map<string, ExternalConstructionDetailProfile[]>();
    for (const profile of externalDetailProfiles) {
      if (profile.elementType !== 'wall') continue;
      const title = `${profile.sourceShortName} · ${profile.systemName}`;
      const list = bySystem.get(title) ?? [];
      list.push(profile);
      bySystem.set(title, list);
    }
    return [...bySystem.entries()].map(([title, profiles]) => ({
      title,
      options: profiles.map((profile) => ({
        value: profile.id,
        label: profile.optionLabel ?? profile.label,
        description: profile.description ?? `${profile.junctions.length} details`,
        searchText: profile.label,
      })),
    }));
  }, [externalDetailProfiles, supportsExternalDetails]);

  const selectedExternalDetailProfile = useMemo(
    () => externalDetailCataloguePort?.getProfile(externalDetailProfile),
    [externalDetailCataloguePort, externalDetailProfile],
  );

  /**
   * Everything a draft of the layers gives: what the rows show, and the patch an edit applies
   * (null while the layers are incomplete).
   */
  const computeAssembly = (draft: AssemblyDraft) => {
    const {
      layers, externalDetailProfile, annexFPrimaryCavityLayerIndex, annexFastenerEnabled,
      annexNf, annexChi, annexInvertedRoof, annexPMm, annexFTimesX,
    } = draft;
    const suspendedGroundAssembly = elementMode === 'BuildingElementGround' && groundFloorType === 'Suspended_floor';
    const suspendedGroundVoidContext = (() => (suspendedGroundAssembly ? resolveSuspendedGroundVentilatedVoidContext(layers) : null))();
    const suspendedGroundVoidSplit = (() => {
      if (!library || !suspendedGroundAssembly) return null;
      return computeSuspendedGroundFloorConstructionMeansFromVoid(
        layers,
        library.materialsById,
        library.cavityResistanceByType,
        elementPitchDeg,
      );
    })();
    const useSuspendedGroundVoidSplit = !!suspendedGroundVoidSplit?.hasVentilatedVoid;
    const suspendedGroundErrors = (() =>
        suspendedGroundAssembly && !useSuspendedGroundVoidSplit
          ? ['Suspended floors need one well ventilated cavity to mark the underfloor void.']
          : [])();
    const calcLayers = (() => (useSuspendedGroundVoidSplit ? suspendedGroundVoidSplit!.rfLayers : layers))();
    const heatTransferContext = (() => resolveAssemblyHeatTransferContext(calcLayers, elementPitchDeg))();

    const calc = (() => {
      if (!library) {
        return {
          rLayers: 0,
          rLayersFullAssembly: 0,
          rConstructionLower: 0,
          rConstructionUpper: 0,
          rLayersSeries: 0,
          rLayersSeriesFullAssembly: 0,
          seriesLayerResistances: [] as number[],
          u: 0,
          uSeries: 0,
          hasRepeatingBridges: false,
          arealJPerM2K: null as number | null,
          arealErrors: [] as string[],
          errors: [] as string[],
        };
      }
      const layoutErrors = validateAssemblyLayerLayout(layers);
      const iso = computeIso6946CombinedConstructionResistance(
        calcLayers,
        library.materialsById,
        library.cavityResistanceByType,
        elementPitchDeg,
      );
      const seriesOnly = sumConstructionResistanceSeriesOnly(
        calcLayers,
        library.materialsById,
        library.cavityResistanceByType,
        elementPitchDeg,
      );
      const { rLayers: rLayersSeries, errors: seriesErrors } = seriesOnly;
      const adjustedResistance = adjustConstructionResistanceForHeatedAdjacentElement(
        elementMode,
        iso.rConstructionMean_m2K_W,
        rLayersSeries,
      );
      const rMean = adjustedResistance.rMean;
      const rLayersSeriesAdjusted = adjustedResistance.rSeries;
      const { u } = computeOpaqueUAndTotals(
        rMean,
        elementPitchDeg,
        heatTransferContext.externalSurfaceResistance_m2K_W,
      );
      const { u: uSeries } = computeOpaqueUAndTotals(
        rLayersSeriesAdjusted,
        elementPitchDeg,
        heatTransferContext.externalSurfaceResistance_m2K_W,
      );
      const hasRepeatingBridges = heatTransferContext.effectiveLayers.some(
        (l) => l.kind === 'solid' && (l.repeatingBridges?.length ?? 0) > 0,
      );
      const areal = sumAssemblyArealHeatCapacity(heatTransferContext.effectiveLayers, library.materialsById);
      const arealJHalved = applyHeatedAdjacentHalfToArealJPerM2K(areal.jPerM2K, elementMode);
      return {
        rLayers: rMean,
        rLayersFullAssembly: iso.rConstructionMean_m2K_W,
        rConstructionLower: iso.rConstructionLower_m2K_W,
        rConstructionUpper: iso.rConstructionUpper_m2K_W,
        rLayersSeries: rLayersSeriesAdjusted,
        rLayersSeriesFullAssembly: rLayersSeries,
        seriesLayerResistances: seriesOnly.layerResistances,
        u,
        uSeries,
        hasRepeatingBridges,
        arealJPerM2K: arealJHalved,
        arealErrors: areal.errors,
        errors: [...layoutErrors, ...iso.errors, ...seriesErrors, ...suspendedGroundErrors, ...(suspendedGroundVoidSplit?.errors ?? [])],
      };
    })();

    /**
     * Each layer's own R, quiet in its row, while the rows are the calculated layers. A
     * well-ventilated cavity ends them: the rows inside it have R, the cavity and the rows outside none.
     */
    const layerSeriesR: readonly (number | undefined)[] = useSuspendedGroundVoidSplit || calc.errors.length > 0
      || calc.seriesLayerResistances.length !== heatTransferContext.effectiveLayers.length
      ? [] : calc.seriesLayerResistances;

    /** Ground floor: split deck R_f vs crawl-space ground insulation R_g (HEM `thermal_resist_insul`). */
    const groundSplit = (() => {
      if (!library || elementMode !== 'BuildingElementGround') return null;
      if (suspendedGroundAssembly) return useSuspendedGroundVoidSplit ? suspendedGroundVoidSplit : null;
      return null;
    })();

    const cavityLayerIndices = (() => collectCavityLayerIndices(layers))();

    const annexFPrimaryCavityResolved = (() => resolveAnnexFPrimaryCavityLayerIndex(layers, annexFPrimaryCavityLayerIndex))();

    const effectiveAnnexFAirVoidLevel = (() => {
      if (!library) return 0 as const;
      return effectiveAnnexFAirVoidLevelForStack(layers, library.cavityRows, annexFPrimaryCavityResolved);
    })();

    const hasAnnexFAirVoidOverrideOnAnyCavity = (() =>
        layers.some((L) => L.kind === 'cavity' && (L as AssemblyLayerCavity).annexFAirVoidLevelOverride !== undefined))();

    const annexR1Resolved = (() => {
      if (!library || calc.errors.length > 0) return 0;
      return resolveAnnexFR1LayerIndex(layers, calc.seriesLayerResistances, annexFPrimaryCavityResolved);
    })();

    const annexF = (() => {
      if (!library || calc.errors.length > 0 || !(calc.u > 0)) return null;
      // Annex F is defined for a single construction path; skip when R_f/R_g stack split is used.
      if (elementMode === 'BuildingElementGround' && useSuspendedGroundVoidSplit) {
        return null;
      }
      return computeAssemblyAnnexF({
        rFullMean_m2K_W: calc.rLayersFullAssembly,
        rFullSeries_m2K_W: calc.rLayersSeriesFullAssembly,
        pitchDeg: elementPitchDeg,
        externalSurfaceResistance_m2K_W: heatTransferContext.externalSurfaceResistance_m2K_W,
        halfConstruction: heatedAdjacentHalfConstruction,
        layerSeriesR_m2K_W: calc.seriesLayerResistances,
        layers: heatTransferContext.effectiveLayers,
        r1LayerIndex: annexR1Resolved,
        airVoidLevel: effectiveAnnexFAirVoidLevel,
        fastenerNf_per_m2: annexFastenerEnabled ? annexNf : 0,
        fastenerChi_W_per_m2K: annexFastenerEnabled ? annexChi : 0,
        invertedRoofEnabled: annexInvertedRoof,
        opaqueSubtype,
        pMmPerDay: annexPMm,
        fTimesX: annexFTimesX,
      });
    })();
    const annexComputation = annexF?.annex ?? null;
    const annexDeltaUForElement = annexF?.deltaUForElement_W_m2K ?? 0;

    const fabricUWrites = (() => {
      if (!(calc.rLayers > 0)) return null;
      return computeFabricUWritesFromConstructionR(
        calc.rLayers,
        calc.rLayersSeries,
        elementPitchDeg,
        heatTransferContext.externalSurfaceResistance_m2K_W,
        annexDeltaUForElement,
      );
    })();

    const massSuggestion = (() => {
      if (!library) return undefined;
      return suggestMassDistributionClass(heatTransferContext.effectiveLayers, library.materialsById);
    })();

    const assemblyApplyErrors = (() => [
        ...calc.errors,
        ...(elementMode === 'BuildingElementGround' && groundSplit ? groundSplit.errors : []),
        ...(fabricUWrites?.error ? [fabricUWrites.error] : []),
      ])();

    const showApplyErrors = assemblyApplyErrors.length > 0 && (layersEdited || initialDraft.fromSaved);

    const stackValidForApply = (() => {
      if (elementMode === 'BuildingElementGround' && groundSplit && library) {
        const { u } = computeOpaqueUAndTotals(groundSplit.rfMean_m2K_W, elementPitchDeg);
        return groundSplit.rfMean_m2K_W > 0 && u > 0;
      }
      return calc.rLayers > 0 && calc.u > 0;
    })();

    const patch = (() => {
      if (assemblyApplyErrors.length > 0 || !stackValidForApply || !library) return null;

      const useGroundRf =
        elementMode === 'BuildingElementGround' && groundSplit && groundSplit.rfMean_m2K_W > 0;
      const rfMean = useGroundRf ? groundSplit!.rfMean_m2K_W : calc.rLayers;
      const rfSeries = useGroundRf
        ? sumConstructionResistanceSeriesOnly(
            groundSplit!.rfLayers,
            library.materialsById,
            library.cavityResistanceByType,
            elementPitchDeg,
          ).rLayers
        : calc.rLayersSeries;
      const rgMean = useGroundRf ? groundSplit!.rgMean_m2K_W : 0;

      const rfIsoLimits =
        useGroundRf && groundSplit
          ? computeIso6946CombinedConstructionResistance(
              groundSplit.rfLayers,
              library.materialsById,
              library.cavityResistanceByType,
              elementPitchDeg,
            )
          : null;

      const annex = annexComputation;
      const uW = computeFabricUWritesFromConstructionR(
        rfMean,
        rfSeries,
        elementPitchDeg,
        heatTransferContext.externalSurfaceResistance_m2K_W,
        annexDeltaUForElement,
      );
      if (uW.error) return null;
      const uWrite = uW.uForHem_W_m2K;
      const rWrite = uW.thermalResistanceConstruction_m2K_W;
      const massDistributionClass: FhsMassDistributionClass | undefined =
        massSuggestion != null ? fhsMassDistributionFromSuggestion(massSuggestion) : undefined;
      if (massDistributionClass == null) return null;

      const envelope: VulcanAssemblyV1Envelope = {
        schemaVersion: 1,
        assemblyId: 'calculator:layered',
        assemblySnapshot: {
          layers,
          pitchDegrees: elementPitchDeg,
          elementMode,
          ...(cavityLayerIndices.length > 1 ? { annexFPrimaryCavityLayerIndex: annexFPrimaryCavityResolved } : {}),
          ...(supportsExternalDetails && externalDetailProfile ? { externalDetailProfile } : {}),
        },
        appliedAt: new Date().toISOString(),
        /** Series stack only (ignores parallel bridges) — audit clear-field U. */
        uncorrectedU_W_m2K: uW.uncorrectedU_twoSf_W_m2K,
        /** Final U for HEM (Annex F corrections included). */
        correctedU_W_m2K: uWrite,
        combinedMethodU_W_m2K: roundToTwoDecimals(
          annex ? calc.u : uW.uCombinedFromRoundedConstruction_W_m2K,
        ),
        thermalResistanceConstruction_m2K_W: rWrite,
        rConstructionLowerLimit_m2K_W: roundToTwoDecimals(
          heatedAdjacentHalfConstruction
            ? (rfIsoLimits ? rfIsoLimits.rConstructionLower_m2K_W : calc.rConstructionLower) / 2
            : (rfIsoLimits ? rfIsoLimits.rConstructionLower_m2K_W : calc.rConstructionLower),
        ),
        rConstructionUpperLimit_m2K_W: roundToTwoDecimals(
          heatedAdjacentHalfConstruction
            ? (rfIsoLimits ? rfIsoLimits.rConstructionUpper_m2K_W : calc.rConstructionUpper) / 2
            : (rfIsoLimits ? rfIsoLimits.rConstructionUpper_m2K_W : calc.rConstructionUpper),
        ),
        massDistributionClass,
        calculationEngineVersion: CALCULATION_ENGINE_VERSION,
        ...(elementMode === 'BuildingElementGround' && suspendedGroundAssembly
          ? { thermalResistanceGroundInsulation_m2K_W: roundToTwoDecimals(rgMean) }
          : {}),
      };
      if (
        annex &&
        shouldPersistAnnexF_v1({
          annex,
          airVoidLevel: effectiveAnnexFAirVoidLevel,
          hasAnnexFAirVoidLevelOverrideOnAnyCavity: hasAnnexFAirVoidOverrideOnAnyCavity,
          annexFastenerEnabled,
          annexNf,
          annexChi,
          annexInvertedRoof,
          annexPMm,
          annexFTimesX,
        })
      ) {
        envelope.annexF_v1 = buildAnnexF_v1EnvelopeSnapshot(annex, {
          airVoidLevel: effectiveAnnexFAirVoidLevel,
          airVoidLayerIndex: annexR1Resolved,
          fastenerNf_per_m2: annexFastenerEnabled ? annexNf : 0,
          fastenerChi_W_per_m2K: annexFastenerEnabled ? annexChi : 0,
          invertedRoof: annexInvertedRoof,
          p_mm_per_day: annexPMm,
          f_times_x: annexFTimesX,
        });
      }
      const arealRawJ =
        calc.arealJPerM2K != null ? roundToTwoDecimals(calc.arealJPerM2K) : undefined;
      const arealElementValue = resolveFabricArealHeatCapacityForElement(
        calc.arealJPerM2K,
        arealWrite,
      );
      if (arealRawJ != null) {
        envelope.arealHeatCapacity_J_m2K = arealRawJ;
      }
      const arealElementJ = arealHeatCapacityJPerM2KFromBand(arealElementValue, arealScale);
      if (arealElementJ != null) {
        envelope.arealHeatCapacityWrittenToElement_J_m2K = arealElementJ;
      }
      if (elementMode !== 'BuildingElementGround') {
        envelope.uValueWrittenToElement_W_m2K = uWrite;
      }

      if (
        elementMode === 'BuildingElementGround' &&
        suspendedGroundAssembly &&
        useSuspendedGroundVoidSplit &&
        suspendedGroundVoidSplit?.heightUpperSurfaceM != null
      ) {
        envelope.suspendedHeightUpperSurfaceM = roundToTwoDecimals(suspendedGroundVoidSplit.heightUpperSurfaceM);
      }

      if (elementMode === 'BuildingElementGround') {
        return {
          thermal_resistance_floor_construction: rWrite,
          ...(suspendedGroundAssembly ? { thermal_resist_insul: roundToTwoDecimals(rgMean) } : {}),
          ...(suspendedGroundAssembly &&
          useSuspendedGroundVoidSplit &&
          suspendedGroundVoidSplit?.heightUpperSurfaceM != null
            ? { height_upper_surface: roundToTwoDecimals(suspendedGroundVoidSplit.heightUpperSurfaceM) }
            : {}),
          mass_distribution_class: massDistributionClass,
          areal_heat_capacity: arealElementValue, // undefined clears a stale value (no ρ/c)
          vulcan_assembly_v1: envelope,
        };
      } else {
        return {
          u_value: uWrite,
          thermal_resistance_construction: rWrite,
          construction_basis: shouldUseHeatedAdjacentHalfConstructionFabric(elementMode) ? 'half' : 'full',
          ...(elementMode === 'BuildingElementPartyWall' ? { u_value_interpretation: 'half_construction' } : {}),
          mass_distribution_class: massDistributionClass,
          areal_heat_capacity: arealElementValue, // undefined clears a stale value (no ρ/c)
          vulcan_assembly_v1: envelope,
        };
      }
    })();

    return {
      suspendedGroundAssembly, suspendedGroundVoidContext, suspendedGroundVoidSplit, useSuspendedGroundVoidSplit,
      calc, layerSeriesR, groundSplit, cavityLayerIndices, annexFPrimaryCavityResolved,
      assemblyApplyErrors, showApplyErrors, stackValidForApply, patch,
    };
  };
  const {
    suspendedGroundAssembly, suspendedGroundVoidContext, suspendedGroundVoidSplit, useSuspendedGroundVoidSplit,
    calc, layerSeriesR, groundSplit, cavityLayerIndices, annexFPrimaryCavityResolved,
    assemblyApplyErrors, showApplyErrors, stackValidForApply,
  } = computeAssembly(draft);

  /** An edit: the draft changes, and applies to the element at once when the layers are complete. */
  const edit = (changes: Partial<AssemblyDraft>) => {
    setSaveMessage(null);
    const next = { ...draft, ...changes };
    setDraft(next);
    const { patch } = computeAssembly(next);
    if (patch) onApply(patch);
  };
  const setLayers = (next: AssemblyLayer[] | ((previous: AssemblyLayer[]) => AssemblyLayer[])) => {
    setLayersEdited(true);
    edit({ layers: typeof next === 'function' ? next(draft.layers) : next });
  };
  const setExternalDetailProfile = (externalDetailProfile: ExternalDetailProfileLink | null) => edit({ externalDetailProfile });
  const setAnnexFPrimaryCavityLayerIndex = (annexFPrimaryCavityLayerIndex: number | null) => edit({ annexFPrimaryCavityLayerIndex });
  const setAnnexFastenerEnabled = (annexFastenerEnabled: boolean) => edit({ annexFastenerEnabled });
  const setAnnexNf = (annexNf: number) => edit({ annexNf });
  const setAnnexChi = (annexChi: number) => edit({ annexChi });
  const setAnnexInvertedRoof = (annexInvertedRoof: boolean) => edit({ annexInvertedRoof });
  const setAnnexPMm = (annexPMm: number) => edit({ annexPMm });
  const setAnnexFTimesX = (annexFTimesX: number) => edit({ annexFTimesX });

  const handleSaveToLibrary = async () => {
    if (!library || assemblyApplyErrors.length > 0 || !stackValidForApply) return;
    setSaveBusy(true);
    setSaveMessage(null);
    try {
      const lt = libraryElementTypeForMode(elementMode, opaqueSubtype);
      const ex = buildUserAssemblyExample(
        layers,
        elementMode,
        lt,
        library.materialsById,
        library.cavityRows,
        supportsExternalDetails ? externalDetailProfile : null,
      );
      await upsertUserAssembly(ex, workspaceResourcePort);
      await reloadLibrary();
      setSaveMessage('Saved to your library');
    } catch (e: unknown) {
      setSaveMessage(
        e instanceof Error ? e.message : 'Failed to save assembly — check workspace folder permissions.',
      );
    } finally {
      setSaveBusy(false);
    }
  };

  /** A new layer at the inside (0) or the outside end, open to pick its material. */
  const addLayer = (at: number) => {
    setLayers([...layers.slice(0, at), emptySolidLayer(), ...layers.slice(at)]);
    setOpenRow(at);
  };
  const endRow = (label: 'Inside' | 'Outside', at: number) => <LayerEndRow label={label} onAdd={() => addLayer(at)} />;
  const layerName = (layer: AssemblyLayer): string => {
    if (layer.kind === 'cavity') {
      return layer.ventilation === 'well_ventilated' ? 'Air gap, well ventilated' : 'Air gap, unventilated';
    }
    const material = library?.materialsById.get(layer.materialId);
    return material?.shortName || material?.name || layer.materialId || 'Choose a material';
  };

  return (
    <div data-assembly-layers style={{ color: 'var(--text-primary)' }}>
          {loadError && (
            <div style={{ color: 'var(--error-text)', marginBottom: 10, fontSize: 13 }}>{loadError}</div>
          )}

          {library && (
            <div style={{ marginBottom: 12 }}>
              <div className="element-label" style={{ marginBottom: 6 }}>Layers</div>
              <AssemblyLibraryPicker
                library={library}
                elementType={libraryElementType}
                figure={(row) => libraryRowFigure(row, library, elementMode, elementPitchDeg, {
                  arealHeatCapacity: arealHeatCapacityInput,
                  groundFloorType,
                })}
                value={chosenAssemblyId}
                menuZIndex={pickerMenuZ}
                onSave={() => void handleSaveToLibrary()}
                saveDisabled={saveBusy || assemblyApplyErrors.length > 0 || !stackValidForApply}
                onPick={(row) => {
                  if (!row) return;
                  const next = layersFromLibraryAssembly(
                    row,
                    library.materialsById,
                    library.cavityResistanceByType,
                  );
                  if (next.length === 0) return;
                  setLayersEdited(true);
                  // A library row carries no fasteners, inverted roof or main-cavity pick: clear them
                  // so the U applied is the U the option showed.
                  edit({
                    layers: next,
                    annexFastenerEnabled: false,
                    annexInvertedRoof: false,
                    annexFPrimaryCavityLayerIndex: null,
                    externalDetailProfile: coerceExternalDetailProfileLink(row.externalDetailProfile, externalDetailCataloguePort),
                  });
                }}
              />
              {saveMessage && (
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 6,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: saveMessage.startsWith('Saved')
                      ? 'var(--success-bg)'
                      : 'var(--error-bg)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {saveMessage}
                </div>
              )}
            </div>
          )}

          {supportsExternalDetails && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary, var(--surface-control))',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Detail profile
                </label>
                {selectedExternalDetailProfile ? (
                  <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    {selectedExternalDetailProfile.sourceShortName}
                  </span>
                ) : null}
              </div>
              <div style={{ marginTop: 8 }}>
                <SearchableDescribedSelect
                  value={selectedExternalDetailProfile?.id ?? ''}
                  placeholder="Not linked"
                  searchPlaceholder="Search detail profiles…"
                  minWidth="100%"
                  menuZIndex={pickerMenuZ}
                  collapsibleSections
                  sections={externalDetailProfileSections}
                  onChange={(profileId) => {
                    const profile = externalDetailCataloguePort?.getProfile(profileId);
                    setExternalDetailProfile(profile ? externalDetailProfileLink(profile) : null);
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                  {selectedExternalDetailProfile
                    ? selectedExternalDetailProfile.systemName
                    : 'Optional · used by auto thermal bridges'}
                </span>
                {selectedExternalDetailProfile && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => setExternalDetailProfile(null)}
                  >
                    Remove link
                  </button>
                )}
              </div>
            </div>
          )}

          {library && cavityLayerIndices.length > 1 && !useSuspendedGroundVoidSplit && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary, var(--surface-control))',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Main cavity for the optional air-gap extra
                </span>
                <select
                  value={annexFPrimaryCavityResolved ?? cavityLayerIndices[0]}
                  onChange={(e) => setAnnexFPrimaryCavityLayerIndex(Number(e.target.value))}
                  style={{
                    padding: '6px 8px',
                    height: 'var(--form-input-height)',
                    borderRadius: 'var(--form-input-radius)',
                    maxWidth: '100%',
                    background: 'var(--bg-primary)',
                    color: 'inherit',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {cavityLayerIndices.map((ci) => (
                    <option key={ci} value={ci}>
                      {layerAnnexLabel(layers[ci]!, ci, library.materialsById)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {library && elementMode === 'BuildingElementGround' && suspendedGroundAssembly && useSuspendedGroundVoidSplit && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary, var(--surface-control))',
              }}
            >
              <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                Above void: R_f ≈ {groundSplit?.rfMean_m2K_W.toFixed(3) ?? '0.000'} m²K/W · Below void: R_g ≈{' '}
                {groundSplit?.rgMean_m2K_W.toFixed(3) ?? '0.000'} m²K/W · Void height ≈{' '}
                {suspendedGroundVoidSplit?.heightUpperSurfaceM?.toFixed(3) ?? '0.000'} m
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
          <LayerRows>
          {endRow('Inside', 0)}
          {layers.map((layer, idx) => {
            const n = layers.length;
            const insertAt = (e: React.DragEvent<HTMLDivElement>) => {
              const rect = e.currentTarget.getBoundingClientRect();
              return e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
            };
            return (
            <LayerRow
              key={idx}
              label={`Layer ${idx + 1}`}
              active={openRow === idx}
              r={layerSeriesR[idx]}
              drag={{
                dragging: dragLayerIdx === idx,
                insertLine: dropInsertAt === idx ? 'above' : dropInsertAt === n && idx === n - 1 ? 'below' : undefined,
                onDragStart: (e) => {
                  setDragLayerIdx(idx);
                  e.dataTransfer.setData('text/plain', String(idx));
                  e.dataTransfer.effectAllowed = 'move';
                },
                onDragEnd: () => {
                  setDragLayerIdx(null);
                  setDropInsertAt(null);
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropInsertAt(insertAt(e));
                },
                onDrop: (e) => {
                  e.preventDefault();
                  const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                  setDragLayerIdx(null);
                  setDropInsertAt(null);
                  if (!Number.isFinite(from)) return;
                  setLayers((prev) => moveLayerToGap(prev, from, insertAt(e)));
                },
              }}
              thickness={layer.kind === 'solid' ? {
                valueMm: Math.round(layer.thickness_m * 1000),
                onChange: (mm) => setLayers(layers.map((l, i) => (i === idx ? { ...l, thickness_m: (mm ?? 0) / 1000 } as AssemblyLayer : l))),
              } : {
                valueMm: layer.gap_thickness_m === undefined ? '' : Math.round(layer.gap_thickness_m * 1000),
                onChange: (mm) => setLayers(layers.map((l, i) => (i === idx ? { ...l, gap_thickness_m: mm === undefined ? undefined : mm / 1000 } as AssemblyLayer : l))),
              }}
              details={openRow === idx ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      aria-label="Layer type"
                      value={layer.kind}
                      onChange={(e) => {
                        const kind = e.target.value as 'solid' | 'cavity';
                        const next = [...layers];
                        next[idx] =
                          kind === 'solid'
                            ? { kind: 'solid', materialId: firstMaterialId, thickness_m: 0.1 }
                            : emptyCavityLayer();
                        setLayers(next);
                      }}
                      style={{
                        flexShrink: 0,
                        width: 92,
                        padding: 'var(--spacing-sm, 8px) var(--spacing-sm, 8px)',
                        height: 'var(--form-input-height)',
                        borderRadius: 'var(--form-input-radius)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-input, inherit)',
                        fontSize: 12,
                      }}
                    >
                      <option value="solid">Solid</option>
                      <option value="cavity">Cavity</option>
                    </select>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {library && layer.kind === 'solid' && (
                        <SearchableDescribedSelect
                          value={layer.materialId}
                          placeholder="Search materials…"
                          searchPlaceholder="Filter materials…"
                          minWidth="100%"
                          collapsibleSections
                          menuZIndex={pickerMenuZ}
                          sections={materialSectionsByLayer[idx] ?? []}
                          onChange={(materialId) => {
                            setLayers(layers.map((l, i) => (i === idx ? { ...l, materialId } as AssemblyLayer : l)));
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {library && layer.kind === 'cavity' && (
                    <>
                      {(() => {
                        const cavityLayer = layer as AssemblyLayerCavity;
                        const isWellVentilated = isExplicitWellVentilatedCavity(cavityLayer);
                        const suspendedGroundVoidLayer =
                          suspendedGroundAssembly &&
                          isWellVentilated &&
                          suspendedGroundVoidContext?.voidLayerIndex === idx;
                        const derived = suspendedGroundVoidLayer
                          ? { rSe: 0, error: undefined as string | undefined }
                          : isWellVentilated
                          ? explicitWellVentilatedExternalSurfaceResistanceM2KPerW(cavityLayer, elementPitchDeg)
                          : effectiveCavityResistanceM2KPerW(
                              cavityLayer,
                              elementPitchDeg,
                              library.cavityResistanceByType,
                            );
                        const heatFlow = cavityHeatFlowDirectionForPitch(elementPitchDeg);
                        const derivedValueLabel = suspendedGroundVoidLayer
                          ? `${(suspendedGroundVoidContext?.heightUpperSurfaceM ?? 0).toFixed(3)} m`
                          : derived.error
                            ? 'Incomplete'
                            : isWellVentilated
                              ? `${explicitWellVentilatedExternalSurfaceResistanceM2KPerW(cavityLayer, elementPitchDeg).rSe.toFixed(2)} m2K/W`
                              : `${effectiveCavityResistanceM2KPerW(
                                  cavityLayer,
                                  elementPitchDeg,
                                  library.cavityResistanceByType,
                                ).r.toFixed(2)} m2K/W`;
                        const cavityHelperText = suspendedGroundVoidLayer
                          ? 'Underfloor void. Gap writes height_upper_surface and splits the stack above/below.'
                          : isWellVentilated
                            ? 'Uses sheltered external surface resistance. Outer layers are ignored in the U-value path.'
                            : `Derived from gap, emissivity and ${cavityHeatFlowLabel(heatFlow)} heat flow.`;
                        return (
                          <div
                            style={{
                              display: 'grid',
                              gap: 8,
                              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            }}
                          >
                            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {suspendedGroundAssembly ? 'Void type' : 'Ventilation'}
                              </span>
                              <select
                                aria-label="Cavity ventilation"
                                value={cavityLayer.ventilation ?? 'unventilated'}
                                onChange={(e) => {
                                  const next = [...layers];
                                  next[idx] = {
                                    ...cavityLayer,
                                    ventilation: e.target.value as 'unventilated' | 'well_ventilated',
                                  };
                                  setLayers(next);
                                }}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: 'var(--form-input-radius)',
                                  background: 'var(--bg-primary)',
                                  color: 'inherit',
                                  border: '1px solid var(--border-subtle)',
                                  height: 'var(--form-input-height)',
                                }}
                              >
                                <option value="unventilated">Unventilated</option>
                                <option value="well_ventilated">
                                  {suspendedGroundAssembly ? 'Underfloor void (ventilated)' : 'Well ventilated'}
                                </option>
                              </select>
                            </label>
                            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Surface emissivity</span>
                              <select
                                aria-label="Cavity emissivity"
                                value={cavityLayer.surface_emissivity ?? 'high'}
                                onChange={(e) => {
                                  const next = [...layers];
                                  next[idx] = {
                                    ...cavityLayer,
                                    surface_emissivity: e.target.value as 'high' | 'low',
                                  };
                                  setLayers(next);
                                }}
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: 'var(--form-input-radius)',
                                  background: 'var(--bg-primary)',
                                  color: 'inherit',
                                  border: '1px solid var(--border-subtle)',
                                  height: 'var(--form-input-height)',
                                }}
                              >
                                <option value="high">High emissivity</option>
                                <option value="low">Low emissivity</option>
                              </select>
                            </label>
                            <div
                              style={{
                                gridColumn: '1 / -1',
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 8,
                                alignItems: 'baseline',
                                fontSize: 11,
                                color: 'var(--text-secondary)',
                                lineHeight: 1.45,
                                marginTop: 2,
                              }}
                            >
                              <strong style={{ color: 'var(--text-primary)' }}>
                                {suspendedGroundVoidLayer
                                  ? `Void height: ${derivedValueLabel}`
                                  : isWellVentilated
                                    ? `Derived Rse: ${derivedValueLabel}`
                                    : `Derived R: ${derivedValueLabel}`}
                              </strong>
                              <span>{cavityHelperText}</span>
                            </div>
                            {derived.error && !suspendedGroundVoidLayer ? (
                              <div
                                style={{
                                  gridColumn: '1 / -1',
                                  color: 'var(--error)',
                                  fontSize: 12,
                                  lineHeight: 1.4,
                                }}
                              >
                                {derived.error}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                      {!useSuspendedGroundVoidSplit && annexFPrimaryCavityResolved != null && idx === annexFPrimaryCavityResolved && (
                          <div
                            style={{
                              marginTop: 10,
                              paddingTop: 10,
                              borderTop: '1px solid var(--border-subtle, var(--surface-control-active))',
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                marginBottom: 6,
                                color: 'var(--text-secondary)',
                                lineHeight: 1.4,
                              }}
                            >
                              Optional extra air-gap effect
                            </div>
                            <label style={{ display: 'block', fontSize: 12 }}>
                              <select
                                aria-label="Optional extra air-gap effect"
                                value={
                                  (layer as AssemblyLayerCavity).annexFAirVoidLevelOverride === undefined
                                    ? 'suggested'
                                    : String((layer as AssemblyLayerCavity).annexFAirVoidLevelOverride)
                                }
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const next = [...layers];
                                  const cur = next[idx] as AssemblyLayerCavity;
                                  next[idx] =
                                    v === 'suggested'
                                      ? (() => {
                                          const rest = { ...cur };
                                          delete rest.annexFAirVoidLevelOverride;
                                          return rest;
                                        })()
                                      : {
                                          ...cur,
                                          annexFAirVoidLevelOverride: Number(v) as 0 | 1 | 2,
                                        };
                                  setLayers(next);
                                }}
                                style={{
                                  padding: '6px 8px',
                                  height: 'var(--form-input-height)',
                                  borderRadius: 'var(--form-input-radius)',
                                  maxWidth: '100%',
                                  background: 'var(--bg-primary)',
                                  color: 'inherit',
                                  border: '1px solid var(--border-subtle)',
                                }}
                              >
                                {(() => {
                                  const suggestedLevel = defaultAnnexFAirVoidLevelForCavityType(
                                    layer.cavityType ?? '',
                                    library.cavityRows,
                                  );
                                  return (
                                    <>
                                      <option value="suggested">
                                        Use suggested (
                                        {ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS[suggestedLevel]})
                                      </option>
                                      {suggestedLevel !== 0 && (
                                        <option value="0">{ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS[0]}</option>
                                      )}
                                      {suggestedLevel !== 1 && (
                                        <option value="1">{ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS[1]}</option>
                                      )}
                                      {suggestedLevel !== 2 && (
                                        <option value="2">{ISO6946_ANNEX_F_AIR_VOID_EFFECT_LABELS[2]}</option>
                                      )}
                                    </>
                                  );
                                })()}
                              </select>
                            </label>
                          </div>
                        )}
                    </>
                  )}
                  {layer.kind === 'solid' && (
                    <>
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        marginTop: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-nav btn-small"
                        style={assemblyFieldActionStyle}
                        title="Repeating bridges in this thickness (e.g. studs). Not used for cavity layers."
                        onClick={() => {
                          const next = [...layers];
                          const s = next[idx] as AssemblyLayerSolid;
                          const bridges = [...(s.repeatingBridges ?? [])];
                          bridges.push(newRepeatingBridgeRow(defaultBridgeMaterialId));
                          next[idx] = { ...s, repeatingBridges: bridges };
                          setLayers(next);
                        }}
                      >
                        Add repeating bridge
                      </button>
                    </div>
                    {library &&
                      (layer as AssemblyLayerSolid).repeatingBridges?.map((bridge, bidx) => {
                        const bridgeSections = buildAssemblyMaterialPickerSections(
                          library,
                          elementMode,
                          bridge.bridgeMaterialId,
                        );
                        const defMode = bridge.definition.mode;
                        return (
                          <div
                            key={bridge.id}
                            style={{
                              marginTop: 10,
                              marginLeft: 8,
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: '1px dashed var(--focus-outline)',
                              background: 'var(--surface-control)',
                            }}
                          >
                            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                              Repeating framing (in-plane)
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                              <SearchableDescribedSelect
                                value={bridge.bridgeMaterialId}
                                placeholder="Bridge material…"
                                searchPlaceholder="Filter materials…"
                                minWidth="min(100%, 220px)"
                                collapsibleSections
                                menuZIndex={pickerMenuZ}
                                sections={bridgeSections}
                                onChange={(bridgeMaterialId) => {
                                  const next = [...layers];
                                  const s = next[idx] as AssemblyLayerSolid;
                                  const bridges = [...(s.repeatingBridges ?? [])];
                                  bridges[bidx] = { ...bridges[bidx]!, bridgeMaterialId };
                                  next[idx] = { ...s, repeatingBridges: bridges };
                                  setLayers(next);
                                }}
                              />
                              <select
                                aria-label="Bridge definition"
                                value={defMode}
                                onChange={(e) => {
                                  const mode = e.target.value as 'framing_fraction' | 'spacing_width';
                                  const next = [...layers];
                                  const s = next[idx] as AssemblyLayerSolid;
                                  const bridges = [...(s.repeatingBridges ?? [])];
                                  bridges[bidx] = {
                                    ...bridges[bidx]!,
                                    definition:
                                      mode === 'framing_fraction'
                                        ? { mode: 'framing_fraction', framingFraction: 0.12 }
                                        : { mode: 'spacing_width', spacing_m: 0.6, width_m: 0.038 },
                                  };
                                  next[idx] = { ...s, repeatingBridges: bridges };
                                  setLayers(next);
                                }}
                                style={{
                                  padding: 8,
                                  height: 'var(--form-input-height)',
                                  borderRadius: 'var(--form-input-radius)',
                                  border: '1px solid var(--border-subtle)',
                                  background: 'var(--bg-tertiary)',
                                  color: 'inherit',
                                  fontSize: 12,
                                }}
                              >
                                <option value="framing_fraction">Framing fraction</option>
                                <option value="spacing_width">Spacing + width</option>
                              </select>
                              {defMode === 'framing_fraction' && (
                                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                                  Fraction (0–1)
                                  <DraftSafeNumberInput
                                    step={0.001}
                                    min={0.001}
                                    max={1}
                                    value={bridge.definition.mode === 'framing_fraction' ? bridge.definition.framingFraction : 0.12}
                                    onChange={(e) => {
                                      const v = Number(e.target.value);
                                      const next = [...layers];
                                      const s = next[idx] as AssemblyLayerSolid;
                                      const bridges = [...(s.repeatingBridges ?? [])];
                                      bridges[bidx] = {
                                        ...bridges[bidx]!,
                                        definition: { mode: 'framing_fraction', framingFraction: v },
                                      };
                                      next[idx] = { ...s, repeatingBridges: bridges };
                                      setLayers(next);
                                    }}
                                    style={{
                                      ...assemblyStackNumberInputStyle,
                                      width: 88,
                                      padding: 6,
                                    }}
                                  />
                                </label>
                              )}
                              {defMode === 'spacing_width' && bridge.definition.mode === 'spacing_width' && (
                                <>
                                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Spacing (mm)
                                    <DraftSafeNumberInput
                                      min={1}
                                      value={Math.round(bridge.definition.spacing_m * 1000)}
                                      onChange={(e) => {
                                        const mm = Number(e.target.value);
                                        const next = [...layers];
                                        const s = next[idx] as AssemblyLayerSolid;
                                        const bridges = [...(s.repeatingBridges ?? [])];
                                        const prev = bridges[bidx]!.definition;
                                        if (prev.mode !== 'spacing_width') return;
                                        bridges[bidx] = {
                                          ...bridges[bidx]!,
                                          definition: {
                                            mode: 'spacing_width',
                                            spacing_m: mm / 1000,
                                            width_m: prev.width_m,
                                          },
                                        };
                                        next[idx] = { ...s, repeatingBridges: bridges };
                                        setLayers(next);
                                      }}
                                      style={{
                                        ...assemblyStackNumberInputStyle,
                                        width: 80,
                                        marginLeft: 6,
                                        padding: 6,
                                      }}
                                    />
                                  </label>
                                  <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Width (mm)
                                    <DraftSafeNumberInput
                                      min={1}
                                      value={Math.round(bridge.definition.width_m * 1000)}
                                      onChange={(e) => {
                                        const mm = Number(e.target.value);
                                        const next = [...layers];
                                        const s = next[idx] as AssemblyLayerSolid;
                                        const bridges = [...(s.repeatingBridges ?? [])];
                                        const prev = bridges[bidx]!.definition;
                                        if (prev.mode !== 'spacing_width') return;
                                        bridges[bidx] = {
                                          ...bridges[bidx]!,
                                          definition: {
                                            mode: 'spacing_width',
                                            spacing_m: prev.spacing_m,
                                            width_m: mm / 1000,
                                          },
                                        };
                                        next[idx] = { ...s, repeatingBridges: bridges };
                                        setLayers(next);
                                      }}
                                      style={{
                                        ...assemblyStackNumberInputStyle,
                                        width: 80,
                                        marginLeft: 6,
                                        padding: 6,
                                      }}
                                    />
                                  </label>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn btn-nav btn-small"
                                style={assemblyFieldActionStyle}
                                aria-label="Remove bridge"
                                onClick={() => {
                                  const next = [...layers];
                                  const s = next[idx] as AssemblyLayerSolid;
                                  const bridges = (s.repeatingBridges ?? []).filter((_, j) => j !== bidx);
                                  next[idx] =
                                    bridges.length > 0 ? { ...s, repeatingBridges: bridges } : { ...s, repeatingBridges: undefined };
                                  setLayers(next);
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div>
                    <button
                      type="button"
                      className="btn btn-nav btn-small"
                      style={assemblyFieldActionStyle}
                      onClick={() => {
                        setLayers(layers.filter((_, i) => i !== idx));
                        setOpenRow(null);
                      }}
                    >
                      Remove layer
                    </button>
                  </div>
                </div>
              ) : undefined}
            >
              <LayerRowName name={layerName(layer)} open={openRow === idx} italic={layer.kind === 'cavity'}
                onToggle={() => setOpenRow(openRow === idx ? null : idx)} />
            </LayerRow>
            );
          })}

          {endRow('Outside', layers.length)}
          </LayerRows>
          </div>

          {library &&
            (elementMode === 'BuildingElementOpaque' ||
              elementMode === 'BuildingElementAdjacentConditionedSpace') &&
            calc.errors.length === 0 &&
            calc.u > 0 && (
              <details
                style={{
                  marginBottom: 12,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '8px 10px',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  Advanced corrections
                </summary>
                <div style={{ marginTop: 10, lineHeight: 1.55 }}>
                  <div style={{ marginBottom: opaqueSubtype === 'roof' ? 14 : 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)', fontSize: 12 }}>
                      Penetrating fasteners (e.g. wall ties)
                    </div>
                    <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: annexFastenerEnabled ? 10 : 0 }}>
                      <input
                        type="checkbox"
                        checked={annexFastenerEnabled}
                        onChange={(e) => setAnnexFastenerEnabled(e.target.checked)}
                      />
                      Include fastener correction
                    </label>
                    {annexFastenerEnabled && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span>How many per square metre of face?</span>
                          <DraftSafeNumberInput
                            min={0}
                            step={0.01}
                            value={annexNf || ''}
                            onChange={(e) => setAnnexNf(Number(e.target.value) || 0)}
                            style={assemblyStackNumberInputStyle}
                          />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span title="Thermal loss characteristic per fastener (ISO 6946 symbol χ)">
                            Heat loss per fastener (W/m²K)
                          </span>
                          <DraftSafeNumberInput
                            min={0}
                            step={0.001}
                            value={annexChi || ''}
                            onChange={(e) => setAnnexChi(Number(e.target.value) || 0)}
                            style={assemblyStackNumberInputStyle}
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {opaqueSubtype === 'roof' && (
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)', fontSize: 12 }}>
                        Inverted roof (waterproofing above insulation)
                      </div>
                      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: annexInvertedRoof ? 10 : 0 }}>
                        <input
                          type="checkbox"
                          checked={annexInvertedRoof}
                          onChange={(e) => setAnnexInvertedRoof(e.target.checked)}
                        />
                        Include rain-on-insulation correction
                      </label>
                      {annexInvertedRoof && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span title="Replace with project or national data when you have it">
                              Typical heating-season rainfall (mm per day)
                            </span>
                            <DraftSafeNumberInput
                              min={0}
                              step={0.1}
                              value={annexPMm}
                              onChange={(e) => setAnnexPMm(Number(e.target.value) || 0)}
                              style={assemblyStackNumberInputStyle}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span title="From manufacturer or national tables; ISO 6946 uses symbol f×x">
                              Drainage / system factor (f×x)
                            </span>
                            <DraftSafeNumberInput
                              min={0}
                              step={0.001}
                              value={annexFTimesX}
                              onChange={(e) => setAnnexFTimesX(Number(e.target.value) || 0)}
                              style={assemblyStackNumberInputStyle}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </details>
            )}


          {showApplyErrors && (
            <div
              data-assembly-actions
              role="alert"
              title={assemblyApplyErrors.join('\n')}
              style={{
                marginBottom: 12,
                color: 'var(--validation-error)',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {assemblyApplyErrors[0]}
            </div>
          )}
    </div>
  );
};
