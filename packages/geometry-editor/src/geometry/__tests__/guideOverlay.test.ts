// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  decodeGuideOverlayMetadataValue,
  decodeGuideOverlaySourceMetadataValue,
  encodeGuideOverlayMetadataValue,
  encodeGuideOverlaySourceMetadataValue,
  type GuideOverlay,
  type GuideOverlaySource,
} from '../guideOverlay';

describe('GuideOverlay metadata', () => {
  it('round-trips an image overlay payload unchanged', () => {
    const overlay: GuideOverlay = {
      path: 'input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png',
      opacity01: 0.5,
      pos_m: { x: 1.2, y: 3.4 },
      pxPerM: 142.7,
      calibration: {
        a_world_m: { x: 1.2, y: 3.4 },
        b_world_m: { x: 4.2, y: 3.4 },
        real_m: 3,
      },
    };

    const encoded = encodeGuideOverlayMetadataValue(overlay);
    expect(encoded).toBe(
      'v1|input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png|0.5|1.2|3.4|142.7|3|1.2|3.4|4.2|3.4',
    );
    expect(decodeGuideOverlayMetadataValue(encoded)).toEqual(overlay);
  });
});

describe('GuideOverlaySource metadata', () => {
  it('round-trips an image-backed source row', () => {
    const source: GuideOverlaySource = {
      kind: 'image',
      source_path: 'input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png',
      source_filename: 'ground_floor.png',
      derived_overlay_path: 'input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png',
    };

    const encoded = encodeGuideOverlaySourceMetadataValue(source);
    expect(encoded).toBe(
      'v1|image|input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png|ground_floor.png||input/overlays/2026-04-24T15-41-22-468Z_ground_floor.png',
    );
    expect(decodeGuideOverlaySourceMetadataValue(encoded)).toEqual(source);
  });

  it('round-trips a pdf-backed source row with page context', () => {
    const source: GuideOverlaySource = {
      kind: 'pdf',
      source_path: 'input/overlay-sources/2026-04-24T15-41-22-468Z_floorplans.pdf',
      source_filename: 'floorplans.pdf',
      page: 3,
      derived_overlay_path: 'input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png',
    };

    const encoded = encodeGuideOverlaySourceMetadataValue(source);
    expect(encoded).toBe(
      'v1|pdf|input/overlay-sources/2026-04-24T15-41-22-468Z_floorplans.pdf|floorplans.pdf|3|input/overlays/2026-04-24T15-41-22-468Z_floorplans_p3.png',
    );
    expect(decodeGuideOverlaySourceMetadataValue(encoded)).toEqual(source);
  });

  it('rejects invalid guide overlay source payloads', () => {
    expect(decodeGuideOverlaySourceMetadataValue('')).toBeNull();
    expect(decodeGuideOverlaySourceMetadataValue('v1|pdf|input/overlay-sources/source.pdf|source.pdf||')).toBeNull();
    expect(decodeGuideOverlaySourceMetadataValue('v1|pdf|input/overlay-sources/source.pdf|source.pdf|0|input/overlays/derived.png')).toBeNull();
  });
});
