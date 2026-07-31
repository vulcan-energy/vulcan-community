// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useEffect, useLayoutEffect, useCallback } from 'react';

export type PanelRect = { x: number; y: number; width: number; height: number };
export type DetailsPanelMode = 'docked' | 'manual';
export type ActivePanel = 'elements' | 'details' | null;

const ELEMENTS_PANEL_STORAGE_KEY = 'vulcan.geometryCanvas.panels.v2.elements';
export const ELEMENTS_PANEL_MIN_W = 320;
export const ELEMENTS_PANEL_MIN_H = 140;
export const ELEMENTS_PANEL_DEFAULT_W = 420;
export const ELEMENTS_PANEL_DEFAULT_H = 200;

const DETAILS_PANEL_STORAGE_KEY = 'vulcan.geometryCanvas.panels.v2.details';
export const DETAILS_PANEL_MIN_W = 320;
export const DETAILS_PANEL_MIN_H = 240;
export const DETAILS_PANEL_DEFAULT_W = 340;
export const DETAILS_PANEL_DEFAULT_H = 360;
export const GEOMETRY_CANVAS_PANEL_INSET_PX = 12;
export type InitialElementsPanelPlacement = 'left' | 'right';
const DOCK_GAP_PX = 12;
const DEFAULT_POS_TOLERANCE_PX = 16;

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

export function usePanelLayout(
  stageSize: { width: number; height: number },
  containerRef: React.RefObject<HTMLDivElement | null>,
  initialElementsPanelPlacement: InitialElementsPanelPlacement = 'right',
) {
  const getCanvasEl = useCallback(() => {
    return (containerRef.current?.closest('.geometry-canvas') as HTMLElement | null) ?? null;
  }, [containerRef]);

  const getOverlayTopPxCallback = useCallback(
    () => getGeometryCanvasOverlaySafeTopPx(getCanvasEl()),
    [getCanvasEl],
  );

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

  const getFallbackDockedTopPx = useCallback(() => {
    return getOverlayTopPxCallback() + ELEMENTS_PANEL_DEFAULT_H + DOCK_GAP_PX;
  }, [getOverlayTopPxCallback]);

  const getElementsDefaultRect = useCallback((): PanelRect => {
    const canvasEl = getCanvasEl();
    const canvasRect = canvasEl?.getBoundingClientRect();
    const w = ELEMENTS_PANEL_DEFAULT_W;
    const h = ELEMENTS_PANEL_DEFAULT_H;
    const x = Math.max(
      0,
      (canvasRect?.width ?? stageSize.width) - GEOMETRY_CANVAS_PANEL_INSET_PX - w,
    );
    const y = getGeometryCanvasOverlaySafeTopPx(canvasEl);
    return clampElementsRectToCanvas({ x, y, width: w, height: h });
  }, [clampElementsRectToCanvas, getCanvasEl, stageSize.width]);

  const getDetailsDefaultRect = useCallback((): PanelRect => {
    const canvasEl = getCanvasEl();
    const canvasRect = canvasEl?.getBoundingClientRect();
    const w = DETAILS_PANEL_DEFAULT_W;
    const h = DETAILS_PANEL_DEFAULT_H;
    const x = Math.max(
      0,
      (canvasRect?.width ?? stageSize.width) - GEOMETRY_CANVAS_PANEL_INSET_PX - w,
    );
    const y = getFallbackDockedTopPx();
    return clampRectToCanvas({ x, y, width: w, height: h });
  }, [clampRectToCanvas, getCanvasEl, getFallbackDockedTopPx, stageSize.width]);

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

  // One-time cleanup: remove older saved panel layouts
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v1.elements');
      window.localStorage.removeItem('vulcan.geometryCanvas.panels.v1.details');
    } catch { /* swallow: best-effort */ }
  }, []);

  // Resolve the first layout only after the portalled canvas and its composition
  // inset exist. Stored layouts are preserved and clamped; fresh layouts start
  // at exactly the same rects used by double-click reset.
  useLayoutEffect(() => {
    const initializeOrClampPanels = () => {
      if (!getCanvasEl()) return;

      if (!panelLayoutReady) {
        setElementsRect(
          initialElementsPanelState === null
            ? initialElementsPanelPlacement === 'left'
              ? clampElementsRectToCanvas({
                  x: 0,
                  y: getOverlayTopPxCallback(),
                  width: ELEMENTS_PANEL_DEFAULT_W,
                  height: ELEMENTS_PANEL_DEFAULT_H,
                })
              : getElementsDefaultRect()
            : clampElementsRectToCanvas(initialElementsPanelState.rect),
        );
        setDetailsRect(
          initialDetailsPanelState === null
            ? getDetailsDefaultRect()
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
    getDetailsDefaultRect,
    getElementsDefaultRect,
    getOverlayTopPxCallback,
    initialDetailsPanelState,
    initialElementsPanelPlacement,
    initialElementsPanelState,
    panelLayoutReady,
  ]);

  // Docked mode positioning: keep Details panel below Elements panel while docked
  useEffect(() => {
    if (!panelLayoutReady || detailsMode !== 'docked') return;

    const updateDockedPosition = () => {
      const canvasEl = getCanvasEl();
      if (!canvasEl) return;

      const canvasRect = canvasEl.getBoundingClientRect();
      const fallbackTop = getFallbackDockedTopPx();

      const width = detailsRect.width;
      const height = detailsRect.height;

      const x = Math.max(
        0,
        canvasRect.width - GEOMETRY_CANVAS_PANEL_INSET_PX - width,
      );

      let y = fallbackTop;
      const elementsDefault = getElementsDefaultRect();
      const isElementsDefaultPositioned =
        Math.abs(elementsRect.x - elementsDefault.x) <= DEFAULT_POS_TOLERANCE_PX &&
        Math.abs(elementsRect.y - elementsDefault.y) <= DEFAULT_POS_TOLERANCE_PX;
      if (isElementsDefaultPositioned) {
        y = elementsRect.y + elementsRect.height + DOCK_GAP_PX;
      }

      const clamped = clampRectToCanvas({ x, y, width, height });

      setDetailsRect((prev) => {
        if (
          Math.abs(prev.x - clamped.x) < 0.5 &&
          Math.abs(prev.y - clamped.y) < 0.5 &&
          Math.abs(prev.width - clamped.width) < 0.5 &&
          Math.abs(prev.height - clamped.height) < 0.5
        )
          return prev;
        return clamped;
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
    detailsRect.height,
    elementsRect.x,
    elementsRect.y,
    elementsRect.width,
    elementsRect.height,
    clampRectToCanvas,
    getElementsDefaultRect,
    getFallbackDockedTopPx,
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
