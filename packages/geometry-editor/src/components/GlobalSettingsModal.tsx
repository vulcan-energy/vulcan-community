// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { targetRules, targetSchemaMode } from '../../../geometry-editor-host/src/schemaPort';
import { targetValidationFlags } from '../geometry/validation/validateElement';
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
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
import { targetFieldAvailability } from "../lib/schemaCache";
import { HEMIE_NATION, NATIONS, postcodeBorderArea, postcodeUnrecognised } from "../lib/hemieFabric";
import { SourceNote } from "./FieldSource";
import { calculateDwellingLengthWidthFromGroundElements } from "../lib/buildingFootprintDimensions";

import { resolveFieldPresentation } from "../lib/fieldPresentation";
import {
  unsetMetadataInputIssues,
  collectGlobalSettingsWarnings,
  fhsBedroomCountIssue,
  globalSettingsFieldSection,
  METADATA_INPUT_LABELS,
  smartMeterGuidIssue,
  type TargetInputRow,
  targetBuildTypes,
  buildTypeHasStoreyRows,
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
import { FabricTable } from "./FabricTable";
import { FabricTabCloseContext } from "./fabricTabCloseContext";
import { ModalHeader } from "./ModalHeader";
import { ResetFieldButton } from "./ResetFieldButton";
import { StandardDropdown } from "./StandardDropdown";
import { StandardInput } from "./StandardInput";
import { Tooltip } from "./Tooltip";
import { ValidationIndicator, ValidationPill } from "./ValidationIndicator";
import { useKeyedState } from "../hooks/useKeyedState";
import { useTargetRules } from "../hooks/useTargetRules";
import { getElementEffectiveArea } from "../lib/elementArea";

/** Global Settings rows of HEMIE's leakage-estimate inputs (hemie.rs `leakage_estimate_inputs`). */
const HEMIE_OPEN_FIREPLACES = "HEMIE_number_of_open_fireplaces";
const HEMIE_DOUBLE_GLAZING_PERIOD = "HEMIE_double_glazing_installation_period";
const HEMIE_HEAT_LOSS_CORRIDOR = "HEMIE_heat_loss_corridor";

/** Element types the converter counts in the envelope area (a party adjacent element counts too). */
const ENVELOPE_TYPES: ReadonlySet<string> = new Set(["BuildingElementOpaque", "BuildingElementTransparent", "BuildingElementGround",
  "BuildingElementPartyWall", "BuildingElementAdjacentUnconditionedSpace_Simple"]);

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
  calculationTargetSection?: ReactNode;
  /** Host groups at the end of the Fabric tab, such as emitter defaults. */
  defaultsSection?: ReactNode;
  /** An existing building's fabric (age band and constructions): the Fabric tab's body under construction bands. */
  fabricSection?: ReactNode;
  renderEvidencePill?: (fieldKey: string, label: string) => ReactNode;
  externalDetailProfileSection?: ReactNode;
  onIndicatorChange?: (indicator: GlobalSettingsIndicator | null) => void;
  /** A CSV Metadata key: on open, its tab and section open and its field scrolls into view and takes focus. */
  focusFieldKey?: string;
}>;

const ROOM_COUNT_COMPLIANCE_ROWS: {
  field: DwellingCountField;
  label: string;
  evidenceShort: string;
  comparisonFieldKey?: "NumberOfBedrooms" | "NumberOfWetRooms";
}[] = [
  {
    field: "NumberOfBedrooms",
    label: "Number of bedrooms",
    evidenceShort: "Number of bedrooms",
    comparisonFieldKey: "NumberOfBedrooms",
  },
  {
    field: "NumberOfWetRooms",
    label: "Number of wet rooms",
    evidenceShort: "Number of wet rooms",
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

// Shared models store their defaults by content hash; the raw path means nothing to a reader.
const CONTENT_HASH_DEFAULTS_PATH = /^input\/defaults\/([0-9a-f]{64})\.json$/;

function contentHashDefaultsShortHash(path: string): string | undefined {
  return CONTENT_HASH_DEFAULTS_PATH.exec(path)?.[1]?.slice(0, 8);
}

/** The files the sample library ships, by the name people know them by. */
const BUILT_IN_FABRIC_FILES: Readonly<Record<string, string>> = {
  "input/defaults/defaults_template.json": "Standard template",
  "input/defaults/defaults_template_epc.json": "EPC template",
  "input/defaults/defaults_partyL2021.json": "Part L 2021",
  "input/defaults/defaults_targetHEMCaseStudy.json": "HEM case study",
};

/** A defaults file as words, never its path or content hash: "my_spec.json" -> "My spec". */
function defaultsFileLabel(path: string): string {
  if (BUILT_IN_FABRIC_FILES[path]) return BUILT_IN_FABRIC_FILES[path];
  if (contentHashDefaultsShortHash(path)) return "This model's defaults";
  const words = (path.split("/").pop() ?? path).replace(/\.json$/, "").replace(/_/g, " ").replace(/\bepc\b/gi, "EPC");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function defaultsFileTag(path: string): string {
  if (BUILT_IN_FABRIC_FILES[path]) return "built-in";
  return contentHashDefaultsShortHash(path) ? "shared model" : "your copy";
}

/** What a defaults file is for, from its content: an HEM:EPC file states IsExistingBuilding. */
type DefaultsFileFacts = Readonly<{ family?: "epc" | "fhs"; runsOnTarget?: boolean }>;
function defaultsFileFamily(text: string): DefaultsFileFacts["family"] {
  try {
    const json: unknown = JSON.parse(text);
    if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
    if ("IsExistingBuilding" in json) return "epc";
    return "Zone" in json ? "fhs" : undefined;
  } catch {
    return undefined;
  }
}


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

type RequiredYesNoKey = TargetInputRow | "PartGcompliance" | "Ventilation_noise_nuisance";
const APPLIANCE_ROWS = ["Appliances_has_dryer", "Appliances_has_dishwasher", "Appliances_has_separate_fridge_or_freezer"] as const;

/** An issue as Global Settings itself shows it: no pointer back to Global Settings. */
const inGlobalSettingsWords = (issue: string) =>
  issue.replace(/^Global Settings: /, "").replace(" Enter it in Global Settings.", " Enter it below.");

/** A TRUE or FALSE row the target requires: empty until the user picks, never a box that reads as "no". */
function RequiredYesNo({ label, value, onChange, placeholder = "Select..." }: {
  label: ReactNode;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
  placeholder?: string;
}) {
  return (
    <StandardDropdown
      label={label}
      value={value === undefined ? "" : value ? "TRUE" : "FALSE"}
      onChange={(next) => onChange(next === "" ? undefined : next === "TRUE")}
      options={[{ value: "TRUE", label: "Yes" }, { value: "FALSE", label: "No" }]}
      placeholder={placeholder}
      variant="ghost"
      size="md"
    />
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
      data-field-key={paramId}
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

function GlobalSettingsAccordionHeader({
  title,
  expanded,
  onToggle,
  errorCount,
  warningCount,
  infoCount,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  errorCount: number;
  warningCount?: number;
  infoCount: number;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        cursor: "pointer",
        padding: "var(--spacing-sm)",
        borderRadius: "var(--radius-md)",
        background: expanded ? "var(--bg-secondary)" : "transparent",
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
        {title}
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
          expanded={expanded}
          errorCount={errorCount}
          warningCount={warningCount}
          infoCount={infoCount}
        />
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
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

/** `semi_detached_end_terrace` as "Semi detached end terrace". */
const buildTypeLabel = (type: string) => {
  if (type === "semi_detached_end_terrace") return "Semi-detached or end-terrace";
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function GlobalSettingsModal({
  isOpen,
  onClose,
  workspaceResourcePort,
  fallbackDefaultsPath,
  inspectDefaultsCompatibility,
  onEditDefaults,
  evidenceSection,
  calculationTargetSection,
  defaultsSection,
  fabricSection,
  renderEvidencePill = () => null,
  externalDetailProfileSection,
  onIndicatorChange,
  focusFieldKey,
}: GlobalSettingsModalProps) {
  const schemaPort = useGeometrySchemaPort();
  const targetRoot = schemaPort.availability === "available" ? schemaPort.getRootSchema(targetSchemaMode(schemaPort)) : null;
  // Dwelling fields show only where the target's root schema has them; no schema says nothing.
  const roomCountRows = useMemo(
    () => ROOM_COUNT_COMPLIANCE_ROWS.filter((row) => targetFieldAvailability(targetRoot, [row.field]) !== "absent"),
    [targetRoot],
  );
  const showGroundFloorArea = targetFieldAvailability(targetRoot, ["GroundFloorArea"]) !== "absent";
  const showPartOCooling = targetFieldAvailability(targetRoot, ["PartO_active_cooling_required"]) !== "absent";
  const showKitchenHood = targetFieldAvailability(targetRoot, ["KitchenExtractorHoodExternal"]) !== "absent";
  const showBuildingLength = targetFieldAvailability(targetRoot, ["BuildingLength"]) !== "absent";
  const showBuildingWidth = targetFieldAvailability(targetRoot, ["BuildingWidth"]) !== "absent";
  const { requiredMetadataRows, storeyBuildTypes, desnzDefaultRows, derivedMetadataRows, fhsInputRules } = useTargetRules();
  const requiredRows = useMemo(() => new Set(requiredMetadataRows), [requiredMetadataRows]);
  // HEM:EPC reads neither the SAP built form nor the thermal bridging settings of an existing building.
  const epcTarget = requiredMetadataRows.includes("IsExistingBuilding");
  // Dwelling fields show only where the target's root schema has them (no schema says nothing).
  // HEM:EPC's schema states no storey row, but a flat or maisonette still takes one (`storeyBuildTypes`).
  const showStoreyOfDwelling = epcTarget || targetFieldAvailability(targetRoot, ["General", "storey_of_dwelling"]) !== "absent";
  const derivedRows = useMemo(() => new Set(derivedMetadataRows), [derivedMetadataRows]);
  const sourceComparisonPort = useGeometrySourceComparisonPort();
  const sourceComparisonSnapshot = useSyncExternalStore(
    sourceComparisonPort.subscribe,
    sourceComparisonPort.getSnapshot,
    sourceComparisonPort.getSnapshot
  );
  const {
    zones,
    elementsById,
    elementIds,
    defaultsPath,
    propertyPostcode,
    complianceSettings,
    floors,
    globalOrientationOffset,
    junctionPsiDefaultsPath,
    junctionPsiDefaultsError,
    junctionPsiDefaultsLoading,
    spaceLabelIds,
    spaceLabelsById,
    defaultsJson,
  } = useGeometryStore(
    useShallow((state) => ({
      zones: state.zones,
      elementsById: state.elementsById,
      elementIds: state.elementIds,
      defaultsPath: state.defaultsPath,
      propertyPostcode: state.propertyPostcode,
      complianceSettings: state.complianceSettings,
      floors: state.floors,
      globalOrientationOffset: state.globalOrientationOffset,
      junctionPsiDefaultsPath: state.junctionPsiDefaultsPath,
      junctionPsiDefaultsError: state.junctionPsiDefaultsError,
      junctionPsiDefaultsLoading: state.junctionPsiDefaultsLoading,
      spaceLabelIds: state.spaceLabelIds,
      spaceLabelsById: state.spaceLabelsById,
      defaultsJson: state.defaultsLoading ? undefined : state.defaultsJson,
    }))
  );
  const setDefaultsPath = useGeometryStore((state) => state.setDefaultsPath);
  const pinnedDefaultsPath = useGeometryStore((state) => state.pinnedDefaultsPath(state.targetBundleId));
  const setPropertyPostcode = useGeometryStore(
    (state) => state.setPropertyPostcode
  );
  const setJunctionPsiDefaultsPath = useGeometryStore(
    (state) => state.setJunctionPsiDefaultsPath
  );
  const setComplianceSettings = useGeometryStore(
    (state) => state.setComplianceSettings
  );
  // Under construction bands the host's fabric defaults replace the default assemblies.
  const { constructionBands, hemDatabaseProducts } = targetRules(schemaPort, complianceSettings);
  // The drawn envelope area, as the converter sums it when the model states none.
  const drawnEnvelopeArea = useMemo(() => {
    let sum = 0;
    for (const element of Object.values(elementsById)) {
      const party = (element.extra_json as Record<string, unknown> | undefined)?._vulcan_ui_party_element === true;
      if (ENVELOPE_TYPES.has(element.type) || (element.type === 'BuildingElementAdjacentConditionedSpace' && party)) {
        sum += getElementEffectiveArea(element, elementsById, floors, globalOrientationOffset);
      }
    }
    return Math.round(sum * 10) / 10;
  }, [elementsById, floors, globalOrientationOffset]);
  const borderArea = postcodeBorderArea(propertyPostcode);
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
  // DESNZ question E17: an existing building with no air test gives HEMIE's leakage-estimate inputs.
  const estimatedAirtightness =
    epcTarget && complianceSettings.IsExistingBuilding === true && complianceSettings.AirPermeability_test_result === undefined;
  const setHemieSetting = (key: string, value: string) => {
    const others = { ...complianceSettings.hemieSettings };
    delete others[key];
    setComplianceSettings({ hemieSettings: value === "" ? others : { ...others, [key]: value } });
  };
  const requiredYesNoProps = (key: RequiredYesNoKey, label = METADATA_INPUT_LABELS[key] ?? key) => ({
    label: complianceFieldLabel(label, key),
    value: complianceSettings[key],
    onChange: (value: boolean | undefined) => setComplianceSettings({ [key]: value }),
  });
  const complianceFieldUnit = (paramId: string, label = paramId) => {
    const presentation = complianceFieldPresentation(paramId, label);
    return presentation.unit.status === "resolved" ? presentation.unit.display : undefined;
  };

  const [activeTab, setActiveTab] = useState<"fabric" | "settings">(
    "fabric"
  );
  const [defaultsList, setDefaultsList] = useState<{
    available: string[];
    compatibility: Map<string, GlobalSettingsDefaultsCompatibility>;
    facts: Map<string, DefaultsFileFacts>;
  }>({ available: [], compatibility: new Map(), facts: new Map() });
  const { available: availableDefaults, compatibility: compatibilityMap, facts: defaultsFacts } = defaultsList;
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
  const dwellingDetailsSuggestion = useMemo(
    () => calculateDwellingDetailsSuggestion(Object.values(elementsById)),
    [elementsById]
  );
  // A file's build type the editor cannot hold (an HEM:EPC built form) is shown and saved as is.
  const fileBuildType =
    complianceSettings.unreadMetadataRows?.General_build_type || undefined;
  const effectiveBuildType =
    complianceSettings.build_type ?? dwellingDetailsSuggestion.buildType;
  // The target's build types; the geometry's suggestion only where the target takes it.
  const buildTypes = targetBuildTypes(targetRoot);
  const suggestedBuildType =
    dwellingDetailsSuggestion.buildType && buildTypes.includes(dwellingDetailsSuggestion.buildType)
      ? dwellingDetailsSuggestion.buildType
      : undefined;
  const shownBuildType = complianceSettings.build_type ?? fileBuildType ?? suggestedBuildType;
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

  const loadDefaultsList = useCallback(async (): Promise<{
    available: string[];
    compatibility: Map<string, GlobalSettingsDefaultsCompatibility>;
    facts: Map<string, DefaultsFileFacts>;
  }> => {
    if (!defaultsCheckReady) {
      return { available: [], compatibility: new Map(), facts: new Map() };
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
      const facts = new Map<string, DefaultsFileFacts>();
      // A pinned target runs only its own defaults, byte for byte (target preparation checks the hash).
      const pinnedText = pinnedDefaultsPath
        ? await workspaceResourcePort.readText(pinnedDefaultsPath).catch(() => undefined)
        : undefined;
      for (const path of sorted) {
        let text: string;
        try {
          text = await workspaceResourcePort.readText(path);
        } catch {
          if (inspectDefaultsCompatibility) {
            nextCompatibility.set(path, {
              warnings: ["File cannot be read"],
              foundTypes: [],
              hasRequiredRootSections: false,
            });
          }
          continue;
        }
        if (inspectDefaultsCompatibility) nextCompatibility.set(path, inspectDefaultsCompatibility(text));
        facts.set(path, {
          family: defaultsFileFamily(text),
          runsOnTarget: pinnedText === undefined ? undefined : text === pinnedText,
        });
      }
      return { available: sorted, compatibility: nextCompatibility, facts };
    } catch (error) {
      console.warn("[GlobalSettingsModal] refresh defaults failed", error);
      return { available: [], compatibility: new Map(), facts: new Map() };
    }
  }, [
    defaultsCheckReady,
    effectiveDefaultsPath,
    fallbackDefaultsPath,
    inspectDefaultsCompatibility,
    pinnedDefaultsPath,
    workspaceResourcePort,
  ]);

  // The target's fabric files: an EPC target lists HEM:EPC files, any other the FHS ones. Files for
  // another target, and files with no model in them, are left out; the file in use always shows, first.
  const defaultsListForDisplay = useMemo(() => {
    const effective = (selectedDefaults || effectiveDefaultsPath).trim();
    const family = epcTarget ? "epc" : "fhs";
    const filtered = availableDefaults.filter((path) => path !== effective && defaultsFacts.get(path)?.family === family);
    return effective ? [effective, ...filtered] : filtered;
  }, [
    availableDefaults,
    defaultsFacts,
    effectiveDefaultsPath,
    selectedDefaults,
    epcTarget,
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
      if (!cancelled) setDefaultsList(next);
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
        `Defaults file not found: ${defaultsFileLabel(
          selectedDefaults || effectiveDefaultsPath
        )}`,
      ],
    };
  }, [effectiveDefaultsPath, selectedDefaults, selectedExists]);

  // The defaults file a model cannot run with, in words, with the way back to the target's own file.
  const defaultsFileProblem = !defaultsCheckReady
    ? undefined
    : !effectiveDefaultsPath
      ? "This model has no defaults file."
      : selectedExists === false
        ? `The defaults file "${defaultsFileLabel(effectiveDefaultsPath)}" is missing.`
        : defaultsFacts.get(effectiveDefaultsPath)?.runsOnTarget === false
          ? defaultsFacts.get(effectiveDefaultsPath)?.family === (epcTarget ? "epc" : "fhs")
            ? `The defaults file "${defaultsFileLabel(effectiveDefaultsPath)}" differs from the one this HEM version runs, so the model does not run.`
            : `The defaults file "${defaultsFileLabel(effectiveDefaultsPath)}" is for another target, so the model does not run.`
          : undefined;

  const fhsComplianceRequiredIssues = useMemo(() => {
    const issues: string[] = [];
    // Every model-input row the save would leave out: the same check that blocks the model.
    issues.push(...unsetMetadataInputIssues(
      { zones, elementsById, spaceLabelsById, spaceLabelIds, complianceSettings, floors, elements: Object.values(elementsById) },
      targetRoot,
      defaultsJson,
      { requiredMetadataRows, storeyBuildTypes, desnzDefaultRows, derivedMetadataRows },
    ));
    const bedroomCountIssue = fhsBedroomCountIssue(
      complianceSettings.NumberOfBedrooms
    );
    if (bedroomCountIssue) {
      issues.push(bedroomCountIssue);
    }
    if (
      typeof effectiveStoreysInDwelling === "number" &&
      effectiveStoreysInDwelling < 1
    ) {
      issues.push("Storeys in dwelling must be at least 1.");
    }
    if (
      buildTypeHasStoreyRows(targetRoot, shownBuildType, storeyBuildTypes) &&
      typeof complianceSettings.storeys_in_building === "number"
    ) {
      if (complianceSettings.storeys_in_building < 1) {
        issues.push("Storeys in building must be at least 1.");
      } else if (
        typeof effectiveStoreysInDwelling === "number" &&
        complianceSettings.storeys_in_building < effectiveStoreysInDwelling
      ) {
        issues.push(
          "Storeys in building should be greater than or equal to storeys in dwelling."
        );
      }
    }
    if (complianceSettings.ColdWaterSource === undefined) {
      issues.push("Global Settings: Cold water source is not set. Enter it in Global Settings.");
    }
    // One message per setting: a required row is also an unset model-input row.
    return [...new Set(issues)];
  }, [
    complianceSettings,
    shownBuildType,
    effectiveStoreysInDwelling,
    elementsById,
    floors,
    spaceLabelIds,
    spaceLabelsById,
    targetRoot,
    defaultsJson,
    requiredMetadataRows,
    storeyBuildTypes,
    desnzDefaultRows,
    derivedMetadataRows,
    zones,
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
        elements: elementIds.flatMap((id) => elementsById[id] ?? []),
        floors,
        zones,
        complianceValidationEnabled: targetValidationFlags(schemaPort, complianceSettings).complianceValidationEnabled,
        complianceSettings,
        globalOrientationOffset,
      }),
    [
      complianceSettings,
      schemaPort,
      elementsById,
      elementIds,
      floors,
      globalOrientationOffset,
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

  const titleId = useId();
  const containerRef = useRef<HTMLDialogElement | null>(null);
  // Focus lands inside the dialog on open so Escape reaches its key handler.
  const attachContainer = useCallback((el: HTMLDialogElement | null) => {
    containerRef.current = el;
    el?.focus();
  }, []);

  // focusFieldKey: a new request opens its tab and section during render; the effect
  // then scrolls to and focuses the field, also when they were already open.
  const focusRequest = isOpen ? focusFieldKey ?? null : null;
  const [focusRequestOpened, setFocusRequestOpened] = useKeyedState(focusRequest ?? "", false);
  if (focusRequest && !focusRequestOpened) {
    setFocusRequestOpened(true);
    const section = globalSettingsFieldSection(focusRequest);
    if (section) {
      setActiveTab(section === "fabric" ? "fabric" : "settings");
      if (section === "dwelling") setComplianceSettingsExpanded(true);
      if (section === "airTightness") setAirTightnessExpanded(true);
      if (section === "ventilation") setVentilationEnvExpanded(true);
      if (section === "thermalBridging") setThermalBridgingExpanded(true);
      if (focusRequest === "JunctionPsiDefaultsPath") setJunctionPsiFallbackExpanded(true);
    }
  }
  useEffect(() => {
    const container = containerRef.current;
    if (!focusRequest || !container) return;
    const target =
      container.querySelector(`[data-field-key="${CSS.escape(focusRequest)}"]`)
      ?? container.querySelector(`[data-field-section="${globalSettingsFieldSection(focusRequest)}"]`);
    target?.scrollIntoView?.({ block: "center" });
    target?.closest("label")?.control?.focus({ preventScroll: true });
  }, [focusRequest]);
  // Postcode, nation and build type: where a survey starts, so shown first on HEM:EPC and ahead of the
  // fabric on a construction-band target. A new-build EPC input has no postcode, so it is not shown there.
  const surveyFirst = epcTarget || constructionBands;
  // Closed, the modal only reports its indicator (above); the form below is built when open.
  if (!isOpen || typeof document === "undefined") return null;
  const surveyFields = (
    <>
      {epcTarget && !constructionBands ? null : <StandardInput
        type="text"
        label={<span data-field-key="Postcode">Property postcode</span>}
        value={propertyPostcode ?? ""}
        onChange={(event) => {
          const value = event.target.value.toUpperCase();
          setPropertyPostcode(value || undefined);
        }}
        placeholder="e.g. MK40 1AA"
        helperText={constructionBands
          ? "Sets the nation, which sets the years of each age band."
          : "Used only as property metadata in the SAP report. It does not select the native SAP calculator's climate data."}
        autoComplete="postal-code"
        error={constructionBands && postcodeUnrecognised(propertyPostcode) ? "Postcode not recognised" : undefined}
        variant="ghost"
        size="md"
      />}
      {constructionBands && borderArea ? (
        <StandardDropdown
          label={<span data-field-key={HEMIE_NATION}>Nation</span>}
          value={complianceSettings.hemieSettings?.[HEMIE_NATION] ?? ""}
          onChange={(value) => {
            const others = { ...complianceSettings.hemieSettings };
            delete others[HEMIE_NATION];
            setComplianceSettings({ hemieSettings: value ? { ...others, [HEMIE_NATION]: value } : others });
          }}
          options={NATIONS.map((nation) => ({ value: nation, label: nation }))}
          placeholder="Choose the nation"
          helperText={`Postcode area ${borderArea} spans two nations.`}
          variant="ghost"
          size="md"
        />
      ) : null}

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
              {shownBuildType && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 400,
                    color: isBuildTypeManual || fileBuildType
                      ? "var(--text-warning)"
                      : "var(--text-muted)",
                  }}
                >
                  {isBuildTypeManual || fileBuildType
                    ? "(set by you)"
                    : "(auto)"}
                </span>
              )}
            </div>
          }
          value={shownBuildType || ""}
          onChange={(value) => {
            if (value === shownBuildType) return;
            const next =
              value === ""
                ? undefined
                : value;
            const patch: Parameters<
              typeof setComplianceSettings
            >[0] = {
              build_type:
                next === suggestedBuildType
                  ? undefined
                  : next,
            };
            const nextEffectiveBuildType =
              next ?? suggestedBuildType;
            if (nextEffectiveBuildType !== undefined && !buildTypeHasStoreyRows(targetRoot, nextEffectiveBuildType, storeyBuildTypes)) {
              patch.storey_of_dwelling = undefined;
              patch.storeys_in_building = undefined;
            }
            // The user's choice replaces the file's build type.
            if (fileBuildType) {
              const unread = { ...complianceSettings.unreadMetadataRows };
              delete unread.General_build_type;
              patch.unreadMetadataRows = unread;
            }
            setComplianceSettings(patch);
          }}
          options={[
            {
              value: "",
              label: suggestedBuildType
                ? `Auto (${suggestedBuildType})`
                : derivedRows.has("General_build_type") ? "From the party walls" : "Select build type...",
            },
            ...buildTypes.map((type) => ({ value: type, label: buildTypeLabel(type) })),
            ...(fileBuildType && !complianceSettings.build_type && !buildTypes.includes(fileBuildType)
              ? [{ value: fileBuildType, label: fileBuildType }]
              : []),
          ]}
          placeholder="Select build type..."
          variant="ghost"
          size="md"
        />
        {isBuildTypeManual &&
          suggestedBuildType && (
            <ResetFieldButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setComplianceSettings({
                  build_type: undefined,
                  ...(suggestedBuildType ===
                  "house"
                    ? {
                        storey_of_dwelling: undefined,
                        storeys_in_building: undefined,
                      }
                    : {}),
                });
              }}
              title={`Reset to suggested build type (${suggestedBuildType})`}
              ariaLabel="Reset build type to suggested value"
              align="input-row"
            />
          )}
      </div>
    </>
  );


  return ReactDOM.createPortal(
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        // Escape from a portalled child dialog, or one an expanded combobox consumes, is not ours.
        const target = e.target as Element;
        if (!containerRef.current?.contains(target)) return;
        if (target.getAttribute("aria-expanded") === "true") return;
        onClose();
      }}
    >
      <dialog
        open
        ref={attachContainer}
        tabIndex={-1}
        className="modal-container"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div style={{ flexShrink: 0 }}>
          <ModalHeader
            title="Global Settings"
            titleId={titleId}
            onClose={() => onClose()}
          />
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
              aria-selected={activeTab === "fabric"}
              onClick={() => setActiveTab("fabric")}
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
                  activeTab === "fabric"
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                color:
                  activeTab === "fabric"
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
              <span>Fabric</span>
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
                    issues={settingsTabIndicator.issues.map(inGlobalSettingsWords)}
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
          {/* Fabric tab: what an element takes when it states no fabric of its own. */}
          {activeTab === "fabric" && (
            <FabricTabCloseContext value={onClose}>
              {defaultsFileProblem ? (
                <div
                  role="alert"
                  data-field-key="DefaultsPath"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "8px 10px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "var(--error-text)",
                  }}
                >
                  <span style={{ flex: "1 1 220px" }}>{defaultsFileProblem}</span>
                  {pinnedDefaultsPath && pinnedDefaultsPath !== effectiveDefaultsPath ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => {
                        setSelectedDefaults(pinnedDefaultsPath);
                        setDefaultsPath(pinnedDefaultsPath);
                      }}
                    >
                      Use the {defaultsFileLabel(pinnedDefaultsPath)}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {constructionBands ? (
                // An existing building's fabric is its age band and constructions; its defaults file has none.
                fabricSection
              ) : (
                <>
                  {/* A host that pins no target lets the model pick its defaults file; a pinned target runs only its own. */}
                  {pinnedDefaultsPath ? null : (
                  <>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-subtle)",
                      fontWeight: 500,
                      padding: "4px 0 0",
                    }}
                  >
                    Defaults file
                  </div>
                  <div
                    role="listbox"
                    aria-label="Defaults files"
                    style={{
                      maxHeight: 168,
                      flexShrink: 0,
                      overflow: "auto",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 4,
                      background: "var(--bg-secondary)",
                    }}
                  >
                    {!defaultsCheckReady ? (
                      <div style={{ padding: 8, fontSize: 12, color: "var(--text-subtle)" }}>
                        Use Files to choose or reconnect a workspace folder and list
                        default JSON files.
                      </div>
                    ) : defaultsListForDisplay.length === 0 ? (
                      <div style={{ padding: 8, fontSize: 12, color: "var(--text-subtle)" }}>
                        No JSON files found under input/defaults/
                      </div>
                    ) : (
                      defaultsListForDisplay.map((p) => {
                        const selected = p === selectedDefaults;
                        const compat = compatibilityMap.get(p);
                        const hasWarnings = !!compat?.warnings?.length;
                        return (
                          <div
                            key={p}
                            data-fabric-file={p}
                            title={p}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 10px",
                              cursor: "pointer",
                              background: selected ? "var(--row-highlight-bg)" : "transparent",
                              borderBottom: "1px solid var(--border-subtle)",
                              boxShadow: selected ? "inset 3px 0 0 var(--row-highlight-border)" : "none",
                              minWidth: 0,
                            }}
                            onClick={async () => {
                              if (selected) return;
                              setSelectedDefaults(p);
                              const ok = await workspaceResourcePort.exists(p).catch(() => false);
                              setSelectedExists(!!ok);
                              if (ok) setDefaultsPath(p);
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: "1 1 0",
                                minWidth: 0,
                              }}
                            >
                              {defaultsFileLabel(p)}
                              {selected && selectedExists === false ? (
                                <span style={{ color: "var(--error-text)", fontSize: 12, fontWeight: 400 }}> (not found)</span>
                              ) : null}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{defaultsFileTag(p)}</span>
                            {hasWarnings && (
                              <span
                                style={{ fontSize: 10, color: "var(--warning-text, #ff8c00)", flexShrink: 0 }}
                                title={`Template coverage only; the merged model determines compatibility: ${(compat?.warnings ?? []).join("; ")}`}
                              >
                                ⚠️
                              </span>
                            )}
                            {onEditDefaults ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-small"
                                title="Edit"
                                style={{ padding: "2px 6px", flexShrink: 0 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditDefaults(p, compat);
                                }}
                              >
                                <DefaultsEditIcon />
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                  </>
                  )}
                  <FabricTable
                    workspaceResourcePort={workspaceResourcePort}
                    family={epcTarget ? "epc" : "fhs"}
                    fileLabel={effectiveDefaultsPath ? defaultsFileLabel(effectiveDefaultsPath) : "Defaults file"}
                  />
                </>
              )}
              {defaultsSection}
            </FabricTabCloseContext>
          )}

          {/* Global Settings Tab */}
          {activeTab === "settings" && (
            <>
              {calculationTargetSection}

              {/* With the target: it decides which inputs and defaults the model takes. */}
              {surveyFirst ? <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)", marginBottom: "var(--spacing-md)" }}>{surveyFields}</div> : null}
              {requiredRows.has("IsExistingBuilding") && (
                <div data-field-section="target" style={{ marginBottom: "var(--spacing-md)" }}>
                  <RequiredYesNo {...requiredYesNoProps("IsExistingBuilding")} />
                </div>
              )}

              {/* Evidence linking for global settings */}
              {evidenceSection}

              {/* Dwelling Details Section */}
              <div data-field-section="dwelling" style={{ marginTop: "var(--spacing-md)" }}>
                <GlobalSettingsAccordionHeader
                  title="Dwelling details"
                  expanded={complianceSettingsExpanded}
                  onToggle={() =>
                    setComplianceSettingsExpanded(!complianceSettingsExpanded)
                  }
                  errorCount={fhsComplianceRequiredIssues.length}
                  warningCount={globalSettingsWarningIssues.length}
                  infoCount={complianceComparisonIssues.length}
                />
                <GlobalSettingsSectionValidationStrip
                  expanded={complianceSettingsExpanded}
                  errorIssues={fhsComplianceRequiredIssues.map(inGlobalSettingsWords)}
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
                      Configure dwelling-level details used by the
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
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--spacing-md)",
                        }}
                      >
                        {surveyFirst ? null : surveyFields}

                        {!epcTarget && (
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
                        )}

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
                                      ? "(set by you)"
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

                        {buildTypeHasStoreyRows(targetRoot, shownBuildType, storeyBuildTypes) && (
                          <>
                            {showStoreyOfDwelling && (
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
                                          ? "(set by you)"
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
                                helperText={epcTarget ? "The ground floor is 1." : undefined}
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
                            )}

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

                      {showPartOCooling && (
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
                      )}

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

                        {roomCountRows.map((row) => {
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
                                          ? "(set by you)"
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
                                // Unset, the save writes the space-label count: show it.
                                placeholder={dwellingRoomCounts ? String(derived) : undefined}
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

                      {showGroundFloorArea ? (
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
                      ) : null}

                      {showBuildingLength ? (
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
                      ) : null}

                      {showBuildingWidth ? (
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
                      ) : null}

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
                              "Heating control type",
                              "HeatingControlType"
                            )}
                            {renderEvidencePill(
                              "HeatingControlType",
                              "Heating control type"
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
                            label: "Separate temperature control",
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
                              "Cold water source",
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

                      {requiredRows.has("HasElectricitySmartMeter") && <RequiredYesNo {...requiredYesNoProps("HasElectricitySmartMeter")} />}
                      {requiredRows.has("HasElectricitySmartMeter") && (complianceSettings.HasElectricitySmartMeter === true || complianceSettings.ElectricitySmartMeterGUID) ? (
                        <StandardInput
                          type="text"
                          label={complianceFieldLabel("Smart meter GUID", "ElectricitySmartMeterGUID")}
                          value={complianceSettings.ElectricitySmartMeterGUID ?? ""}
                          onChange={(event) => setComplianceSettings({ ElectricitySmartMeterGUID: event.target.value.trim() || undefined })}
                          placeholder="e.g. 0A1B2C3D4E5F6071"
                          error={complianceSettings.ElectricitySmartMeterGUID ? smartMeterGuidIssue(complianceSettings, requiredRows)?.replace(/^Global Settings: /, "").replace(" Enter it in Global Settings.", "") : undefined}
                          variant="ghost"
                          size="md"
                        />
                      ) : null}
                      {requiredRows.has("PartGcompliance") ? <RequiredYesNo {...requiredYesNoProps("PartGcompliance", "Part G compliance")} /> : (
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
                          "Part G compliance",
                          "PartGcompliance"
                        )}
                        {renderEvidencePill(
                          "PartGcompliance",
                          "Part G compliance"
                        )}
                      </label>
                      )}
                      {APPLIANCE_ROWS.flatMap((key) => (requiredRows.has(key) ? [<RequiredYesNo key={key} {...requiredYesNoProps(key)} />] : []))}
                      {showKitchenHood && (
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
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Air Tightness Settings Section */}
              <div
                data-field-section="airTightness"
                style={{
                  marginTop: "var(--spacing-md)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "var(--spacing-md)",
                }}
              >
                <GlobalSettingsAccordionHeader
                  title="Air tightness"
                  expanded={airTightnessExpanded}
                  onToggle={() => setAirTightnessExpanded(!airTightnessExpanded)}
                  errorCount={0}
                  infoCount={comparisonGlobalSections.airTightness.length}
                />
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
                      The air test of the dwelling. The envelope area comes from
                      the element areas{hemDatabaseProducts ? " unless the report states it" : ""}.
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
                          <span data-field-key="AirPermeability_test_pressure">Test Pressure</span>
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
                        { value: "Standard", label: fhsInputRules ? "Standard" : "Blower door (50 Pa)" },
                        { value: "Pulse test only", label: fhsInputRules ? "Pulse test only" : "Pulse (4 Pa)" },
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
                          <span data-field-key="AirPermeability_test_result">Test Result</span>
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
                    {estimatedAirtightness && (
                      <>
                        <SourceNote>Estimated (no air test). HEM:EPC estimates the airtightness from the dwelling and these inputs.</SourceNote>
                        <StandardInput
                          type="number"
                          label={<span data-field-key={HEMIE_OPEN_FIREPLACES}>Open fireplaces</span>}
                          helperText="Fireplaces open to the outside, for example through a chimney."
                          value={complianceSettings.hemieSettings?.[HEMIE_OPEN_FIREPLACES] ?? ""}
                          onChange={(e) => setHemieSetting(HEMIE_OPEN_FIREPLACES, e.target.value)}
                          min="0"
                          step="1"
                          variant="ghost"
                          size="md"
                        />
                        <StandardDropdown
                          label={<span data-field-key={HEMIE_DOUBLE_GLAZING_PERIOD}>Double glazing installed</span>}
                          value={complianceSettings.hemieSettings?.[HEMIE_DOUBLE_GLAZING_PERIOD] ?? ""}
                          onChange={(value) => setHemieSetting(HEMIE_DOUBLE_GLAZING_PERIOD, value)}
                          options={[
                            { value: "double_glazing_post_2002", label: "2002 or later" },
                            { value: "double_glazing_pre_2002", label: "Before 2002" },
                            { value: "double_glazing_unknown_install_date", label: "Unknown" },
                          ]}
                          placeholder="Only if the windows are double glazed"
                          variant="ghost"
                          size="md"
                        />
                        {(shownBuildType === "flat" || shownBuildType === "maisonette") && (
                          <StandardDropdown
                            label={<span data-field-key={HEMIE_HEAT_LOSS_CORRIDOR}>Heat loss corridor</span>}
                            value={complianceSettings.hemieSettings?.[HEMIE_HEAT_LOSS_CORRIDOR] ?? ""}
                            onChange={(value) => setHemieSetting(HEMIE_HEAT_LOSS_CORRIDOR, value)}
                            options={[
                              { value: "no_corridor", label: "No corridor" },
                              { value: "heated_corridor", label: "Heated corridor" },
                              { value: "unheated_corridor", label: "Unheated corridor" },
                            ]}
                            placeholder="Select corridor..."
                            variant="ghost"
                            size="md"
                          />
                        )}
                      </>
                    )}
                    {hemDatabaseProducts && (
                      <StandardInput
                        type="number"
                        unit="m²"
                        label={<span data-field-key="AirPermeability_env_area">Envelope area</span>}
                        helperText="From the air test report. Blank uses the drawn area."
                        placeholder={`Drawn: ${drawnEnvelopeArea}`}
                        value={complianceSettings.AirPermeability_env_area?.toString() ?? ""}
                        onChange={(e) => {
                          const val = e.target.value === "" ? undefined : parseFloat(e.target.value);
                          setComplianceSettings({ AirPermeability_env_area: val === undefined || isNaN(val) ? undefined : val });
                        }}
                        min="0"
                        step="0.1"
                        variant="ghost"
                        size="md"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Ventilation Environment Settings Section */}
              <div
                data-field-section="ventilation"
                style={{
                  marginTop: "var(--spacing-md)",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "var(--spacing-md)",
                }}
              >
                <GlobalSettingsAccordionHeader
                  title="Ventilation environment"
                  expanded={ventilationEnvExpanded}
                  onToggle={() =>
                    setVentilationEnvExpanded(!ventilationEnvExpanded)
                  }
                  errorCount={0}
                  infoCount={comparisonGlobalSections.ventilation.length}
                />
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
                                    ? "(set by you)"
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

                    {/* Where DESNZ derives shield class from the terrain class, terrain comes first. */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
                    <div style={{ order: requiredRows.has("Ventilation_terrain_class") ? 2 : 1 }}>
                    <StandardDropdown
                      label={<span data-field-key="Ventilation_shield_class">Shield Class</span>}
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
                        { value: "", label: derivedRows.has("Ventilation_shield_class") ? "From the terrain class" : requiredRows.has("Ventilation_shield_class") ? "Select shield class..." : "Normal (default)" },
                        { value: "Open", label: "Open" },
                        { value: "Normal", label: "Normal" },
                        { value: "Shielded", label: "Shielded" },
                      ]}
                      variant="ghost"
                      size="md"
                      helperText="Wind exposure of the building facade"
                    />

                    </div>
                    <div style={{ order: requiredRows.has("Ventilation_terrain_class") ? 1 : 2 }}>
                    <StandardDropdown
                      label={<span data-field-key="Ventilation_terrain_class">Terrain Class</span>}
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
                        { value: "", label: requiredRows.has("Ventilation_terrain_class") ? "Select terrain class..." : "Open Field (default)" },
                        { value: "OpenWater", label: "Open Water" },
                        { value: "OpenField", label: "Open Field" },
                        { value: "Suburban", label: "Suburban" },
                        { value: "Urban", label: "Urban" },
                      ]}
                      variant="ghost"
                      size="md"
                      helperText="Surrounding terrain affecting wind speed profile"
                    />

                    </div>
                    </div>
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
                      placeholder={requiredRows.has("Ventilation_altitude") ? "Enter the altitude" : "30 (default)"}
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
                                ? "(set by you)"
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

                    {requiredRows.has("Ventilation_noise_nuisance") || desnzDefaultRows.Ventilation_noise_nuisance ? (
                      <RequiredYesNo {...requiredYesNoProps("Ventilation_noise_nuisance", "Noise nuisance")}
                        placeholder={desnzDefaultRows.Ventilation_noise_nuisance && `${desnzDefaultRows.Ventilation_noise_nuisance} (default)`} />
                    ) : (
                    <>
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
                        data-field-key="Ventilation_noise_nuisance"
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
                    </>
                    )}
                    {requiredRows.has("Ventilation_cross_vent_possible") && <RequiredYesNo {...requiredYesNoProps("Ventilation_cross_vent_possible")} />}
                  </div>
                )}
              </div>

              {/* Thermal Bridging Settings Section */}
              {!constructionBands && (
              <div
                data-field-section="thermalBridging"
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
                    Thermal bridging
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
              )}
            </>
          )}
        </div>
      </dialog>
    </div>,
    document.body
  );
}
