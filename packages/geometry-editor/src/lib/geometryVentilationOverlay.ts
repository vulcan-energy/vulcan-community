// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for 3D window ventilation overlays (max open area rectangle, frame inset).
 * Kept pure for unit tests and parity with opening dimensions W×H (m).
 */

/** Centred rectangle of area A (m²) inside W×H, same aspect as opening when unconstrained. */
export function rectSizeForMaxOpenArea(A: number, W: number, H: number): { w: number; h: number } {
  const cap = W * H;
  if (!Number.isFinite(A) || A <= 0 || !Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
    return { w: 0, h: 0 };
  }
  A = Math.min(A, cap);
  if (A >= cap - 1e-9) return { w: W, h: H };

  let w = Math.sqrt((A * W) / H);
  let h = A / w;
  if (w > W) {
    w = W;
    h = A / w;
  }
  if (h > H) {
    h = H;
    w = A / h;
  }
  if (w > W) {
    w = W;
    h = A / w;
  }
  return { w, h };
}

/**
 * Uniform inset s (m) on all sides so inner rectangle area = (1 − f) × W × H,
 * where f is `frame_area_fraction` (fraction of opening area that is frame).
 * Solves (W − 2s)(H − 2s) = (1 − f) W H.
 */
export function frameInsetFromFrameAreaFraction(f: number, W: number, H: number): number {
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) return 0;
  f = Math.min(1, Math.max(0, f));
  if (f <= 1e-12) return 0;

  const WH = W * H;
  // From 4s² − 2(W+H)s + f·W·H = 0: s = ((W+H) − √((W+H)² − 4fWH)) / 4 (smaller root).
  const disc = (W + H) ** 2 - 4 * f * WH;
  if (disc < 0) return Math.max(0, Math.min(W, H) / 2 - 0.001);

  const s = (W + H - Math.sqrt(disc)) / 4;
  const maxS = Math.min(W, H) / 2;
  return Math.max(0, Math.min(s, maxS));
}
