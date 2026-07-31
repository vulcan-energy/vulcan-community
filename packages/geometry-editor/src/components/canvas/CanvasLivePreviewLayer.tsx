// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, type ReactNode } from 'react';
import { Layer } from 'react-konva';

type CanvasLivePreviewLayerProps = {
  children: ReactNode;
};

export const CanvasLivePreviewLayer = memo<CanvasLivePreviewLayerProps>(function CanvasLivePreviewLayer({
  children,
}) {
  return (
    <Layer
      name="geometry-live-preview-layer"
      listening={false}
    >
      {children}
    </Layer>
  );
});
