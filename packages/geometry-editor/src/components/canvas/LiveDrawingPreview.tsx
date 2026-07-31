// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useSyncExternalStore } from 'react';
import { DrawingPreview, type DrawingPreviewProps } from './DrawingPreview';
import type { DrawingPreviewSignal } from './drawingPreviewSignal';

type LiveDrawingPreviewProps = Omit<
  DrawingPreviewProps,
  'drawCursor' | 'drawAngleSnapped' | 'segmentLengthPreview'
> & {
  previewSignal: DrawingPreviewSignal;
};

export const LiveDrawingPreview = memo<LiveDrawingPreviewProps>(function LiveDrawingPreview({
  previewSignal,
  ...props
}) {
  const livePreview = useSyncExternalStore(
    previewSignal.subscribe,
    previewSignal.getSnapshot,
    previewSignal.getSnapshot,
  );

  return (
    <DrawingPreview
      {...props}
      drawCursor={livePreview.drawCursor}
      drawAngleSnapped={livePreview.drawAngleSnapped}
      segmentLengthPreview={livePreview.segmentLengthPreview}
    />
  );
});
