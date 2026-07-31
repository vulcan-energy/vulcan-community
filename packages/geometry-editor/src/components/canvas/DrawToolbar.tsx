// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo, useCallback, useEffect, useMemo } from 'react';
import type { DrawMode } from '../../hooks/useDrawingMode';
import type { Element, ElementType, Floor } from '../../stores/geometryStore';
import { ELEMENT_TYPE_ORDER } from '../../lib/elementTypeMetadata';
import { CANVAS_CONSTANTS } from '../../lib/canvasConstants';
import { StandardDropdown } from '../StandardDropdown';
import { ElementTypePicker } from '../ElementTypePicker';
import { FloorPickerDropdown } from './FloorPickerDropdown';
import { isServiceLineDrawMode, isServiceLineElementType } from '../../lib/serviceLineDrawModes';
import {
  MVHR_DUCT_ROLES,
  MVHR_TERMINAL_ROLES,
  type MvhrDuctRole,
  type MvhrTerminalRole,
} from '../../lib/mvhrDuctwork';

const COMPLIANCE_EXCLUDED_DRAW_TYPES: ElementType[] = ['CombustionAppliances'];

function drawingTypeIncludes(types: readonly ElementType[], type: ElementType): boolean {
  return types.includes(type);
}

function getDefaultDrawModeForElementType(type: ElementType): DrawMode {
  if (isServiceLineElementType(type)) return 'tb-plan-line';
  if (type === 'BuildingElementGround' || type === 'ContextShading' || type === 'OnSiteGeneration') {
    return 'polygon';
  }
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POINT, type)) return 'point';
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.LINE, type)) return 'line';
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POLYGON, type)) return 'polygon';
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.SLOPED_POLYGON, type)) return 'sloped-polygon';
  return 'none';
}

function getDrawModeOptionsForElementType(type: ElementType): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.ROOM, type)) {
    options.push({ value: 'room', label: 'Room [K]' });
    options.push({ value: 'orthogonal-room', label: '□ Orthogonal Room [Q]' });
  }
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.LINE, type)) {
    if (isServiceLineElementType(type)) {
      options.push({ value: 'tb-plan-line', label: '— Plan Line [L]' });
      options.push({ value: 'tb-vertical-line', label: '↕ Vertical Line [V]' });
      options.push({ value: 'tb-slope-line', label: '⟋ Slope Line [S]' });
    } else {
      options.push({ value: 'line', label: '— Line [L]' });
    }
  }
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POLYGON, type)) {
    options.push({ value: 'polygon', label: '□ Polygon [P]' });
  }
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.SLOPED_POLYGON, type)) {
    options.push({ value: 'sloped-polygon', label: '▱ Slope [J]' });
  }
  if (type === 'BuildingElementOpaque') {
    options.push({ value: 'dormer', label: '⌂ Dormer' });
  }
  if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POINT, type)) {
    options.push({ value: 'point', label: '• Point [O]' });
  }
  return options;
}

export type CanvasViewMode = '2d' | '3d';

export interface DrawToolbarProps {
  drawMode: DrawMode;
  setDrawMode: (mode: DrawMode) => void;
  drawElementType: ElementType;
  setDrawElementType: (type: ElementType) => void;
  showOverlayPanel: boolean;
  setShowOverlayPanel: (show: boolean) => void;
  showShortcuts: boolean;
  setShowShortcuts: (show: boolean) => void;
  currentFloorZ: number;
  setCurrentFloorZ: (z: number) => void;
  floors: Floor[];
  elementsById: Record<string, Element>;
  ensureFloorForZ: (z: number) => string;
  removeFloor: (id: string) => void;
  updateFloor: (id: string, updates: Partial<Floor>) => void;
  setDrawPoints: (points: Array<{ x: number; y: number }>) => void;
  setRoomWalls: (walls: Array<{ x: number; y: number }>) => void;
  setRoomWallElements: (ids: string[]) => void;
  setOrthogonalRoomStart: (point: { x: number; y: number } | null) => void;
  setOrthogonalRoomEnd: (point: { x: number; y: number } | null) => void;
  drawPreset: string;
  setDrawPreset: (preset: string) => void;
  presetOptions: Array<{ value: string; label: string; source?: 'system' | 'user' }>;
  drawMvhrDuctRole: MvhrDuctRole;
  setDrawMvhrDuctRole: (role: MvhrDuctRole) => void;
  drawMvhrTerminalRole: MvhrTerminalRole;
  setDrawMvhrTerminalRole: (role: MvhrTerminalRole) => void;
  viewMode: CanvasViewMode;
  setViewMode: (mode: CanvasViewMode) => void;
  onPrefetch3DView?: () => void;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  dragHandle?: React.ReactNode;
  /** Shown above the draw toolbar (e.g. auto thermal bridge preview entry). */
  leadingAccessory?: React.ReactNode;
  renderLeadingAccessory?: () => React.ReactNode;
  complianceValidationEnabled?: boolean;
  /** When true, toolbar is not rendered (rare; floor picker stays available when Space Labeller is open). */
  hidden?: boolean;
}

export const DrawToolbar = memo<DrawToolbarProps>(function DrawToolbar({
  drawMode,
  setDrawMode,
  drawElementType,
  setDrawElementType,
  showOverlayPanel,
  setShowOverlayPanel,
  showShortcuts,
  setShowShortcuts,
  currentFloorZ,
  setCurrentFloorZ,
  floors,
  elementsById,
  ensureFloorForZ,
  removeFloor,
  updateFloor,
  setDrawPoints,
  setRoomWalls,
  setRoomWallElements,
  setOrthogonalRoomStart,
  setOrthogonalRoomEnd,
  drawPreset,
  setDrawPreset,
  presetOptions,
  drawMvhrDuctRole,
  setDrawMvhrDuctRole,
  drawMvhrTerminalRole,
  setDrawMvhrTerminalRole,
  viewMode,
  setViewMode,
  onPrefetch3DView,
  complianceValidationEnabled = false,
  wrapperRef,
  style,
  dragHandle,
  leadingAccessory,
  renderLeadingAccessory,
  hidden = false,
}) {
  const in3D = viewMode === '3d';
  const drawElementTypeOptions = useMemo(
    () =>
      ELEMENT_TYPE_ORDER.filter(
        (type) => !(complianceValidationEnabled && COMPLIANCE_EXCLUDED_DRAW_TYPES.includes(type))
      ),
    [complianceValidationEnabled]
  );
  const drawModeOptions = useMemo(
    () => getDrawModeOptionsForElementType(drawElementType),
    [drawElementType],
  );

  const resetDraftForMode = useCallback((mode: DrawMode) => {
    setShowShortcuts(false);
    setDrawPoints([]);
    if (mode === 'room') {
      setRoomWalls([]);
      setRoomWallElements([]);
    } else if (mode === 'orthogonal-room') {
      setOrthogonalRoomStart(null);
      setOrthogonalRoomEnd(null);
    } else {
      setRoomWalls([]);
      setRoomWallElements([]);
      setOrthogonalRoomStart(null);
      setOrthogonalRoomEnd(null);
    }
  }, [
    setDrawPoints,
    setOrthogonalRoomEnd,
    setOrthogonalRoomStart,
    setRoomWallElements,
    setRoomWalls,
    setShowShortcuts,
  ]);

  const handleDrawModeChange = useCallback((value: string) => {
    const nextMode = value === '' ? 'none' : (value as DrawMode);
    setDrawMode(nextMode);
    resetDraftForMode(nextMode);
  }, [resetDraftForMode, setDrawMode]);

  const handleDrawElementTypeChange = useCallback((value: string) => {
    const nextType = value as ElementType;
    const nextMode = getDefaultDrawModeForElementType(nextType);
    setDrawElementType(nextType);
    setDrawMode(nextMode);
    resetDraftForMode(nextMode);
  }, [resetDraftForMode, setDrawElementType, setDrawMode]);

  useEffect(() => {
    if (complianceValidationEnabled && COMPLIANCE_EXCLUDED_DRAW_TYPES.includes(drawElementType)) {
      const nextMode = getDefaultDrawModeForElementType('BuildingElementOpaque');
      setDrawElementType('BuildingElementOpaque');
      setDrawMode(nextMode);
      resetDraftForMode(nextMode);
    }
  }, [complianceValidationEnabled, drawElementType, resetDraftForMode, setDrawElementType, setDrawMode]);

  useEffect(() => {
    if (!isServiceLineElementType(drawElementType)) {
      if (isServiceLineDrawMode(drawMode)) {
        if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.LINE, drawElementType)) {
          setDrawMode('line');
        } else if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POINT, drawElementType)) {
          setDrawMode('point');
        } else if (drawingTypeIncludes(CANVAS_CONSTANTS.DRAWING_ELEMENT_TYPES.POLYGON, drawElementType)) {
          setDrawMode('polygon');
        } else {
          setDrawMode('none');
        }
      }
    }
  }, [drawElementType, drawMode, setDrawMode]);

  if (hidden) {
    return null;
  }
  const leadingAccessoryNode = renderLeadingAccessory?.() ?? leadingAccessory;

  return (
    <div
      ref={wrapperRef}
      className="overlay-drawtoolbar-wrap"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}
    >
      {leadingAccessoryNode}
      <div className="glass-panel overlay-drawtoolbar">
        <div className="view-mode-segment" role="group" aria-label="Canvas view mode">
          <button
            type="button"
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
            title="2D plan view"
          >
            2D
          </button>
          <button
            type="button"
            className={viewMode === '3d' ? 'active' : ''}
            onPointerEnter={onPrefetch3DView}
            onFocus={onPrefetch3DView}
            onMouseDown={onPrefetch3DView}
            onClick={() => {
              onPrefetch3DView?.();
              setViewMode('3d');
            }}
            title="3D view"
          >
            3D
          </button>
        </div>

        <span className="controls-label">Draw</span>

        {/* Element type selector for draw mode */}
        <ElementTypePicker
          value={drawElementType}
          onChange={handleDrawElementTypeChange}
          options={drawElementTypeOptions}
          ariaLabel="Element type for new drawings"
          className="draw-element-type-picker"
          disabled={in3D}
        />

        {drawElementType === 'MechanicalVentilationDuctwork' && (
          <StandardDropdown
            value={drawMvhrDuctRole}
            onChange={(value) => setDrawMvhrDuctRole(value as MvhrDuctRole)}
            options={MVHR_DUCT_ROLES.map((role) => ({ value: role, label: role }))}
            size="sm"
            variant="ghost"
            className="mvhr-role-dropdown"
          />
        )}

        {drawElementType === 'MechanicalVentilationTerminal' && (
          <StandardDropdown
            value={drawMvhrTerminalRole}
            onChange={(value) => setDrawMvhrTerminalRole(value as MvhrTerminalRole)}
            options={MVHR_TERMINAL_ROLES.map((role) => ({ value: role, label: role }))}
            size="sm"
            variant="ghost"
            className="mvhr-role-dropdown"
          />
        )}

        {/* Element preset selector - only shown when presets exist for the element type */}
        {presetOptions.length > 0 && (
          <StandardDropdown
            value={drawPreset}
            onChange={(value: string) => setDrawPreset(value)}
            options={presetOptions}
            placeholder="Preset..."
            size="sm"
            variant="ghost"
            className="preset-dropdown"
          />
        )}

        <FloorPickerDropdown
          currentFloorZ={currentFloorZ}
          floors={floors}
          elementsById={elementsById}
          onSelectFloor={(z) => {
            ensureFloorForZ(z);
            setCurrentFloorZ(z);
          }}
          onAddFloor={(z) => {
            ensureFloorForZ(z);
            setCurrentFloorZ(z);
          }}
          onDeleteFloor={removeFloor}
          onUpdateFloor={(id, updates) => updateFloor(id, updates)}
          addDisabled={in3D}
        />
        <StandardDropdown
          value={drawMode === 'none' ? '' : drawMode}
          onChange={handleDrawModeChange}
          options={drawModeOptions}
          placeholder="Select shape..."
          size="sm"
          variant="ghost"
          className="shape-dropdown"
        />
        <button
          className={`draw-button ${showOverlayPanel ? 'active' : ''}`}
          onClick={() => setShowOverlayPanel(!showOverlayPanel)}
          title="Overlay controls"
          disabled={in3D}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"
              fill="currentColor"
              opacity="0.9"
            />
            <path
              d="M8 9h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V9z"
              fill="currentColor"
              opacity="0.35"
            />
          </svg>
          <span>Overlay</span>
        </button>
        <button
          className={`draw-button guide-button ${showShortcuts ? 'active' : ''}`}
          onClick={() => {
            setDrawMode('none');
            setDrawPoints([]);
            setRoomWalls([]);
            setRoomWallElements([]);
            setOrthogonalRoomStart(null);
            setOrthogonalRoomEnd(null);
            setShowShortcuts(!showShortcuts);
          }}
          title="Show keyboard shortcuts guide"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              fill="currentColor"
            />
          </svg>
          <span>Controls</span>
        </button>
        {dragHandle}
      </div>
    </div>
  );
});
