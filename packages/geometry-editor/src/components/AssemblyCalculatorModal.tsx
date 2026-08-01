// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { DraftSafeNumberInput } from './DraftSafeNumberInput';
import { ModalHeader } from './ModalHeader';
import { SearchableDescribedSelect } from './SearchableDescribedSelect';
import { useKeyedState } from '../hooks/useKeyedState';
import './GlobalButtonSystem.css';
import {
  arealHeatCapacityBandFromJPerM2K,
  arealHeatCapacityJPerM2KFromBand,
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
  migrateLegacyCavityLayer,
  resolveAssemblyHeatTransferContext,
  resolveSuspendedGroundVentilatedVoidContext,
} from '../lib/assemblyCavityModel';
import {
  buildAnnexF_v1EnvelopeSnapshot,
  computeAnnexFCorrections,
  ISO6946_DEFAULT_INVERTED_ROOF_F_TIMES_X,
  ISO6946_DEFAULT_UK_PRECIPITATION_HEATING_SEASON_MM_PER_DAY,
  roundUValueToTwoSignificantFigures,
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
import { computeFabricUWritesFromConstructionR } from '../lib/fabricUWrites';
import { loadBundledAssemblyLibrary, upsertUserAssembly, type BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import { assemblySearchHaystack, assemblyPickerDescription } from '../lib/assemblyNaming';
import { buildUserAssemblyExample, libraryElementTypeForMode } from '../lib/assemblyUserLibrary';
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
  AssemblyExample,
  AssemblyLayer,
  AssemblyLayerCavity,
  AssemblyLayerSolid,
  ExternalDetailProfileLink,
  MaterialRow,
  RepeatingBridgeRow,
  VulcanAssemblyV1Envelope,
} from '../lib/assemblyTypes';
import { FHS_MASS_CLASS_COMMENTARY } from '../lib/assemblyAppliedUi';
import { roundToTwoDecimals } from '../geometry/constants';
import type { GroundFloorType } from '../lib/groundUValueCalculator';
import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src';
import type {
  ExternalConstructionDetailProfile,
  ExternalDetailCataloguePort,
} from '../geometry/thermalBridge/externalDetailContracts';

export interface AssemblyCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  elementMode: AssemblyElementMode;
  /**
   * Pitch (degrees) from the element editor — drives ISO 13789 surface films for the U-value.
   * Edit pitch on the element (advanced fields), not in this modal.
   */
  elementPitchDeg: number;
  /** When present (e.g. from extra_json.vulcan_assembly_v1), reopening restores the layer stack. */
  initialAssemblySnapshot?: VulcanAssemblyV1Envelope['assemblySnapshot'] | null;
  /** Last calculator result saved on this element (audit blob); used for “last applied” copy. */
  appliedEnvelope?: VulcanAssemblyV1Envelope | null;
  onApply: (extraJsonPatch: Record<string, unknown>) => void;
  /** Host-owned access to the currently selected workspace. */
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  /** Optional host-supplied recognised/manufacturer detail catalogue. */
  externalDetailCataloguePort?: ExternalDetailCataloguePort;
  /**
   * When set while the modal opens, sets **Fabric type** (wall vs roof) for opaque and adjacent-conditioned
   * (e.g. dormer roof planes → `roof`).
   */
  initialOpaqueSubtype?: 'wall' | 'roof' | null;
  /**
   * Global “FHS validation” toggle: map computed areal heat capacity to the nearest FHS enum band
   * and write that label to `extra_json.areal_heat_capacity`.
   */
  complianceValidationEnabled?: boolean;
  /**
   * HEM ground `floor_type` when `elementMode` is ground. R_g split (`thermal_resist_insul`) is only meaningful for
   * suspended floors — when this is not `Suspended_floor`, the calculator uses a single construction R only.
   */
  groundFloorType?: GroundFloorType | null;
}

function layersFromLibraryAssembly(
  row: AssemblyExample,
  materialsById: Map<string, MaterialRow>,
  cavityResistanceByType: Map<string, number>,
): AssemblyLayer[] {
  const out: AssemblyLayer[] = [];
  for (const L of row.layers) {
    if (L.kind === 'solid') {
      const mid = L.materialId ?? '';
      if (!mid || !materialsById.has(mid)) continue;
      out.push({
        kind: 'solid',
        materialId: mid,
        thickness_m: typeof L.thickness_m === 'number' && L.thickness_m > 0 ? L.thickness_m : 0.1,
      });
    } else {
      const ct = L.cavityType ?? '';
      const r =
        (ct ? cavityResistanceByType.get(ct) : undefined) ??
        (typeof L.fixedResistance_m2K_W === 'number' ? L.fixedResistance_m2K_W : 0.18);
      out.push(
        migrateLegacyCavityLayer({
          kind: 'cavity',
          cavityType: ct || undefined,
          ...(r > 0 ? { fixedResistance_m2K_W: r } : {}),
          ventilation: L.ventilation,
          gap_thickness_m: L.gap_thickness_m,
          surface_emissivity: L.surface_emissivity,
          annexFAirVoidLevelOverride: L.annexFAirVoidLevelOverride,
        }),
      );
    }
  }
  return out;
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

const NUM_EPS = 1e-6;
function numChanged(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) > NUM_EPS;
}

const modalSelectZ = 13000;

/** Same look as thickness / bridge inputs in the layer stack (no default browser white). */
const assemblyStackNumberInputStyle: React.CSSProperties = {
  width: 140,
  padding: 'var(--spacing-sm, 8px) var(--spacing-md, 10px)',
  height: 'var(--form-input-height)',
  borderRadius: 'var(--form-input-radius)',
  background: 'var(--bg-primary)',
  color: 'inherit',
  fontSize: 12,
  border: '1px solid var(--border-subtle)',
};

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

export const AssemblyCalculatorModal: React.FC<AssemblyCalculatorModalProps> = ({
  isOpen,
  onClose,
  elementMode,
  elementPitchDeg,
  initialAssemblySnapshot = null,
  appliedEnvelope = null,
  onApply,
  workspaceResourcePort,
  externalDetailCataloguePort,
  initialOpaqueSubtype = null,
  complianceValidationEnabled = false,
  groundFloorType = null,
}) => {
  const heatedAdjacentHalfConstruction = useMemo(
    () => shouldUseHeatedAdjacentHalfConstructionFabric(elementMode),
    [elementMode],
  );

  const supportsExternalDetails = externalDetailCataloguePort !== undefined;
  const initialDraft = useMemo(() => {
    const fromInitial =
      initialAssemblySnapshot?.layers && initialAssemblySnapshot.layers.length > 0
        ? initialAssemblySnapshot.layers
        : null;
    const fromApplied =
      appliedEnvelope?.assemblySnapshot?.layers && appliedEnvelope.assemblySnapshot.layers.length > 0
        ? appliedEnvelope.assemblySnapshot.layers
        : null;
    const baseLayers = fromInitial ?? fromApplied;
    let nextLayers: AssemblyLayer[] = baseLayers?.length
      ? normalizeAssemblyLayers(baseLayers)
      : [emptySolidLayer()];
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

    const primarySnapshot =
      initialAssemblySnapshot?.layers && initialAssemblySnapshot.layers.length > 0
        ? initialAssemblySnapshot
        : appliedEnvelope?.assemblySnapshot;
    const annex = appliedEnvelope?.annexF_v1;
    const primaryCavityLayerIndex =
      primarySnapshot &&
      typeof primarySnapshot === 'object' &&
      'annexFPrimaryCavityLayerIndex' in primarySnapshot
        ? (primarySnapshot as { annexFPrimaryCavityLayerIndex?: number | null }).annexFPrimaryCavityLayerIndex ?? null
        : annex?.airVoidLayerIndex ?? null;

    return {
      layers: nextLayers,
      externalDetailProfile: supportsExternalDetails
        ? coerceExternalDetailProfileLink(
            initialAssemblySnapshot?.externalDetailProfile ??
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
    initialAssemblySnapshot,
    supportsExternalDetails,
  ]);
  const draftResetKey = useMemo(() => JSON.stringify({
    open: isOpen,
    initialAssemblySnapshot,
    appliedEnvelope,
    supportsExternalDetails,
  }), [appliedEnvelope, initialAssemblySnapshot, isOpen, supportsExternalDetails]);

  const [library, setLibrary] = useState<BundledAssemblyLibrary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useKeyedState(draftResetKey, initialDraft.layers);
  /** Wall vs roof when `elementMode` is opaque — filters library and save target. */
  const [opaqueSubtype, setOpaqueSubtype] = useKeyedState<'wall' | 'roof'>(
    initialOpaqueSubtype == null ? 'uncontrolled' : `${isOpen ? 'open' : 'closed'}\0${initialOpaqueSubtype}`,
    initialOpaqueSubtype ?? 'wall',
  );
  const [saveMessage, setSaveMessage] = useKeyedState<string | null>(
    isOpen ? 'open' : 'closed',
    null,
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [dragLayerIdx, setDragLayerIdx] = useState<number | null>(null);
  /** Gap index 0…n while dragging (line before row `k`, or after last when `n`). */
  const [dropInsertAt, setDropInsertAt] = useState<number | null>(null);
  const [externalDetailProfile, setExternalDetailProfile] = useKeyedState<ExternalDetailProfileLink | null>(
    draftResetKey,
    initialDraft.externalDetailProfile,
  );

  /** ISO 6946 Annex F — installation corrections. Air void / R₁ come from cavity layers. */
  /** When several cavity layers exist, which drives Annex F ΔU_g (inside → outside order in list). */
  const [annexFPrimaryCavityLayerIndex, setAnnexFPrimaryCavityLayerIndex] = useKeyedState<number | null>(
    draftResetKey,
    initialDraft.primaryCavityLayerIndex,
  );
  const [annexFastenerEnabled, setAnnexFastenerEnabled] = useKeyedState(
    draftResetKey,
    initialDraft.fastenerEnabled,
  );
  const [annexNf, setAnnexNf] = useKeyedState(draftResetKey, initialDraft.nf);
  const [annexChi, setAnnexChi] = useKeyedState(draftResetKey, initialDraft.chi);
  const [annexInvertedRoof, setAnnexInvertedRoof] = useKeyedState(draftResetKey, initialDraft.invertedRoof);
  const [annexPMm, setAnnexPMm] = useKeyedState(draftResetKey, initialDraft.precipitation);
  const [annexFTimesX, setAnnexFTimesX] = useKeyedState(draftResetKey, initialDraft.fTimesX);

  const suspendedGroundAssembly = elementMode === 'BuildingElementGround' && groundFloorType === 'Suspended_floor';
  const suspendedGroundVoidContext = useMemo(
    () => (suspendedGroundAssembly ? resolveSuspendedGroundVentilatedVoidContext(layers) : null),
    [suspendedGroundAssembly, layers],
  );
  const suspendedGroundVoidSplit = useMemo(() => {
    if (!library || !suspendedGroundAssembly) return null;
    return computeSuspendedGroundFloorConstructionMeansFromVoid(
      layers,
      library.materialsById,
      library.cavityResistanceByType,
      elementPitchDeg,
    );
  }, [library, suspendedGroundAssembly, layers, elementPitchDeg]);
  const useSuspendedGroundVoidSplit = !!suspendedGroundVoidSplit?.hasVentilatedVoid;
  const suspendedGroundErrors = useMemo(
    () =>
      suspendedGroundAssembly && !useSuspendedGroundVoidSplit
        ? ['Suspended floors need one well ventilated cavity to mark the underfloor void.']
        : [],
    [suspendedGroundAssembly, useSuspendedGroundVoidSplit],
  );
  const calcLayers = useMemo(
    () => (useSuspendedGroundVoidSplit ? suspendedGroundVoidSplit!.rfLayers : layers),
    [useSuspendedGroundVoidSplit, suspendedGroundVoidSplit, layers],
  );
  const heatTransferContext = useMemo(
    () => resolveAssemblyHeatTransferContext(calcLayers, elementPitchDeg),
    [calcLayers, elementPitchDeg],
  );

  const reloadLibrary = useCallback(async () => {
    const lib = await loadBundledAssemblyLibrary(workspaceResourcePort);
    setLibrary(lib);
  }, [workspaceResourcePort]);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, workspaceResourcePort]);

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

  const libraryAssemblyOptions = useMemo(() => {
    if (!library) return [];
    return library.examples.filter((ex) => ex.elementType === libraryElementType);
  }, [library, libraryElementType]);

  const assemblyStarterSections = useMemo(() => {
    if (!library) return [];
    return [
      {
        title: 'Library assemblies',
        options: libraryAssemblyOptions.map((row) => ({
          value: row.id,
          label: row.name,
          description: assemblyPickerDescription(row),
          searchText: assemblySearchHaystack(row, library.materialsById),
        })),
      },
    ];
  }, [library, libraryAssemblyOptions]);

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

  const calc = useMemo(() => {
    if (!library) {
      return {
        rLayers: 0,
        rLayersFullAssembly: 0,
        rConstructionLower: 0,
        rConstructionUpper: 0,
        rLayersSeries: 0,
        seriesLayerResistances: [] as number[],
        rTotSeriesWithFilms: 0,
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
    const { u: uSeries, rTot: rTotSeriesWithFilms } = computeOpaqueUAndTotals(
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
      seriesLayerResistances: seriesOnly.layerResistances,
      rTotSeriesWithFilms,
      u,
      uSeries,
      hasRepeatingBridges,
      arealJPerM2K: arealJHalved,
      arealErrors: areal.errors,
      errors: [...layoutErrors, ...iso.errors, ...seriesErrors, ...suspendedGroundErrors, ...(suspendedGroundVoidSplit?.errors ?? [])],
    };
  }, [library, layers, calcLayers, elementPitchDeg, heatTransferContext, elementMode, suspendedGroundErrors, suspendedGroundVoidSplit]);

  /** Ground floor: split deck R_f vs crawl-space ground insulation R_g (HEM `thermal_resist_insul`). */
  const groundSplit = useMemo(() => {
    if (!library || elementMode !== 'BuildingElementGround') return null;
    if (suspendedGroundAssembly) return useSuspendedGroundVoidSplit ? suspendedGroundVoidSplit : null;
    return null;
  }, [library, elementMode, suspendedGroundAssembly, useSuspendedGroundVoidSplit, suspendedGroundVoidSplit]);

  const cavityLayerIndices = useMemo(() => collectCavityLayerIndices(layers), [layers]);

  const annexFPrimaryCavityResolved = useMemo(
    () => resolveAnnexFPrimaryCavityLayerIndex(layers, annexFPrimaryCavityLayerIndex),
    [layers, annexFPrimaryCavityLayerIndex],
  );

  const effectiveAnnexFAirVoidLevel = useMemo(() => {
    if (!library) return 0 as const;
    return effectiveAnnexFAirVoidLevelForStack(layers, library.cavityRows, annexFPrimaryCavityResolved);
  }, [library, layers, annexFPrimaryCavityResolved]);

  const hasAnnexFAirVoidOverrideOnAnyCavity = useMemo(
    () =>
      layers.some((L) => L.kind === 'cavity' && (L as AssemblyLayerCavity).annexFAirVoidLevelOverride !== undefined),
    [layers],
  );

  const annexR1Resolved = useMemo(() => {
    if (!library || calc.errors.length > 0) return 0;
    return resolveAnnexFR1LayerIndex(layers, calc.seriesLayerResistances, annexFPrimaryCavityResolved);
  }, [library, calc.errors.length, calc.seriesLayerResistances, layers, annexFPrimaryCavityResolved]);

  const annexComputation = useMemo(() => {
    if (!library || calc.errors.length > 0 || !(calc.u > 0)) return null;
    // Annex F is defined for a single construction path; skip when R_f/R_g stack split is used.
    if (elementMode === 'BuildingElementGround' && useSuspendedGroundVoidSplit) {
      return null;
    }
    return computeAnnexFCorrections({
      uCombined_W_m2K: calc.u,
      rTotSeriesWithFilms_m2K_W: calc.rTotSeriesWithFilms,
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
  }, [
    library,
    calc.errors.length,
    calc.u,
    calc.rTotSeriesWithFilms,
    calc.seriesLayerResistances,
    heatTransferContext.effectiveLayers,
    annexR1Resolved,
    effectiveAnnexFAirVoidLevel,
    annexFastenerEnabled,
    annexNf,
    annexChi,
    annexInvertedRoof,
    opaqueSubtype,
    annexPMm,
    annexFTimesX,
    elementMode,
    useSuspendedGroundVoidSplit,
  ]);

  const fabricUWrites = useMemo(() => {
    if (!(calc.rLayers > 0)) return null;
    return computeFabricUWritesFromConstructionR(
      calc.rLayers,
      calc.rLayersSeries,
      elementPitchDeg,
      heatTransferContext.externalSurfaceResistance_m2K_W,
    );
  }, [calc.rLayers, calc.rLayersSeries, elementPitchDeg, heatTransferContext.externalSurfaceResistance_m2K_W]);

  const previewUForHem =
    annexComputation?.uForHem_W_m2K ??
    (fabricUWrites?.uCombinedTwoSf_W_m2K ?? roundUValueToTwoSignificantFigures(calc.u));
  const previewWrittenConstructionR =
    fabricUWrites?.thermalResistanceConstruction_m2K_W ?? null;
  const fullAssemblyRPreview =
    heatedAdjacentHalfConstruction && calc.rLayersFullAssembly > 0 ? calc.rLayersFullAssembly : null;

  const massSuggestion = useMemo(() => {
    if (!library) return undefined;
    return suggestMassDistributionClass(heatTransferContext.effectiveLayers, library.materialsById);
  }, [library, heatTransferContext.effectiveLayers]);

  /** FHS enum string for display (matches what we persist on the element and in the envelope). */
  const massPreviewFhs = useMemo((): FhsMassDistributionClass | null => {
    if (massSuggestion == null) return null;
    return fhsMassDistributionFromSuggestion(massSuggestion);
  }, [massSuggestion]);

  const arealWrittenValue = useMemo(
    () => resolveFabricArealHeatCapacityForElement(calc.arealJPerM2K, complianceValidationEnabled),
    [calc.arealJPerM2K, complianceValidationEnabled],
  );
  const arealWrittenJ = useMemo(
    () => arealHeatCapacityJPerM2KFromBand(arealWrittenValue),
    [arealWrittenValue],
  );
  const arealWrittenBand = useMemo(
    () =>
      typeof arealWrittenValue === 'string'
        ? arealWrittenValue
        : arealHeatCapacityBandFromJPerM2K(arealWrittenValue),
    [arealWrittenValue],
  );

  const assemblyApplyErrors = useMemo(
    () => [...calc.errors, ...(elementMode === 'BuildingElementGround' && groundSplit ? groundSplit.errors : [])],
    [calc.errors, elementMode, groundSplit],
  );

  const stackValidForApply = useMemo(() => {
    if (elementMode === 'BuildingElementGround' && groundSplit && library) {
      const { u } = computeOpaqueUAndTotals(groundSplit.rfMean_m2K_W, elementPitchDeg);
      return groundSplit.rfMean_m2K_W > 0 && u > 0;
    }
    return calc.rLayers > 0 && calc.u > 0;
  }, [elementMode, groundSplit, library, calc.rLayers, calc.u, elementPitchDeg]);

  /** Preview R_f / R_g for ground summary; when no R_g split, construction preview matches full-stack mean. */
  const groundPreviewRf = useMemo(() => {
    if (elementMode !== 'BuildingElementGround' || !groundSplit) return calc.rLayers;
    return useSuspendedGroundVoidSplit ? groundSplit.rfMean_m2K_W : calc.rLayers;
  }, [elementMode, groundSplit, useSuspendedGroundVoidSplit, calc.rLayers]);

  const groundPreviewRg = useMemo(() => {
    if (elementMode !== 'BuildingElementGround' || !groundSplit) return null;
    if (!useSuspendedGroundVoidSplit) return null;
    return groundSplit.rgMean_m2K_W;
  }, [elementMode, groundSplit, useSuspendedGroundVoidSplit]);

  const handleApply = useCallback(() => {
    if (assemblyApplyErrors.length > 0 || !stackValidForApply || !library) return;

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

    const uW = computeFabricUWritesFromConstructionR(
      rfMean,
      rfSeries,
      elementPitchDeg,
      heatTransferContext.externalSurfaceResistance_m2K_W,
    );
    const annex = annexComputation;
    const uWrite = annex != null ? annex.uForHem_W_m2K : uW.uCombinedTwoSf_W_m2K;
    const rWrite = uW.thermalResistanceConstruction_m2K_W;
    const massDistributionClass: FhsMassDistributionClass | undefined =
      massSuggestion != null ? fhsMassDistributionFromSuggestion(massSuggestion) : undefined;
    if (massDistributionClass == null) return;

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
        annex?.uBeforeAnnexF_W_m2K ?? uW.uCombinedFromRoundedConstruction_W_m2K,
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
      complianceValidationEnabled,
    );
    if (arealRawJ != null) {
      envelope.arealHeatCapacity_J_m2K = arealRawJ;
    }
    const arealElementJ = arealHeatCapacityJPerM2KFromBand(arealElementValue);
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
      onApply({
        thermal_resistance_floor_construction: rWrite,
        ...(suspendedGroundAssembly ? { thermal_resist_insul: roundToTwoDecimals(rgMean) } : {}),
        ...(suspendedGroundAssembly &&
        useSuspendedGroundVoidSplit &&
        suspendedGroundVoidSplit?.heightUpperSurfaceM != null
          ? { height_upper_surface: roundToTwoDecimals(suspendedGroundVoidSplit.heightUpperSurfaceM) }
          : {}),
        mass_distribution_class: massDistributionClass,
        ...(arealElementValue != null ? { areal_heat_capacity: arealElementValue } : {}),
        vulcan_assembly_v1: envelope,
      });
    } else {
      onApply({
        u_value: uWrite,
        thermal_resistance_construction: rWrite,
        mass_distribution_class: massDistributionClass,
        ...(arealElementValue != null ? { areal_heat_capacity: arealElementValue } : {}),
        vulcan_assembly_v1: envelope,
      });
    }
    onClose();
  }, [
    annexChi,
    annexComputation,
    annexFastenerEnabled,
    annexFTimesX,
    annexInvertedRoof,
    annexNf,
    annexPMm,
    annexR1Resolved,
    annexFPrimaryCavityResolved,
    assemblyApplyErrors,
    cavityLayerIndices.length,
    effectiveAnnexFAirVoidLevel,
    hasAnnexFAirVoidOverrideOnAnyCavity,
    calc,
    complianceValidationEnabled,
    elementMode,
    elementPitchDeg,
    externalDetailProfile,
    heatedAdjacentHalfConstruction,
    suspendedGroundAssembly,
    suspendedGroundVoidSplit,
    useSuspendedGroundVoidSplit,
    groundSplit,
    layers,
    library,
    massSuggestion,
    heatTransferContext.externalSurfaceResistance_m2K_W,
    onApply,
    onClose,
    stackValidForApply,
    supportsExternalDetails,
  ]);

  const handleSaveToLibrary = useCallback(async () => {
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
      setSaveMessage(`Saved to workspace: ${ex.name} (${ex.id})`);
    } catch (e: unknown) {
      setSaveMessage(
        e instanceof Error ? e.message : 'Failed to save assembly — check workspace folder permissions.',
      );
    } finally {
      setSaveBusy(false);
    }
  }, [
    assemblyApplyErrors,
    stackValidForApply,
    elementMode,
    externalDetailProfile,
    layers,
    library,
    opaqueSubtype,
    reloadLibrary,
    setSaveMessage,
    supportsExternalDetails,
    workspaceResourcePort,
  ]);

  if (!isOpen) return null;

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return ReactDOM.createPortal(
    <div
      className="modal-backdrop"
      style={{ zIndex: 12000 }}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="modal-container"
        style={{
          maxWidth: 640,
          width: 'min(640px, 94vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ flexShrink: 0 }}>
          <ModalHeader title="Assembly calculator" onClose={onClose} />
        </div>
        <div
          className="modal-content"
          style={{
            color: 'var(--text-primary, var(--text-primary))',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {loadError && (
            <div style={{ color: 'var(--error-text)', marginBottom: 10, fontSize: 13 }}>{loadError}</div>
          )}

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
            <summary style={{ cursor: 'pointer', userSelect: 'none', color: 'var(--text-primary)' }}>
              How it’s calculated
            </summary>
            <div style={{ marginTop: 8, lineHeight: 1.5 }}>
              <p style={{ margin: 0 }}>
                U-values follow <strong>BS EN ISO 6946</strong> (combined method: average of lower and upper
                resistance limits). Surface resistances follow <strong>BS EN ISO 13789</strong> Table 8, matching
                the HEM engine.
              </p>
            </div>
          </details>

          {(elementMode === 'BuildingElementOpaque' || elementMode === 'BuildingElementAdjacentConditionedSpace') && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }} id="fabric-type-label">
                Fabric type
              </span>
              <div
                role="group"
                aria-labelledby="fabric-type-label"
                style={{
                  display: 'inline-flex',
                  padding: 3,
                  gap: 3,
                  borderRadius: 10,
                  background: 'var(--bg-tertiary, var(--surface-control-hover))',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {(['wall', 'roof'] as const).map((kind) => {
                  const selected = opaqueSubtype === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setOpaqueSubtype(kind)}
                      aria-pressed={selected}
                      style={{
                        padding: '7px 18px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: selected ? 700 : 500,
                        letterSpacing: 0.02,
                        background: selected
                          ? 'var(--accent-primary)'
                          : 'transparent',
                        color: selected ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                        boxShadow: selected ? 'var(--shadow-sm)' : 'none',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      {kind === 'wall' ? 'Wall' : 'Roof'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {heatedAdjacentHalfConstruction && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary, var(--surface-control))',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              {elementMode === 'BuildingElementPartyWall' ? (
                <>
                  Party wall: the calculator writes the dwelling-side half construction. U-value is recalculated
                  from that half construction; enter cavity treatment in the party wall fields.
                </>
              ) : (
                <>
                  Internal element: the calculator writes half-construction resistance and areal heat capacity,
                  and recalculates U-value from that half construction.
                </>
              )}
            </div>
          )}

          {library && libraryAssemblyOptions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Load from library</label>
              <SearchableDescribedSelect
                key={`starter-${libraryElementType}`}
                value=""
                placeholder="Search assemblies…"
                searchPlaceholder="Filter by name…"
                minWidth="100%"
                menuZIndex={modalSelectZ}
                sections={assemblyStarterSections}
                onChange={(id) => {
                  if (!id || !library) return;
                  const row = libraryAssemblyOptions.find((a) => a.id === id);
                  if (!row) return;
                  const next = layersFromLibraryAssembly(
                    row,
                    library.materialsById,
                    library.cavityResistanceByType,
                  );
                  if (next.length > 0) setLayers(next);
                  setExternalDetailProfile(
                    coerceExternalDetailProfileLink(
                      row.externalDetailProfile,
                      externalDetailCataloguePort,
                    ),
                  );
                }}
              />
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
                  menuZIndex={modalSelectZ}
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

          {library && elementMode === 'BuildingElementGround' && suspendedGroundAssembly && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary, var(--surface-control))',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                Add one well ventilated cavity for the underfloor void.
              </div>
              {useSuspendedGroundVoidSplit && (
                <div style={{ fontSize: 11, color: 'var(--text-primary)', marginTop: 8, lineHeight: 1.5 }}>
                  Above void: R_f ≈ {groundSplit?.rfMean_m2K_W.toFixed(3) ?? '0.000'} m²K/W · Below void: R_g ≈{' '}
                  {groundSplit?.rgMean_m2K_W.toFixed(3) ?? '0.000'} m²K/W · Void height ≈{' '}
                  {suspendedGroundVoidSplit?.heightUpperSurfaceM?.toFixed(3) ?? '0.000'} m
                </div>
              )}
            </div>
          )}

          {layers.map((layer, idx) => {
            const n = layers.length;
            const showInsertLineAbove = dropInsertAt === idx;
            const showInsertLineBelow = dropInsertAt === n && idx === n - 1;
            return (
            <div
              key={idx}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const insertAt = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                setDropInsertAt(insertAt);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                setDragLayerIdx(null);
                setDropInsertAt(null);
                if (!Number.isFinite(from)) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const insertAt = e.clientY < rect.top + rect.height / 2 ? idx : idx + 1;
                setLayers((prev) => moveLayerToGap(prev, from, insertAt));
              }}
              style={{
                marginBottom: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-secondary, var(--surface-control))',
                opacity: dragLayerIdx === idx ? 0.72 : 1,
                boxShadow: showInsertLineAbove
                  ? 'inset 0 3px 0 0 var(--accent-primary)'
                  : showInsertLineBelow
                    ? 'inset 0 -3px 0 0 var(--accent-primary)'
                    : undefined,
                transition: 'opacity 0.12s, box-shadow 0.12s',
              }}
            >
              {(idx === 0 || idx === layers.length - 1) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    marginBottom: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  {idx === 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.06,
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'var(--accent-primary-alpha)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--focus-outline)',
                      }}
                    >
                      Heated side
                    </span>
                  )}
                  {idx === layers.length - 1 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.06,
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'var(--semantic-human-bg)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--validation-info-border)',
                      }}
                    >
                      Outside
                    </span>
                  )}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <span
                  draggable
                  aria-grabbed={dragLayerIdx === idx}
                  title="Drag to reorder — the yellow line shows where the layer will land"
                  onDragStart={(e) => {
                    setDragLayerIdx(idx);
                    e.dataTransfer.setData('text/plain', String(idx));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDragLayerIdx(null);
                    setDropInsertAt(null);
                  }}
                  style={{
                    cursor: dragLayerIdx === idx ? 'grabbing' : 'grab',
                    flexShrink: 0,
                    userSelect: 'none',
                    padding: '4px 2px',
                    color: 'var(--text-secondary)',
                    fontSize: 16,
                    lineHeight: 1,
                    alignSelf: 'center',
                  }}
                >
                  ≡
                </span>
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
                      menuZIndex={modalSelectZ}
                      sections={materialSectionsByLayer[idx] ?? []}
                      onChange={(materialId) => {
                        const next = [...layers];
                        (next[idx] as AssemblyLayer & { kind: 'solid' }).materialId = materialId;
                        setLayers(next);
                      }}
                    />
                  )}
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
                              <span style={{ color: 'var(--text-secondary)' }}>Gap (m)</span>
                              <DraftSafeNumberInput
                                aria-label="Cavity gap"
                                min="0.001"
                                step="0.001"
                                value={cavityLayer.gap_thickness_m ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const next = [...layers];
                                  next[idx] = {
                                    ...cavityLayer,
                                    gap_thickness_m: raw === '' ? undefined : Number(raw),
                                  };
                                  setLayers(next);
                                }}
                                style={assemblyStackNumberInputStyle}
                              />
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
                </div>
                <button
                  type="button"
                  aria-label="Remove layer"
                  title="Remove layer"
                  className="btn btn-nav btn-small"
                  onClick={() => setLayers(layers.filter((_, i) => i !== idx))}
                  style={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    padding: 0,
                    fontSize: 22,
                    lineHeight: 1,
                    borderRadius: 'var(--radius-xl, 12px)',
                  }}
                >
                  ×
                </button>
              </div>
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
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Thickness (mm)</label>
                    <DraftSafeNumberInput
                      value={Math.round(layer.thickness_m * 1000)}
                      onChange={(e) => {
                        const next = [...layers];
                        (next[idx] as AssemblyLayerSolid).thickness_m = Number(e.target.value) / 1000;
                        setLayers(next);
                      }}
                      style={{
                        ...assemblyStackNumberInputStyle,
                        width: 120,
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-nav btn-small"
                      style={assemblyFieldActionStyle}
                      title="Repeating bridges in this thickness (e.g. studs). Not used for cavity layers."
                      onClick={() => {
                        const next = [...layers];
                        const s = next[idx] as AssemblyLayerSolid;
                        const bridges = [...(s.repeatingBridges ?? [])];
                        bridges.push(newRepeatingBridgeRow(firstMaterialId));
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
                              menuZIndex={modalSelectZ}
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
            </div>
            );
          })}

          <button
            type="button"
            className="btn btn-nav btn-small"
            style={{ marginBottom: 10 }}
            onClick={() => setLayers([...layers, emptySolidLayer()])}
          >
            Add layer
          </button>

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
                  <p style={{ margin: '0 0 12px', fontSize: 11, lineHeight: 1.45 }}>
                    Only use these when the construction needs them.
                  </p>

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

          {saveMessage && (
            <div
              style={{
                fontSize: 12,
                marginBottom: 10,
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

          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 4,
              padding: '12px',
              borderRadius: 8,
              background: 'var(--bg-secondary, var(--surface-control-hover))',
              border: '1px solid var(--border-subtle, var(--surface-control-active))',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {appliedEnvelope ? 'Saved vs preview' : 'Writes to element'}
            </div>
            {elementMode === 'BuildingElementGround' ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <li>
                  <code style={{ fontSize: 11 }}>thermal_resistance_floor_construction</code>
                  {appliedEnvelope ? (
                    <>
                      {' — saved '}
                      {appliedEnvelope.thermalResistanceConstruction_m2K_W.toFixed(4)} m²K/W
                      {', preview '}
                      {groundPreviewRf > 0 ? `${groundPreviewRf.toFixed(4)} m²K/W` : '—'}
                      {numChanged(
                        appliedEnvelope.thermalResistanceConstruction_m2K_W,
                        groundPreviewRf > 0 ? groundPreviewRf : null,
                      ) ? (
                        <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                      ) : null}
                    </>
                  ) : (
                    <> — {groundPreviewRf > 0 ? `${groundPreviewRf.toFixed(4)} m²K/W` : '—'}</>
                  )}
                </li>
                {(suspendedGroundAssembly &&
                  (useSuspendedGroundVoidSplit ||
                    appliedEnvelope?.thermalResistanceGroundInsulation_m2K_W != null)) && (
                  <li style={{ fontSize: 11 }}>
                    <code style={{ fontSize: 11 }}>thermal_resist_insul</code> (R_g)
                    {appliedEnvelope?.thermalResistanceGroundInsulation_m2K_W != null ? (
                      <>
                        {' — saved '}
                        {appliedEnvelope.thermalResistanceGroundInsulation_m2K_W.toFixed(4)} m²K/W
                        {groundPreviewRg != null ? (
                          <>
                            {', preview '}
                            {groundPreviewRg.toFixed(4)} m²K/W
                            {numChanged(
                              appliedEnvelope.thermalResistanceGroundInsulation_m2K_W,
                              groundPreviewRg,
                            ) ? (
                              <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                            ) : null}
                          </>
                        ) : (
                          ', preview —'
                        )}
                      </>
                    ) : (
                      <>
                        {' — '}
                        {groundPreviewRg != null && groundPreviewRg > 0
                          ? `${groundPreviewRg.toFixed(4)} m²K/W`
                          : '—'}
                      </>
                    )}
                  </li>
                )}
                {calc.hasRepeatingBridges && (
                  <li style={{ fontSize: 11 }}>
                    Floor construction R: <strong>parallel-path</strong>{' '}
                    {calc.rLayers > 0 ? `${calc.rLayers.toFixed(4)} m²K/W` : '—'} (applied) vs{' '}
                    <strong>series-only</strong>{' '}
                    {calc.rLayersSeries > 0 ? `${calc.rLayersSeries.toFixed(4)} m²K/W` : '—'} (audit)
                  </li>
                )}
                {(appliedEnvelope?.massDistributionClass || massPreviewFhs) && (
                  <li>
                    <code style={{ fontSize: 11 }}>mass_distribution_class</code>
                    {appliedEnvelope?.massDistributionClass ? (
                      <>
                        {' — saved '}
                        <strong>{appliedEnvelope.massDistributionClass}</strong>
                        {FHS_MASS_CLASS_COMMENTARY[appliedEnvelope.massDistributionClass] ? (
                          <span> — {FHS_MASS_CLASS_COMMENTARY[appliedEnvelope.massDistributionClass]}</span>
                        ) : null}
                        {massPreviewFhs ? (
                          <>
                            {', preview '}
                            <strong>{massPreviewFhs}</strong>
                            {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs] ? (
                              <span> — {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs]}</span>
                            ) : null}
                            {appliedEnvelope.massDistributionClass !== massPreviewFhs ? (
                              <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                            ) : null}
                          </>
                        ) : (
                          ', preview —'
                        )}
                      </>
                    ) : (
                      <>
                        {' — '}
                        <strong>{massPreviewFhs}</strong>
                        {massPreviewFhs && FHS_MASS_CLASS_COMMENTARY[massPreviewFhs] ? (
                          <span> — {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs]}</span>
                        ) : null}
                      </>
                    )}
                  </li>
                )}
                <li style={{ fontSize: 11 }}>
                  <span title="Layer sum ρ·c·d (cavities ignored; bridges area-weighted). In FHS mode the element stores the nearest enum band, while the audit envelope keeps the numeric layer sum and matched band value.">
                    Areal heat capacity → <code style={{ fontSize: 11 }}>areal_heat_capacity</code>
                  </span>
                  {appliedEnvelope?.arealHeatCapacity_J_m2K != null ? (
                    <>
                      {' — saved layers '}
                      {(appliedEnvelope.arealHeatCapacity_J_m2K / 1000).toFixed(2)} kJ/(m²·K)
                      {appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K != null ? (
                        <>
                          {', on element '}
                          <strong>{arealHeatCapacityBandFromJPerM2K(appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K) ?? '—'}</strong>
                          {' ('}
                          {(appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K / 1000).toFixed(2)} kJ/(m²·K)
                          {')'}
                        </>
                      ) : null}
                      {calc.arealJPerM2K != null ? (
                        <>
                          {', preview layers '}
                          {(calc.arealJPerM2K / 1000).toFixed(2)} kJ/(m²·K)
                          {arealWrittenJ != null ? (
                            <>
                              {', → writes '}
                              <strong>{arealWrittenBand ?? '—'}</strong>
                              {' ('}
                              {(arealWrittenJ / 1000).toFixed(2)} kJ/(m²·K)
                              {')'}
                              {complianceValidationEnabled &&
                              Math.abs(arealWrittenJ - calc.arealJPerM2K) > 1 ? (
                                <span style={{ color: 'var(--accent-blue)' }}> (FHS band)</span>
                              ) : null}
                            </>
                          ) : null}
                          {numChanged(appliedEnvelope.arealHeatCapacity_J_m2K, calc.arealJPerM2K) ? (
                            <span style={{ color: 'var(--warning-text)' }}> (layers changed)</span>
                          ) : null}
                        </>
                      ) : (
                        ', preview —'
                      )}
                    </>
                  ) : (
                    <>
                      {' — '}
                      {calc.arealJPerM2K != null ? (
                        <>
                          layers {(calc.arealJPerM2K / 1000).toFixed(2)} kJ/(m²·K)
                          {arealWrittenJ != null ? (
                            <>
                              {', → writes '}
                              <strong>{arealWrittenBand ?? '—'}</strong>
                              {' ('}
                              {(arealWrittenJ / 1000).toFixed(2)} kJ/(m²·K)
                              {')'}
                              {complianceValidationEnabled &&
                              Math.abs(arealWrittenJ - calc.arealJPerM2K) > 1 ? (
                                <span style={{ color: 'var(--accent-blue)' }}> (FHS band)</span>
                              ) : null}
                            </>
                          ) : null}
                        </>
                      ) : (
                        <span title={calc.arealErrors.length ? calc.arealErrors.join('\n') : undefined}>—</span>
                      )}
                    </>
                  )}
                </li>
              </ul>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <li>
                  <code style={{ fontSize: 11 }}>thermal_resistance_construction</code>
                  {heatedAdjacentHalfConstruction
                    ? ' — selected assembly R split for heated-adjacent handling'
                    : null}
                  {appliedEnvelope ? (
                    <>
                      {heatedAdjacentHalfConstruction ? (
                        <>
                          {' — saved written R '}
                          {appliedEnvelope.thermalResistanceConstruction_m2K_W.toFixed(4)} m²K/W
                          {', selected assembly R '}
                          {fullAssemblyRPreview != null
                            ? `${fullAssemblyRPreview.toFixed(4)} m²K/W`
                            : '—'}
                          {', preview written R '}
                          {previewWrittenConstructionR != null ? `${previewWrittenConstructionR.toFixed(4)} m²K/W` : '—'}
                        </>
                      ) : (
                        <>
                          {' — saved '}
                          {appliedEnvelope.thermalResistanceConstruction_m2K_W.toFixed(4)} m²K/W
                          {', preview '}
                          {previewWrittenConstructionR != null ? `${previewWrittenConstructionR.toFixed(4)} m²K/W` : '—'}
                        </>
                      )}
                      {numChanged(
                        appliedEnvelope.thermalResistanceConstruction_m2K_W,
                        previewWrittenConstructionR,
                      ) ? (
                        <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {heatedAdjacentHalfConstruction ? (
                        <>
                          {' — selected assembly R '}
                          {fullAssemblyRPreview != null
                            ? `${fullAssemblyRPreview.toFixed(4)} m²K/W`
                            : '—'}
                          {', writes '}
                          {previewWrittenConstructionR != null ? `${previewWrittenConstructionR.toFixed(4)} m²K/W` : '—'}
                        </>
                      ) : (
                        <> — {previewWrittenConstructionR != null ? `${previewWrittenConstructionR.toFixed(4)} m²K/W` : '—'}</>
                      )}
                    </>
                  )}
                </li>
                <li>
                  <code style={{ fontSize: 11 }}>u_value</code>
                  {heatedAdjacentHalfConstruction
                    ? ' — fabric U written to the element (HEM, calculated from the written R + surface films)'
                    : ' — fabric U written to the element (HEM)'}
                  {appliedEnvelope ? (
                    <>
                      {' — saved '}
                      {appliedEnvelope.uValueWrittenToElement_W_m2K ?? appliedEnvelope.correctedU_W_m2K}{' '}
                      W/m²K
                      {', preview '}
                      {calc.u > 0 ? `${previewUForHem} W/m²K` : '—'}
                      {numChanged(
                        appliedEnvelope.uValueWrittenToElement_W_m2K ?? appliedEnvelope.correctedU_W_m2K,
                        calc.u > 0 ? previewUForHem : null,
                      ) ? (
                        <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                      ) : heatedAdjacentHalfConstruction
                        && numChanged(
                          appliedEnvelope.thermalResistanceConstruction_m2K_W,
                          previewWrittenConstructionR,
                        ) ? (
                          <span style={{ color: 'var(--accent-blue)' }}> (same after HEM rounding)</span>
                        ) : null}
                    </>
                  ) : (
                    <> — {calc.u > 0 ? `${previewUForHem} W/m²K` : '—'}</>
                  )}
                </li>
                {calc.hasRepeatingBridges && (
                  <li style={{ fontSize: 11 }}>
                    Bridged layers: <strong>uses</strong>{' '}
                    {calc.u > 0 ? `${calc.u.toFixed(4)} W/m²K` : '—'} ·{' '}
                    <strong>series-only (reference)</strong>{' '}
                    {calc.uSeries > 0 ? `${calc.uSeries.toFixed(4)} W/m²K` : '—'}
                    {calc.rConstructionLower > 0 && calc.rConstructionUpper > 0 ? (
                      <>
                        {' '}
                        · construction R′ / R″{' '}
                        {calc.rConstructionLower.toFixed(3)} / {calc.rConstructionUpper.toFixed(3)} m²K/W
                      </>
                    ) : null}
                  </li>
                )}
                {elementMode === 'BuildingElementPartyWall' && (
                  <li style={{ fontSize: 11 }}>
                    Cavity treatment comes from the party wall fields on the element:
                    {' '}
                    <code style={{ fontSize: 11 }}>party_wall_cavity_type</code>
                    {', '}
                    <code style={{ fontSize: 11 }}>party_wall_lining_type</code>
                    {' '}
                    and
                    {' '}
                    <code style={{ fontSize: 11 }}>thermal_resistance_cavity</code>
                    {' '}
                    when needed.
                  </li>
                )}
                {(appliedEnvelope?.massDistributionClass || massPreviewFhs) && (
                  <li>
                    <code style={{ fontSize: 11 }}>mass_distribution_class</code>
                    {appliedEnvelope?.massDistributionClass ? (
                      <>
                        {' — saved '}
                        <strong>{appliedEnvelope.massDistributionClass}</strong>
                        {FHS_MASS_CLASS_COMMENTARY[appliedEnvelope.massDistributionClass] ? (
                          <span> — {FHS_MASS_CLASS_COMMENTARY[appliedEnvelope.massDistributionClass]}</span>
                        ) : null}
                        {massPreviewFhs ? (
                          <>
                            {', preview '}
                            <strong>{massPreviewFhs}</strong>
                            {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs] ? (
                              <span> — {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs]}</span>
                            ) : null}
                            {appliedEnvelope.massDistributionClass !== massPreviewFhs ? (
                              <span style={{ color: 'var(--warning-text)' }}> (changed)</span>
                            ) : null}
                          </>
                        ) : (
                          ', preview —'
                        )}
                      </>
                    ) : (
                      <>
                        {' — '}
                        <strong>{massPreviewFhs}</strong>
                        {massPreviewFhs && FHS_MASS_CLASS_COMMENTARY[massPreviewFhs] ? (
                          <span> — {FHS_MASS_CLASS_COMMENTARY[massPreviewFhs]}</span>
                        ) : null}
                      </>
                    )}
                  </li>
                )}
                <li style={{ fontSize: 11 }}>
                  <span title="Layer sum ρ·c·d (cavities ignored; bridges area-weighted). In FHS mode the element stores the nearest enum band, while the audit envelope keeps the numeric layer sum and matched band value.">
                    Areal heat capacity → <code style={{ fontSize: 11 }}>areal_heat_capacity</code>
                  </span>
                  {appliedEnvelope?.arealHeatCapacity_J_m2K != null ? (
                    <>
                      {' — saved layers '}
                      {(appliedEnvelope.arealHeatCapacity_J_m2K / 1000).toFixed(2)} kJ/(m²·K)
                      {appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K != null ? (
                        <>
                          {', on element '}
                          <strong>{arealHeatCapacityBandFromJPerM2K(appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K) ?? '—'}</strong>
                          {' ('}
                          {(appliedEnvelope.arealHeatCapacityWrittenToElement_J_m2K / 1000).toFixed(2)} kJ/(m²·K)
                          {')'}
                        </>
                      ) : null}
                      {calc.arealJPerM2K != null ? (
                        <>
                          {', preview layers '}
                          {(calc.arealJPerM2K / 1000).toFixed(2)} kJ/(m²·K)
                          {arealWrittenJ != null ? (
                            <>
                              {', → writes '}
                              <strong>{arealWrittenBand ?? '—'}</strong>
                              {' ('}
                              {(arealWrittenJ / 1000).toFixed(2)} kJ/(m²·K)
                              {')'}
                              {complianceValidationEnabled &&
                              Math.abs(arealWrittenJ - calc.arealJPerM2K) > 1 ? (
                                <span style={{ color: 'var(--accent-blue)' }}> (FHS band)</span>
                              ) : null}
                            </>
                          ) : null}
                          {numChanged(appliedEnvelope.arealHeatCapacity_J_m2K, calc.arealJPerM2K) ? (
                            <span style={{ color: 'var(--warning-text)' }}> (layers changed)</span>
                          ) : null}
                        </>
                      ) : (
                        ', preview —'
                      )}
                    </>
                  ) : (
                    <>
                      {' — '}
                      {calc.arealJPerM2K != null ? (
                        <>
                          layers {(calc.arealJPerM2K / 1000).toFixed(2)} kJ/(m²·K)
                          {arealWrittenJ != null ? (
                            <>
                              {', → writes '}
                              <strong>{arealWrittenBand ?? '—'}</strong>
                              {' ('}
                              {(arealWrittenJ / 1000).toFixed(2)} kJ/(m²·K)
                              {')'}
                              {complianceValidationEnabled &&
                              Math.abs(arealWrittenJ - calc.arealJPerM2K) > 1 ? (
                                <span style={{ color: 'var(--accent-blue)' }}> (FHS band)</span>
                              ) : null}
                            </>
                          ) : null}
                        </>
                      ) : (
                        <span title={calc.arealErrors.length ? calc.arealErrors.join('\n') : undefined}>—</span>
                      )}
                    </>
                  )}
                </li>
              </ul>
            )}
            {assemblyApplyErrors.length > 0 && (
              <div
                role="alert"
                aria-live="polite"
                title={assemblyApplyErrors.join(' ')}
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--error-bg)',
                  border: '1px solid var(--error-text)',
                  color: 'var(--error-text)',
                  fontSize: 12,
                  lineHeight: 1.35,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: 'var(--error-text)',
                    color: 'var(--semantic-on-color)',
                    fontSize: 12,
                    fontWeight: 800,
                    lineHeight: '20px',
                    textAlign: 'center',
                  }}
                >
                  !
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {assemblyApplyErrors.join(' · ')}
                </span>
              </div>
            )}
          </div>

          {elementMode === 'BuildingElementGround' && (
            <p style={{ fontSize: 12, color: 'var(--warning-text)', marginTop: 10 }}>
              Writes floor-construction fields only. Whole-floor <strong>u_value</strong> still comes from the ground
              floor element calculation, not this layer stack alone.
            </p>
          )}
          {elementMode === 'BuildingElementGround' && !suspendedGroundAssembly && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.45 }}>
              <code style={{ fontSize: 11 }}>thermal_resist_insul</code> is only used for suspended floors.
            </p>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary btn-standard"
              disabled={
                saveBusy ||
                assemblyApplyErrors.length > 0 ||
                !stackValidForApply ||
                !library
              }
              title="Appends or updates a row in input/assembly_library/assemblies.json — does not change this element until you use Update element."
              onClick={() => void handleSaveToLibrary()}
            >
              Save to library
            </button>
            <button
              type="button"
              className="btn btn-primary btn-standard"
              disabled={assemblyApplyErrors.length > 0 || !stackValidForApply}
              onClick={handleApply}
            >
              Update element
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
};
