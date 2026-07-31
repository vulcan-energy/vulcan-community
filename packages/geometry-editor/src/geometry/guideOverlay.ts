// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type GuideOverlay = {
  // Workspace-relative path (e.g. input/overlays/...)
  path: string;
  // 0..1
  opacity01: number;
  // World-space position in metres (top-left origin)
  pos_m: { x: number; y: number };
  // Pixels per metre (optional until calibrated)
  pxPerM?: number;
  // Optional persisted calibration info
  calibration?: {
    a_world_m: { x: number; y: number };
    b_world_m: { x: number; y: number };
    real_m: number;
  };
};

export type GuideOverlaySource = {
  kind: 'image' | 'pdf';
  source_path: string;
  source_filename: string;
  page?: number;
  derived_overlay_path: string;
};

// GuideOverlay metadata encoding
// NOTE: loadFromCSV() metadata parsing currently uses `line.split(',')`,
// so the value stored in the second column MUST NOT contain commas.
export const encodeGuideOverlayMetadataValue = (overlay: GuideOverlay): string => {
  const safe = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const f = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');

  const path = String(overlay.path || '').trim();
  if (!path) return '';
  if (path.includes('|')) {
    // We deliberately forbid pipes since we use `|` as a delimiter.
    // (The UI should prevent this; this is just a defensive fallback.)
    throw new Error('GuideOverlay.path must not contain "|"');
  }

  const opacity01 = typeof overlay.opacity01 === 'number' && Number.isFinite(overlay.opacity01)
    ? overlay.opacity01
    : 0.5;
  const posX = typeof overlay.pos_m?.x === 'number' && Number.isFinite(overlay.pos_m.x) ? overlay.pos_m.x : 0;
  const posY = typeof overlay.pos_m?.y === 'number' && Number.isFinite(overlay.pos_m.y) ? overlay.pos_m.y : 0;

  const pxPerM = f(overlay.pxPerM);
  const real = f(overlay.calibration?.real_m);
  const ax = f(overlay.calibration?.a_world_m?.x);
  const ay = f(overlay.calibration?.a_world_m?.y);
  const bx = f(overlay.calibration?.b_world_m?.x);
  const by = f(overlay.calibration?.b_world_m?.y);

  // v1|path|opacity01|posX|posY|pxPerM|real|ax|ay|bx|by
  return [
    'v1',
    path,
    safe(opacity01),
    safe(posX),
    safe(posY),
    pxPerM,
    real,
    ax,
    ay,
    bx,
    by
  ].join('|');
};

export const decodeGuideOverlayMetadataValue = (value: string): GuideOverlay | null => {
  const raw = (value || '').trim();
  if (!raw) return null;
  const parts = raw.split('|');
  if (parts.length < 5) return null;

  const [version, path, opacity01Str, posXStr, posYStr, pxPerMStr, realStr, axStr, ayStr, bxStr, byStr] = parts;
  if (version !== 'v1') return null;
  if (!path) return null;

  const num = (s?: string): number | undefined => {
    if (s === undefined) return undefined;
    const t = s.trim();
    if (t === '') return undefined;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : undefined;
  };

  const opacity01 = num(opacity01Str) ?? 0.5;
  const posX = num(posXStr) ?? 0;
  const posY = num(posYStr) ?? 0;
  const pxPerM = num(pxPerMStr);

  const real_m = num(realStr);
  const ax = num(axStr);
  const ay = num(ayStr);
  const bx = num(bxStr);
  const by = num(byStr);

  const overlay: GuideOverlay = {
    path,
    opacity01,
    pos_m: { x: posX, y: posY },
    ...(pxPerM !== undefined ? { pxPerM } : {})
  };

  const hasCalibration = real_m !== undefined && ax !== undefined && ay !== undefined && bx !== undefined && by !== undefined;
  if (hasCalibration) {
    overlay.calibration = {
      real_m,
      a_world_m: { x: ax, y: ay },
      b_world_m: { x: bx, y: by }
    };
  }

  return overlay;
};

export const encodeGuideOverlaySourceMetadataValue = (source: GuideOverlaySource): string => {
  const safe = (v: unknown) => (v === undefined || v === null ? '' : String(v));

  const kind = source.kind === 'pdf' ? 'pdf' : 'image';
  const sourcePath = String(source.source_path || '').trim();
  const sourceFilename = String(source.source_filename || '').trim();
  const derivedOverlayPath = String(source.derived_overlay_path || '').trim();

  if (!sourcePath || !sourceFilename || !derivedOverlayPath) return '';
  if (sourcePath.includes('|') || sourceFilename.includes('|') || derivedOverlayPath.includes('|')) {
    throw new Error('GuideOverlaySource fields must not contain "|"');
  }
  if (kind === 'pdf') {
    if (!Number.isInteger(source.page) || (source.page ?? 0) <= 0) {
      throw new Error('GuideOverlaySource.page must be a positive integer for pdf sources');
    }
  }

  return [
    'v1',
    kind,
    sourcePath,
    sourceFilename,
    kind === 'pdf' ? safe(source.page) : '',
    derivedOverlayPath,
  ].join('|');
};

export const decodeGuideOverlaySourceMetadataValue = (value: string): GuideOverlaySource | null => {
  const raw = (value || '').trim();
  if (!raw) return null;

  const parts = raw.split('|');
  if (parts.length < 6) return null;

  const [version, kindRaw, sourcePath, sourceFilename, pageStr, derivedOverlayPath] = parts;
  if (version !== 'v1') return null;
  if ((kindRaw !== 'image' && kindRaw !== 'pdf') || !sourcePath || !sourceFilename || !derivedOverlayPath) {
    return null;
  }

  const page = (() => {
    const trimmed = (pageStr || '').trim();
    if (!trimmed) return undefined;
    const value = Number.parseInt(trimmed, 10);
    return Number.isInteger(value) ? value : undefined;
  })();

  if (kindRaw === 'pdf' && (!page || page <= 0)) {
    return null;
  }

  return {
    kind: kindRaw,
    source_path: sourcePath,
    source_filename: sourceFilename,
    ...(page !== undefined ? { page } : {}),
    derived_overlay_path: derivedOverlayPath,
  };
};
