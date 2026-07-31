// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useLayoutEffect, useRef } from 'react';
import { Rect } from 'react-konva';
import type { Rect as KonvaRect } from 'konva/lib/shapes/Rect';
import type { MarqueeSelectionSignal } from './marqueeSelectionSignal';

type LiveMarqueeSelectionProps = {
  previewSignal: MarqueeSelectionSignal;
};

export const LiveMarqueeSelection = memo<LiveMarqueeSelectionProps>(function LiveMarqueeSelection({
  previewSignal,
}) {
  const rectRef = useRef<KonvaRect | null>(null);

  useLayoutEffect(() => {
    const applySnapshot = () => {
      const node = rectRef.current;
      if (!node) return;
      const marqueeSelection = previewSignal.getSnapshot();
      const nextAttrs = marqueeSelection.isActive
        ? {
            x: Math.min(marqueeSelection.startX, marqueeSelection.endX),
            y: Math.min(marqueeSelection.startY, marqueeSelection.endY),
            width: Math.abs(marqueeSelection.endX - marqueeSelection.startX),
            height: Math.abs(marqueeSelection.endY - marqueeSelection.startY),
            visible: true,
          }
        : {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            visible: false,
          };
      node.setAttrs(nextAttrs);
      node.getLayer?.()?.batchDraw?.();
    };

    applySnapshot();
    return previewSignal.subscribe(applySnapshot);
  }, [previewSignal]);

  return (
    <Rect
      ref={rectRef}
      name="marquee-selection-preview"
      x={0}
      y={0}
      width={0}
      height={0}
      visible={false}
      fill="rgba(0, 123, 255, 0.1)"
      stroke="var(--validation-info)"
      strokeWidth={1}
      dash={[4, 4]}
      listening={false}
    />
  );
});
