// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AutoThermalBridgeCandidate } from '../../../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { AutoDuctPreview, AutoThermalBridgePreview } from '../../../hooks/useAutoThermalBridgePreview';
import { ThermalBridgePreview2D } from '../ThermalBridgePreview2D';
import type { DrawingCanvasPalette } from '../drawingPreviewPalette';

vi.mock('react-konva', () => {
  const Layer = ({ children }: { children?: import('react').ReactNode }) => <div>{children}</div>;
  const Rect = (props: Record<string, unknown>) => (
    <div data-testid="preview-hit-area"
      onMouseMove={(event) => (props.onMouseMove as (event: unknown) => void)({
        evt: event,
        target: { getStage: () => ({ getPointerPosition: () => ({ x: event.clientX, y: event.clientY }) }) },
      })}
      onClick={(event) => (props.onClick as (event: unknown) => void)({
        evt: event,
        target: { getStage: () => ({ getPointerPosition: () => ({ x: event.clientX, y: event.clientY }) }) },
      })}
    />
  );
  const Circle = (props: Record<string, unknown>) => props.onClick
    ? <button type="button" data-testid="issue-marker"
        onMouseEnter={() => (props.onMouseEnter as () => void)?.()}
        onClick={(event) => {
          const konvaEvent = { cancelBubble: false, evt: event };
          (props.onClick as (event: { cancelBubble: boolean }) => void)(konvaEvent);
          event.currentTarget.dataset.cancelled = String(konvaEvent.cancelBubble);
        }} />
    : <span data-testid="candidate-marker" />;
  const Line = () => <span data-testid="candidate-line" />;
  return { Layer, Rect, Circle, Line };
});

const palette: DrawingCanvasPalette = {
  guide: '#abc123', guideFill: '', snap: '', snapText: '', handleFill: '', handleStroke: '',
  tooltipBg: '#111111', tooltipBorder: '', tooltipText: '', tooltipShadow: '',
};

function candidate(proposalId: string, coordinates: AutoThermalBridgeCandidate['coordinates']): AutoThermalBridgeCandidate {
  return {
    proposalId, openingId: `host-${proposalId}`, openingName: proposalId, zoneId: 'zone',
    edgeRole: 'lintel', junctionCode: 'E1', junctionOptions: ['E1'], suggestedLengthM: 1,
    linearThermalTransmittance: 0.1, reason: 'test', coordinates, status: 'new',
  } as AutoThermalBridgeCandidate;
}

function renderPreview(candidates: AutoThermalBridgeCandidate[], overrides: Partial<AutoThermalBridgePreview> = {}) {
  const preview = {
    candidates, issues: [], pinned: false, hover: null,
    onHover: vi.fn(), onActivate: vi.fn(), ...overrides,
  } as unknown as AutoThermalBridgePreview;
  const onInspect = vi.fn();
  const canActivate = vi.fn(() => true);
  render(<ThermalBridgePreview2D preview={preview} scale={1} panOffset={{ x: 0, y: 0 }}
    canvasCenter={{ x: 100, y: 100 }} width={400} height={300} palette={palette}
    onInspect={onInspect} canActivate={canActivate} />);
  return { preview, onInspect, canActivate };
}

describe('ThermalBridgePreview2D hit testing', () => {
  it('hits projected segment endpoints and the 8px tolerance while excluding points beyond it', () => {
    const { preview } = renderPreview([candidate('edge', [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }])]);
    const area = screen.getByTestId('preview-hit-area');
    fireEvent.mouseMove(area, { clientX: 100, clientY: 100, buttons: 0 });
    expect(preview.onHover).toHaveBeenLastCalledWith(['edge'], { x: 100, y: 100 });
    fireEvent.mouseMove(area, { clientX: 118, clientY: 100, buttons: 0 });
    expect(preview.onHover).toHaveBeenLastCalledWith(['edge'], { x: 118, y: 100 });
    fireEvent.mouseMove(area, { clientX: 118.1, clientY: 100, buttons: 0 });
    expect(preview.onHover).toHaveBeenLastCalledWith([], { x: 118.1, y: 100 });
  });

  it('preserves all overlapping candidates in stable proposal order on click', () => {
    const coords: AutoThermalBridgeCandidate['coordinates'] = [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }];
    const { preview } = renderPreview([candidate('first', coords), candidate('second', coords)]);
    fireEvent.click(screen.getByTestId('preview-hit-area'), { clientX: 105, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenCalledOnce();
    expect(preview.onActivate).toHaveBeenCalledWith(['first', 'second'], { x: 105, y: 100 });
  });

  it('stops a consumed preview click from bubbling to document-level chooser dismissal', () => {
    const coords: AutoThermalBridgeCandidate['coordinates'] = [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }];
    const bubbledClick = vi.fn();
    render(<div onClick={bubbledClick}>
      <ThermalBridgePreview2D preview={{
        candidates: [candidate('edge', coords)], issues: [], pinned: false, held: true, hover: null,
        onHover: vi.fn(), onActivate: vi.fn(),
      } as unknown as AutoThermalBridgePreview} scale={1} panOffset={{ x: 0, y: 0 }}
        canvasCenter={{ x: 100, y: 100 }} width={400} height={300} palette={palette}
        onInspect={vi.fn()} canActivate={() => true} />
    </div>);
    fireEvent.click(screen.getByTestId('preview-hit-area'), { clientX: 105, clientY: 100, button: 0 });
    expect(bubbledClick).not.toHaveBeenCalled();
  });

  it('hit-tests a zero-length candidate as a point using the same tolerance', () => {
    const { preview } = renderPreview([candidate('point', [{ x: 0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }])]);
    const area = screen.getByTestId('preview-hit-area');
    fireEvent.click(area, { clientX: 133, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenCalledWith(['point'], { x: 133, y: 100 });
    preview.onActivate.mockClear();
    fireEvent.click(area, { clientX: 133.1, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenCalledWith([], { x: 133.1, y: 100 });
  });

  it('shows and hit-tests only chooser candidates after A is released', () => {
    const chosen = candidate('chosen', [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }]);
    const background = candidate('background', [{ x: 1, y: 0, z: 0 }, { x: 1.2, y: 0, z: 0 }]);
    const { preview } = renderPreview([chosen, background], {
      pinned: true,
      held: false,
      menu: { ids: ['chosen'], anchor: { x: 100, y: 100 } },
    });
    expect(screen.getAllByTestId('candidate-line')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('preview-hit-area'), { clientX: 155, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenCalledWith([], { x: 155, y: 100 });
  });

  it('keeps the full suggestion overlay while A is held with a chooser open', () => {
    const coords: AutoThermalBridgeCandidate['coordinates'] = [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }];
    renderPreview([candidate('chosen', coords), candidate('background', coords)], {
      pinned: true,
      held: true,
      menu: { ids: ['chosen'], anchor: { x: 100, y: 100 } },
    });
    expect(screen.getAllByTestId('candidate-line')).toHaveLength(2);
  });

  it('suppresses hover while pinned or dragging and activation for non-left or blocked clicks', () => {
    const coords: AutoThermalBridgeCandidate['coordinates'] = [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }];
    const { preview, canActivate } = renderPreview([candidate('edge', coords)], { pinned: true });
    const area = screen.getByTestId('preview-hit-area');
    fireEvent.mouseMove(area, { clientX: 105, clientY: 100, buttons: 0 });
    expect(preview.onHover).not.toHaveBeenCalled();
    (preview as unknown as { pinned: boolean }).pinned = false;
    fireEvent.mouseMove(area, { clientX: 105, clientY: 100, buttons: 1 });
    expect(preview.onHover).not.toHaveBeenCalled();
    fireEvent.click(area, { clientX: 105, clientY: 100, button: 2 });
    expect(preview.onActivate).not.toHaveBeenCalled();
    canActivate.mockReturnValue(false);
    fireEvent.click(area, { clientX: 105, clientY: 100, button: 0 });
    expect(preview.onActivate).not.toHaveBeenCalled();
  });

  it('inspects a warning marker and stops its click from bubbling to candidate activation', () => {
    const preview = {
      candidates: [], pinned: false, hover: null, onHover: vi.fn(), onActivate: vi.fn(),
      issues: [{ tb: { id: 'bad-tb', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }] } }],
    } as unknown as AutoThermalBridgePreview;
    const onInspect = vi.fn();
    render(<ThermalBridgePreview2D preview={preview} scale={1} panOffset={{ x: 0, y: 0 }}
      canvasCenter={{ x: 100, y: 100 }} width={400} height={300} palette={palette}
      onInspect={onInspect} canActivate={() => true} />);
    const marker = screen.getByTestId('issue-marker');
    fireEvent.mouseEnter(marker);
    expect(preview.onHover).toHaveBeenCalledWith(['issue:bad-tb'], { x: 100, y: 100 });
    fireEvent.click(marker);
    expect(onInspect).toHaveBeenCalledWith('bad-tb');
    expect(preview.onActivate).not.toHaveBeenCalled();
    expect(marker).toHaveAttribute('data-cancelled', 'true');
  });

  it('does not consume a warning click while a pan gesture suppresses preview activation', () => {
    const row = { tb: { id: 'bad-tb', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }] } };
    const preview = { candidates: [], issues: [row], pinned: false, hover: null,
      onHover: vi.fn(), onActivate: vi.fn() } as unknown as AutoThermalBridgePreview;
    const bubbledClick = vi.fn();
    const onInspect = vi.fn();
    render(<div onClick={bubbledClick}>
      <ThermalBridgePreview2D preview={preview} scale={1} panOffset={{ x: 0, y: 0 }}
        canvasCenter={{ x: 100, y: 100 }} width={400} height={300} palette={palette}
        onInspect={onInspect} canActivate={() => false} />
    </div>);
    fireEvent.click(screen.getByTestId('issue-marker'));
    expect(onInspect).not.toHaveBeenCalled();
    expect(bubbledClick).toHaveBeenCalledOnce();
  });
});

describe('ThermalBridgePreview2D duct runs', () => {
  it('takes the run whose room end is nearest on a shared stretch, the same for hover and click', () => {
    const p = (x: number, y: number) => ({ x, y, z: 0 });
    const run = (proposalId: string, segments: Array<[ReturnType<typeof p>, ReturnType<typeof p>]>) =>
      ({ proposalId, role: 'supply', drafts: [], segments, lengthM: 1 });
    const preview = {
      kind: 'duct', pinned: false, hover: null, onHover: vi.fn(), onActivate: vi.fn(),
      runs: [run('far', [[p(0, 0), p(2, 0)]]), run('near', [[p(0, 0), p(1, 0)], [p(1, 0), p(1, 0.6)]])],
    } as unknown as AutoDuctPreview;
    render(<ThermalBridgePreview2D preview={preview} scale={1} panOffset={{ x: 0, y: 0 }}
      canvasCenter={{ x: 100, y: 100 }} width={400} height={300} palette={palette}
      onInspect={vi.fn()} canActivate={() => true} />);
    const area = screen.getByTestId('preview-hit-area');
    fireEvent.mouseMove(area, { clientX: 140, clientY: 100, buttons: 0 });
    expect(preview.onHover).toHaveBeenLastCalledWith(['near'], { x: 140, y: 100 });
    fireEvent.click(area, { clientX: 140, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenCalledWith(['near'], { x: 140, y: 100 });
    fireEvent.click(area, { clientX: 180, clientY: 100, button: 0 });
    expect(preview.onActivate).toHaveBeenLastCalledWith(['far'], { x: 180, y: 100 });
  });
});
