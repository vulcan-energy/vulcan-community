// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ReactDOM from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { GeometryWorkspaceResourcePort } from "../../../geometry-editor-host/src/workspaceResourcePort";
import {
  useGeometrySchemaPort,
  useGeometrySourceComparisonPort,
} from "../../../geometry-editor-host/src/editorServicePorts";
import type { GeometrySchemaPort } from "../../../geometry-editor-host/src/schemaPort";
import type { AssemblyExample } from "../lib/assemblyTypes";
import { calculateDwellingLengthWidthFromGroundElements } from "../lib/buildingFootprintDimensions";

import { resolveFieldPresentation } from "../lib/fieldPresentation";
import {
  collectGlobalSettingsWarnings,
  fhsBedroomCountIssue,
} from "../lib/globalSettingsValidation";
import {
  DEFAULT_JUNCTION_PSI_CSV_RELATIVE_PATH,
  JUNCTION_PSI_DEFAULTS_DIR,
} from "../lib/junctionPsiDefaultsCsv";
import type { DefaultsCompatibility } from "../lib/defaultsCompatibility";
import type { DwellingCountField } from "../lib/spaceLabelDerivation";
import {
  aggregateDwellingCounts,
  dwellingCountZoneIds,
  formatDwellingCountMismatchWarnings,
  fullDwellingCountsCompliancePatch,
  getDwellingCountSpaceLabelMismatchState,
} from "../lib/spaceLabelDerivation";
import { formatSchemaInfoForTooltip } from "../utils/schemaTooltipHelpers";
import {
  calculateDwellingDetailsSuggestion,
  calculateGroundFloorArea,
  calculateSuggestedVentilationBaseHeight,
  calculateSuggestedVentilationHeight,
} from "../lib/zoneDerivation";
import type { SapBuiltFormCode } from "../geometry/types";
import {
  useGeometryStore,
} from "../stores/geometryStore";
import { DerivedNumberField } from "./DerivedNumberField";
import { ModalHeader } from "./ModalHeader";
import { ResetFieldButton } from "./ResetFieldButton";
import { StandardDropdown } from "./StandardDropdown";
import { StandardInput } from "./StandardInput";
import { Tooltip } from "./Tooltip";
import { ValidationIndicator, ValidationPill } from "./ValidationIndicator";
import { useKeyedState } from "../hooks/useKeyedState";

export type GlobalSettingsDefaultsCompatibility = DefaultsCompatibility;

export type GlobalSettingsIndicator = Readonly<{
  variant: "error" | "warning" | "info";
  issues: string[];
}>;

export type GlobalSettingsModalProps = Readonly<{
  isOpen: boolean;
  onClose(): void;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  /** Hosts may retain an established template path; Community omits this. */
  fallbackDefaultsPath?: string;
  inspectDefaultsCompatibility?: (
    content: string
  ) => GlobalSettingsDefaultsCompatibility;
  onEditDefaults?: (
    path: string,
    compatibility: GlobalSettingsDefaultsCompatibility | undefined
  ) => void;
  evidenceSection?: ReactNode;
  renderEvidencePill?: (fieldKey: string, label: string) => ReactNode;
  externalDetailProfileSection?: ReactNode;
  onIndicatorChange?: (indicator: GlobalSettingsIndicator | null) => void;
}>;

const ROOM_COUNT_COMPLIANCE_ROWS: {
  field: DwellingCountField;
  label: string;
  evidenceShort: string;
  comparisonFieldKey?: "NumberOfBedrooms" | "NumberOfWetRooms";
}[] = [
  {
    field: "NumberOfBedrooms",
    label: "Number of Bedrooms",
    evidenceShort: "Number of Bedrooms",
    comparisonFieldKey: "NumberOfBedrooms",
  },
  {
    field: "NumberOfWetRooms",
    label: "Number of Wet Rooms",
    evidenceShort: "Number of Wet Rooms",
    comparisonFieldKey: "NumberOfWetRooms",
  },
  {
    field: "NumberOfHabitableRooms",
    label: "Number of habitable rooms",
    evidenceShort: "Habitable rooms",
  },
  {
    field: "NumberOfHotTappedRooms",
    label: "Number of hot-tapped rooms",
    evidenceShort: "Hot-tapped rooms",
  },
  {
    field: "NumberOfUtilityRooms",
    label: "Number of utility rooms",
    evidenceShort: "Utility rooms",
  },
  {
    field: "NumberOfBathrooms",
    label: "Number of bathrooms",
    evidenceShort: "Bathrooms",
  },
  {
    field: "NumberOfSanitaryAccommodations",
    label: "Number of sanitary accommodations",
    evidenceShort: "Sanitary accommodations",
  },
];

const COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED = true;
const COMPLIANCE_VALIDATION_LOCK_NOTE =
  "FHS-compatible export is required for now. Core / non-FHS defaults will be re-enabled once alternative defaults are supported.";

function DefaultsEditIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function DefaultsDuplicateIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function buildComplianceFieldLabel(
  label: string,
  paramId: string,
  schemaPort: GeometrySchemaPort,
  hardcodedExtra?: string,
  useFHSSchema = true
): ReactNode {
  const presentation = resolveFieldPresentation({
    mode: useFHSSchema ? "fhs" : "core",
    propertyKey: paramId,
    elementType: "Global",
    label,
  }, schemaPort);
  const labelSpan = (
    <span
      style={{
        fontSize: "12px",
        fontWeight: 500,
        color: "var(--text-primary)",
      }}
    >
      {presentation.label}
    </span>
  );
  if (presentation.tooltipInfo) {
    const extra = hardcodedExtra?.trim();
    const info = extra
      ? {
          ...presentation.tooltipInfo,
          description: `${presentation.tooltipInfo.description ?? ""}\n\n${extra}`.trim(),
        }
      : presentation.tooltipInfo;
    return (
      <Tooltip
        content={formatSchemaInfoForTooltip(info)}
        useFHSSchema={useFHSSchema}
        position="right"
        maxWidth={350}
      >
        {labelSpan}
      </Tooltip>
    );
  }
  return labelSpan;
}

const collapsedIssueBadgeBaseStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  minWidth: 22,
  height: 22,
  padding: "0 7px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const collapsedIssueBadgeStyles: Record<
  "error" | "warning" | "info",
  React.CSSProperties
> = {
  error: {
    backgroundColor: "var(--validation-error-badge-bg)",
    color: "var(--validation-error-text)",
    border: "1px solid var(--validation-error-badge-border)",
  },
  warning: {
    backgroundColor: "var(--validation-warning-badge-bg)",
    color: "var(--validation-warning-text)",
    border: "1px solid var(--validation-warning-badge-border)",
  },
  info: {
    backgroundColor: "var(--validation-info-badge-bg)",
    color: "var(--validation-info-text)",
    border: "1px solid var(--validation-info-badge-border)",
  },
};

function GlobalSettingsCollapsedIssueBadges({
  expanded,
  errorCount,
  warningCount = 0,
  infoCount,
}: {
  expanded: boolean;
  errorCount: number;
  warningCount?: number;
  infoCount: number;
}) {
  if (expanded || (errorCount === 0 && warningCount === 0 && infoCount === 0)) {
    return null;
  }
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
    >
      {errorCount > 0 && (
        <span
          title={`${errorCount} blocking issue(s)`}
          style={{
            ...collapsedIssueBadgeBaseStyle,
            ...collapsedIssueBadgeStyles.error,
          }}
        >
          {errorCount}
        </span>
      )}
      {warningCount > 0 && (
        <span
          title={`${warningCount} warning(s)`}
          style={{
            ...collapsedIssueBadgeBaseStyle,
            ...collapsedIssueBadgeStyles.warning,
          }}
        >
          {warningCount}
        </span>
      )}
      {infoCount > 0 && (
        <span
          title={`${infoCount} comparison note(s)`}
          style={{
            ...collapsedIssueBadgeBaseStyle,
            ...collapsedIssueBadgeStyles.info,
          }}
        >
          {infoCount}
        </span>
      )}
    </div>
  );
}

function GlobalSettingsSectionValidationStrip({
  expanded,
  errorIssues,
  warningIssues = [],
  infoIssues,
}: {
  expanded: boolean;
  errorIssues: readonly string[];
  warningIssues?: readonly string[];
  infoIssues: readonly string[];
}) {
  if (!expanded) return null;
  if (
    errorIssues.length === 0 &&
    warningIssues.length === 0 &&
    infoIssues.length === 0
  ) {
    return null;
  }
  return (
    <div
      role="status"
      style={{
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        padding: "4px 0 10px",
        marginTop: 2,
      }}
    >
      {errorIssues.map((text, index) => (
        <ValidationPill
          key={`gse-${index}-${text.slice(0, 24)}`}
          message={text}
          variant="error"
        />
      ))}
      {warningIssues.map((text, index) => (
        <ValidationPill
          key={`gsw-${index}-${text.slice(0, 24)}`}
          message={text}
          variant="warning"
        />
      ))}
      {infoIssues.map((text, index) => (
        <ValidationPill
          key={`gsi-${index}-${text.slice(0, 24)}`}
          message={text}
          variant="info"
        />
      ))}
    </div>
  );
}

async function listJsonFilesRecursively(
  resources: GeometryWorkspaceResourcePort,
  directory: string
): Promise<string[]> {
  const entries = await resources.list(directory, { withKind: true });
  const files: string[] = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry.name;
    const kind = typeof entry === "string" ? "file" : entry.kind;
    const path = `${directory}/${name}`;
    if (kind === "directory") {
      files.push(...(await listJsonFilesRecursively(resources, path)));
    } else if (name.toLowerCase().endsWith(".json")) {
      files.push(path);
    }
  }
  return files;
}

export function GlobalSettingsModal({
  isOpen,
  onClose,
  workspaceResourcePort,
  fallbackDefaultsPath,
  inspectDefaultsCompatibility,
  onEditDefaults,
  evidenceSection,
  renderEvidencePill = () => null,
  externalDetailProfileSection,
  onIndicatorChange,
}: GlobalSettingsModalProps) {
  const schemaPort = useGeometrySchemaPort();
  const sourceComparisonPort = useGeometrySourceComparisonPort();
  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot
  );
  const {
    zones,
    elementsById,
    defaultsPath,
    propertyPostcode,
    defaultThermalBridging,
    complianceSettings,
    floors,
    junctionPsiDefaultsPath,
    junctionPsiDefaultsError,
    junctionPsiDefaultsLoading,
    spaceLabelIds,
    spaceLabelsById,
    creationDefaultAssemblyIds,
    bundledAssemblyLibrary,
    bundledAssemblyLibraryLoading,
    bundledAssemblyLibraryError,
  } = useGeometryStore(
    useShallow((state) => ({
      zones: state.zones,
      elementsById: state.elementsById,
      defaultsPath: state.defaultsPath,
      propertyPostcode: state.propertyPostcode,
      defaultThermalBridging: state.defaultThermalBridging,
      complianceSettings: state.complianceSettings,
      floors: state.floors,
      junctionPsiDefaultsPath: state.junctionPsiDefaultsPath,
      junctionPsiDefaultsError: state.junctionPsiDefaultsError,
      junctionPsiDefaultsLoading: state.junctionPsiDefaultsLoading,
      spaceLabelIds: state.spaceLabelIds,
      spaceLabelsById: state.spaceLabelsById,
      creationDefaultAssemblyIds: state.creationDefaultAssemblyIds,
      bundledAssemblyLibrary: state.bundledAssemblyLibrary,
      bundledAssemblyLibraryLoading: state.bundledAssemblyLibraryLoading,
      bundledAssemblyLibraryError: state.bundledAssemblyLibraryError,
    }))
  );
  const setDefaultsPath = useGeometryStore((state) => state.setDefaultsPath);
  const setPropertyPostcode = useGeometryStore(
    (state) => state.setPropertyPostcode
  );
  const setDefaultThermalBridging = useGeometryStore(
    (state) => state.setDefaultThermalBridging
  );
  const setJunctionPsiDefaultsPath = useGeometryStore(
    (state) => state.setJunctionPsiDefaultsPath
  );
  const setComplianceSettings = useGeometryStore(
    (state) => state.setComplianceSettings
  );
  const setCreationDefaultAssemblyIds = useGeometryStore(
    (state) => state.setCreationDefaultAssemblyIds
  );
  const openSpaceLabeller = useGeometryStore(
    (state) => state.openSpaceLabeller
  );
  const complianceFieldPresentation = (
    paramId: string,
    label = paramId,
    useFHSSchema = true
  ) => resolveFieldPresentation({
    mode: useFHSSchema ? "fhs" : "core",
    propertyKey: paramId,
    elementType: "Global",
    label,
  }, schemaPort);
  const complianceFieldLabel = (
    label: string,
    paramId: string,
    hardcodedExtra?: string,
    useFHSSchema = true
  ) => buildComplianceFieldLabel(
    label,
    paramId,
    schemaPort,
    hardcodedExtra,
    useFHSSchema
  );
  const complianceFieldUnit = (paramId: string, label = paramId) => {
    const presentation = complianceFieldPresentation(paramId, label);
    return presentation.unit.status === "resolved" ? presentation.unit.display : undefined;
  };

  const [activeTab, setActiveTab] = useState<"defaults" | "settings">(
    "defaults"
  );
  const [availableDefaults, setAvailableDefaults] = useState<string[]>([]);
  const [compatibilityMap, setCompatibilityMap] = useState(
    new Map<string, GlobalSettingsDefaultsCompatibility>()
  );
  const [complianceSettingsExpanded, setComplianceSettingsExpanded] =
    useState(false);
  const [thermalBridgingExpanded, setThermalBridgingExpanded] = useState(false);
  const [airTightnessExpanded, setAirTightnessExpanded] = useState(false);
  const [ventilationEnvExpanded, setVentilationEnvExpanded] = useState(false);
  const [junctionPsiCsvOptions, setJunctionPsiCsvOptions] = useState<string[]>(
    []
  );

  const defaultsCheckReady = workspaceResourcePort.availability === "available";
  const effectiveDefaultsPath =
    (defaultsPath || "").trim() || (fallbackDefaultsPath || "").trim();
  const [selectedDefaults, setSelectedDefaults] = useKeyedState(
    effectiveDefaultsPath,
    effectiveDefaultsPath
  );
  const [selectedExists, setSelectedExists] = useKeyedState<boolean | null>(
    `${effectiveDefaultsPath}\0${defaultsCheckReady ? "ready" : "unavailable"}`,
    null
  );
  const [defaultsSearchQuery, setDefaultsSearchQuery] = useKeyedState(
    isOpen ? "open" : "closed",
    ""
  );
  const primaryZoneForSpaceLabels = useMemo(
    () => zones.find((zone) => !zone.isPlaceholder)?.id,
    [zones]
  );

  const junctionPsiDropdownOptions = useMemo(() => {
    const base = junctionPsiCsvOptions.map((path) => ({
      value: path,
      label: path.split("/").pop() || path,
    }));
    const current = (junctionPsiDefaultsPath || "").trim();
    if (current && !base.some((option) => option.value === current)) {
      base.unshift({
        value: current,
        label: `${current.split("/").pop() || current} (current)`,
      });
    }
    return [{ value: "", label: "None" }, ...base];
  }, [junctionPsiCsvOptions, junctionPsiDefaultsPath]);
  const junctionPsiFallbackPath = (junctionPsiDefaultsPath || "").trim();
  const junctionPsiFallbackLabel = junctionPsiFallbackPath
    ? `Project CSV: ${
        junctionPsiFallbackPath.split("/").pop() || junctionPsiFallbackPath
      }`
    : "Table 3.7 defaults";
  const [junctionPsiFallbackExpanded, setJunctionPsiFallbackExpanded] =
    useKeyedState(
      `${junctionPsiFallbackPath}\0${junctionPsiDefaultsError ?? ""}`,
      Boolean(junctionPsiFallbackPath || junctionPsiDefaultsError)
    );

  useEffect(() => {
    if (!thermalBridgingExpanded || !defaultsCheckReady) return;
    let cancelled = false;
    workspaceResourcePort
      .list(JUNCTION_PSI_DEFAULTS_DIR, { withKind: true })
      .then((entries) => {
        if (cancelled) return;
        setJunctionPsiCsvOptions(
          entries
            .filter((entry) =>
              typeof entry === "string"
                ? entry.endsWith(".csv")
                : entry.kind === "file" && entry.name.endsWith(".csv")
            )
            .map(
              (entry) =>
                `${JUNCTION_PSI_DEFAULTS_DIR}/${
                  typeof entry === "string" ? entry : entry.name
                }`
            )
            .sort((left, right) => left.localeCompare(right))
        );
      })
      .catch(() => {
        if (!cancelled) setJunctionPsiCsvOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [defaultsCheckReady, thermalBridgingExpanded, workspaceResourcePort]);

  const openJunctionPsiDefaultsCsv = useCallback(async () => {
    const path = (junctionPsiDefaultsPath || "").trim();
    if (!path) return;
    try {
      const text = await workspaceResourcePort.readText(path);
      const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (error) {
      console.warn("[GlobalSettingsModal] open junction ψ CSV failed", error);
    }
  }, [junctionPsiDefaultsPath, workspaceResourcePort]);

  const sourceComparisonGlobalInfo = useMemo(
    () => {
      void sourceComparisonSnapshot.revision;
      return sourceComparisonPort.globalInfo();
    },
    [sourceComparisonPort, sourceComparisonSnapshot.revision]
  );
  const comparisonGlobalFieldIndicators =
    sourceComparisonGlobalInfo?.fieldIndicators ?? {};

  const derivedGFA = useMemo(
    () => calculateGroundFloorArea(Object.values(elementsById)),
    [elementsById]
  );
  const derivedLW = useMemo(
    () =>
      calculateDwellingLengthWidthFromGroundElements(
        Object.values(elementsById)
      ),
    [elementsById]
  );
  const effectiveBuildingLength =
    complianceSettings.BuildingLength ?? derivedLW.lengthM;
  const effectiveBuildingWidth =
    complianceSettings.BuildingWidth ?? derivedLW.widthM;
  const dwellingDetailsSuggestion = useMemo(
    () => calculateDwellingDetailsSuggestion(Object.values(elementsById)),
    [elementsById]
  );
  const effectiveBuildType =
    complianceSettings.build_type ?? dwellingDetailsSuggestion.buildType;
  const effectiveStoreysInDwelling =
    complianceSettings.storeys_in_dwelling ??
    dwellingDetailsSuggestion.storeysInDwelling;
  const effectiveStoreyOfDwelling =
    complianceSettings.storey_of_dwelling ??
    dwellingDetailsSuggestion.storeyOfDwelling;
  const isBuildTypeManual = complianceSettings.build_type !== undefined;
  const isStoreysInDwellingManual =
    complianceSettings.storeys_in_dwelling !== undefined;
  const isStoreyOfDwellingManual =
    complianceSettings.storey_of_dwelling !== undefined;
  const effectiveComplianceValidationEnabled =
    COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED
      ? true
      : !!complianceSettings.complianceValidationEnabled;

  useEffect(() => {
    if (
      COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED &&
      complianceSettings.complianceValidationEnabled !== true
    ) {
      setComplianceSettings({ complianceValidationEnabled: true });
    }
  }, [complianceSettings.complianceValidationEnabled, setComplianceSettings]);

  const suggestedVentHeight = useMemo(
    () =>
      calculateSuggestedVentilationHeight(Object.values(elementsById), floors),
    [elementsById, floors]
  );
  const effectiveVentHeight =
    complianceSettings.AirPermeability_ventilation_zone_height ??
    (suggestedVentHeight > 0 ? suggestedVentHeight : undefined);
  const isVentHeightManualOverride =
    complianceSettings.AirPermeability_ventilation_zone_height !== undefined;
  const suggestedVentBaseHeight = useMemo(
    () =>
      calculateSuggestedVentilationBaseHeight(
        Object.values(elementsById),
        floors,
        {
          buildType: effectiveBuildType,
          storeysInDwelling: effectiveStoreysInDwelling,
          storeyOfDwelling: effectiveStoreyOfDwelling,
          ventilationZoneHeight: effectiveVentHeight,
        }
      ),
    [
      elementsById,
      floors,
      effectiveBuildType,
      effectiveStoreysInDwelling,
      effectiveStoreyOfDwelling,
      effectiveVentHeight,
    ]
  );
  const isVentBaseHeightManualOverride =
    complianceSettings.Ventilation_ventilation_zone_base_height !== undefined;

  const assemblyOptions = useCallback(
    (elementType: AssemblyExample["elementType"], current: string) => {
      const base =
        bundledAssemblyLibrary?.examples
          .filter((example) => example.elementType === elementType)
          .map((example) => ({
            value: example.id,
            label: example.name || example.id,
          })) ?? [];
      const options = [{ value: "", label: "None" }, ...base];
      if (current && !options.some((option) => option.value === current)) {
        options.push({
          value: current,
          label: `${current} (missing from library)`,
        });
      }
      return options;
    },
    [bundledAssemblyLibrary]
  );
  const defaultAssemblyWallOptions = useMemo(
    () => assemblyOptions("wall", creationDefaultAssemblyIds.wall ?? ""),
    [assemblyOptions, creationDefaultAssemblyIds.wall]
  );
  const defaultAssemblyRoofOptions = useMemo(
    () => assemblyOptions("roof", creationDefaultAssemblyIds.roof ?? ""),
    [assemblyOptions, creationDefaultAssemblyIds.roof]
  );
  const defaultAssemblyGroundOptions = useMemo(
    () =>
      assemblyOptions(
        "ground_floor",
        creationDefaultAssemblyIds.ground_floor ?? ""
      ),
    [assemblyOptions, creationDefaultAssemblyIds.ground_floor]
  );

  const loadDefaultsList = useCallback(async (): Promise<{
    available: string[];
    compatibility: Map<string, GlobalSettingsDefaultsCompatibility>;
  }> => {
    if (!defaultsCheckReady) {
      return { available: [], compatibility: new Map() };
    }
    try {
      const fromDefaultsDirectory = await listJsonFilesRecursively(
        workspaceResourcePort,
        "input/defaults"
      );
      const effective = effectiveDefaultsPath;
      const extras: string[] = [];
      if (
        effective &&
        (await workspaceResourcePort.exists(effective).catch(() => false))
      ) {
        extras.push(effective);
      }
      if (
        fallbackDefaultsPath &&
        effective !== fallbackDefaultsPath &&
        (await workspaceResourcePort
          .exists(fallbackDefaultsPath)
          .catch(() => false))
      ) {
        extras.push(fallbackDefaultsPath);
      }
      const sorted = [...new Set([...fromDefaultsDirectory, ...extras])].sort(
        (left, right) => {
          const leftName = left.split("/").pop() || left;
          const rightName = right.split("/").pop() || right;
          if (leftName !== rightName) return leftName.localeCompare(rightName);
          return left.localeCompare(right);
        }
      );
      const nextCompatibility = new Map<
        string,
        GlobalSettingsDefaultsCompatibility
      >();
      if (inspectDefaultsCompatibility) {
        for (const path of sorted) {
          try {
            nextCompatibility.set(
              path,
              inspectDefaultsCompatibility(
                await workspaceResourcePort.readText(path)
              )
            );
          } catch {
            nextCompatibility.set(path, {
              warnings: ["File cannot be read"],
              foundTypes: [],
              hasRequiredRootSections: false,
            });
          }
        }
      }
      return { available: sorted, compatibility: nextCompatibility };
    } catch (error) {
      console.warn("[GlobalSettingsModal] refresh defaults failed", error);
      return { available: [], compatibility: new Map() };
    }
  }, [
    defaultsCheckReady,
    effectiveDefaultsPath,
    fallbackDefaultsPath,
    inspectDefaultsCompatibility,
    workspaceResourcePort,
  ]);

  const refreshDefaultsList = useCallback(async () => {
    const next = await loadDefaultsList();
    setAvailableDefaults(next.available);
    setCompatibilityMap(next.compatibility);
  }, [loadDefaultsList]);

  const defaultsListForDisplay = useMemo(() => {
    const query = defaultsSearchQuery.toLowerCase().trim();
    let filtered = availableDefaults.filter((path) =>
      path.toLowerCase().includes(query)
    );
    const effective = (selectedDefaults || effectiveDefaultsPath).trim();
    if (
      effective &&
      !filtered.includes(effective) &&
      (!query || effective.toLowerCase().includes(query))
    ) {
      filtered = [effective, ...filtered];
    }
    if (effective && filtered.includes(effective)) {
      return [effective, ...filtered.filter((path) => path !== effective)];
    }
    return filtered;
  }, [
    availableDefaults,
    effectiveDefaultsPath,
    defaultsSearchQuery,
    selectedDefaults,
  ]);

  useEffect(() => {
    if (!defaultsCheckReady) return;
    let cancelled = false;
    const effective = effectiveDefaultsPath;
    if (!effective) return;
    workspaceResourcePort
      .exists(effective)
      .then((exists) => {
        if (!cancelled) setSelectedExists(exists);
      })
      .catch(() => {
        if (!cancelled) setSelectedExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    defaultsCheckReady,
    effectiveDefaultsPath,
    setSelectedExists,
    workspaceResourcePort,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void loadDefaultsList().then((next) => {
      if (!cancelled) {
        setAvailableDefaults(next.available);
        setCompatibilityMap(next.compatibility);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    loadDefaultsList,
  ]);

  const defaultsTabIndicator = useMemo<GlobalSettingsIndicator | null>(() => {
    if (!effectiveDefaultsPath) {
      return {
        variant: "error",
        issues: ["No defaults file is selected."],
      };
    }
    if (selectedExists !== false) return null;
    return {
      variant: "error",
      issues: [
        `Defaults file not found: ${selectedDefaults || effectiveDefaultsPath}`,
      ],
    };
  }, [effectiveDefaultsPath, selectedDefaults, selectedExists]);

  const fhsComplianceRequiredIssues = useMemo(() => {
    const issues: string[] = [];
    if (effectiveComplianceValidationEnabled) {
      if (complianceSettings.PartGcompliance === undefined) {
        issues.push(
          "Part G water efficiency: set yes or no (needed for strict checks)."
        );
      }
      if (complianceSettings.NumberOfBedrooms === undefined) {
        issues.push(
          "Number of bedrooms is required when strict checks are on."
        );
      }
      const bedroomCountIssue = fhsBedroomCountIssue(
        complianceSettings.NumberOfBedrooms
      );
      if (bedroomCountIssue) {
        issues.push(bedroomCountIssue);
      }
      if (effectiveBuildType === undefined) {
        issues.push(
          "Build type is required when strict checks are on. Draw floor geometry or select house/flat manually."
        );
      }
      if (
        !(
          typeof effectiveStoreysInDwelling === "number" &&
          Number.isFinite(effectiveStoreysInDwelling) &&
          effectiveStoreysInDwelling >= 1
        )
      ) {
        issues.push(
          "Storeys in dwelling is required when strict checks are on. Draw floor geometry or enter a manual override."
        );
      }
      if (effectiveBuildType === "flat") {
        if (
          !(
            typeof effectiveStoreyOfDwelling === "number" &&
            Number.isFinite(effectiveStoreyOfDwelling)
          )
        ) {
          issues.push(
            "Storey of dwelling is required for flats when strict checks are on."
          );
        }
        if (
          !(
            typeof complianceSettings.storeys_in_building === "number" &&
            Number.isFinite(complianceSettings.storeys_in_building) &&
            complianceSettings.storeys_in_building >= 1
          )
        ) {
          issues.push(
            "Storeys in building is required for flats when strict checks are on."
          );
        } else if (
          typeof effectiveStoreysInDwelling === "number" &&
          complianceSettings.storeys_in_building < effectiveStoreysInDwelling
        ) {
          issues.push(
            "Storeys in building should be greater than or equal to storeys in dwelling."
          );
        }
      }
      if (
        !(
          typeof effectiveBuildingLength === "number" &&
          Number.isFinite(effectiveBuildingLength) &&
          effectiveBuildingLength > 0
        )
      ) {
        issues.push(
          "Building length is required when strict checks are on. Draw usable ground floor geometry or enter a manual override."
        );
      }
      if (
        !(
          typeof effectiveBuildingWidth === "number" &&
          Number.isFinite(effectiveBuildingWidth) &&
          effectiveBuildingWidth > 0
        )
      ) {
        issues.push(
          "Building width is required when strict checks are on. Draw usable ground floor geometry or enter a manual override."
        );
      }
      if (complianceSettings.NumberOfHabitableRooms === undefined) {
        issues.push(
          "Number of habitable rooms is required when strict checks are on."
        );
      }
      if (complianceSettings.NumberOfHotTappedRooms === undefined) {
        issues.push(
          "Number of hot-tapped rooms is required when strict checks are on."
        );
      }
      if (complianceSettings.NumberOfUtilityRooms === undefined) {
        issues.push(
          "Number of utility rooms is required when strict checks are on."
        );
      }
      if (complianceSettings.NumberOfBathrooms === undefined) {
        issues.push(
          "Number of bathrooms is required when strict checks are on."
        );
      }
      if (complianceSettings.NumberOfSanitaryAccommodations === undefined) {
        issues.push(
          "Number of sanitary accommodations is required when strict checks are on."
        );
      }
      if (complianceSettings.HeatingControlType === undefined) {
        issues.push(
          "Heating control type is required when strict checks are on."
        );
      }
      if (complianceSettings.ColdWaterSource === undefined) {
        issues.push("Cold water source is required when strict checks are on.");
      }
    }
    return issues;
  }, [
    complianceSettings,
    effectiveBuildingLength,
    effectiveBuildingWidth,
    effectiveBuildType,
    effectiveComplianceValidationEnabled,
    effectiveStoreyOfDwelling,
    effectiveStoreysInDwelling,
  ]);

  const comparisonGlobalSections = useMemo(() => ({
    compliance: sourceComparisonGlobalInfo?.sectionItems.compliance ?? [],
    airTightness: sourceComparisonGlobalInfo?.sectionItems.airTightness ?? [],
    ventilation: sourceComparisonGlobalInfo?.sectionItems.ventilation ?? [],
    other: sourceComparisonGlobalInfo?.sectionItems.other ?? [],
  }), [sourceComparisonGlobalInfo]);
  const complianceComparisonIssues = useMemo(
    () => [...comparisonGlobalSections.compliance, ...comparisonGlobalSections.other],
    [comparisonGlobalSections]
  );
  const dwellingCountSpaceLabelMismatchState = useMemo(
    () =>
      getDwellingCountSpaceLabelMismatchState(
        zones,
        spaceLabelIds,
        spaceLabelsById,
        complianceSettings
      ),
    [complianceSettings, spaceLabelIds, spaceLabelsById, zones]
  );
  const dwellingCountVersusSpaceLabelWarnings = useMemo(
    () =>
      formatDwellingCountMismatchWarnings(
        dwellingCountSpaceLabelMismatchState.mismatches
      ),
    [dwellingCountSpaceLabelMismatchState.mismatches]
  );
  const globalSettingsWarnings = useMemo(
    () =>
      collectGlobalSettingsWarnings({
        elements: Object.values(elementsById),
        floors,
        zones,
        complianceValidationEnabled: effectiveComplianceValidationEnabled,
        complianceSettings,
      }),
    [
      complianceSettings,
      effectiveComplianceValidationEnabled,
      elementsById,
      floors,
      zones,
    ]
  );
  const globalSettingsWarningIssues = useMemo(
    () => [...dwellingCountVersusSpaceLabelWarnings, ...globalSettingsWarnings],
    [dwellingCountVersusSpaceLabelWarnings, globalSettingsWarnings]
  );
  // Room counts describe the dwelling, so they span every non-placeholder zone
  // (a two-zone FHS model keeps its bedrooms in "Rest of Dwelling").
  const dwellingRoomCounts = useMemo(() => {
    const labels = spaceLabelIds
      .map((id) => spaceLabelsById[id])
      .filter((label): label is NonNullable<typeof label> => !!label);
    const result = aggregateDwellingCounts(labels, dwellingCountZoneIds(zones));
    return result.hasLabelledFootprints ? result.dwellingCounts : null;
  }, [spaceLabelIds, spaceLabelsById, zones]);
  const applyAllRoomCountsFromSpaceLabels = useCallback(() => {
    if (!primaryZoneForSpaceLabels || !dwellingRoomCounts) return;
    setComplianceSettings(fullDwellingCountsCompliancePatch(dwellingRoomCounts));
  }, [primaryZoneForSpaceLabels, dwellingRoomCounts, setComplianceSettings]);
  const settingsTabIndicator = useMemo<GlobalSettingsIndicator | null>(() => {
    if (fhsComplianceRequiredIssues.length > 0) {
      return { variant: "error", issues: fhsComplianceRequiredIssues };
    }
    if (globalSettingsWarningIssues.length > 0) {
      return { variant: "warning", issues: globalSettingsWarningIssues };
    }
    const informational = Object.values(comparisonGlobalSections).flat();
    return informational.length > 0
      ? { variant: "info", issues: informational }
      : null;
  }, [comparisonGlobalSections, fhsComplianceRequiredIssues, globalSettingsWarningIssues]);
  const indicator = useMemo<GlobalSettingsIndicator | null>(() => {
    if (!defaultsTabIndicator) return settingsTabIndicator;
    if (!settingsTabIndicator) return defaultsTabIndicator;
    const variant = defaultsTabIndicator.variant === "error"
      || settingsTabIndicator.variant === "error"
      ? "error"
      : defaultsTabIndicator.variant === "warning"
        || settingsTabIndicator.variant === "warning"
        ? "warning"
        : "info";
    return {
      variant,
      issues: [...defaultsTabIndicator.issues, ...settingsTabIndicator.issues],
    };
  }, [defaultsTabIndicator, settingsTabIndicator]);
  useEffect(() => {
    onIndicatorChange?.(indicator);
  }, [indicator, onIndicatorChange]);

  if (!isOpen || typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div style={{ flexShrink: 0 }}>
          <ModalHeader title="Global Settings" onClose={() => onClose()} />
          <div
            role="tablist"
            style={{
              display: "flex",
              width: "100%",
              borderBottom: "1px solid var(--border-subtle)",
              marginTop: 4,
              boxSizing: "border-box",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "defaults"}
              onClick={() => setActiveTab("defaults")}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 8px",
                border: "none",
                background: "transparent",
                borderBottom:
                  activeTab === "defaults"
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                color:
                  activeTab === "defaults"
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                fontWeight: 500,
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                transition:
                  "color var(--transition-normal), border-color var(--transition-normal)",
              }}
            >
              <span>Defaults</span>
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {defaultsTabIndicator ? (
                  <ValidationIndicator
                    hasIssues
                    issues={defaultsTabIndicator.issues}
                    size="small"
                    variant={defaultsTabIndicator.variant}
                  />
                ) : null}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "settings"}
              onClick={() => setActiveTab("settings")}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "10px 8px",
                border: "none",
                background: "transparent",
                borderBottom:
                  activeTab === "settings"
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                color:
                  activeTab === "settings"
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                fontWeight: 500,
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                transition:
                  "color var(--transition-normal), border-color var(--transition-normal)",
              }}
            >
              <span>Global values</span>
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {settingsTabIndicator ? (
                  <ValidationIndicator
                    hasIssues
                    issues={settingsTabIndicator.issues}
                    size="small"
                    variant={settingsTabIndicator.variant}
                  />
                ) : null}
              </span>
            </button>
          </div>
        </div>

        <div
          className="modal-body"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 0,
            alignItems: "stretch",
          }}
        >
          {/* Defaults tab: merge targets + default assemblies */}
          {activeTab === "defaults" && (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-subtle)",
                  fontWeight: 500,
                  padding: "4px 0 0",
                }}
              >
                Pick a defaults file
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  lineHeight: 1.45,
                  padding: "0 0 2px",
                }}
              >
                What you draw is the building shape. The defaults file supplies
                other details HEM requires: schedules, default properties, and
                similar. The file in use is highlighted at the top.
              </div>

              {/* Search input */}
              <StandardInput
                type="text"
                value={defaultsSearchQuery}
                onChange={(e) => setDefaultsSearchQuery(e.target.value)}
                placeholder="Search default files..."
                variant="ghost"
                size="md"
              />

              <div
                role="listbox"
                aria-label="Default JSON files in workspace"
                style={{
                  minHeight: 100,
                  maxHeight: 168,
                  flexShrink: 0,
                  overflow: "auto",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 4,
                  background: "var(--bg-secondary)",
                }}
              >
                {!defaultsCheckReady ? (
                  <div
                    style={{
                      padding: 8,
                      fontSize: 12,
                      color: "var(--text-subtle)",
                    }}
                  >
                    Use Files to choose or reconnect a workspace folder and list
                    default JSON files.
                  </div>
                ) : defaultsListForDisplay.length === 0 ? (
                  <div
                    style={{
                      padding: 8,
                      fontSize: 12,
                      color: "var(--text-subtle)",
                    }}
                  >
                    {defaultsSearchQuery.trim()
                      ? "No files match your search"
                      : "No JSON files found under input/defaults/"}
                  </div>
                ) : (
                  defaultsListForDisplay.map((p) => {
                    const selected = p === selectedDefaults;
                    const compat = compatibilityMap.get(p);
                    const hasWarnings = !!compat?.warnings?.length;
                    return (
                      <div
                        key={p}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: 10,
                          cursor: "pointer",
                          background: selected
                            ? "var(--row-highlight-bg)"
                            : "transparent",
                          borderBottom: "1px solid var(--border-subtle)",
                          boxShadow: selected
                            ? "inset 3px 0 0 var(--row-highlight-border)"
                            : "none",
                          minWidth: 0,
                        }}
                        onClick={async () => {
                          setSelectedDefaults(p);
                          const ok = await workspaceResourcePort
                            .exists(p)
                            .catch(() => false);
                          setSelectedExists(!!ok);
                          if (ok) {
                            setDefaultsPath(p);
                            onClose();
                          }
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            minWidth: 0,
                            overflow: "hidden",
                            flex: "1 1 0",
                          }}
                        >
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 9999,
                              background: selected
                                ? "var(--accent-primary)"
                                : "transparent",
                              border: "1px solid var(--accent-secondary)",
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: "1 1 0",
                              minWidth: 0,
                            }}
                          >
                            {p}
                          </span>
                          {selected && selectedExists === false ? (
                            <span
                              style={{
                                color: "var(--error-text)",
                                fontSize: 12,
                                flexShrink: 0,
                              }}
                            >
                              (not found)
                            </span>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginLeft: "auto",
                            flexShrink: 0,
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {hasWarnings && (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "2px 6px",
                                background: "rgba(255, 165, 0, 0.15)",
                                border: "1px solid rgba(255, 165, 0, 0.3)",
                                borderRadius: 4,
                                fontSize: 10,
                                color: "var(--warning-text, #ff8c00)",
                                cursor: "default",
                                fontWeight: 500,
                                flexShrink: 0,
                              }}
                              title={`Warning, may not contain sufficient inputs to be a default: ${(
                                compat?.warnings ?? []
                              ).join("; ")}`}
                            >
                              ⚠️
                            </span>
                          )}
                          {onEditDefaults ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              title="Edit"
                              style={{ padding: "2px 6px" }}
                              onClick={() => onEditDefaults(p, compat)}
                            >
                              <DefaultsEditIcon />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            title="Duplicate"
                            style={{ padding: "2px 6px" }}
                            onClick={async () => {
                              try {
                                const name = prompt(
                                  "New file name (without extension):",
                                  "default"
                                );
                                if (!name) return;
                                const content =
                                  await workspaceResourcePort.readText(p);
                                const target = `input/defaults/${name}.json`;
                                const exists =
                                  await workspaceResourcePort.exists(target);
                                if (
                                  exists &&
                                  !confirm("File exists. Overwrite?")
                                )
                                  return;
                                await workspaceResourcePort.writeText(
                                  target,
                                  content
                                );
                                await refreshDefaultsList();
                                setSelectedDefaults(target);
                                setSelectedExists(true);
                                setDefaultsPath(target);
                              } catch (error: unknown) {
                                alert(
                                  `Duplicate failed: ${
                                    error instanceof Error
                                      ? error.message
                                      : String(error)
                                  }`
                                );
                              }
                            }}
                          >
                            <DefaultsDuplicateIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-subtle)",
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  Default assemblies for new fabric elements
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                    lineHeight: 1.45,
                  }}
                >
                  Choose a construction to apply when you add new walls, roofs,
                  or ground floors. Leave as None to use only the defaults file
                  you picked above. These choices are saved with this model.
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <StandardDropdown
                    label="Walls (and wall-like adjacent)"
                    value={creationDefaultAssemblyIds.wall ?? ""}
                    onChange={(v) =>
                      setCreationDefaultAssemblyIds({ wall: v || undefined })
                    }
                    options={defaultAssemblyWallOptions}
                    variant="ghost"
                    size="md"
                    disabled={!bundledAssemblyLibrary}
                  />
                  <StandardDropdown
                    label="Roofs (and roof-like adjacent)"
                    value={creationDefaultAssemblyIds.roof ?? ""}
                    onChange={(v) =>
                      setCreationDefaultAssemblyIds({ roof: v || undefined })
                    }
                    options={defaultAssemblyRoofOptions}
                    variant="ghost"
                    size="md"
                    disabled={!bundledAssemblyLibrary}
                  />
                  <StandardDropdown
                    label="Ground floors"
                    value={creationDefaultAssemblyIds.ground_floor ?? ""}
                    onChange={(v) =>
                      setCreationDefaultAssemblyIds({
                        ground_floor: v || undefined,
                      })
                    }
                    options={defaultAssemblyGroundOptions}
                    variant="ghost"
                    size="md"
                    disabled={!bundledAssemblyLibrary}
                  />
                </div>
                {bundledAssemblyLibraryLoading && !bundledAssemblyLibrary ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-subtle)",
                      marginTop: 8,
                    }}
                  >
                    Loading assembly library…
                  </div>
                ) : bundledAssemblyLibraryError ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--error-text)",
                      marginTop: 8,
                      lineHeight: 1.4,
                    }}
                  >
                    Could not load{" "}
                    <code style={{ fontSize: 10 }}>
                      input/assembly_library/
                    </code>
                    : {bundledAssemblyLibraryError}
                  </div>
                ) : null}
              </div>
            </>
          )}

          {/* Global Settings Tab */}
          {activeTab === "settings" && (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                  padding: "8px 0",
                }}
              >
                Configure global settings that apply to your model, including
                compliance settings and thermal bridging defaults.
              </div>

              {/* Evidence linking for global settings */}
              {evidenceSection}

              {/* Dwelling Details Section */}
              <div style={{ marginTop: "var(--spacing-md)" }}>
                <div
                  onClick={() =>
                    setComplianceSettingsExpanded(!complianceSettingsExpanded)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                    padding: "var(--spacing-sm)",
                    borderRadius: "var(--radius-md)",
                    background: complianceSettingsExpanded
                      ? "var(--bg-secondary)"
                      : "transparent",
                    transition: "var(--transition-colors)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "var(--font-weight-semibold)",
                      fontSize: "var(--font-size-md)",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                  >
                    Dwelling Details
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <GlobalSettingsCollapsedIssueBadges
                      expanded={complianceSettingsExpanded}
                      errorCount={fhsComplianceRequiredIssues.length}
                      warningCount={globalSettingsWarningIssues.length}
                      infoCount={complianceComparisonIssues.length}
                    />
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      style={{
                        transform: complianceSettingsExpanded
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform var(--transition-normal) ease",
                      }}
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <GlobalSettingsSectionValidationStrip
                  expanded={complianceSettingsExpanded}
                  errorIssues={fhsComplianceRequiredIssues}
                  warningIssues={globalSettingsWarningIssues}
                  infoIssues={complianceComparisonIssues}
                />

                {complianceSettingsExpanded && (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--spacing-md)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        marginBottom: "var(--spacing-sm)",
                      }}
                    >
                      Configure dwelling-level details used by the FHS
                      calculation. Some values can be suggested from geometry,
                      but you can override them where needed.
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--spacing-sm)",
                      }}
                    >
                      <div
                        style={{
                          padding: "12px 14px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--bg-tertiary)",
                          border: "1px solid var(--border-subtle)",
                          marginBottom: 2,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "var(--spacing-sm)",
                            cursor: COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED
                              ? "default"
                              : "pointer",
                            margin: 0,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={effectiveComplianceValidationEnabled}
                            onChange={(e) =>
                              setComplianceSettings({
                                complianceValidationEnabled: e.target.checked,
                              })
                            }
                            disabled={COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED}
                            style={{
                              cursor: COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED
                                ? "not-allowed"
                                : "pointer",
                              marginTop: 2,
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: "var(--text-primary)",
                                }}
                              >
                                Apply Future Homes Standard (FHS) validation to
                                inputs
                              </span>
                              {COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED && (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    background:
                                      "var(--validation-info-badge-bg)",
                                    border:
                                      "1px solid var(--validation-info-badge-border)",
                                    color: "var(--validation-info-text)",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    lineHeight: 1.4,
                                  }}
                                >
                                  Required for now
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-secondary)",
                                lineHeight: 1.45,
                              }}
                            >
                              The FHS pathway strips values that are not
                              accepted by FHS from the input file and merges
                              multiple zones into one. Missing Part G, bedroom
                              count, or heating control stops the run until you
                              fill them in.
                            </span>
                            {COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.45,
                                }}
                              >
                                {COMPLIANCE_VALIDATION_LOCK_NOTE}
                              </span>
                            )}
                            {!COMPLIANCE_VALIDATION_TEMPORARILY_LOCKED && (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-secondary)",
                                  lineHeight: 1.45,
                                }}
                              >
                                When it is off, the same problems show as
                                warnings and may only fail later in the
                                pipeline.
                              </span>
                            )}
                          </div>
                        </label>
                      </div>

                      <div
                        style={{
                          marginTop: "var(--spacing-sm)",
                          paddingTop: "var(--spacing-sm)",
                          borderTop: "1px solid var(--border-subtle)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--spacing-md)",
                        }}
                      >
                        <StandardInput
                          type="text"
                          label="Property postcode"
                          value={propertyPostcode ?? ""}
                          onChange={(event) => {
                            const value = event.target.value.toUpperCase();
                            setPropertyPostcode(value || undefined);
                          }}
                          placeholder="e.g. MK40 1AA"
                          helperText="Used only as property metadata in the SAP report. It does not select the native SAP calculator's climate data."
                          autoComplete="postal-code"
                          variant="ghost"
                          size="md"
                        />

                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            lineHeight: 1.45,
                          }}
                        >
                          Dwelling form is exported to FHS <code>General</code>.
                          Auto suggestions count distinct floor levels with
                          ground-contact floors or pitch-180 walkable floor
                          polygons; pitch-0 roof/ceiling surfaces and line walls
                          are excluded.
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--spacing-xs)",
                          }}
                        >
                          <StandardDropdown
                            label={
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  flexWrap: "wrap",
                                }}
                              >
                                {complianceFieldLabel(
                                  "Build type",
                                  "General_build_type",
                                  dwellingDetailsSuggestion.explanation
                                )}
                                {effectiveBuildType && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 400,
                                      color: isBuildTypeManual
                                        ? "var(--text-warning)"
                                        : "var(--text-muted)",
                                    }}
                                  >
                                    {isBuildTypeManual
                                      ? "(manual override)"
                                      : "(auto)"}
                                  </span>
                                )}
                              </div>
                            }
                            value={effectiveBuildType || ""}
                            onChange={(value) => {
                              const next =
                                value === ""
                                  ? undefined
                                  : (value as "flat" | "house");
                              const patch: Parameters<
                                typeof setComplianceSettings
                              >[0] = {
                                build_type:
                                  next === dwellingDetailsSuggestion.buildType
                                    ? undefined
                                    : next,
                              };
                              const nextEffectiveBuildType =
                                next ?? dwellingDetailsSuggestion.buildType;
                              if (nextEffectiveBuildType === "house") {
                                patch.storey_of_dwelling = undefined;
                                patch.storeys_in_building = undefined;
                              }
                              setComplianceSettings(patch);
                            }}
                            options={[
                              {
                                value: "",
                                label: dwellingDetailsSuggestion.buildType
                                  ? `Auto (${dwellingDetailsSuggestion.buildType})`
                                  : "Select build type...",
                              },
                              { value: "house", label: "House" },
                              { value: "flat", label: "Flat" },
                            ]}
                            placeholder="Select build type..."
                            variant="ghost"
                            size="md"
                          />
                          {isBuildTypeManual &&
                            dwellingDetailsSuggestion.buildType && (
                              <ResetFieldButton
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setComplianceSettings({
                                    build_type: undefined,
                                    ...(dwellingDetailsSuggestion.buildType ===
                                    "house"
                                      ? {
                                          storey_of_dwelling: undefined,
                                          storeys_in_building: undefined,
                                        }
                                      : {}),
                                  });
                                }}
                                title={`Reset to suggested build type (${dwellingDetailsSuggestion.buildType})`}
                                ariaLabel="Reset build type to suggested value"
                                align="input-row"
                              />
                            )}
                        </div>

                        <StandardDropdown
                          label={complianceFieldLabel(
                            "SAP built form",
                            "General_built_form"
                          )}
                          value={
                            complianceSettings.built_form?.toString() || ""
                          }
                          onChange={(value) => {
                            const code = Number(value);
                            setComplianceSettings({
                              built_form:
                                value !== "" &&
                                Number.isInteger(code) &&
                                code >= 1 &&
                                code <= 6
                                  ? (code as SapBuiltFormCode)
                                  : undefined,
                            });
                          }}
                          options={[
                            { value: "", label: "Select SAP built form..." },
                            { value: "1", label: "Detached" },
                            { value: "2", label: "Semi-detached" },
                            { value: "3", label: "End-terrace" },
                            { value: "4", label: "Mid-terrace" },
                            { value: "5", label: "Enclosed end-terrace" },
                            { value: "6", label: "Enclosed mid-terrace" },
                          ]}
                          placeholder="Select SAP built form..."
                          helperText="Required for SAP XML. Choose explicitly; Vulcan does not infer this from geometry."
                          variant="ghost"
                          size="md"
                        />

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--spacing-xs)",
                          }}
                        >
                          <StandardInput
                            type="number"
                            unit={complianceFieldUnit("General_storeys_in_dwelling", "Storeys in dwelling")}
                            label={
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  flexWrap: "wrap",
                                }}
                              >
                                {complianceFieldLabel(
                                  "Storeys in dwelling",
                                  "General_storeys_in_dwelling",
                                  dwellingDetailsSuggestion.explanation
                                )}
                                {effectiveStoreysInDwelling !== undefined && (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 400,
                                      color: isStoreysInDwellingManual
                                        ? "var(--text-warning)"
                                        : "var(--text-muted)",
                                    }}
                                  >
                                    {isStoreysInDwellingManual
                                      ? "(manual override)"
                                      : "(auto)"}
                                  </span>
                                )}
                              </div>
                            }
                            value={effectiveStoreysInDwelling?.toString() || ""}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                setComplianceSettings({
                                  storeys_in_dwelling: undefined,
                                });
                                return;
                              }
                              const val = Math.max(
                                1,
                                Math.floor(parseFloat(raw) || 1)
                              );
                              setComplianceSettings({
                                storeys_in_dwelling:
                                  val ===
                                  dwellingDetailsSuggestion.storeysInDwelling
                                    ? undefined
                                    : val,
                              });
                            }}
                            placeholder={
                              dwellingDetailsSuggestion.storeysInDwelling?.toString() ||
                              "Draw floor geometry"
                            }
                            min="1"
                            step="1"
                            variant="ghost"
                            size="md"
                          />
                          {isStoreysInDwellingManual &&
                            dwellingDetailsSuggestion.storeysInDwelling && (
                              <ResetFieldButton
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setComplianceSettings({
                                    storeys_in_dwelling: undefined,
                                  });
                                }}
                                title={`Reset to suggested storeys in dwelling (${dwellingDetailsSuggestion.storeysInDwelling})`}
                                ariaLabel="Reset storeys in dwelling to suggested value"
                                align="input-row"
                              />
                            )}
                        </div>

                        {effectiveBuildType === "flat" && (
                          <>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "var(--spacing-xs)",
                              }}
                            >
                              <StandardInput
                                type="number"
                                unit={complianceFieldUnit("General_storey_of_dwelling", "Storey of dwelling")}
                                label={
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {complianceFieldLabel(
                                      "Storey of dwelling",
                                      "General_storey_of_dwelling",
                                      dwellingDetailsSuggestion.explanation
                                    )}
                                    {effectiveStoreyOfDwelling !==
                                      undefined && (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 400,
                                          color: isStoreyOfDwellingManual
                                            ? "var(--text-warning)"
                                            : "var(--text-muted)",
                                        }}
                                      >
                                        {isStoreyOfDwellingManual
                                          ? "(manual override)"
                                          : "(auto)"}
                                      </span>
                                    )}
                                  </div>
                                }
                                value={
                                  effectiveStoreyOfDwelling?.toString() || ""
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === "") {
                                    setComplianceSettings({
                                      storey_of_dwelling: undefined,
                                    });
                                    return;
                                  }
                                  const val = Math.floor(parseFloat(raw) || 0);
                                  setComplianceSettings({
                                    storey_of_dwelling:
                                      val ===
                                      dwellingDetailsSuggestion.storeyOfDwelling
                                        ? undefined
                                        : val,
                                  });
                                }}
                                placeholder={
                                  dwellingDetailsSuggestion.storeyOfDwelling?.toString() ||
                                  "Lowest occupied storey"
                                }
                                min="-50"
                                max="199"
                                step="1"
                                variant="ghost"
                                size="md"
                              />
                              {isStoreyOfDwellingManual &&
                                dwellingDetailsSuggestion.storeyOfDwelling !==
                                  undefined && (
                                  <ResetFieldButton
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setComplianceSettings({
                                        storey_of_dwelling: undefined,
                                      });
                                    }}
                                    title={`Reset to suggested storey of dwelling (${dwellingDetailsSuggestion.storeyOfDwelling})`}
                                    ariaLabel="Reset storey of dwelling to suggested value"
                                    align="input-row"
                                  />
                                )}
                            </div>

                            <StandardInput
                              type="number"
                              unit={complianceFieldUnit("General_storeys_in_building", "Storeys in building")}
                              label={complianceFieldLabel(
                                "Storeys in building",
                                "General_storeys_in_building"
                              )}
                              value={
                                complianceSettings.storeys_in_building?.toString() ||
                                ""
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val =
                                  raw === ""
                                    ? undefined
                                    : Math.max(
                                        1,
                                        Math.floor(parseFloat(raw) || 1)
                                      );
                                setComplianceSettings({
                                  storeys_in_building: val,
                                });
                              }}
                              placeholder="Required for flats"
                              min="1"
                              step="1"
                              variant="ghost"
                              size="md"
                            />
                          </>
                        )}
                      </div>

                      <div
                        style={{
                          marginTop: "var(--spacing-sm)",
                          paddingTop: "var(--spacing-sm)",
                          borderTop: "1px solid var(--border-subtle)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--spacing-sm)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              complianceSettings.PartO_active_cooling_required ||
                              false
                            }
                            onChange={(e) =>
                              setComplianceSettings({
                                PartO_active_cooling_required: e.target.checked,
                              })
                            }
                            style={{ cursor: "pointer" }}
                          />
                          {complianceFieldLabel(
                            "Part O Active Cooling Required",
                            "PartO_active_cooling_required"
                          )}
                          {renderEvidencePill(
                            "PartO_active_cooling_required",
                            "Part O Active Cooling"
                          )}
                        </label>
                      </div>

                      <div
                        style={{
                          marginTop: "var(--spacing-sm)",
                          padding: "var(--spacing-md)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-subtle)",
                          background: "var(--bg-secondary)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--spacing-md)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            lineHeight: 1.45,
                          }}
                        >
                          Room counts are automatically set by{" "}
                          <button
                            type="button"
                            disabled={!primaryZoneForSpaceLabels}
                            title={
                              primaryZoneForSpaceLabels
                                ? "Open Space labeller"
                                : "Add a non-placeholder zone first"
                            }
                            onClick={() => {
                              if (primaryZoneForSpaceLabels)
                                openSpaceLabeller(primaryZoneForSpaceLabels);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              margin: 0,
                              cursor: primaryZoneForSpaceLabels
                                ? "pointer"
                                : "not-allowed",
                              color: primaryZoneForSpaceLabels
                                ? "var(--accent-primary, #5eead4)"
                                : "var(--text-muted)",
                              textDecoration: "underline",
                              font: "inherit",
                              fontSize: "inherit",
                            }}
                          >
                            space assignments
                          </button>{" "}
                          — these can be manually overridden.
                        </div>

                        {dwellingCountSpaceLabelMismatchState.mismatches
                          .length > 0 ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={applyAllRoomCountsFromSpaceLabels}
                              title="Overwrite every room count below with totals from labelled space footprints"
                            >
                              Use space labels for all room counts
                            </button>
                          </div>
                        ) : null}

                        {ROOM_COUNT_COMPLIANCE_ROWS.map((row) => {
                          const comparisonMessages = row.comparisonFieldKey
                            ? comparisonGlobalFieldIndicators[row.comparisonFieldKey]
                            : undefined;
                          const derived = dwellingRoomCounts
                            ? Math.max(
                                0,
                                Math.round(dwellingRoomCounts[row.field])
                              )
                            : 0;
                          const stored = complianceSettings[row.field];
                          const hasLabelled =
                            dwellingCountSpaceLabelMismatchState.hasLabelledFootprintsInPrimary;
                          const showSource =
                            hasLabelled &&
                            typeof stored === "number" &&
                            Number.isFinite(stored);
                          const mismatch =
                            dwellingCountSpaceLabelMismatchState.mismatches.find(
                              (m) => m.field === row.field
                            );
                          const isManual = !!mismatch;
                          return (
                            <div
                              key={row.field}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "var(--spacing-xs)",
                              }}
                            >
                              <StandardInput
                                type="number"
                                unit={complianceFieldUnit(row.field, row.label)}
                                label={
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {complianceFieldLabel(row.label, row.field)}
                                    {showSource ? (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 400,
                                          color: isManual
                                            ? "var(--text-warning)"
                                            : "var(--text-muted)",
                                        }}
                                      >
                                        {isManual
                                          ? "(manual override)"
                                          : "(from space labels)"}
                                      </span>
                                    ) : null}
                                    {comparisonMessages?.length ? (
                                      <ValidationIndicator
                                        hasIssues
                                        issues={comparisonMessages}
                                        size="small"
                                        variant="info"
                                      />
                                    ) : null}
                                    {renderEvidencePill(
                                      row.field,
                                      row.evidenceShort
                                    )}
                                  </div>
                                }
                                value={
                                  complianceSettings[row.field]?.toString() ||
                                  ""
                                }
                                onChange={(e) => {
                                  const val =
                                    e.target.value === ""
                                      ? undefined
                                      : Math.max(
                                          0,
                                          Math.floor(
                                            parseFloat(e.target.value) || 0
                                          )
                                        );
                                  setComplianceSettings({ [row.field]: val });
                                }}
                                min="0"
                                step="1"
                                variant="ghost"
                                size="md"
                              />
                              {isManual ? (
                                <ResetFieldButton
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setComplianceSettings({
                                      [row.field]: derived,
                                    });
                                  }}
                                  title={`Use space labels (${derived})`}
                                  ariaLabel={`Reset ${row.label} to value from space labels`}
                                  align="input-row"
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div>
                        <DerivedNumberField
                          label={complianceFieldLabel(
                            "Ground Floor Area (m²)",
                            "GroundFloorArea"
                          )}
                          derivedValue={derivedGFA}
                          unit={complianceFieldUnit("GroundFloorArea", "Ground Floor Area (m²)")}
                          manualValue={complianceSettings.GroundFloorArea}
                          onChange={(next) =>
                            setComplianceSettings({ GroundFloorArea: next })
                          }
                          labelAccessory={renderEvidencePill(
                            "GroundFloorArea",
                            "Ground Floor Area"
                          )}
                          placeholderWhenUnavailable="No ground polygons drawn"
                          helperTextWhenDerived={`Derived from lowest-Z ground polygons: ${derivedGFA} m²`}
                          helperTextWhenUnavailable="Draw ground floor polygons to auto-derive"
                          resetTitle={`Reset to geometry-derived ground floor area (${derivedGFA} m²)`}
                          resetAriaLabel="Reset ground floor area to derived value"
                        />
                      </div>

                      <DerivedNumberField
                        label={complianceFieldLabel(
                          "Building length (m)",
                          "BuildingLength",
                          derivedLW.detail +
                            (derivedLW.warning ? ` — ${derivedLW.warning}` : "")
                        )}
                        derivedValue={derivedLW.lengthM}
                        unit={complianceFieldUnit("BuildingLength", "Building length (m)")}
                        manualValue={complianceSettings.BuildingLength}
                        onChange={(next) =>
                          setComplianceSettings({ BuildingLength: next })
                        }
                        labelAccessory={renderEvidencePill(
                          "BuildingLength",
                          "Building length"
                        )}
                        autoTagMarginLeft={4}
                        resetTitle={`Reset to geometry-derived building length (${derivedLW.lengthM} m)`}
                        resetAriaLabel="Reset building length to derived value"
                      />

                      <DerivedNumberField
                        label={complianceFieldLabel(
                          "Building width (m)",
                          "BuildingWidth"
                        )}
                        derivedValue={derivedLW.widthM}
                        unit={complianceFieldUnit("BuildingWidth", "Building width (m)")}
                        manualValue={complianceSettings.BuildingWidth}
                        onChange={(next) =>
                          setComplianceSettings({ BuildingWidth: next })
                        }
                        labelAccessory={renderEvidencePill(
                          "BuildingWidth",
                          "Building width"
                        )}
                        autoTagMarginLeft={4}
                        resetTitle={`Reset to geometry-derived building width (${derivedLW.widthM} m)`}
                        resetAriaLabel="Reset building width to derived value"
                      />

                      <StandardDropdown
                        label={
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            {complianceFieldLabel(
                              "Heating Control Type",
                              "HeatingControlType"
                            )}
                            {renderEvidencePill(
                              "HeatingControlType",
                              "Heating Control Type"
                            )}
                          </div>
                        }
                        value={complianceSettings.HeatingControlType || ""}
                        onChange={(value) =>
                          setComplianceSettings({
                            HeatingControlType: value as
                              | "SeparateTempControl"
                              | "SeparateTimeAndTempControl"
                              | undefined,
                          })
                        }
                        options={[
                          {
                            value: "SeparateTempControl",
                            label: "Separate Temperature Control",
                          },
                          {
                            value: "SeparateTimeAndTempControl",
                            label: "Separate Time and Temperature Control",
                          },
                        ]}
                        placeholder="Select control type..."
                        variant="ghost"
                        size="md"
                      />

                      <StandardDropdown
                        label={
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            {complianceFieldLabel(
                              "Cold Water Source",
                              "ColdWaterSource"
                            )}
                            {renderEvidencePill(
                              "ColdWaterSource",
                              "Cold Water Source"
                            )}
                          </div>
                        }
                        value={complianceSettings.ColdWaterSource || ""}
                        onChange={(value) => {
                          const next =
                            value === ""
                              ? undefined
                              : (value as "mains water" | "header tank");
                          setComplianceSettings({ ColdWaterSource: next });
                        }}
                        options={[
                          { value: "mains water", label: "Mains water" },
                          { value: "header tank", label: "Header tank" },
                        ]}
                        placeholder="Select cold water source..."
                        variant="ghost"
                        size="md"
                      />

                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--spacing-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={complianceSettings.PartGcompliance || false}
                          onChange={(e) =>
                            setComplianceSettings({
                              PartGcompliance: e.target.checked,
                            })
                          }
                          style={{ cursor: "pointer" }}
                        />
                        {complianceFieldLabel(
                          "Part G Compliance",
                          "PartGcompliance"
                        )}
                        {renderEvidencePill(
                          "PartGcompliance",
                          "Part G Compliance"
                        )}
                      </label>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--spacing-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={
                            complianceSettings.KitchenExtractorHoodExternal ||
                            false
                          }
                          onChange={(e) =>
                            setComplianceSettings({
                              KitchenExtractorHoodExternal: e.target.checked,
                            })
                          }
                          style={{ cursor: "pointer" }}
                        />
                        {complianceFieldLabel(
                          "Kitchen cooker hood extracts to outside",
                          "KitchenExtractorHoodExternal"
                        )}
                        {renderEvidencePill(
                          "KitchenExtractorHoodExternal",
                          "Kitchen hood"
                        )}
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Air Tightness Settings Section */}
              <div
                style={{
                  marginTop: "var(--spacing-md)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "var(--spacing-md)",
                }}
              >
                <div
                  onClick={() => setAirTightnessExpanded(!airTightnessExpanded)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                    padding: "var(--spacing-sm)",
                    borderRadius: "var(--radius-md)",
                    background: airTightnessExpanded
                      ? "var(--bg-secondary)"
                      : "transparent",
                    transition: "var(--transition-colors)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "var(--font-weight-semibold)",
                      fontSize: "var(--font-size-md)",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                  >
                    Air Tightness
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <GlobalSettingsCollapsedIssueBadges
                      expanded={airTightnessExpanded}
                      errorCount={0}
                      infoCount={comparisonGlobalSections.airTightness.length}
                    />
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      style={{
                        transform: airTightnessExpanded
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform var(--transition-normal) ease",
                      }}
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <GlobalSettingsSectionValidationStrip
                  expanded={airTightnessExpanded}
                  errorIssues={[]}
                  infoIssues={comparisonGlobalSections.airTightness}
                />

                {airTightnessExpanded && (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--spacing-md)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        marginBottom: "var(--spacing-sm)",
                      }}
                    >
                      These settings will be merged into
                      InfiltrationVentilation.Leaks in the JSON output. Env Area
                      is automatically calculated from building element areas.
                    </div>

                    <StandardDropdown
                      label={
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>Test Pressure</span>
                          {renderEvidencePill(
                            "AirPermeability_test_pressure",
                            "Test Pressure"
                          )}
                        </div>
                      }
                      value={
                        complianceSettings.AirPermeability_test_pressure || ""
                      }
                      onChange={(value) => {
                        setComplianceSettings({
                          AirPermeability_test_pressure:
                            value === ""
                              ? undefined
                              : (value as "Standard" | "Pulse test only"),
                        });
                      }}
                      options={[
                        { value: "Standard", label: "Standard" },
                        { value: "Pulse test only", label: "Pulse test only" },
                      ]}
                      placeholder="Select test pressure..."
                      variant="ghost"
                      size="md"
                    />

                    <StandardInput
                      type="number"
                      unit={complianceFieldUnit("AirPermeability_test_result", "Test Result")}
                      label={
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>Test Result</span>
                          {comparisonGlobalFieldIndicators.AirPermeability_test_result
                            ?.length ? (
                            <ValidationIndicator
                              hasIssues
                              issues={
                                comparisonGlobalFieldIndicators.AirPermeability_test_result
                              }
                              size="small"
                              variant="info"
                            />
                          ) : null}
                          {renderEvidencePill(
                            "AirPermeability_test_result",
                            "Test Result"
                          )}
                        </div>
                      }
                      value={
                        complianceSettings.AirPermeability_test_result?.toString() ||
                        ""
                      }
                      onChange={(e) => {
                        const val =
                          e.target.value === ""
                            ? undefined
                            : parseFloat(e.target.value);
                        setComplianceSettings({
                          AirPermeability_test_result: isNaN(val || 0)
                            ? undefined
                            : val,
                        });
                      }}
                      min="0"
                      step="0.1"
                      variant="ghost"
                      size="md"
                    />
                  </div>
                )}
              </div>

              {/* Ventilation Environment Settings Section */}
              <div
                style={{
                  marginTop: "var(--spacing-md)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "var(--spacing-md)",
                }}
              >
                <div
                  onClick={() =>
                    setVentilationEnvExpanded(!ventilationEnvExpanded)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                    padding: "var(--spacing-sm)",
                    borderRadius: "var(--radius-md)",
                    background: ventilationEnvExpanded
                      ? "var(--bg-secondary)"
                      : "transparent",
                    transition: "var(--transition-colors)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "var(--font-weight-semibold)",
                      fontSize: "var(--font-size-md)",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                  >
                    Ventilation Environment
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <GlobalSettingsCollapsedIssueBadges
                      expanded={ventilationEnvExpanded}
                      errorCount={0}
                      infoCount={comparisonGlobalSections.ventilation.length}
                    />
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      style={{
                        transform: ventilationEnvExpanded
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                        transition: "transform var(--transition-normal) ease",
                      }}
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
                <GlobalSettingsSectionValidationStrip
                  expanded={ventilationEnvExpanded}
                  errorIssues={[]}
                  infoIssues={comparisonGlobalSections.ventilation}
                />

                {ventilationEnvExpanded && (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--spacing-md)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        marginBottom: "var(--spacing-sm)",
                      }}
                    >
                      Site exposure, terrain, and ventilation zone dimensions
                      that affect wind pressure and infiltration calculations.
                      These override the defaults template values.
                    </div>

                    <div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--spacing-xs)",
                        }}
                      >
                        <StandardInput
                          type="number"
                          unit={complianceFieldUnit("AirPermeability_ventilation_zone_height", "Ventilation Zone Height (m)")}
                          label={
                            <>
                              {complianceFieldLabel(
                                "Ventilation Zone Height (m)",
                                "AirPermeability_ventilation_zone_height"
                              )}
                              {suggestedVentHeight > 0 && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 400,
                                    marginLeft: 6,
                                    color: isVentHeightManualOverride
                                      ? "var(--text-warning)"
                                      : "var(--text-muted)",
                                  }}
                                >
                                  {isVentHeightManualOverride
                                    ? "(manual override)"
                                    : "(auto)"}
                                </span>
                              )}
                              {renderEvidencePill(
                                "AirPermeability_ventilation_zone_height",
                                "Ventilation Zone Height"
                              )}
                            </>
                          }
                          value={
                            isVentHeightManualOverride
                              ? complianceSettings.AirPermeability_ventilation_zone_height!.toString()
                              : suggestedVentHeight > 0
                              ? suggestedVentHeight.toString()
                              : ""
                          }
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              setComplianceSettings({
                                AirPermeability_ventilation_zone_height:
                                  undefined,
                              });
                              return;
                            }
                            const val = parseFloat(raw);
                            if (isNaN(val)) {
                              setComplianceSettings({
                                AirPermeability_ventilation_zone_height:
                                  undefined,
                              });
                            } else {
                              setComplianceSettings({
                                AirPermeability_ventilation_zone_height:
                                  suggestedVentHeight > 0 &&
                                  Math.abs(val - suggestedVentHeight) < 1e-9
                                    ? undefined
                                    : val,
                              });
                            }
                          }}
                          placeholder={
                            suggestedVentHeight > 0
                              ? suggestedVentHeight.toString()
                              : "No zone heights set"
                          }
                          min="0"
                          step="0.1"
                          variant="ghost"
                          size="md"
                          helperText={
                            suggestedVentHeight > 0
                              ? `Total building height (sum of floor heights): ${suggestedVentHeight} m`
                              : "Draw wall elements to auto-derive"
                          }
                        />
                        {isVentHeightManualOverride &&
                          suggestedVentHeight > 0 && (
                            <ResetFieldButton
                              onClick={() =>
                                setComplianceSettings({
                                  AirPermeability_ventilation_zone_height:
                                    undefined,
                                })
                              }
                              title={`Reset to suggested ventilation zone height (${suggestedVentHeight} m)`}
                              ariaLabel="Reset ventilation zone height to suggested value"
                              align="input-row"
                            />
                          )}
                      </div>
                      {isVentHeightManualOverride &&
                        suggestedVentHeight > 0 &&
                        Math.abs(
                          complianceSettings.AirPermeability_ventilation_zone_height! -
                            suggestedVentHeight
                        ) > 0.1 && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-warning)",
                              background:
                                "var(--surface-warning, rgba(255, 165, 0, 0.08))",
                              border:
                                "1px solid var(--border-warning, rgba(255, 165, 0, 0.25))",
                              borderRadius: 4,
                              padding: "4px 8px",
                              marginTop: 4,
                            }}
                          >
                            ⚠ Ventilation zone height (
                            {
                              complianceSettings.AirPermeability_ventilation_zone_height
                            }{" "}
                            m) differs from total building height (
                            {suggestedVentHeight} m). Check this is intentional.
                          </div>
                        )}
                    </div>

                    <StandardDropdown
                      label="Shield Class"
                      value={complianceSettings.Ventilation_shield_class || ""}
                      onChange={(value) => {
                        const val =
                          value === ""
                            ? undefined
                            : (value as "Open" | "Normal" | "Shielded");
                        setComplianceSettings({
                          Ventilation_shield_class: val,
                        });
                      }}
                      options={[
                        { value: "", label: "Normal (default)" },
                        { value: "Open", label: "Open" },
                        { value: "Normal", label: "Normal" },
                        { value: "Shielded", label: "Shielded" },
                      ]}
                      variant="ghost"
                      size="md"
                      helperText="Wind exposure of the building facade"
                    />

                    <StandardDropdown
                      label="Terrain Class"
                      value={complianceSettings.Ventilation_terrain_class || ""}
                      onChange={(value) => {
                        const val =
                          value === ""
                            ? undefined
                            : (value as
                                | "OpenWater"
                                | "OpenField"
                                | "Suburban"
                                | "Urban");
                        setComplianceSettings({
                          Ventilation_terrain_class: val,
                        });
                      }}
                      options={[
                        { value: "", label: "Open Field (default)" },
                        { value: "OpenWater", label: "Open Water" },
                        { value: "OpenField", label: "Open Field" },
                        { value: "Suburban", label: "Suburban" },
                        { value: "Urban", label: "Urban" },
                      ]}
                      variant="ghost"
                      size="md"
                      helperText="Surrounding terrain affecting wind speed profile"
                    />

                    <StandardInput
                      type="number"
                      unit={complianceFieldUnit("Ventilation_altitude", "Altitude (m)")}
                      label={complianceFieldLabel("Altitude (m)", "Ventilation_altitude")}
                      value={
                        complianceSettings.Ventilation_altitude?.toString() ||
                        ""
                      }
                      onChange={(e) => {
                        const val =
                          e.target.value === ""
                            ? undefined
                            : parseFloat(e.target.value);
                        setComplianceSettings({
                          Ventilation_altitude:
                            val !== undefined && isNaN(val) ? undefined : val,
                        });
                      }}
                      min="0"
                      step="1"
                      variant="ghost"
                      size="md"
                      placeholder="30 (default)"
                      helperText="Height above sea level (m)"
                    />

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--spacing-xs)",
                      }}
                    >
                      <StandardInput
                        type="number"
                        unit={complianceFieldUnit("Ventilation_ventilation_zone_base_height", "Ventilation Zone Base Height (m)")}
                        label={
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              flexWrap: "wrap",
                            }}
                          >
                            {complianceFieldLabel(
                              "Ventilation Zone Base Height (m)",
                              "Ventilation_ventilation_zone_base_height"
                            )}
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 400,
                                color: isVentBaseHeightManualOverride
                                  ? "var(--text-warning)"
                                  : "var(--text-muted)",
                              }}
                            >
                              {isVentBaseHeightManualOverride
                                ? "(manual override)"
                                : "(auto)"}
                            </span>
                            {renderEvidencePill(
                              "Ventilation_ventilation_zone_base_height",
                              "Ventilation Zone Base Height"
                            )}
                          </div>
                        }
                        value={
                          isVentBaseHeightManualOverride
                            ? complianceSettings.Ventilation_ventilation_zone_base_height!.toString()
                            : suggestedVentBaseHeight.toString()
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setComplianceSettings({
                              Ventilation_ventilation_zone_base_height:
                                undefined,
                            });
                            return;
                          }
                          const val = parseFloat(raw);
                          if (isNaN(val)) {
                            setComplianceSettings({
                              Ventilation_ventilation_zone_base_height:
                                undefined,
                            });
                            return;
                          }
                          setComplianceSettings({
                            Ventilation_ventilation_zone_base_height:
                              Math.abs(val - suggestedVentBaseHeight) < 1e-9
                                ? undefined
                                : val,
                          });
                        }}
                        min="-150"
                        max="750"
                        step="0.1"
                        variant="ghost"
                        size="md"
                        placeholder={suggestedVentBaseHeight.toString()}
                        helperText="Height from external ground to the base of the ventilation zone"
                      />
                      {isVentBaseHeightManualOverride && (
                        <ResetFieldButton
                          onClick={() =>
                            setComplianceSettings({
                              Ventilation_ventilation_zone_base_height:
                                undefined,
                            })
                          }
                          title={`Reset to suggested ventilation zone base height (${suggestedVentBaseHeight} m)`}
                          ariaLabel="Reset ventilation zone base height to suggested value"
                          align="input-row"
                        />
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--spacing-sm)",
                      }}
                    >
                      <input
                        type="checkbox"
                        id="noise_nuisance"
                        checked={
                          complianceSettings.Ventilation_noise_nuisance ?? false
                        }
                        onChange={(e) => {
                          setComplianceSettings({
                            Ventilation_noise_nuisance: e.target.checked,
                          });
                        }}
                        style={{ margin: 0 }}
                      />
                      <label
                        htmlFor="noise_nuisance"
                        style={{
                          fontSize: "var(--font-size-sm)",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                        }}
                      >
                        Noise nuisance{" "}
                        <span
                          style={{
                            color: "var(--text-muted)",
                            fontWeight: "var(--font-weight-normal)",
                          }}
                        >
                          (default: off)
                        </span>
                      </label>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: -8,
                      }}
                    >
                      Whether external noise limits window opening for cooling
                    </div>
                  </div>
                )}
              </div>

              {/* Thermal Bridging Settings Section */}
              <div
                style={{
                  marginTop: "var(--spacing-md)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "var(--spacing-md)",
                }}
              >
                <div
                  onClick={() =>
                    setThermalBridgingExpanded(!thermalBridgingExpanded)
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                    padding: "var(--spacing-sm)",
                    borderRadius: "var(--radius-md)",
                    background: thermalBridgingExpanded
                      ? "var(--bg-secondary)"
                      : "transparent",
                    transition: "var(--transition-colors)",
                  }}
                >
                  <span
                    style={{
                      fontWeight: "var(--font-weight-semibold)",
                      fontSize: "var(--font-size-md)",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                  >
                    Thermal Bridging
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{
                      transform: thermalBridgingExpanded
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      transition: "transform var(--transition-normal) ease",
                      flexShrink: 0,
                    }}
                  >
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                {thermalBridgingExpanded && (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--spacing-md)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        marginBottom: "var(--spacing-sm)",
                      }}
                    >
                      Heat loss through junctions (W/K per zone) when you are
                      not using individual thermal bridge elements. If zones are
                      merged, these values add together.
                    </div>
                    <StandardInput
                      type="number"
                      unit={complianceFieldUnit("defaultThermalBridging", "Fallback heat loss (W/K)")}
                      label={
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {complianceFieldLabel(
                            "Fallback heat loss (W/K)",
                            "defaultThermalBridging"
                          )}
                          {renderEvidencePill(
                            "defaultThermalBridging",
                            "Default Thermal Bridging"
                          )}
                        </div>
                      }
                      value={defaultThermalBridging.toString()}
                      onChange={(e) => {
                        const inputValue = e.target.value;
                        if (inputValue === "" || inputValue === ".") {
                          // Allow empty or partial decimal input
                          return;
                        }
                        const parsed = parseFloat(inputValue);
                        if (!isNaN(parsed) && parsed >= 0) {
                          setDefaultThermalBridging(parsed);
                        }
                      }}
                      onBlur={(e) => {
                        // On blur, ensure we have a valid value or default to 0.20
                        const inputValue = e.target.value;
                        if (
                          inputValue === "" ||
                          isNaN(parseFloat(inputValue))
                        ) {
                          setDefaultThermalBridging(0.2);
                        }
                      }}
                      min="0"
                      step="0.01"
                      variant="ghost"
                      size="md"
                    />

                    {externalDetailProfileSection}

                    <details
                      open={junctionPsiFallbackExpanded}
                      onToggle={(event) =>
                        setJunctionPsiFallbackExpanded(event.currentTarget.open)
                      }
                      style={{
                        borderTop: "1px solid var(--border-subtle)",
                        paddingTop: 10,
                      }}
                    >
                      <summary
                        style={{
                          cursor: "pointer",
                          color: "var(--text-secondary)",
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.35,
                        }}
                      >
                        Advanced fallback ψ source · {junctionPsiFallbackLabel}
                      </summary>
                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                          }}
                        >
                          Optional CSV under{" "}
                          <code style={{ fontSize: 10 }}>
                            {JUNCTION_PSI_DEFAULTS_DIR}/
                          </code>
                          . Omitted rows use Table 3.7. Reference:{" "}
                          <code style={{ fontSize: 10 }}>
                            {DEFAULT_JUNCTION_PSI_CSV_RELATIVE_PATH}
                          </code>
                          .
                        </div>
                        {defaultsCheckReady ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              alignItems: "stretch",
                            }}
                          >
                            <StandardDropdown
                              value={junctionPsiDefaultsPath || ""}
                              onChange={(v) =>
                                setJunctionPsiDefaultsPath(v || undefined)
                              }
                              options={junctionPsiDropdownOptions}
                              variant="ghost"
                              size="md"
                            />
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                                alignItems: "center",
                              }}
                            >
                              <button
                                type="button"
                                className="btn btn-ghost btn-small"
                                disabled={
                                  !(junctionPsiDefaultsPath || "").trim() ||
                                  junctionPsiDefaultsLoading
                                }
                                onClick={() =>
                                  void openJunctionPsiDefaultsCsv()
                                }
                              >
                                Open CSV
                              </button>
                              {junctionPsiDefaultsLoading && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  Loading…
                                </span>
                              )}
                            </div>
                            {junctionPsiDefaultsError ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-danger, #f87171)",
                                }}
                              >
                                {junctionPsiDefaultsError}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div
                            style={{ fontSize: 11, color: "var(--text-muted)" }}
                          >
                            Open a workspace folder first to use a junction ψ
                            table.
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
