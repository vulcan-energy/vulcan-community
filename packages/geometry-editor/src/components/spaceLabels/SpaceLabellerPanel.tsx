// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpaceLabel } from '../../geometry/types';
import { getOpenToLivingRoomAdjacencyWarning } from '../../geometry/validation/validateSpaceLabels';
import { fingerprintInferenceWallSet } from '../../lib/spaceInference/inferSpacesFromWalls';
import {
  canSpaceLabelBeMarkedOpenToLivingRoom,
  DEFAULT_SPACE_LABEL_ROOM_REGISTRY,
  isSpaceLabelOpenToLivingRoom,
  SPACE_LABEL_OPEN_TO_LIVING_ROOM_KEY,
} from '../../lib/spaceLabelDerivation';
import { useGeometryStore } from '../../stores/geometryStore';
import { StandardDropdown } from '../StandardDropdown';
import { ValidationPill } from '../ValidationIndicator';

const ROOM_TYPE_OPTIONS = ['', ...Object.keys(DEFAULT_SPACE_LABEL_ROOM_REGISTRY).sort()];

/** Trash bin — matches ConfigCard / BatchConfigBuilder delete stroke icons */
const DeleteSpaceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export interface SpaceLabellerPanelProps {
  zoneId: string;
  onClose: () => void;
  /** Focus room type control for this label id until consumed (e.g. after adding a footprint). */
  expandLabelId?: string | null;
  onExpandLabelConsumed?: () => void;
  /** Double-click on the space id focuses the plan on that footprint (2D). */
  onCenterFootprintForLabel?: (labelId: string) => void;
  onStartDrawFootprint?: () => void;
  onCancelDrawFootprint?: () => void;
  isDrawingFootprint?: boolean;
}

export const SpaceLabellerPanel: React.FC<SpaceLabellerPanelProps> = ({
  zoneId,
  onClose,
  expandLabelId = null,
  onExpandLabelConsumed,
  onCenterFootprintForLabel,
  onStartDrawFootprint,
  onCancelDrawFootprint,
  isDrawingFootprint = false,
}) => {
  const zones = useGeometryStore((s) => s.zones);
  const zone = useMemo(() => zones.find((z) => z.id === zoneId), [zones, zoneId]);
  const spaceLabelIds = useGeometryStore((s) => s.spaceLabelIds);
  const spaceLabelsById = useGeometryStore((s) => s.spaceLabelsById);
  const elementIds = useGeometryStore((s) => s.elementIds);
  const elementsById = useGeometryStore((s) => s.elementsById);
  const floors = useGeometryStore((s) => s.floors);
  const syncInferredSpaceLabelsForZone = useGeometryStore((s) => s.syncInferredSpaceLabelsForZone);

  const wallFingerprint = useMemo(() => {
    const els = elementIds.map((id) => elementsById[id]).filter(Boolean);
    return fingerprintInferenceWallSet(els, zoneId, floors, 0.1);
  }, [elementIds, elementsById, zoneId, floors]);

  const [footprintNotice, setFootprintNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    const r = syncInferredSpaceLabelsForZone(zoneId);
    if (r.changed && r.previousCount === 0 && r.footprintCount > 0) {
      // The layout effect synchronizes the external geometry store before paint; this notice
      // records the result of that one-time zone transition for the user.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFootprintNotice('Spaces inferred from walls — assign room types where needed.');
    }
  }, [zoneId, syncInferredSpaceLabelsForZone]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const r = syncInferredSpaceLabelsForZone(zoneId);
      if (r.changed) {
        setFootprintNotice(
          r.roomTypesCleared > 0
            ? `Wall layout changed — re-check room types (${r.roomTypesCleared} unassigned).`
            : 'Footprints updated from walls.',
        );
      }
    }, 420);
    return () => clearTimeout(t);
  }, [wallFingerprint, zoneId, syncInferredSpaceLabelsForZone]);

  useEffect(() => {
    if (!footprintNotice) return undefined;
    const u = window.setTimeout(() => setFootprintNotice(null), 5200);
    return () => clearTimeout(u);
  }, [footprintNotice]);

  const labels = useMemo(
    () =>
      spaceLabelIds
        .map((id) => spaceLabelsById[id])
        .filter((sl): sl is SpaceLabel => !!sl && sl.zoneId === zoneId),
    [spaceLabelIds, spaceLabelsById, zoneId],
  );

  const unlabeledFootprintCount = useMemo(
    () => labels.filter((sl) => !String(sl.room_type || '').trim()).length,
    [labels],
  );

  const openToLivingWarningsByLabelId = useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const label of labels) {
      const message = getOpenToLivingRoomAdjacencyWarning(label, labels);
      if (message) byId.set(label.id, [message]);
    }
    return byId;
  }, [labels]);

  return (
    <div className="space-labeller-panel">
      <span className="controls-label" style={{ marginBottom: 6 }}>
        SPACE LABELLER
      </span>

      <div className="space-labeller-panel__zone-draw-row">
        <span className="space-labeller-panel__zone-name" title={zone?.name}>
          {zone?.name ?? 'Zone'}
        </span>
        <button
          type="button"
          className="btn btn-nav btn-small"
          title="Re-run wall-to-space inference (same as automatic updates)"
          onClick={() => {
            const r = syncInferredSpaceLabelsForZone(zoneId, { force: true });
            if (r.changed || r.roomTypesCleared > 0) {
              setFootprintNotice(
                r.roomTypesCleared > 0
                  ? `Footprints refreshed — re-check room types (${r.roomTypesCleared} unassigned).`
                  : 'Footprints refreshed from walls.',
              );
            }
          }}
        >
          Refresh footprints
        </button>
        <button
          type="button"
          className="btn btn-nav btn-small"
          title={isDrawingFootprint ? 'Cancel drawing room footprint' : 'Draw a manual room footprint'}
          onClick={() => {
            if (isDrawingFootprint) onCancelDrawFootprint?.();
            else onStartDrawFootprint?.();
          }}
        >
          {isDrawingFootprint ? 'Cancel draw' : 'Draw room'}
        </button>
      </div>

      {unlabeledFootprintCount > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <ValidationPill
            variant="error"
            message={
              unlabeledFootprintCount === 1
                ? '1 space is not yet labelled'
                : `${unlabeledFootprintCount} spaces are not yet labelled`
            }
          />
        </div>
      ) : null}

      {footprintNotice ? (
        <div
          className="space-labeller-panel__notice"
          role="status"
          style={{
            fontSize: 12,
            marginBottom: 8,
            padding: '6px 8px',
            borderRadius: 6,
            background: 'rgba(255, 193, 7, 0.12)',
            border: '1px solid rgba(255, 193, 7, 0.35)',
          }}
        >
          {footprintNotice}
        </div>
      ) : null}

      <div className="space-labeller-panel__scroll">
        <div className="space-labeller-panel__grid">
          {labels.length === 0 ? (
            <div className="space-labeller-panel__empty">
              No closed spaces detected from walls across the storeys in this dwelling — check each floor has a
              closed loop of walls, or use Refresh footprints after editing.
            </div>
          ) : (
            labels.map((sl, i) => (
              <SpaceLabelCompactRow
                key={sl.id}
                displayIndex={i + 1}
                label={sl}
                expandForRoomTypeId={expandLabelId}
                onExpandForRoomTypeConsumed={onExpandLabelConsumed}
                onCenterFootprintForLabel={onCenterFootprintForLabel}
                warnings={openToLivingWarningsByLabelId.get(sl.id) ?? []}
              />
            ))
          )}
        </div>
      </div>

      <div className="element-creator-sticky-footer space-labeller-panel__footer">
        <div className="form-actions element-editor-actions-row element-editor-actions-row--one">
          <button
            type="button"
            className="btn btn-standard btn-yellow editor-action-btn editor-action-btn--primary"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

function SpaceLabelCompactRow({
  displayIndex,
  label,
  expandForRoomTypeId,
  onExpandForRoomTypeConsumed,
  onCenterFootprintForLabel,
  warnings,
}: {
  displayIndex: number;
  label: SpaceLabel;
  expandForRoomTypeId?: string | null;
  onExpandForRoomTypeConsumed?: () => void;
  onCenterFootprintForLabel?: (labelId: string) => void;
  warnings?: string[];
}) {
  const updateSpaceLabel = useGeometryStore((s) => s.updateSpaceLabel);
  const removeSpaceLabel = useGeometryStore((s) => s.removeSpaceLabel);
  const spaceLabellerSelectedLabelId = useGeometryStore((s) => s.spaceLabellerSelectedLabelId);
  const setSpaceLabellerSelectedLabelId = useGeometryStore((s) => s.setSpaceLabellerSelectedLabelId);
  const roomTypeSelectRef = useRef<HTMLSelectElement>(null);
  const isRowSelected = spaceLabellerSelectedLabelId === label.id;
  const canMarkOpenToLiving = canSpaceLabelBeMarkedOpenToLivingRoom(label);
  const isOpenToLiving = isSpaceLabelOpenToLivingRoom(label);

  const setOpenToLivingRoom = (nextValue: boolean) => {
    const nextExtraJson = { ...(label.extra_json ?? {}) };
    if (nextValue) {
      nextExtraJson[SPACE_LABEL_OPEN_TO_LIVING_ROOM_KEY] = true;
    } else {
      delete nextExtraJson[SPACE_LABEL_OPEN_TO_LIVING_ROOM_KEY];
    }
    updateSpaceLabel(label.id, {
      extra_json: Object.keys(nextExtraJson).length > 0 ? nextExtraJson : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!expandForRoomTypeId || expandForRoomTypeId !== label.id) return;
    roomTypeSelectRef.current?.focus();
    onExpandForRoomTypeConsumed?.();
  }, [expandForRoomTypeId, label.id, onExpandForRoomTypeConsumed]);

  return (
    <div
      className={`space-labeller-panel__row${isRowSelected ? ' space-labeller-panel__row--selected' : ''}`}
    >
      <button
        type="button"
        className="space-labeller-panel__row-id"
        title="Click to highlight on plan · Double-click to centre and switch floor"
        onClick={() => setSpaceLabellerSelectedLabelId(label.id)}
        onDoubleClick={(e) => {
          e.preventDefault();
          onCenterFootprintForLabel?.(label.id);
        }}
      >
        {displayIndex}
      </button>
      <div
        className="space-labeller-panel__row-type"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <StandardDropdown
          className="space-labeller-panel__dropdown-wrap"
          selectRef={roomTypeSelectRef}
          value={label.room_type || ''}
          onChange={(value) => updateSpaceLabel(label.id, { room_type: value })}
          options={ROOM_TYPE_OPTIONS.map((k) => ({ value: k, label: k === '' ? '(none)' : k }))}
          variant="ghost"
          size="sm"
        />
      </div>
      {canMarkOpenToLiving ? (
        <label
          className={`space-labeller-panel__living-toggle${isOpenToLiving ? ' space-labeller-panel__living-toggle--on' : ''}`}
          title="Include this space in the FHS living zone area when it is open to the living room"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isOpenToLiving}
            onChange={(e) => setOpenToLivingRoom(e.target.checked)}
          />
          <span>Open to living</span>
        </label>
      ) : null}
      <button
        type="button"
        className="space-labeller-panel__icon-btn"
        title="Remove space"
        aria-label={`Remove space ${displayIndex}`}
        onClick={(e) => {
          e.stopPropagation();
          removeSpaceLabel(label.id);
        }}
      >
        <DeleteSpaceIcon />
      </button>
      {warnings && warnings.length > 0 ? (
        <div className="space-labeller-panel__row-warning">
          {warnings.map((message, i) => (
            <ValidationPill
              key={`${label.id}-warning-${i}`}
              message={message}
              variant="warning"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
