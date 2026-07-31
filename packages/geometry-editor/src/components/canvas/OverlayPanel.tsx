// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { worldToCanvas } from '../../lib/shapeUtils';
import type { GuideOverlay, GuideOverlaySource } from '../../geometry/guideOverlay';
import {
  nearestLowerFloorWithOverlayRecord,
  resolveGuideOverlayForFloor,
  type GuideOverlayByFloor,
} from '../../geometry/guideOverlayByFloor';
import { fhsFloorLabelForCanvasFloor } from '../../lib/storeySemantics';
import { DraftSafeNumberInput } from '../DraftSafeNumberInput';

const PER_FLOOR_HINT_DISMISSED_KEY = 'vulcan.overlay.perFloorHintDismissed.v1';

export type OverlayCalPointRef = {
  canvas: { x: number; y: number };
  world: { x: number; y: number };
  imgPx: { x: number; y: number };
} | null;

export interface OverlayPanelProps {
  /** Root element ref (for click-outside handling in parent). */
  panelRef?: React.Ref<HTMLDivElement | null>;
  showOverlayPanel: boolean;
  overlayMoveMode: boolean;
  setOverlayMoveMode: (mode: boolean) => void;
  overlayCalibrateMode: boolean;
  setOverlayCalibrateMode: (mode: boolean) => void;
  overlayCalRealM: string;
  setOverlayCalRealM: (val: string) => void;
  overlayCalStep: 0 | 1 | 2;
  setOverlayCalStep: (step: 0 | 1 | 2) => void;
  overlayImg: HTMLImageElement | null;
  overlayCalFirstRef: React.RefObject<OverlayCalPointRef>;
  overlayCalSecondRef: React.RefObject<OverlayCalPointRef>;
  overlayCalDistPxRef: React.RefObject<number | null>;
  setOverlayCalSecondCanvas: (v: { x: number; y: number } | null) => void;
  setOverlayCalHoverCanvas: (v: { x: number; y: number } | null) => void;
  guideOverlay: GuideOverlay | null;
  guideOverlaySource?: GuideOverlaySource | null;
  /** Optional — used to label the active-floor overlay record as inherited or customised. */
  guideOverlayByFloor?: GuideOverlayByFloor;
  /** Active floor's storey index. */
  currentFloorZ?: number;
  updateGuideOverlay: (updates: Partial<GuideOverlay>) => void;
  clearGuideOverlay: () => void;
  /** Drop only the active floor's record so it falls back to inheritance. */
  resetGuideOverlayForActiveFloor?: () => void;
  overlayFileInputRef: React.RefObject<HTMLInputElement | null>;
  handleOverlayFileChosen: (file: File) => void;
  /** Called when entering Move or Calibrate mode so parent can reset drawing state */
  onResetDrawingState: () => void;
  /** Viewport centering after calibration */
  scale: number;
  canvasCenter: { x: number; y: number };
  setPanOffset: (offset: { x: number; y: number }) => void;
}

export const OverlayPanel = memo<OverlayPanelProps>(function OverlayPanel({
  panelRef,
  showOverlayPanel,
  overlayMoveMode,
  setOverlayMoveMode,
  overlayCalibrateMode,
  setOverlayCalibrateMode,
  overlayCalRealM,
  setOverlayCalRealM,
  setOverlayCalStep,
  overlayImg,
  overlayCalFirstRef,
  overlayCalSecondRef,
  overlayCalDistPxRef,
  setOverlayCalSecondCanvas,
  setOverlayCalHoverCanvas,
  guideOverlay,
  guideOverlaySource,
  guideOverlayByFloor,
  currentFloorZ,
  updateGuideOverlay,
  clearGuideOverlay,
  resetGuideOverlayForActiveFloor,
  overlayFileInputRef,
  handleOverlayFileChosen,
  onResetDrawingState,
  scale,
  canvasCenter,
  setPanOffset,
}) {
  // Per-floor inheritance state — only meaningful when the consumer passes the by-floor map.
  const activeFloorZ = typeof currentFloorZ === 'number' && Number.isFinite(currentFloorZ) ? currentFloorZ : 0;
  const resolved = guideOverlayByFloor
    ? resolveGuideOverlayForFloor(guideOverlayByFloor, activeFloorZ)
    : null;
  const overlayLoaded = !!guideOverlay?.path;
  const ownsActiveFloorRecord = !!resolved?.ownedByActiveFloor;
  const inheritedFromFloor = resolved?.inheritedFromFloor ?? null;
  // The Customised/Reset affordance only makes sense when there's a strictly-lower record to fall
  // back to. On the canonical floor (e.g. ground floor with the only record) there's nothing to
  // "match below" — Reset would just delete the overlay, which is what `Clear` is for.
  const lowerFloorWithRecord = guideOverlayByFloor
    ? nearestLowerFloorWithOverlayRecord(guideOverlayByFloor, activeFloorZ)
    : null;
  const hasLowerInheritanceTarget = lowerFloorWithRecord !== null;
  const inheritedFromBelow =
    inheritedFromFloor !== null && inheritedFromFloor < activeFloorZ;
  const activeFloorLabel = fhsFloorLabelForCanvasFloor(activeFloorZ);
  const lowerFloorLabel = lowerFloorWithRecord !== null ? fhsFloorLabelForCanvasFloor(lowerFloorWithRecord) : '';
  const inheritedFromFloorLabel =
    inheritedFromFloor !== null ? fhsFloorLabelForCanvasFloor(inheritedFromFloor) : '';

  // Dismissable hint shown next to Move (per browser, not per workspace) on first visit.
  const [perFloorHintDismissed, setPerFloorHintDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(PER_FLOOR_HINT_DISMISSED_KEY) === '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!perFloorHintDismissed && typeof window !== 'undefined') {
      // Sync across tabs so dismissing in one panel doesn't leave the hint up elsewhere.
      const onStorage = (ev: StorageEvent) => {
        if (ev.key === PER_FLOOR_HINT_DISMISSED_KEY && ev.newValue === '1') {
          setPerFloorHintDismissed(true);
        }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }
    return undefined;
  }, [perFloorHintDismissed]);
  const dismissPerFloorHint = () => {
    setPerFloorHintDismissed(true);
    try {
      window.localStorage.setItem(PER_FLOOR_HINT_DISMISSED_KEY, '1');
    } catch {
      // ignore quota / privacy-mode failures
    }
  };

  // The hint pill is portaled to <body> with position:fixed so it can poke out above the
  // toolbar (which has overflow:hidden). We re-measure on resize/scroll to keep it glued
  // to the Move button.
  const moveButtonAnchorRef = useRef<HTMLSpanElement | null>(null);
  const [hintAnchor, setHintAnchor] = useState<{ left: number; top: number } | null>(null);
  const showHint = !perFloorHintDismissed && !!guideOverlay?.path && showOverlayPanel;
  useLayoutEffect(() => {
    if (!showHint) {
      setHintAnchor(null);
      return;
    }
    const measure = () => {
      const node = moveButtonAnchorRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      setHintAnchor({ left: r.left + r.width / 2, top: r.top - 10 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [showHint]);

  if (!showOverlayPanel) return null;

  return (
    <div ref={panelRef} className="glass-panel overlay-guidepanel">
      <span className="controls-label">Overlay</span>

      <input
        ref={overlayFileInputRef}
        type="file"
        accept="image/png,image/jpeg,application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          handleOverlayFileChosen(f);
        }}
      />

      {!guideOverlay?.path ? (
        <button
          className="draw-button overlay-primary-button"
          onClick={() => overlayFileInputRef.current?.click()}
          title="Select overlay file"
          aria-label="Select overlay file"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l4 4h-3v7h-2V7H8l4-4z" fill="currentColor"/>
            <path d="M5 14v5h14v-5h2v7H3v-7h2z" fill="currentColor" opacity="0.65"/>
          </svg>
          <span>Select overlay file</span>
        </button>
      ) : (
        <>
          <button
            className="draw-button"
            onClick={() => overlayFileInputRef.current?.click()}
            title={
              guideOverlaySource?.kind === 'pdf'
                ? `Replace overlay (current: ${guideOverlaySource.source_filename}, page ${guideOverlaySource.page ?? 1})`
                : `Replace overlay (current: ${guideOverlay.path})`
            }
            aria-label="Replace overlay file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l4 4h-3v7h-2V7H8l4-4z" fill="currentColor"/>
              <path d="M5 14v5h14v-5h2v7H3v-7h2z" fill="currentColor" opacity="0.65"/>
            </svg>
            <span>Replace</span>
          </button>

          <button
            className="draw-button"
            onClick={() => clearGuideOverlay()}
            disabled={!guideOverlay}
            title="Delete overlay (removes from every floor)"
            aria-label="Delete overlay"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3h6l1 2h5v2H3V5h5l1-2z" fill="currentColor"/>
              <path d="M6 9h12l-1 12H7L6 9z" fill="currentColor" opacity="0.65"/>
            </svg>
            <span>Delete</span>
          </button>

          <span className="overlay-divider" />

          <span ref={moveButtonAnchorRef} className="overlay-perfloor-hint-anchor">
            <button
              className={`draw-button overlay-move-button ${overlayMoveMode ? 'active' : ''}`}
              disabled={!guideOverlay}
              onClick={() => {
                if (!guideOverlay) return;
                if (!overlayMoveMode) {
                  setOverlayCalibrateMode(false);
                  overlayCalFirstRef.current = null;
                  setOverlayCalSecondCanvas(null);
                  setOverlayCalHoverCanvas(null);
                  onResetDrawingState();
                }
                setOverlayMoveMode(!overlayMoveMode);
              }}
              title={overlayMoveMode ? 'Exit Move mode' : 'Move overlay (drag on canvas)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2l3 3h-2v4h4V7l3 3-3 3v-2h-4v4h2l-3 3-3-3h2v-4H7v2l-3-3 3-3v2h4V5H9l3-3z" fill="currentColor"/>
              </svg>
              <span>Move</span>
            </button>
          </span>
          {showHint && hintAnchor && typeof document !== 'undefined' && createPortal(
            <span
              className="overlay-perfloor-hint"
              role="note"
              style={{ left: hintAnchor.left, top: hintAnchor.top }}
            >
              Each floor remembers its own overlay. Click Move to change.
              <button
                type="button"
                className="overlay-perfloor-hint-dismiss"
                onClick={dismissPerFloorHint}
                aria-label="Dismiss overlay hint"
                title="Dismiss"
              >
                ×
              </button>
            </span>,
            document.body,
          )}

          {overlayMoveMode && overlayLoaded && (
            <>
              {ownsActiveFloorRecord && hasLowerInheritanceTarget ? (
                <>
                  <span
                    className="overlay-status"
                    title={`${activeFloorLabel} overrides the position from ${lowerFloorLabel}`}
                  >
                    Customised
                  </span>
                  {resetGuideOverlayForActiveFloor && (
                    <button
                      className="draw-button"
                      onClick={() => resetGuideOverlayForActiveFloor()}
                      title={`Drop ${activeFloorLabel} overlay overrides and inherit from ${lowerFloorLabel}`}
                    >
                      Reset to match floor below
                    </button>
                  )}
                </>
              ) : !ownsActiveFloorRecord && inheritedFromBelow ? (
                <span
                  className="overlay-status"
                  title={`Inherited from ${inheritedFromFloorLabel}`}
                >
                  Matches floor below
                </span>
              ) : null}
            </>
          )}

          <span className="overlay-divider" />

          <span className="overlay-label">Opacity</span>
          <input
            className="overlay-range"
            type="range"
            min={0}
            max={100}
            value={Math.round(((guideOverlay?.opacity01 ?? 0.5) * 100))}
            disabled={!guideOverlay}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isFinite(v)) return;
              updateGuideOverlay({ opacity01: Math.max(0, Math.min(1, v / 100)) });
            }}
          />
          <span className="overlay-value">
            {Math.round(((guideOverlay?.opacity01 ?? 0.5) * 100))}%
          </span>

          <span className="overlay-divider" />

          <button
            className={`draw-button ${overlayCalibrateMode ? 'active' : ''}`}
            disabled={!guideOverlay}
            title={
              overlayCalibrateMode
                ? 'Cancel calibration'
                : (guideOverlay.calibration ? 'Recalibrate overlay scale' : 'Calibrate overlay scale')
            }
            onClick={() => {
              if (!guideOverlay) return;

              if (overlayCalibrateMode) {
                setOverlayCalibrateMode(false);
                overlayCalFirstRef.current = null;
                overlayCalSecondRef.current = null;
                overlayCalDistPxRef.current = null;
                setOverlayCalSecondCanvas(null);
                setOverlayCalHoverCanvas(null);
                setOverlayCalStep(0);
                return;
              }

              setOverlayMoveMode(false);
              onResetDrawingState();

              overlayCalFirstRef.current = null;
              overlayCalSecondRef.current = null;
              overlayCalDistPxRef.current = null;
              setOverlayCalSecondCanvas(null);
              setOverlayCalHoverCanvas(null);
              setOverlayCalStep(0);
              setOverlayCalibrateMode(true);
            }}
          >
            {overlayCalibrateMode ? 'Cancel' : (guideOverlay?.calibration ? 'Recalibrate' : 'Calibrate')}
          </button>
        </>
      )}

      {overlayCalibrateMode && (
        <>
          <span className="overlay-divider" />
          <span className="overlay-status">
            {!overlayCalFirstRef.current
              ? 'Click first point…'
              : !overlayCalSecondRef.current
                ? 'Click second point…'
                : 'Enter real length:'}
          </span>
          {overlayCalSecondRef.current && (
            <>
              <DraftSafeNumberInput
                className="compact-input overlay-number"
                style={{ width: 86 }}
                step="0.01"
                min="0"
                value={overlayCalRealM}
                onChange={(e) => setOverlayCalRealM(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  (e.currentTarget.closest('.overlay-guidepanel') as HTMLElement | null)?.querySelector<HTMLButtonElement>('button[data-cal-apply="true"]')?.click?.();
                }}
                title="Real length in metres"
              />
              <span className="overlay-label">m</span>
              <button
                className="draw-button"
                data-cal-apply="true"
                onClick={() => {
                  const first = overlayCalFirstRef.current;
                  const second = overlayCalSecondRef.current;
                  const distPx = overlayCalDistPxRef.current;
                  if (!guideOverlay || !first || !second || !distPx) return;

                  const realM = parseFloat(String(overlayCalRealM || '').trim());
                  if (!Number.isFinite(realM) || realM <= 0) {
                    alert('Please enter a valid real length in metres.');
                    return;
                  }

                  const nextPxPerM = distPx / realM;
                  if (!Number.isFinite(nextPxPerM) || nextPxPerM <= 0) {
                    alert('Calibration failed. Try again.');
                    return;
                  }

                  updateGuideOverlay({
                    pxPerM: nextPxPerM,
                    calibration: {
                      a_world_m: { x: first.world.x, y: first.world.y },
                      b_world_m: { x: second.world.x, y: second.world.y },
                      real_m: realM
                    }
                  });

                  try {
                    if (overlayImg && guideOverlay?.pos_m) {
                      const width_m = overlayImg.width / nextPxPerM;
                      const height_m = overlayImg.height / nextPxPerM;
                      const overlayCenterWorld = {
                        x: guideOverlay.pos_m.x + (width_m / 2),
                        y: guideOverlay.pos_m.y - (height_m / 2),
                      };
                      const target = worldToCanvas(overlayCenterWorld, scale, { x: 0, y: 0 }, canvasCenter);
                      setPanOffset({ x: canvasCenter.x - target.x, y: canvasCenter.y - target.y });
                    }
                  } catch {
                    // ignore
                  }

                  setOverlayCalibrateMode(false);
                  overlayCalFirstRef.current = null;
                  overlayCalSecondRef.current = null;
                  overlayCalDistPxRef.current = null;
                  setOverlayCalSecondCanvas(null);
                  setOverlayCalHoverCanvas(null);
                  setOverlayCalStep(0);
                }}
                title="Apply calibration"
              >
                Apply
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
});
