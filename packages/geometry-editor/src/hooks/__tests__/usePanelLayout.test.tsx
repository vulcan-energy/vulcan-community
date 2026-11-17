// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment jsdom
import React, {
  type CSSProperties,
  createRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useRef,
} from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  usePanelLayout,
  type PanelRect,
} from '../usePanelLayout';

const STAGE_SIZE = Object.freeze({ width: 1000, height: 800 });
const FILEBAR_HEIGHT_PX = 46;

type PanelLayoutHandle = ReturnType<typeof usePanelLayout>;

type PanelLayoutHarnessProps = Readonly<{
  hostTopInsetPx: number;
  initialElementsPanelPlacement: 'left' | 'right';
}>;

const rect = (width: number, height: number): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  right: width,
  bottom: height,
  left: 0,
  width,
  height,
  toJSON: () => ({}),
});

const PanelLayoutHarness = forwardRef<PanelLayoutHandle, PanelLayoutHarnessProps>(
  function PanelLayoutHarness({ hostTopInsetPx, initialElementsPanelPlacement }, forwardedRef) {
    const containerRef = useRef<HTMLDivElement>(null);
    const layout = usePanelLayout(
      STAGE_SIZE,
      containerRef,
      initialElementsPanelPlacement,
    );

    const setCanvasRef = useCallback((canvas: HTMLDivElement | null) => {
      if (canvas === null) return;
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(STAGE_SIZE.width, STAGE_SIZE.height),
      });
    }, []);

    // jsdom does no layout: the File bar reports a 46 px tall bar at the top.
    const setFilebarRef = useCallback((filebar: HTMLDivElement | null) => {
      if (filebar === null) return;
      Object.defineProperty(filebar, 'offsetHeight', { configurable: true, value: FILEBAR_HEIGHT_PX });
    }, []);

    useImperativeHandle(forwardedRef, () => layout, [layout]);

    return (
      <div
        ref={setCanvasRef}
        className="geometry-canvas geometry-canvas-fullscreen"
        style={{
          '--geometry-canvas-host-top-inset': `${hostTopInsetPx}px`,
        } as CSSProperties}
      >
        <div className="overlay-filebar" ref={setFilebarRef} />
        <div ref={containerRef} />
      </div>
    );
  },
);

async function renderSettledLayout(
  hostTopInsetPx: number,
  initialElementsPanelPlacement: 'left' | 'right',
) {
  const layoutRef = createRef<PanelLayoutHandle>();
  const view = render(
    <PanelLayoutHarness
      ref={layoutRef}
      hostTopInsetPx={hostTopInsetPx}
      initialElementsPanelPlacement={initialElementsPanelPlacement}
    />,
  );
  const firstPaintElementsRect = layoutRef.current?.elementsRect;
  const firstPaintDetailsRect = layoutRef.current?.detailsRect;

  // Docked Details is positioned on a zero-delay callback. Waiting for its
  // right-aligned x coordinate also proves all mount-time layout work settled.
  await waitFor(() => {
    expect(layoutRef.current?.detailsRect.x).toBe(648);
  });

  if (!layoutRef.current) throw new Error('Panel layout harness did not expose its layout');
  return { firstPaintDetailsRect, firstPaintElementsRect, layoutRef, view };
}

function expectRect(actual: PanelRect, expected: PanelRect) {
  expect(actual).toEqual(expected);
}

describe('usePanelLayout composition insets', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each([
    {
      composition: 'Community desktop',
      hostTopInsetPx: 0,
      initialElementsPanelPlacement: 'right' as const,
      freshElementsLeftPx: 568,
      safeTopPx: 12,
      panelTopPx: 70,
      // Elements and Details share the right column.
      detailsTopPx: 282,
    },
    {
      composition: 'Inset host desktop',
      hostTopInsetPx: 120,
      initialElementsPanelPlacement: 'left' as const,
      freshElementsLeftPx: 0,
      safeTopPx: 132,
      panelTopPx: 190,
      detailsTopPx: 190,
    },
    {
      composition: 'Inset host mobile',
      hostTopInsetPx: 160,
      initialElementsPanelPlacement: 'left' as const,
      freshElementsLeftPx: 0,
      safeTopPx: 172,
      panelTopPx: 230,
      detailsTopPx: 230,
    },
  ])(
    'uses one coherent fresh, reset and clamp layout for $composition',
    async ({
      hostTopInsetPx,
      initialElementsPanelPlacement,
      freshElementsLeftPx,
      safeTopPx,
      panelTopPx,
      detailsTopPx,
    }) => {
      const {
        firstPaintDetailsRect,
        firstPaintElementsRect,
        layoutRef,
        view,
      } = await renderSettledLayout(
        hostTopInsetPx,
        initialElementsPanelPlacement,
      );
      const layout = layoutRef.current!;
      // Panels open under the File bar; Details runs to the canvas bottom.
      const expectedElements = {
        x: 568,
        y: panelTopPx,
        width: 420,
        height: 200,
      };
      const expectedDetails = {
        x: 648,
        y: detailsTopPx,
        width: 340,
        height: STAGE_SIZE.height - 12 - detailsTopPx,
      };

      // Mount-time geometry is committed in a layout effect, so the public
      // canvas never paints the neutral placeholder rects for either host.
      expect(firstPaintElementsRect).toEqual({
        ...expectedElements,
        x: freshElementsLeftPx,
      });
      expect(firstPaintDetailsRect).toEqual(expectedDetails);

      // These are the rects used by double-click reset.
      expectRect(layout.getElementsDefaultRect(), expectedElements);
      expectRect(layout.getDetailsDefaultRect(), expectedDetails);

      // The same safe top must govern drag/resize clamping.
      expectRect(
        layout.clampElementsRectToCanvas({
          ...expectedElements,
          y: -100,
        }),
        {
          ...expectedElements,
          y: safeTopPx,
        },
      );
      expectRect(
        layout.clampRectToCanvas({
          ...expectedDetails,
          y: -100,
        }),
        {
          ...expectedDetails,
          y: safeTopPx,
        },
      );

      // Community starts at its useful reset position. Inset hosts explicitly
      // preserve their established fresh-profile left placement.
      expectRect(layout.elementsRect, {
        ...expectedElements,
        x: freshElementsLeftPx,
      });
      expectRect(layout.detailsRect, expectedDetails);

      await act(async () => {
        view.unmount();
      });
    },
  );
});
