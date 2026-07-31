// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import './GlobalButtonSystem.css';
import { ModalHeader } from './ModalHeader';
import { useKeyedState } from '../hooks/useKeyedState';
import { useGeometryStore } from '../stores/geometryStore';
import { JUNCTION_TYPE_DESCRIPTIONS } from '../lib/simplifiedFabricMap';
import {
  junctionCodesGroupedBySeries,
  junctionCodesNotAutoSuggestedByFacadeTool,
} from '../geometry/thermalBridge/facadeAutoTbScope';
import {
  annotateProposalsWithDedupe,
  coerceJunctionCodeForEdgeRole,
  junctionOptionsForFacadeEdgeRole,
  type AnnotatedFacadeProposal,
  type FacadeOpeningEdgeRole,
} from '../geometry/thermalBridge/proposeFacadeOpenings';
import { ADJACENT_WALL_COINCIDENT_PERP_TOL_M } from '../geometry/thermalBridge/proposeAdjacentWallJunction';
import { proposeAutoThermalBridges } from '../geometry/thermalBridge/autoThermalBridgePipeline';
import type { Element, ThermalBridgeLinear } from '../geometry/types';
import {
  resolveFloorStoreyIndexForAutoTbFromHostZ,
  thermalBridgeSourceExtraJsonForAutoProposal,
} from '../geometry/thermalBridge/resolveTbHostFloorId';
import {
  buildThermalBridgeInventoryRows,
  type ThermalBridgeInventoryBucket,
  type ThermalBridgeInventoryRow,
} from '../geometry/thermalBridge/thermalBridgeInventory';
import { findLinearThermalBridgeIssues } from '../geometry/thermalBridge/findLinearThermalBridgeIssues';
import {
  getEffectiveLinearPsiForFacadeProposal,
  VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY,
} from '../geometry/thermalBridge/linearTbPsi';
import { THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY } from '../lib/elementCanvasFloor';
import {
  getExternalDetailSuggestionForAutoProposal,
  externalDetailThermalBridgeSourceExtraJson,
  type ExternalDetailAutoTbCandidate,
  type ExternalDetailAutoTbSuggestion,
} from '../geometry/thermalBridge/externalDetailsForAutoTb';
import {
  externalDetailCandidateKey,
  type ExternalDetailCataloguePort,
} from '../geometry/thermalBridge/externalDetailContracts';

/** Groups Table 3.7 junction “shapes” for the preview; order is display order. */
const TB_PREVIEW_CATEGORIES: readonly {
  id: string;
  title: string;
  /** How rows in this group are chosen (shown under the category title). */
  rule: string;
  roles: readonly FacadeOpeningEdgeRole[];
}[] = [
  {
    id: 'opening_lintel_sill',
    title: 'Opening lintel & sill',
    rule: 'Top and bottom of each vertical wall window or door you drew as a straight line.',
    roles: ['lintel', 'sill'],
  },
  {
    id: 'opening_jambs',
    title: 'Opening jambs',
    rule: 'Left and right vertical sides of each opening — from the ends of the line you drew, not “building left/right”.',
    roles: ['jamb_first', 'jamb_second'],
  },
  {
    id: 'roof_window_head_sill',
    title: 'Roof window head & sill',
    rule:
      'Top and bottom of each roof window or flat rooflight drawn on a roof plane, with pitch set (not 90°). Table 3.7 R1 / R2.',
    roles: ['roof_window_head', 'roof_window_sill'],
  },
  {
    id: 'rooflight_kerb',
    title: 'Rooflight kerb / upstand',
    rule:
      'Optional R11 along the bottom in plan, same line as the sill. Use R2 for a sill construction; R11 for a kerb or upstand (do not count both in SAP).',
    roles: ['rooflight_kerb'],
  },
  {
    id: 'roof_window_jambs',
    title: 'Roof window jambs',
    rule: 'Side edges of each roof opening (R3).',
    roles: ['roof_window_jamb_first', 'roof_window_jamb_second'],
  },
  {
    id: 'opening_wall_floor',
    title: 'Wall–floor at openings',
    rule: 'Where the opening meets the floor slab (ground or upper storey); the sill detail is swapped for a wall–floor junction.',
    roles: ['wall_ground_foot', 'wall_intermediate_floor_foot'],
  },
  {
    id: 'continuous_wall_floor',
    title: 'Continuous wall–floor',
    rule: 'Along external walls at floor level; stretches already covered under a door or window on the same wall are left out.',
    roles: ['wall_ground_continuous', 'wall_intermediate_continuous'],
  },
  {
    id: 'external_corners',
    title: 'External corners',
    rule: 'Where the external wall outline turns in plan — outward corners vs inward (bay) corners.',
    roles: ['external_corner_convex', 'external_corner_reentrant'],
  },
  {
    id: 'flat_roof_edge',
    title: 'Flat roof edge',
    rule:
      'Along each horizontal roof line (name contains "roof" or unheated-pitched flag, pitch 0°). Choose E14 (flat roof) or E15 (parapet) in the junction list — same geometry.',
    roles: ['flat_roof_edge'],
  },
  {
    id: 'sloped_roof_eaves_gable',
    title: 'Sloped roof eaves, gable & ridge',
    rule:
      'Pitched roof (0° < pitch < 90°, name or unheated-pitched). First plan edge = low eaves; edges perpendicular to eaves in plan get E12–E13; a nearly parallel (non–first-edge) run gets a ridge R4 (or R5 inverted).',
    roles: ['sloped_roof_eaves', 'sloped_roof_gable', 'sloped_roof_ridge'],
  },
  {
    id: 'room_in_roof_roof_wall_r89',
    title: 'Room-in-roof roof ↔ adjacent wall (R8 / R9)',
    rule:
      'Where a vertical adjacent line (conditioned or unheated void) is plan-coincident with an edge of a sloped roof opaque, with vertical overlap. Cold roof (`is_unheated_pitched_roof`) → R9 (ceiling line); warm roof → R8 (rafter line). Dropdown can swap R8/R9.',
    roles: ['sloped_roof_to_adjacent_wall_r8_r9'],
  },
  {
    id: 'dormer_roof_to_host_roof_r10',
    title: 'Dormer roof to host roof (R10)',
    rule:
      'Dormer roof edges that tie back into the host roof and are not eaves, gables, ridges, or roof-window surrounds — Table 3.7 R10.',
    roles: ['dormer_roof_to_host_roof_r10'],
  },
  {
    id: 'e7_party_floor',
    title: 'Party floor / ceiling vs external wall (E7)',
    rule:
      'Where a **horizontal** conditioned-adjacent line (pitch 0°) is marked with the “party” UI flag — party **floor** slab or top storey **party ceiling** — plan-coincident with an external wall at that line’s Z within the wall height — E7, not a vertical P-line.',
    roles: ['e7_party_floor_external'],
  },
  {
    id: 'basement_ground',
    title: 'Basement floor (E22)',
    rule: 'For each `BuildingElementGround` with `Heated_basement` or `Unheated_basement` floor type, one E22 per plan edge.',
    roles: ['basement_floor_edge'],
  },
  {
    id: 'party_wall_to_roof',
    title: 'Party wall to roof (P4 / P5)',
    rule:
      '**Pitched** roof: `BuildingElementPartyWall` plan-coincident with a sloped roof polygon edge — **P4** / **P5** from cold vs warm deck on the roof. **Flat** roof (`pitch` 0°, named roof or unheated-pitched flag): **P4** where the party line meets a flat deck edge.',
    roles: ['party_wall_to_sloped_roof', 'party_wall_to_flat_roof'],
  },
  {
    id: 'adjacent_wall_junctions',
    title: 'Party walls & unheated adjacent floors',
    rule:
      `**Party wall × intermediate floor:** plan coincidence within ${(ADJACENT_WALL_COINCIDENT_PERP_TOL_M * 100).toFixed(0)} cm — **P2** / **P3**. **Unheated horizontal exposed floor × external wall:** **E20** / **E21** (not **P7**/**P8**, which are the party-wall analogues in Table 3.7).`,
    roles: ['party_wall_junction', 'unheated_adjacent_wall_junction'],
  },
  {
    id: 'party_wall_to_external_e18',
    title: 'Party wall to external (E18)',
    rule:
      'Where a vertical `BuildingElementPartyWall` line is plan-coincident with an external wall, with height overlap. One line per wall–pair at the mid-overlap. P2/P3 in the other category are for floors / adjacent zones, not this wall–wall case.',
    roles: ['party_to_external_e18'],
  },
];

/** Short hint after each E / P / R letter in the “other junction types” list. */
const TB_MANUAL_SERIES_HINT: Record<string, string> = {
  E: 'E7 party floor/ceiling, E10–E18, E22 basement — many are suggested; balconies / some penetrations still manual',
  P: 'P1–P8: party-wall junctions (P2/P3 auto where modelled); P4/P5: party wall × roof — many still manual',
  R: 'R1–R3 roof window; R4–R5 ridge; R8–R9 roof × adjacent (room-in-roof); R10 dormer roof tie-back; R11 kerb; R6/R7: manual linear TB',
};

const INVENTORY_BUCKET_ORDER: ThermalBridgeInventoryBucket[] = ['problematic', 'manual_only', 'validated'];

const INVENTORY_BUCKET_TITLE: Record<ThermalBridgeInventoryBucket, string> = {
  problematic: 'Problematic',
  manual_only: 'Manual-only',
  validated: 'Validated',
};

type FacadeProposalWithExternalDetail = AnnotatedFacadeProposal & {
  externalDetailSuggestion?: ExternalDetailAutoTbSuggestion;
};

function junctionSelectLabel(code: string): string {
  const desc = JUNCTION_TYPE_DESCRIPTIONS[code];
  if (!desc) return code;
  const short = desc.length > 100 ? `${desc.slice(0, 97)}…` : desc;
  return `${code} — ${short}`;
}

function externalDetailCandidateLabel(candidate: ExternalDetailAutoTbCandidate): string {
  return `${candidate.detail.detailCode} · ψ ${candidate.detail.psiWPerMK} · ${candidate.detail.title}`;
}

export interface AutoThermalBridgePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  externalDetailCatalogue?: ExternalDetailCataloguePort;
}

export const AutoThermalBridgePreviewModal: React.FC<AutoThermalBridgePreviewModalProps> = ({
  isOpen,
  onClose,
  externalDetailCatalogue,
}) => {
  const elementsById = useGeometryStore((s) => s.elementsById);
  const zones = useGeometryStore((s) => s.zones);
  const floors = useGeometryStore((s) => s.floors);
  const addElement = useGeometryStore((s) => s.addElement);
  const removeElement = useGeometryStore((s) => s.removeElement);
  const ensureFloorForZ = useGeometryStore((s) => s.ensureFloorForZ);
  const floorsForAutoTb = useGeometryStore((s) => s.floors);
  const junctionPsiDefaultsMap = useGeometryStore((s) => s.junctionPsiDefaultsMap);
  const detailedBridgePsiProfile = useGeometryStore((s) => s.detailedBridgePsiProfile);

  const allElements = useMemo(() => Object.values(elementsById) as Element[], [elementsById]);

  const linearTbIssues = useMemo(() => findLinearThermalBridgeIssues(allElements), [allElements]);

  const baseProposals = useMemo(() => {
    return proposeAutoThermalBridges(allElements, floors);
  }, [allElements, floors]);

  const proposalDraft = useMemo(() => {
    const junctionOverride: Record<string, string> = {};
    const selected: Record<string, boolean> = {};
    const annotated = annotateProposalsWithDedupe(baseProposals, allElements);
    for (const row of annotated) {
      junctionOverride[row.proposalId] = row.junctionCode;
      selected[row.proposalId] = row.status === 'new';
    }
    return {
      key: JSON.stringify(annotated.map((row) => [row.proposalId, row.junctionCode, row.status])),
      junctionOverride,
      selected,
    };
  }, [allElements, baseProposals]);
  const proposalResetKey = `${isOpen ? 'open' : 'closed'}\0${proposalDraft.key}`;
  const [junctionOverride, setJunctionOverride] = useKeyedState(
    proposalResetKey,
    proposalDraft.junctionOverride,
  );
  const [externalDetailSelection, setExternalDetailSelection] = useKeyedState<Record<string, string>>(
    proposalResetKey,
    {},
  );
  const externalDetailProfilesEnabled = externalDetailCatalogue !== undefined;
  const [selected, setSelected] = useKeyedState(proposalResetKey, proposalDraft.selected);
  const [activeTab, setActiveTab] = useState<'suggested' | 'inventory'>('suggested');

  const mergedProposals = useMemo(() => {
    return baseProposals.map((p) => {
      const code = coerceJunctionCodeForEdgeRole(p.edgeRole, p.junctionCode, junctionOverride[p.proposalId]);
      const proposalWithCode = { ...p, junctionCode: code };
      const externalDetailSuggestion = externalDetailProfilesEnabled
        ? getExternalDetailSuggestionForAutoProposal(
            proposalWithCode,
            elementsById,
            externalDetailSelection,
            externalDetailCatalogue,
            detailedBridgePsiProfile,
          )
        : undefined;
      return {
        ...proposalWithCode,
        junctionCode: code,
        linearThermalTransmittance:
          externalDetailSuggestion?.selected?.detail.psiWPerMK ??
          getEffectiveLinearPsiForFacadeProposal(
            proposalWithCode,
            junctionPsiDefaultsMap,
            elementsById,
          ),
        externalDetailSuggestion,
      };
    });
  }, [
    baseProposals,
    junctionOverride,
    junctionPsiDefaultsMap,
    elementsById,
    externalDetailSelection,
    externalDetailProfilesEnabled,
    detailedBridgePsiProfile,
    externalDetailCatalogue,
  ]);

  const annotated = useMemo(
    () => annotateProposalsWithDedupe(mergedProposals, allElements) as FacadeProposalWithExternalDetail[],
    [mergedProposals, allElements],
  );

  const suggestedRows = useMemo(() => annotated.filter((row) => row.status === 'new'), [annotated]);

  const externalDetailGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        groupKey: string;
        sourceShortName: string;
        profileLabel: string;
        junctionCode: string;
        candidates: readonly ExternalDetailAutoTbCandidate[];
        rowCount: number;
        selectedDetailKey: string;
      }
    >();
    for (const row of suggestedRows) {
      const suggestion = row.externalDetailSuggestion;
      if (!suggestion || suggestion.candidates.length <= 1) continue;
      const junctionCode = suggestion.candidates[0]?.detail.junctionCode ?? row.junctionCode;
      const existing = groups.get(suggestion.groupKey);
      if (existing) {
        existing.rowCount += 1;
        continue;
      }
      groups.set(suggestion.groupKey, {
        groupKey: suggestion.groupKey,
        sourceShortName: suggestion.profile.sourceShortName,
        profileLabel: suggestion.profile.label,
        junctionCode,
        candidates: suggestion.candidates,
        rowCount: 1,
        selectedDetailKey: externalDetailSelection[suggestion.groupKey] ?? '',
      });
    }
    return [...groups.values()];
  }, [suggestedRows, externalDetailSelection]);

  const rowsByCategoryId = useMemo(() => {
    const roleToCategoryId = new Map<string, string>();
    for (const cat of TB_PREVIEW_CATEGORIES) {
      for (const r of cat.roles) roleToCategoryId.set(r, cat.id);
    }
    const m = new Map<string, FacadeProposalWithExternalDetail[]>();
    for (const cat of TB_PREVIEW_CATEGORIES) m.set(cat.id, []);
    for (const row of suggestedRows) {
      const cid = roleToCategoryId.get(row.edgeRole);
      if (cid) m.get(cid)!.push(row);
    }
    return m;
  }, [suggestedRows]);

  const inventoryRows = useMemo(
    () => buildThermalBridgeInventoryRows(elementsById, zones, linearTbIssues),
    [elementsById, zones, linearTbIssues],
  );
  const inventoryDraft = useMemo(() => Object.fromEntries(
    inventoryRows.map((row) => [row.tb.id, false]),
  ) as Record<string, boolean>, [inventoryRows]);
  const [inventorySelected, setInventorySelected] = useKeyedState(
    `${isOpen ? 'open' : 'closed'}\0${inventoryRows.map((row) => row.tb.id).join('\0')}`,
    inventoryDraft,
  );

  const inventoryByBucket = useMemo(() => {
    const m: Record<ThermalBridgeInventoryBucket, ThermalBridgeInventoryRow[]> = {
      validated: [],
      problematic: [],
      manual_only: [],
    };
    for (const r of inventoryRows) {
      m[r.bucket].push(r);
    }
    return m;
  }, [inventoryRows]);

  const selectedNewCount = useMemo(
    () => suggestedRows.reduce((n, row) => n + (selected[row.proposalId] ? 1 : 0), 0),
    [suggestedRows, selected],
  );

  const inventorySelectedCount = useMemo(
    () => inventoryRows.reduce((n, r) => n + (inventorySelected[r.tb.id] ? 1 : 0), 0),
    [inventoryRows, inventorySelected],
  );

  const manualOnlyJunctionGroups = useMemo(
    () => junctionCodesGroupedBySeries(junctionCodesNotAutoSuggestedByFacadeTool()),
    [],
  );

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleAddSelected = () => {
    for (const row of annotated) {
      if (!selected[row.proposalId]) continue;
      if (row.status !== 'new') continue;

      const zoneId =
        row.zoneId ??
        (allElements.find((e) => e.id === row.openingId) as { zoneId?: string } | undefined)?.zoneId;
      if (!zoneId) continue;

      const parentElement =
        row.parentElementForTb !== undefined && row.parentElementForTb !== null && String(row.parentElementForTb).trim() !== ''
          ? String(row.parentElementForTb).trim()
          : row.openingName;

      const floorStorey = row.floorStoreyIndexForTb ?? resolveFloorStoreyIndexForAutoTbFromHostZ(
        {
          openingId: row.openingId,
          zoneId: row.zoneId,
          parentElementForTb: row.parentElementForTb,
        },
        elementsById,
        floorsForAutoTb,
      );
      const extraJson: Record<string, unknown> = { junction_type: row.junctionCode };
      let floorIdForTb: string | undefined;
      if (floorStorey !== undefined) {
        extraJson[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY] = floorStorey;
        floorIdForTb = ensureFloorForZ(floorStorey);
      }
      const src = thermalBridgeSourceExtraJsonForAutoProposal(
        {
          openingId: row.openingId,
          zoneId: row.zoneId,
          parentElementForTb: row.parentElementForTb,
          cornerHostWallIds: row.cornerHostWallIds,
          hostElementIds: row.hostElementIds,
          roofAdjacentPairIds: row.roofAdjacentPairIds,
        },
        elementsById,
      );
      const externalDetailSource = externalDetailThermalBridgeSourceExtraJson(row.externalDetailSuggestion);
      if (src || externalDetailSource) {
        extraJson.thermal_bridge_source = {
          ...(src ?? {}),
          ...(externalDetailSource ?? {}),
        };
      }
      if (
        row.edgeRole === 'e7_party_floor_external' ||
        row.edgeRole === 'party_wall_junction' ||
        row.edgeRole === 'unheated_adjacent_wall_junction' ||
        row.edgeRole === 'party_to_external_e18' ||
        row.edgeRole === 'party_wall_to_sloped_roof' ||
        row.edgeRole === 'party_wall_to_flat_roof' ||
        row.edgeRole === 'sloped_roof_to_adjacent_wall_r8_r9'
      ) {
        extraJson[VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY] = row.openingId;
      }

      addElement({
        type: 'ThermalBridgeLinear',
        name: '',
        zoneId,
        length: row.suggestedLengthM,
        linear_thermal_transmittance: row.linearThermalTransmittance,
        parent_element: parentElement,
        coordinates: [row.coordinates[0], row.coordinates[1]],
        floorId: floorIdForTb,
        extra_json: extraJson as ThermalBridgeLinear['extra_json'],
        isPlaceholder: false,
      } as Omit<Element, 'id'>);
    }
    onClose();
  };

  const handleInventoryRemoveSelected = () => {
    for (const r of inventoryRows) {
      if (inventorySelected[r.tb.id]) removeElement(r.tb.id);
    }
  };

  const handleInventoryRemoveBucket = (bucket: ThermalBridgeInventoryBucket) => {
    for (const r of inventoryByBucket[bucket]) {
      removeElement(r.tb.id);
    }
  };

  const handleInventorySelectAll = (checked: boolean) => {
    setInventorySelected((prev) => {
      const next = { ...prev };
      for (const r of inventoryRows) {
        next[r.tb.id] = checked;
      }
      return next;
    });
  };

  if (!isOpen) return null;

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  return ReactDOM.createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={handleBackdropClick}>
      <div
        className="modal-container"
        style={{ maxWidth: 880, width: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ flexShrink: 0 }}>
          <ModalHeader
            title="Thermal bridges"
            onClose={onClose}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={activeTab === 'suggested' ? 'btn btn-yellow btn-small' : 'btn btn-ghost btn-small'}
            onClick={() => setActiveTab('suggested')}
          >
            Suggested new ({suggestedRows.length})
          </button>
          <button
            type="button"
            className={activeTab === 'inventory' ? 'btn btn-yellow btn-small' : 'btn btn-ghost btn-small'}
            onClick={() => setActiveTab('inventory')}
          >
            Inventory ({inventoryRows.length})
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'suggested' ? (
          <>
        <details
          style={{
            margin: '0 0 8px',
            fontSize: 11,
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '6px 8px',
            background: 'var(--bg-secondary)',
            lineHeight: 1.35,
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-input)', fontSize: 12 }}>
            Table 3.7 — codes not auto-suggested
          </summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
            {manualOnlyJunctionGroups.map(({ series, codes }) => (
              <li key={series} style={{ marginBottom: 4 }}>
                <strong style={{ color: 'var(--text-input)' }}>{series}</strong>
                {TB_MANUAL_SERIES_HINT[series] ? (
                  <span style={{ color: 'var(--text-secondary)' }}> ({TB_MANUAL_SERIES_HINT[series]}): </span>
                ) : (
                  ': '
                )}
                <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-input)', fontSize: 10.5 }}>
                  {codes.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </details>

        {externalDetailGroups.length > 0 && (
          <div
            style={{
              margin: '0 0 8px',
              padding: '8px 10px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              Detail choices
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {externalDetailGroups.map((group) => (
                <label
                  key={group.groupKey}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(180px, 1fr) minmax(260px, 1.4fr)',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', lineHeight: 1.3 }} title={group.profileLabel}>
                    <strong style={{ color: 'var(--text-primary)' }}>{group.junctionCode}</strong>
                    {` · ${group.sourceShortName} · ${group.rowCount} row${group.rowCount === 1 ? '' : 's'}`}
                  </span>
                  <select
                    className="standard-dropdown standard-dropdown-ghost"
                    value={group.selectedDetailKey}
                    onChange={(e) =>
                      setExternalDetailSelection((prev) => ({
                        ...prev,
                        [group.groupKey]: e.target.value,
                      }))
                    }
                    aria-label={`Detail choice for ${group.junctionCode}`}
                    style={{ minWidth: 260 }}
                  >
                    <option value="">No detail</option>
                    {group.candidates.map((candidate) => (
                      <option key={externalDetailCandidateKey(candidate)} value={externalDetailCandidateKey(candidate)}>
                        {externalDetailCandidateLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        {suggestedRows.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            No new lines (duplicates skipped).
          </p>
        ) : (
          <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
            {TB_PREVIEW_CATEGORIES.map((cat) => {
              const rows = rowsByCategoryId.get(cat.id) ?? [];
              if (rows.length === 0) return null;
              const nSel = rows.filter((r) => selected[r.proposalId]).length;
              const statLine = [`${rows.length} new`, ...(nSel > 0 ? [`${nSel} selected`] : [])].join(' · ');
              return (
                <details
                  key={cat.id}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <summary
                    style={{
                      cursor: 'pointer',
                      padding: '6px 10px',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: '2px 8px',
                        lineHeight: 1.25,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.title}</span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--text-input)',
                        }}
                      >
                        {statLine}
                      </span>
                    </span>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: 'var(--text-secondary)',
                        marginTop: 2,
                        lineHeight: 1.35,
                      }}
                    >
                      {cat.rule}
                    </div>
                  </summary>
                  <div style={{ padding: '0 6px 6px', overflow: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', background: 'var(--bg-primary)' }}>
                          <th style={{ padding: '5px 6px' }}>Select</th>
                          <th style={{ padding: '5px 6px' }}>Source</th>
                          <th style={{ padding: '5px 6px' }}>Edge</th>
                          <th style={{ padding: '5px 6px' }}>Junction</th>
                          <th style={{ padding: '5px 6px' }}>ψ source</th>
                          <th style={{ padding: '5px 6px' }}>L (m)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <SuggestedFacadeRow
                            key={row.proposalId}
                            row={row}
                            selected={!!selected[row.proposalId]}
                            junctionCode={junctionOverride[row.proposalId] ?? row.junctionCode}
                            onJunctionChange={(code) => {
                              setJunctionOverride((prev) => ({ ...prev, [row.proposalId]: code }));
                            }}
                            onToggle={(v) => setSelected((prev) => ({ ...prev, [row.proposalId]: v }))}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </div>
        )}
          </>
        ) : (
          <>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.35,
              }}
            >
              <strong>Problematic</strong>: validation / naming / length / linkage issues. <strong>Manual-only</strong>: junction
              codes the suggester never emits.
            </p>
            <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
              {INVENTORY_BUCKET_ORDER.map((bucket) => {
                const rows = inventoryByBucket[bucket];
                if (rows.length === 0) return null;
                return (
                  <details
                    key={bucket}
                    open={bucket === 'problematic'}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    <summary
                      style={{
                        cursor: 'pointer',
                        padding: '6px 10px',
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {INVENTORY_BUCKET_TITLE[bucket]} ({rows.length})
                    </summary>
                    <div style={{ padding: '4px 10px 8px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        onClick={() => handleInventoryRemoveBucket(bucket)}
                      >
                        Remove all in section ({rows.length})
                      </button>
                    </div>
                    <div style={{ padding: '0 6px 8px', overflow: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', background: 'var(--bg-primary)' }}>
                            <th style={{ padding: '4px 6px' }}> </th>
                            <th style={{ padding: '4px 6px' }}>Zone</th>
                            <th style={{ padding: '4px 6px' }}>Name</th>
                            <th style={{ padding: '4px 6px' }}>Parent</th>
                            <th style={{ padding: '4px 6px' }}>Junction</th>
                            <th style={{ padding: '4px 6px' }}>L (m)</th>
                            <th style={{ padding: '4px 6px' }}>Host span</th>
                            <th style={{ padding: '4px 6px' }}>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((inv) => (
                            <tr key={inv.tb.id}>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                                <input
                                  type="checkbox"
                                  checked={!!inventorySelected[inv.tb.id]}
                                  onChange={(e) =>
                                    setInventorySelected((prev) => ({ ...prev, [inv.tb.id]: e.target.checked }))
                                  }
                                  aria-label={`Select ${inv.tb.name || inv.tb.id}`}
                                />
                              </td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>{inv.zoneName}</td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top', fontFamily: 'ui-monospace, monospace' }}>
                                {inv.tb.name?.trim() || '—'}
                              </td>
                              <td
                                style={{ padding: '4px 6px', verticalAlign: 'top', maxWidth: 140 }}
                                title={inv.tb.parent_element ?? ''}
                              >
                                {inv.tb.parent_element ?? '—'}
                              </td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top', fontFamily: 'ui-monospace, monospace' }}>
                                {inv.junctionType ?? '—'}
                              </td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                                {inv.tbLengthM !== undefined ? inv.tbLengthM.toFixed(3) : '—'}
                              </td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top' }}>
                                {inv.impliedHostSpanM !== undefined ? inv.impliedHostSpanM.toFixed(3) : '—'}
                              </td>
                              <td style={{ padding: '4px 6px', verticalAlign: 'top', fontSize: 10 }} title={inv.notes.join(' ')}>
                                {inv.notes.join(' · ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
              {inventoryRows.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No linear thermal bridges in the model.</p>
              ) : null}
            </div>
          </>
        )}
        </div>

        <div
          className="modal-actions"
          style={{ marginTop: 12, flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          <button type="button" className="btn btn-ghost btn-standard" onClick={onClose}>
            Close
          </button>
          {activeTab === 'suggested' ? (
            <>
              <div style={{ flex: 1, minWidth: 12 }} />
              <button
                type="button"
                className="btn btn-yellow btn-standard"
                onClick={handleAddSelected}
                disabled={suggestedRows.length === 0 || selectedNewCount === 0}
                title="Create thermal bridges for checked suggestions"
              >
                Add selected
                {selectedNewCount > 0 ? ` (${selectedNewCount})` : ''}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => handleInventorySelectAll(true)}
                disabled={inventoryRows.length === 0}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => handleInventorySelectAll(false)}
                disabled={inventoryRows.length === 0}
              >
                Clear selection
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-standard"
                onClick={handleInventoryRemoveSelected}
                disabled={inventoryRows.length === 0 || inventorySelectedCount === 0}
              >
                Remove selected
                {inventorySelectedCount > 0 ? ` (${inventorySelectedCount})` : ''}
              </button>
              <div style={{ flex: 1 }} />
            </>
          )}
        </div>
      </div>
    </div>,
    portalTarget,
  );
};

const edgeLabel: Record<string, string> = {
  lintel: 'Lintel',
  sill: 'Sill',
  wall_ground_foot: 'Wall / floor (under opening)',
  wall_ground_continuous: 'Wall / floor (continuous along wall)',
  wall_intermediate_floor_foot: 'Wall / intermediate floor (under opening)',
  wall_intermediate_continuous: 'Wall / intermediate floor (continuous along wall)',
  jamb_first: 'Jamb (1st line point)',
  jamb_second: 'Jamb (2nd line point)',
  external_corner_convex: 'External corner (convex)',
  external_corner_reentrant: 'External corner (re-entrant)',
  roof_window_head: 'Roof window head (R1)',
  roof_window_sill: 'Roof window sill (R2)',
  roof_window_jamb_first: 'Roof window jamb (1st line point)',
  roof_window_jamb_second: 'Roof window jamb (2nd line point)',
  rooflight_kerb: 'Rooflight kerb / upstand (R11)',
  party_wall_junction: 'Party / conditioned adjacent (P1–P3)',
  unheated_adjacent_wall_junction: 'Unheated exposed floor ↔ external wall (E20 / E21)',
  flat_roof_edge: 'Flat roof edge (E14 / E15)',
  sloped_roof_eaves: 'Sloped eaves (E10 / E11)',
  sloped_roof_gable: 'Gable in plan (E12 / E13)',
  sloped_roof_ridge: 'Ridge in plan (R4 / R5)',
  party_to_external_e18: 'Party line ↔ external (E18)',
  e7_party_floor_external: 'Party floor line ↔ external (E7)',
  basement_floor_edge: 'Basement floor edge (E22)',
  party_wall_to_sloped_roof: 'Party wall ↔ pitched roof edge (P4 / P5)',
  party_wall_to_flat_roof: 'Party wall ↔ flat roof edge (P4)',
  sloped_roof_to_adjacent_wall_r8_r9: 'Room-in-roof roof ↔ adjacent wall (R8 / R9)',
  dormer_roof_to_host_roof_r10: 'Dormer roof ↔ host roof (R10)',
};

const SuggestedFacadeRow: React.FC<{
  row: FacadeProposalWithExternalDetail;
  selected: boolean;
  junctionCode: string;
  onJunctionChange: (code: string) => void;
  onToggle: (v: boolean) => void;
}> = ({ row, selected, junctionCode, onJunctionChange, onToggle }) => (
  <tr title={row.reason}>
    <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onToggle(e.target.checked)}
        title='Checked rows are added with "Add selected"'
      />
    </td>
    <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>{row.openingName}</td>
    <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>{edgeLabel[row.edgeRole] ?? row.edgeRole}</td>
    <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>
      <select
        className="standard-dropdown standard-dropdown-ghost"
        value={junctionCode}
        onChange={(e) => onJunctionChange(e.target.value)}
        aria-label="Junction type and short description (Table 3.7)"
        style={{ minWidth: 180, maxWidth: 340 }}
      >
        {junctionOptionsForFacadeEdgeRole(row.edgeRole).map((c) => (
          <option key={c} value={c}>
            {junctionSelectLabel(c)}
          </option>
        ))}
      </select>
    </td>
    <td style={{ padding: '5px 6px', verticalAlign: 'top', fontSize: 11 }}>
      {row.externalDetailSuggestion?.selected ? (
        <span
          title={
            row.externalDetailSuggestion.selected.detail.documentUrl ??
              row.externalDetailSuggestion.selected.profile.documentUrl ??
              row.externalDetailSuggestion.selected.detail.title
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            border: '1px solid var(--validation-success-border, var(--border-subtle))',
            borderRadius: 4,
            padding: '2px 5px',
            color: 'var(--text-primary)',
            background: 'var(--validation-success-bg, var(--bg-primary))',
            whiteSpace: 'nowrap',
          }}
        >
          {row.externalDetailSuggestion.profile.sourceShortName} {row.externalDetailSuggestion.selected.detail.detailCode}
          {' · '}
          ψ {row.externalDetailSuggestion.selected.detail.psiWPerMK}
        </span>
      ) : row.externalDetailSuggestion ? (
        <span style={{ color: 'var(--text-secondary)' }}>Choose detail</span>
      ) : (
        <span style={{ color: 'var(--text-secondary)' }}>Default</span>
      )}
    </td>
    <td style={{ padding: '5px 6px', verticalAlign: 'top' }}>{row.suggestedLengthM}</td>
  </tr>
);
