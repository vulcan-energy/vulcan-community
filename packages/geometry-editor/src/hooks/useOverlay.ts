// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/workspaceResourcePort';
import type { GeometryCanvasOverlayEvidenceRequest } from '../../../geometry-editor-host/src/canvasEvidenceContribution';
import {
  openOverlayPdfDocument,
  renderOverlayPdfPageToBlob,
  renderOverlayPdfPageToFile,
  type OverlayPdfDocumentHandle,
} from '../lib/overlayPdfImport';
import { canvasToWorld } from '../lib/shapeUtils';
import type { GuideOverlay, GuideOverlaySource } from '../geometry/guideOverlay';
import {
  allOverlayPaths,
  allOverlaySourcePaths,
  type GuideOverlayByFloor,
  type GuideOverlaySourceByFloor,
} from '../geometry/guideOverlayByFloor';

export interface UseOverlayDeps {
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  guideOverlay: GuideOverlay | null;
  guideOverlaySource?: GuideOverlaySource | null;
  /** Snapshot of every floor's overlay record. Used to ref-count workspace files before deletion. */
  guideOverlayByFloor?: GuideOverlayByFloor;
  guideOverlaySourceByFloor?: GuideOverlaySourceByFloor;
  setGuideOverlay: (overlay: GuideOverlay | null) => void;
  setGuideOverlaySource?: (source: GuideOverlaySource | null) => void;
  updateGuideOverlay: (updates: Partial<GuideOverlay>) => void;
  /** Wipes overlay records for every floor — used by the trash button. */
  clearGuideOverlayAllFloors?: () => void;
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
  stageSize: { width: number; height: number };
  uploadOverlayEvidence?: (
    request: GeometryCanvasOverlayEvidenceRequest,
  ) => Promise<void>;
  /** Called before auto-entering calibrate mode on first overlay upload (e.g. reset drawing state). */
  onBeforeEnterCalibrateMode?: () => void;
}

type OverlayPdfImportState = {
  file: File;
  document: OverlayPdfDocumentHandle;
  page: number;
};

type OverlayImageCacheEntry = {
  image: HTMLImageElement;
  objectUrl: string | null;
};

const OVERLAY_IMAGE_CACHE_LIMIT = 8;
const overlayImageCache = new Map<string, OverlayImageCacheEntry>();

function evictOverlayImageCacheEntry(path: string) {
  const entry = overlayImageCache.get(path);
  if (!entry) return;
  overlayImageCache.delete(path);
  if (entry.objectUrl) {
    try { URL.revokeObjectURL(entry.objectUrl); } catch { /* no-op */ }
  }
}

function rememberOverlayImage(path: string, entry: OverlayImageCacheEntry) {
  evictOverlayImageCacheEntry(path);
  overlayImageCache.set(path, entry);

  while (overlayImageCache.size > OVERLAY_IMAGE_CACHE_LIMIT) {
    const oldestPath = overlayImageCache.keys().next().value;
    if (!oldestPath) break;
    evictOverlayImageCacheEntry(oldestPath);
  }
}

export function useOverlay(deps: UseOverlayDeps) {
  const {
    workspaceResourcePort,
    guideOverlay,
    guideOverlaySource,
    guideOverlayByFloor,
    guideOverlaySourceByFloor,
    setGuideOverlay,
    setGuideOverlaySource,
    updateGuideOverlay,
    clearGuideOverlayAllFloors,
    scale,
    panOffset,
    canvasCenter,
    uploadOverlayEvidence,
    onBeforeEnterCalibrateMode,
  } = deps;

  // Latest by-floor snapshots — used inside callbacks to avoid stale-closure deletes.
  const guideOverlayByFloorRef = useRef<GuideOverlayByFloor>(guideOverlayByFloor ?? {});
  const guideOverlaySourceByFloorRef = useRef<GuideOverlaySourceByFloor>(guideOverlaySourceByFloor ?? {});
  const guideOverlayPxPerMRef = useRef<number | undefined>(guideOverlay?.pxPerM);

  useEffect(() => {
    guideOverlayByFloorRef.current = guideOverlayByFloor ?? {};
    guideOverlaySourceByFloorRef.current = guideOverlaySourceByFloor ?? {};
    guideOverlayPxPerMRef.current = guideOverlay?.pxPerM;
  }, [guideOverlay?.pxPerM, guideOverlayByFloor, guideOverlaySourceByFloor]);

  const [showOverlayPanel, setShowOverlayPanelState] = useState(false);
  const [overlayMoveMode, setOverlayMoveMode] = useState(false);
  const [overlayCalibrateMode, setOverlayCalibrateMode] = useState(false);
  const [overlayImg, setOverlayImg] = useState<HTMLImageElement | null>(null);
  const overlayObjectUrlRef = useRef<string | null>(null);
  const overlayMoveRAFRef = useRef<number | null>(null);
  const overlayAutoCenterPendingRef = useRef<boolean>(false);
  const [overlayIsDragging, setOverlayIsDragging] = useState(false);
  const [overlayHintCanvasPos, setOverlayHintCanvasPos] = useState<{ x: number; y: number } | null>(null);
  const overlayCalFirstRef = useRef<{
    canvas: { x: number; y: number };
    world: { x: number; y: number };
    imgPx: { x: number; y: number };
  } | null>(null);
  const [overlayCalSecondCanvas, setOverlayCalSecondCanvas] = useState<{ x: number; y: number } | null>(null);
  const [overlayCalHoverCanvas, setOverlayCalHoverCanvas] = useState<{ x: number; y: number } | null>(null);
  const overlayCalSecondRef = useRef<{
    canvas: { x: number; y: number };
    world: { x: number; y: number };
    imgPx: { x: number; y: number };
  } | null>(null);
  const overlayCalDistPxRef = useRef<number | null>(null);
  const [overlayCalRealM, setOverlayCalRealM] = useState<string>('3.0');
  const [overlayCalStep, setOverlayCalStep] = useState<0 | 1 | 2>(0);
  const [overlayPdfImport, setOverlayPdfImport] = useState<OverlayPdfImportState | null>(null);
  const [overlayPdfPreviewUrl, setOverlayPdfPreviewUrl] = useState<string | null>(null);
  const [overlayPdfPreviewLoading, setOverlayPdfPreviewLoading] = useState(false);
  const [overlayPdfImporting, setOverlayPdfImporting] = useState(false);
  const [overlayPdfError, setOverlayPdfError] = useState<string | null>(null);

  const resetOverlayInteraction = useCallback(() => {
    setOverlayMoveMode(false);
    setOverlayIsDragging(false);
    setOverlayHintCanvasPos(null);
    setOverlayCalibrateMode(false);
    overlayCalFirstRef.current = null;
    overlayCalSecondRef.current = null;
    overlayCalDistPxRef.current = null;
    setOverlayCalSecondCanvas(null);
    setOverlayCalHoverCanvas(null);
    setOverlayCalStep(0);
  }, []);

  const setShowOverlayPanel = useCallback((show: boolean) => {
    setShowOverlayPanelState(show);
    if (!show) resetOverlayInteraction();
  }, [resetOverlayInteraction]);

  /** Latest view transform for auto-center only — must NOT trigger overlay reload on pan/zoom. */
  const overlayViewRef = useRef({ scale, panOffset, canvasCenter });

  useEffect(() => {
    overlayViewRef.current = { scale, panOffset, canvasCenter };
  }, [canvasCenter, panOffset, scale]);

  const overlayHintText = useMemo(() => {
    if (overlayMoveMode) return overlayIsDragging ? 'Release to place' : 'Drag to move overlay';
    if (overlayCalibrateMode) {
      if (overlayCalStep === 0) return 'Click first point';
      if (overlayCalStep === 1) return 'Click second point';
      return 'Enter length, then Apply';
    }
    return null;
  }, [overlayMoveMode, overlayIsDragging, overlayCalibrateMode, overlayCalStep]);

  const sanitizeFilenameComponent = useCallback((s: string) =>
    (s || '')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, ''),
  []);

  const getOverlayTargetPath = useCallback((file: File) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const original = sanitizeFilenameComponent(file.name || 'overlay');
    const base = original.replace(/\.(png|jpg|jpeg)$/i, '') || 'overlay';
    const ext = (file.type === 'image/png')
      ? 'png'
      : (file.type === 'image/jpeg')
        ? 'jpg'
        : (() => {
          const m = (file.name || '').match(/\.(png|jpg|jpeg)$/i);
          return m ? (m[1]!.toLowerCase() === 'jpeg' ? 'jpg' : m[1]!.toLowerCase()) : 'png';
        })();
    return `input/overlays/${ts}_${base}.${ext}`;
  }, [sanitizeFilenameComponent]);

  const getOverlaySourcePath = useCallback((file: File) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const original = sanitizeFilenameComponent(file.name || 'overlay-source');
    const base = original.replace(/\.(pdf)$/i, '') || 'overlay-source';
    return `input/overlay-sources/${ts}_${base}.pdf`;
  }, [sanitizeFilenameComponent]);

  const getPdfDerivedOverlayTargetPath = useCallback((file: File, page: number) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const original = sanitizeFilenameComponent(file.name || 'overlay');
    const base = original.replace(/\.(pdf)$/i, '') || 'overlay';
    return `input/overlays/${ts}_${base}_p${page}.png`;
  }, [sanitizeFilenameComponent]);

  const applyOverlayImport = useCallback(async ({
    runtimeFile,
    runtimePath,
    source,
    sourceFile,
  }: {
    runtimeFile: File;
    runtimePath: string;
    source?: GuideOverlaySource | null;
    sourceFile?: File;
  }) => {
    const prev = guideOverlay;
    const previousOverlayPath = prev?.path ?? null;
    const previousSourcePath = guideOverlaySource?.source_path ?? null;
    // Snapshot before mutation so we can ref-count which paths are still referenced by
    // sibling floors after the active floor switches to the new record.
    const overlaySnapshot = guideOverlayByFloorRef.current;
    const sourceSnapshot = guideOverlaySourceByFloorRef.current;
    overlayAutoCenterPendingRef.current = true;
    if (previousOverlayPath && previousOverlayPath !== runtimePath) {
      evictOverlayImageCacheEntry(previousOverlayPath);
    }
    evictOverlayImageCacheEntry(runtimePath);
    setOverlayImg(null);
    setGuideOverlay({
      path: runtimePath,
      opacity01: prev?.opacity01 ?? 0.5,
      pos_m: prev?.pos_m ?? { x: 0, y: 0 },
      pxPerM: prev?.pxPerM,
      calibration: prev?.calibration,
    });
    setGuideOverlaySource?.(source ?? null);

    if (previousOverlayPath && previousOverlayPath !== runtimePath) {
      const refCount = Object.values(overlaySnapshot).filter((o) => o?.path === previousOverlayPath).length;
      // refCount includes the active-floor record we just replaced, so >1 means
      // another floor still references the file.
      if (refCount <= 1) {
        try {
          await workspaceResourcePort.removeFile(previousOverlayPath);
        } catch (err) {
          console.warn('[GuideOverlay] Failed to delete replaced overlay file:', previousOverlayPath, err);
        }
      }
    }

    if (previousSourcePath && previousSourcePath !== (source?.source_path ?? null)) {
      const refCount = Object.values(sourceSnapshot).filter((s) => s?.source_path === previousSourcePath).length;
      if (refCount <= 1) {
        try {
          await workspaceResourcePort.removeFile(previousSourcePath);
        } catch (err) {
          console.warn('[GuideOverlay] Failed to delete replaced overlay source file:', previousSourcePath, err);
        }
      }
    }

    setOverlayMoveMode(false);
    if (!prev?.pxPerM) {
      setShowOverlayPanel(true);
      onBeforeEnterCalibrateMode?.();
      setOverlayCalibrateMode(true);
    }

    if (!uploadOverlayEvidence) return;

    try {
      await uploadOverlayEvidence({
        runtimeFile,
        runtimePath,
        ...(source && sourceFile
          ? { sourceFile, sourcePath: source.source_path }
          : {}),
      });
    } catch (err) {
      console.warn('[Evidence] Failed to auto-upload overlay as evidence:', err);
    }
  }, [
    guideOverlay,
    guideOverlaySource,
    onBeforeEnterCalibrateMode,
    setGuideOverlay,
    setGuideOverlaySource,
    setShowOverlayPanel,
    uploadOverlayEvidence,
    workspaceResourcePort,
  ]);

  const cancelOverlayPdfImport = useCallback(() => {
    setOverlayPdfPreviewUrl((current) => {
      if (current) {
        try { URL.revokeObjectURL(current); } catch { /* no-op */ }
      }
      return null;
    });
    setOverlayPdfImport(null);
    setOverlayPdfError(null);
    setOverlayPdfImporting(false);
    setOverlayPdfPreviewLoading(false);
  }, []);

  const setOverlayPdfImportPage = useCallback((page: number) => {
    if (!overlayPdfImport) return;
    const nextPage = Math.max(
      1,
      Math.min(overlayPdfImport.document.numPages, Math.floor(page || 1)),
    );
    if (nextPage === overlayPdfImport.page) return;
    setOverlayPdfPreviewLoading(true);
    setOverlayPdfError(null);
    setOverlayPdfImport({ ...overlayPdfImport, page: nextPage });
  }, [overlayPdfImport]);

  const confirmOverlayPdfImport = useCallback(async () => {
    if (!overlayPdfImport) return;

    try {
      setOverlayPdfImporting(true);
      setOverlayPdfError(null);
      const { file, document, page } = overlayPdfImport;
      const sourcePath = getOverlaySourcePath(file);
      const targetPath = getPdfDerivedOverlayTargetPath(file, page);
      const renderedFile = await renderOverlayPdfPageToFile(
        document.pdf,
        page,
        targetPath.split('/').pop() || 'overlay.png',
      );

      await workspaceResourcePort.ensureDirectory('input/overlay-sources');
      await workspaceResourcePort.writeBytes(sourcePath, file);
      await workspaceResourcePort.ensureDirectory('input/overlays');
      await workspaceResourcePort.writeBytes(targetPath, renderedFile);

      await applyOverlayImport({
        runtimeFile: renderedFile,
        runtimePath: targetPath,
        source: {
          kind: 'pdf',
          source_path: sourcePath,
          source_filename: file.name || sourcePath.split('/').pop() || 'overlay.pdf',
          page,
          derived_overlay_path: targetPath,
        },
        sourceFile: file,
      });

      cancelOverlayPdfImport();
    } catch (e) {
      setOverlayPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setOverlayPdfImporting(false);
    }
  }, [
    applyOverlayImport,
    cancelOverlayPdfImport,
    getOverlaySourcePath,
    getPdfDerivedOverlayTargetPath,
    overlayPdfImport,
    workspaceResourcePort,
  ]);

  const clearOverlayFiles = useCallback(async () => {
    // Capture the union of every floor's overlay/source paths so a global clear cleans up
    // files referenced by any floor, not just the active one.
    const overlayPaths = new Set<string>(allOverlayPaths(guideOverlayByFloorRef.current));
    if (guideOverlay?.path) overlayPaths.add(guideOverlay.path);
    const sourcePaths = new Set<string>(allOverlaySourcePaths(guideOverlaySourceByFloorRef.current));
    if (guideOverlaySource?.source_path) sourcePaths.add(guideOverlaySource.source_path);

    setOverlayImg(null);
    resetOverlayInteraction();
    for (const path of overlayPaths) {
      evictOverlayImageCacheEntry(path);
    }
    if (clearGuideOverlayAllFloors) {
      clearGuideOverlayAllFloors();
    } else {
      setGuideOverlay(null);
      setGuideOverlaySource?.(null);
    }

    for (const path of overlayPaths) {
      try {
        await workspaceResourcePort.removeFile(path);
      } catch (err) {
        console.warn('[GuideOverlay] Failed to delete cleared overlay file:', path, err);
      }
    }

    for (const path of sourcePaths) {
      try {
        await workspaceResourcePort.removeFile(path);
      } catch (err) {
        console.warn('[GuideOverlay] Failed to delete cleared overlay source file:', path, err);
      }
    }
  }, [
    clearGuideOverlayAllFloors,
    guideOverlay,
    guideOverlaySource,
    setGuideOverlay,
    setGuideOverlaySource,
    resetOverlayInteraction,
    workspaceResourcePort,
  ]);

  const handleOverlayFileChosen = useCallback(async (file: File) => {
    const isImage = file.type === 'image/png' || file.type === 'image/jpeg';
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

    if (!(isImage || isPdf)) {
      alert('Please select a PNG, JPG, or PDF file.');
      return;
    }
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(`${isPdf ? 'PDF' : 'Image'} is too large (max 10MB).`);
      return;
    }

    try {
      if (isPdf) {
        setOverlayPdfError(null);
        setOverlayPdfPreviewUrl((current) => {
          if (current) {
            try { URL.revokeObjectURL(current); } catch { /* no-op */ }
          }
          return null;
        });
        setOverlayPdfPreviewLoading(true);
        const document = await openOverlayPdfDocument(file);
        setOverlayPdfImport({ file, document, page: 1 });
        return;
      }

      const targetPath = getOverlayTargetPath(file);
      await workspaceResourcePort.ensureDirectory('input/overlays');
      await workspaceResourcePort.writeBytes(targetPath, file);
      await applyOverlayImport({
        runtimeFile: file,
        runtimePath: targetPath,
        source: null,
      });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
      setOverlayPdfPreviewLoading(false);
    }
  }, [
    applyOverlayImport,
    getOverlayTargetPath,
    setOverlayPdfError,
    workspaceResourcePort,
  ]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const cleanup = () => {
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch { /* no-op */ }
        objectUrl = null;
      }
    };

    if (!overlayPdfImport) {
      return () => {};
    }

    renderOverlayPdfPageToBlob(overlayPdfImport.document.pdf, overlayPdfImport.page)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setOverlayPdfPreviewUrl((current) => {
          if (current) {
            try { URL.revokeObjectURL(current); } catch { /* no-op */ }
          }
          return objectUrl;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setOverlayPdfError(e instanceof Error ? e.message : String(e));
        setOverlayPdfPreviewUrl((current) => {
          if (current) {
            try { URL.revokeObjectURL(current); } catch { /* no-op */ }
          }
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setOverlayPdfPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [overlayPdfImport]);

  // The active floor can change outside this hook, so a missing path is an external
  // store transition rather than a local close/clear command.
  useEffect(() => {
    if (guideOverlay?.path) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetOverlayInteraction();
  }, [guideOverlay?.path, resetOverlayInteraction]);

  // Escape cancels calibration
  useEffect(() => {
    if (!overlayCalibrateMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOverlayCalibrateMode(false);
      overlayCalFirstRef.current = null;
      overlayCalSecondRef.current = null;
      overlayCalDistPxRef.current = null;
      setOverlayCalSecondCanvas(null);
      setOverlayCalHoverCanvas(null);
      setOverlayHintCanvasPos(null);
      setOverlayCalStep(0);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as AddEventListenerOptions);
  }, [overlayCalibrateMode]);

  // Load overlay image from workspace when a path is present
  useEffect(() => {
    let cancelled = false;
    let uncachedObjectUrl: string | null = null;

    const blobToDataUrl = (blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read overlay image bytes'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });

    const loadHtmlImage = async (src: string) => {
      const img = new window.Image();
      img.decoding = 'async';
      img.src = src;
      if ((img as HTMLImageElement & { decode?: () => Promise<void> }).decode) {
        await (img as HTMLImageElement & { decode: () => Promise<void> }).decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load overlay image'));
        });
      }
      return img;
    };

    const maybeAutoCenterOverlay = (img: HTMLImageElement) => {
      if (!overlayAutoCenterPendingRef.current) return;

      const { scale: s, panOffset: pan, canvasCenter: cc } = overlayViewRef.current;
      const pxPerM =
        (typeof guideOverlayPxPerMRef.current === 'number' &&
          Number.isFinite(guideOverlayPxPerMRef.current) &&
          guideOverlayPxPerMRef.current > 0)
          ? guideOverlayPxPerMRef.current
          : 50;
      const width_m = img.width / pxPerM;
      const height_m = img.height / pxPerM;
      const centerWorld = canvasToWorld(
        { x: cc.x, y: cc.y },
        s,
        pan,
        cc,
      );

      updateGuideOverlay({
        pos_m: {
          x: centerWorld.x - (width_m / 2),
          y: centerWorld.y + (height_m / 2),
        },
      });
      overlayAutoCenterPendingRef.current = false;
    };

    const cleanup = () => {
      if (uncachedObjectUrl) {
        try { URL.revokeObjectURL(uncachedObjectUrl); } catch { /* no-op */ }
        if (overlayObjectUrlRef.current === uncachedObjectUrl) {
          overlayObjectUrlRef.current = null;
        }
        uncachedObjectUrl = null;
      }
      setOverlayImg(null);
    };

    const run = async () => {
      const path = guideOverlay?.path;
      if (!path) {
        cleanup();
        return;
      }

      try {
        const cached = overlayImageCache.get(path);
        if (cached) {
          overlayObjectUrlRef.current = cached.objectUrl;
          maybeAutoCenterOverlay(cached.image);
          setOverlayImg(cached.image);
          return;
        }

        const file = await workspaceResourcePort.readFile(path);
        if (cancelled) return;

        const lower = path.toLowerCase();
        const inferredType =
          lower.endsWith('.png')
            ? 'image/png'
            : (lower.endsWith('.jpg') || lower.endsWith('.jpeg'))
              ? 'image/jpeg'
              : '';
        const typedBlob =
          (file.type && file.type !== '')
            ? file
            : (inferredType ? file.slice(0, file.size, inferredType) : file);

        const url = URL.createObjectURL(typedBlob);
        uncachedObjectUrl = url;
        overlayObjectUrlRef.current = url;

        let img: HTMLImageElement;
        let cachedObjectUrl: string | null = url;
        try {
          img = await loadHtmlImage(url);
        } catch {
          try { URL.revokeObjectURL(url); } catch { /* no-op */ }
          if (overlayObjectUrlRef.current === url) {
            overlayObjectUrlRef.current = null;
          }
          uncachedObjectUrl = null;
          cachedObjectUrl = null;
          const dataUrl = await blobToDataUrl(typedBlob);
          img = await loadHtmlImage(dataUrl);
        }

        if (cancelled) {
          if (cachedObjectUrl) {
            try { URL.revokeObjectURL(cachedObjectUrl); } catch { /* no-op */ }
            if (overlayObjectUrlRef.current === cachedObjectUrl) {
              overlayObjectUrlRef.current = null;
            }
          }
          return;
        }

        rememberOverlayImage(path, { image: img, objectUrl: cachedObjectUrl });
        uncachedObjectUrl = null;
        overlayObjectUrlRef.current = cachedObjectUrl;
        maybeAutoCenterOverlay(img);
        setOverlayImg(img);
      } catch (e) {
        console.warn('[GuideOverlay] Failed to load overlay image:', { error: e, path: guideOverlay?.path });
        if (guideOverlay?.path) {
          window.dispatchEvent(
            new CustomEvent('guide-overlay-error', {
              detail: { path: guideOverlay.path, error: e },
            })
          );
        }
        cleanup();
      }
    };

    run();
    return () => {
      cancelled = true;
      cleanup();
    };
    // Reload bitmap only when the workspace file path changes. Including pan/zoom/pxPerM here
    // cleared overlayImg on every view or calibration change (slow re-read + decode for large PDF exports).
  }, [guideOverlay?.path, updateGuideOverlay, workspaceResourcePort]);

  return {
    showOverlayPanel,
    setShowOverlayPanel,
    overlayMoveMode,
    setOverlayMoveMode,
    overlayCalibrateMode,
    setOverlayCalibrateMode,
    overlayImg,
    overlayObjectUrlRef,
    overlayMoveRAFRef,
    overlayAutoCenterPendingRef,
    overlayIsDragging,
    setOverlayIsDragging,
    overlayHintCanvasPos,
    setOverlayHintCanvasPos,
    overlayCalFirstRef,
    overlayCalSecondCanvas,
    setOverlayCalSecondCanvas,
    overlayCalHoverCanvas,
    setOverlayCalHoverCanvas,
    overlayCalSecondRef,
    overlayCalDistPxRef,
    overlayCalRealM,
    setOverlayCalRealM,
    overlayCalStep,
    setOverlayCalStep,
    overlayHintText,
    handleOverlayFileChosen,
    clearOverlayFiles,
    overlayPdfImportState: overlayPdfImport
      ? {
          isOpen: true,
          fileName: overlayPdfImport.file.name,
          page: overlayPdfImport.page,
          numPages: overlayPdfImport.document.numPages,
          previewUrl: overlayPdfPreviewUrl,
          isPreviewLoading: overlayPdfPreviewLoading,
          isImporting: overlayPdfImporting,
          error: overlayPdfError,
        }
      : {
          isOpen: false,
          fileName: null,
          page: 1,
          numPages: 1,
          previewUrl: null,
          isPreviewLoading: false,
          isImporting: false,
          error: null,
        },
    setOverlayPdfImportPage,
    cancelOverlayPdfImport,
    confirmOverlayPdfImport,
  };
}
