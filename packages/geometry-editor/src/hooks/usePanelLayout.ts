// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useEffect, useLayoutEffect, useCallback } from 'react';

export type PanelRect = { x: number; y: number; width: number; height: number };
export type DetailsPanelMode = 'docked' | 'manual';
export type ActivePanel = 'elements' | 'details' | null;

const ELEMENTS_PANEL_STORAGE_KEY = 'vulcan.geometryCanvas.panels.v3.elements';
export const ELEMENTS_PANEL_MIN_W = 320;
export const ELEMENTS_PANEL_MIN_H = 140;
export const ELEMENTS_PANEL_DEFAULT_W = 420;
export const ELEMENTS_PANEL_DEFAULT_H = 200;

const DETAILS_PANEL_STORAGE_KEY = 'vulcan.geometryCanvas.panels.v3.details';
export const DETAILS_PANEL_MIN_W = 320;
export const DETAILS_PANEL_MIN_H = 240;
export const DETAILS_PANEL_DEFAULT_W = 340;
export const DETAILS_PANEL_DEFAULT_H = 360;
export const GEOMETRY_CANVAS_PANEL_INSET_PX = 12;
export type InitialElementsPanelPlacement = 'left' | 'right';
const DOCK_GAP_PX = 12;

export function getGeometryCanvasOverlaySafeTopPx(canvasEl: HTMLElement | null): number {
  if (!canvasEl) return GEOMETRY_CANVAS_PANEL_INSET_PX;

  const hostTopInset = Number.parseFloat(
    getComputedStyle(canvasEl).getPropertyValue('--geometry-canvas-host-top-inset'),
  );
  if (Number.isFinite(hostTopInset)) {
    return GEOMETRY_CANVAS_PANEL_INSET_PX + hostTopInset;
  }

  const filebar = canvasEl.querySelector('.overlay-filebar') as HTMLElement | null;
  if (filebar) {
    const topCss = parseFloat(getComputedStyle(filebar).top || '');
    if (Number.isFinite(topCss)) return topCss;
    const offsetTop = filebar.offsetTop;
    if (Number.isFinite(offsetTop) && offsetTop > 0) return offsetTop;
  }
  return GEOMETRY_CANVAS_PANEL_INSET_PX;
}

/** Where panels open: under the File bar while it is at the top, so it never covers them. */
export function getGeometryCanvasPanelTopPx(canvasEl: HTMLElement | null): number {
  const safeTop = getGeometryCanvasOverlaySafeTopPx(canvasEl);
  const filebar = canvasEl?.querySelector('.overlay-filebar') as HTMLElement | null;
  if (!filebar || filebar.offsetHeight <= 0 || filebar.offsetTop > safeTop + 1) return safeTop;
  return safeTop + filebar.offsetHeight + DOCK_GAP_PX;
}

export function usePanelLayout(
  stageSize: { width: number; height: number },
  containerRef: React.RefObject<HTMLDivElement | null>,
  initialElementsPanelPlacement: InitialElementsPanelPlacement = 'right',
) {
  const getCanvasEl = useCallback(() => {
    return (containerRef.current?.closest('.geometry-canvas') as HTMLElement | null) ?? null;
  }, [containerRef]);

  const clampElementsRectToCanvas = useCallback(
    (rect: PanelRect): PanelRect => {
      const canvasEl = getCanvasEl();
      if (!canvasEl) {
        const w = Math.max(ELEMENTS_PANEL_MIN_W, Math.min(rect.width, Math.max(ELEMENTS_PANEL_MIN_W, stageSize.width)));
        const h = Math.max(ELEMENTS_PANEL_MIN_H, Math.min(rect.height, Math.max(ELEMENTS_PANEL_MIN_H, stageSize.height)));
        const safeTop = GEOMETRY_CANVAS_PANEL_INSET_PX;
        const x = Math.max(0, Math.min(rect.x, stageSize.width - w));
        const y = Math.max(safeTop, Math.min(rect.y, stageSize.height - h));
        return { x, y, width: w, height: h };
      }
      const canvasRect = canvasEl.getBoundingClientRect();
      const w = Math.max(ELEMENTS_PANEL_MIN_W, Math.min(rect.width, Math.max(ELEMENTS_PANEL_MIN_W, canvasRect.width)));
      const h = Math.max(ELEMENTS_PANEL_MIN_H, Math.min(rect.height, Math.max(ELEMENTS_PANEL_MIN_H, canvasRect.height)));
      const safeTop = getGeometryCanvasOverlaySafeTopPx(canvasEl);
      const x = Math.max(0, Math.min(rect.x, canvasRect.width - w));
      const y = Math.max(safeTop, Math.min(rect.y, canvasRect.height - h));
      return { x, y, width: w, height: h };
    },
    [getCanvasEl, stageSize.width, stageSize.height]
  );

  const clampRectToCanvas = useCallback(
    (rect: PanelRect): PanelRect => {
      const canvasEl = getCanvasEl();
      if (!canvasEl) {
        const w = Math.max(DETAILS_PANEL_MIN_W, Math.min(rect.width, Math.max(DETAILS_PANEL_MIN_W, stageSize.width)));
        const h = Math.max(DETAILS_PANEL_MIN_H, Math.min(rect.height, Math.max(DETAILS_PANEL_MIN_H, stageSize.height)));
        const safeTop = GEOMETRY_CANVAS_PANEL_INSET_PX;
        const x = Math.max(0, Math.min(rect.x, stageSize.width - w));
        const y = Math.max(safeTop, Math.min(rect.y, stageSize.height - h));
        return { x, y, width: w, height: h };
      }
      const canvasRect = canvasEl.getBoundingClientRect();
      const w = Math.max(DETAILS_PANEL_MIN_W, Math.min(rect.width, Math.max(DETAILS_PANEL_MIN_W, canvasRect.width)));
      const h = Math.max(DETAILS_PANEL_MIN_H, Math.min(rect.height, Math.max(DETAILS_PANEL_MIN_H, canvasRect.height)));
      const safeTop = getGeometryCanvasOverlaySafeTopPx(canvasEl);
      const x = Math.max(0, Math.min(rect.x, canvasRect.width - w));
      const y = Math.max(safeTop, Math.min(rect.y, canvasRect.height - h));
      return { x, y, width: w, height: h };
    },
    [getCanvasEl, stageSize.width, stageSize.height]
  );

  const getElementsDefaultRect = useCallback((): PanelRect => {
    const canvasEl = getCanvasEl();
    const canvasRect = canvasEl?.getBoundingClientRect();
    const w = ELEMENTS_PANEL_DEFAULT_W;
    const h = ELEMENTS_PANEL_DEFAULT_H;
    const x = Math.max(
      0,
      (canvasRect?.width ?? stageSize.width) - GEOMETRY_CANVAS_PANEL_INSET_PX - w,
    );
    const y = getGeometryCanvasPanelTopPx(canvasEl);
    return clampElementsRectToCanvas({ x, y, width: w, height: h });
  }, [clampElementsRectToCanvas, getCanvasEl, stageSize.width]);

  // Docked Details sits in the right column and runs to the canvas bottom: under the
  // Elements panel when that panel shares the column, otherwise from the panel top.
  const getDockedDetailsRect = useCallback((elements: PanelRect, width: number): PanelRect => {
    const canvasEl = getCanvasEl();
    const canvasRect = canvasEl?.getBoundingClientRect();
    const canvasWidth = canvasRect?.width ?? stageSize.width;
    const canvasHeight = canvasRect?.height ?? stageSize.height;
    const x = Math.max(0, canvasWidth - GEOMETRY_CANVAS_PANEL_INSET_PX - width);
    const sharesColumn = elements.x + elements.width > x && elements.x < x + width;
    const below = elements.y + elements.height + DOCK_GAP_PX;
    // Under the Elements panel only while that leaves room for the panel's minimum height.
    const y = sharesColumn && canvasHeight - GEOMETRY_CANVAS_PANEL_INSET_PX - below >= DETAILS_PANEL_MIN_H
      ? below
      : getGeometryCanvasPanelTopPx(canvasEl);
    const height = Math.max(DETAILS_PANEL_DEFAULT_H, canvasHeight - GEOMETRY_CANVAS_PANEL_INSET_PX - y);
    return clampRectToCanvas({ x, y, width, height });
  }, [clampRectToCanvas, getCanvasEl, stageSize.width, stageSize.height]);

  const loadDetailsPanelState = useCallback((): { mode: DetailsPanelMode; rect: PanelRect } | null => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(DETAILS_PANEL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const mode: DetailsPanelMode = parsed?.mode === 'manual' ? 'manual' : 'docked';
      const rectRaw = parsed?.rect ?? parsed;
      const rect: PanelRect = {
        x: Number(rectRaw?.x ?? 0),
        y: Number(rectRaw?.y ?? 0),
        width: Number(rectRaw?.width ?? DETAILS_PANEL_DEFAULT_W),
        height: Number(rectRaw?.height ?? DETAILS_PANEL_DEFAULT_H)
      };
      return { mode, rect };
    } catch {
      return null;
    }
  }, []);

  const loadElementsPanelState = useCallback((): { rect: PanelRect } | null => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(ELEMENTS_PANEL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const rectRaw = parsed?.rect ?? parsed;
      const rect: PanelRect = {
        x: Number(rectRaw?.x ?? 0),
        y: Number(rectRaw?.y ?? 0),
        width: Number(rectRaw?.width ?? ELEMENTS_PANEL_DEFAULT_W),
        height: Number(rectRaw?.height ?? ELEMENTS_PANEL_DEFAULT_H)
      };
      return { rect };
    } catch {
      return null;
    }
  }, []);

  const [initialDetailsPanelState] = useState(loadDetailsPanelState);
  const [initialElementsPanelState] = useState(loadElementsPanelState);
  const [detailsMode, setDetailsMode] = useState<DetailsPanelMode>(
    () => initialDetailsPanelState?.mode ?? 'docked',
  );
  const [detailsRect, setDetailsRect] = useState<PanelRect>(() =>
    initialDetailsPanelState?.rect ?? {
      x: 0,
      y: GEOMETRY_CANVAS_PANEL_INSET_PX,
      width: DETAILS_PANEL_DEFAULT_W,
      height: DETAILS_PANEL_DEFAULT_H,
    }
  );
  const [elementsRect, setElementsRect] = useState<PanelRect>(() =>
    initialElementsPanelState?.rect ?? {
      x: 0,
      y: GEOMETRY_CANVAS_PANEL_INSET_PX,
      width: ELEMENTS_PANEL_DEFAULT_W,
      height: ELEMENTS_PANEL_DEFAULT_H,
    }
  );
  const [panelLayoutReady, setPanelLayoutReady] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  const getDetailsDefaultRect = useCallback(
    (): PanelRect => getDockedDetailsRect(elementsRect, DETAILS_PANEL_DEFAULT_W),
    [elementsRect, getDockedDetailsRect],
  );

  // One-time cleanup: remove older saved panel layouts
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v1.elements');
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v1.details');
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v2.elements');
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v2.details');
    } catch { /* swallow: best-effort */ }
  }, []);

  // Resolve the first layout only after the portalled canvas and its composition
  // inset exist. Stored layouts are preserved and clamped; fresh layouts start
  // at exactly the same rects used by double-click reset.
  useLayoutEffect(() => {
    const initializeOrClampPanels = () => {
      if (!getCanvasEl()) return;

      if (!panelLayoutReady) {
        const elements = initialElementsPanelState === null
          ? initialElementsPanelPlacement === 'left'
            ? clampElementsRectToCanvas({
                x: 0,
                y: getGeometryCanvasPanelTopPx(getCanvasEl()),
                width: ELEMENTS_PANEL_DEFAULT_W,
                height: ELEMENTS_PANEL_DEFAULT_H,
              })
            : getElementsDefaultRect()
          : clampElementsRectToCanvas(initialElementsPanelState.rect);
        setElementsRect(elements);
        setDetailsRect(
          initialDetailsPanelState === null
            ? getDockedDetailsRect(elements, DETAILS_PANEL_DEFAULT_W)
            : clampRectToCanvas(initialDetailsPanelState.rect),
        );
        setPanelLayoutReady(true);
        return;
      }

      setElementsRect((prev) => clampElementsRectToCanvas(prev));
      if (detailsMode === 'manual') {
        setDetailsRect((prev) => clampRectToCanvas(prev));
      }
    };

    initializeOrClampPanels();
    window.addEventListener('resize', initializeOrClampPanels);
    return () => window.removeEventListener('resize', initializeOrClampPanels);
  }, [
    clampElementsRectToCanvas,
    clampRectToCanvas,
    detailsMode,
    getCanvasEl,
    getDockedDetailsRect,
    getElementsDefaultRect,
    initialDetailsPanelState,
    initialElementsPanelPlacement,
    initialElementsPanelState,
    panelLayoutReady,
  ]);

  // Docked Details follows the Elements panel and the canvas size until it is moved or resized.
  useEffect(() => {
    if (!panelLayoutReady || detailsMode !== 'docked') return;

    const updateDockedPosition = () => {
      if (!getCanvasEl()) return;
      const docked = getDockedDetailsRect(elementsRect, detailsRect.width);
      setDetailsRect((prev) => {
        if (
          Math.abs(prev.x - docked.x) < 0.5 &&
          Math.abs(prev.y - docked.y) < 0.5 &&
          Math.abs(prev.width - docked.width) < 0.5 &&
          Math.abs(prev.height - docked.height) < 0.5
        )
          return prev;
        return docked;
      });
    };

    const timeoutId = window.setTimeout(updateDockedPosition, 0);
    window.addEventListener('resize', updateDockedPosition);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', updateDockedPosition);
    };
  }, [
    detailsMode,
    detailsRect.width,
    elementsRect,
    getDockedDetailsRect,
    getCanvasEl,
    panelLayoutReady,
  ]);

  // Persist Details panel state
  useEffect(() => {
    if (!panelLayoutReady) return;
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(
        DETAILS_PANEL_STORAGE_KEY,
        JSON.stringify({ mode: detailsMode, rect: detailsRect })
      );
    } catch { /* swallow: best-effort */ }
  }, [detailsMode, detailsRect, panelLayoutReady]);

  // Persist Elements panel state
  useEffect(() => {
    if (!panelLayoutReady) return;
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(ELEMENTS_PANEL_STORAGE_KEY, JSON.stringify({ rect: elementsRect }));
    } catch { /* swallow: best-effort */ }
  }, [elementsRect, panelLayoutReady]);

  return {
    detailsMode,
    setDetailsMode,
    detailsRect,
    setDetailsRect,
    elementsRect,
    setElementsRect,
    activePanel,
    setActivePanel,
    clampElementsRectToCanvas,
    getElementsDefaultRect,
    clampRectToCanvas,
    getDetailsDefaultRect,
  };
}
