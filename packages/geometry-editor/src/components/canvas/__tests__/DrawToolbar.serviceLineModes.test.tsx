// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrawToolbar } from '../DrawToolbar';
import type { DrawMode } from '../../../hooks/useDrawingMode';
import type { ElementType } from '../../../geometry/types';

function renderToolbar(
  drawElementType: ElementType,
  complianceValidationEnabled = true,
  overrides: Partial<React.ComponentProps<typeof DrawToolbar>> = {},
) {
  return render(
    <DrawToolbar
      drawMode={'tb-plan-line' as DrawMode}
      setDrawMode={vi.fn()}
      drawElementType={drawElementType}
      setDrawElementType={vi.fn()}
      showOverlayPanel={false}
      setShowOverlayPanel={vi.fn()}
      showShortcuts={false}
      setShowShortcuts={vi.fn()}
      currentFloorZ={0}
      setCurrentFloorZ={vi.fn()}
      floors={[]}
      elementsById={{}}
      ensureFloorForZ={() => 'floor-0'}
      removeFloor={vi.fn()}
      updateFloor={vi.fn()}
      setDrawPoints={vi.fn()}
      setRoomWalls={vi.fn()}
      setRoomWallElements={vi.fn()}
      setOrthogonalRoomStart={vi.fn()}
      setOrthogonalRoomEnd={vi.fn()}
      drawPreset=""
      setDrawPreset={vi.fn()}
      presetOptions={[]}
      drawMvhrDuctRole="supply"
      setDrawMvhrDuctRole={vi.fn()}
      drawMvhrTerminalRole="intake"
      setDrawMvhrTerminalRole={vi.fn()}
      viewMode="2d"
      setViewMode={vi.fn()}
      complianceValidationEnabled={complianceValidationEnabled}
      {...overrides}
    />,
  );
}

describe('DrawToolbar shape dropdown and internal draw modes', () => {
  afterEach(cleanup);

  it('shows the placeholder, not an internal token, while an unlisted mode like space-label-polygon is active', () => {
    // `drawMode` carries modes this toolbar never offers (`space-label-polygon` is
    // entered from the Space Labeller's "Draw a manual room footprint" with the
    // toolbar still mounted). StandardDropdown now renders an unmatched value as a
    // literal "<value> (not in list)" entry, so feeding the raw mode through would
    // surface the internal token to the user -- the toolbar must map any mode it
    // does not offer to the placeholder instead.
    const { container } = renderToolbar('BuildingElementOpaque', true, {
      drawMode: 'space-label-polygon' as DrawMode,
    });

    // `className` lands on StandardDropdown's container div; the select is inside it.
    const select = container.querySelector('.shape-dropdown select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]).toHaveTextContent('Select shape...');
    expect(screen.queryByText(/\(not in list\)/)).not.toBeInTheDocument();
  });
});

describe('DrawToolbar service-line modes', () => {
  afterEach(cleanup);

  it('keeps WaterPipework available in FHS draw type selector', () => {
    renderToolbar('BuildingElementOpaque', true);

    fireEvent.click(screen.getByRole('button', { name: 'Element type for new drawings' }));
    fireEvent.click(screen.getByRole('button', { name: /Heating & Hot Water/i }));

    expect(screen.getByRole('option', { name: /Primary pipework/i })).toBeInTheDocument();
  });

  it('shows one element type section at a time', () => {
    renderToolbar('BuildingElementOpaque', true);

    fireEvent.click(screen.getByRole('button', { name: 'Element type for new drawings' }));
    expect(screen.getByRole('option', { name: /External surface/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Primary pipework/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Heating & Hot Water/i }));
    expect(screen.getByRole('option', { name: /Primary pipework/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /External surface/i })).not.toBeInTheDocument();
  });

  it.each(['WaterPipework', 'MechanicalVentilationDuctwork'] as const)(
    'shows plan, vertical, and slope line modes for %s',
    (elementType) => {
      renderToolbar(elementType, true);

      const shapeSelect = screen.getByDisplayValue('— Plan Line [L]') as HTMLSelectElement;
      const optionLabels = Array.from(shapeSelect.options).map((option) => option.textContent);
      expect(optionLabels).toContain('— Plan Line [L]');
      expect(optionLabels).toContain('↕ Vertical Line [V]');
      expect(optionLabels).toContain('⟋ Slope Line [S]');
    },
  );

  it('shows a duct role selector for MVHR ductwork drawing', () => {
    const setDrawMvhrDuctRole = vi.fn();
    renderToolbar('MechanicalVentilationDuctwork', true, { setDrawMvhrDuctRole });

    const roleSelect = screen.getByDisplayValue('supply') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'exhaust' } });

    expect(setDrawMvhrDuctRole).toHaveBeenCalledWith('exhaust');
  });

  it('uses point drawing and shows a terminal role selector for MVHR terminal drawing', () => {
    const setDrawElementType = vi.fn();
    const setDrawMode = vi.fn();
    const setDrawMvhrTerminalRole = vi.fn();
    renderToolbar('BuildingElementOpaque', true, {
      drawMode: 'none',
      setDrawElementType,
      setDrawMode,
      setDrawMvhrTerminalRole,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Element type for new drawings' }));
    fireEvent.click(screen.getByRole('button', { name: /Ventilation/i }));
    fireEvent.click(screen.getByRole('option', { name: /MVHR terminal/i }));

    expect(setDrawElementType).toHaveBeenCalledWith('MechanicalVentilationTerminal');
    expect(setDrawMode).toHaveBeenCalledWith('point');

    cleanup();
    renderToolbar('MechanicalVentilationTerminal', true, { setDrawMvhrTerminalRole });
    const roleSelect = screen.getByDisplayValue('intake') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'exhaust' } });

    expect(setDrawMvhrTerminalRole).toHaveBeenCalledWith('exhaust');
  });

  it('selects the likely draw shape when the element type changes', () => {
    const setDrawElementType = vi.fn();
    const setDrawMode = vi.fn();
    const setDrawPoints = vi.fn();
    renderToolbar('BuildingElementOpaque', true, {
      drawMode: 'none',
      setDrawElementType,
      setDrawMode,
      setDrawPoints,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Element type for new drawings' }));
    fireEvent.click(screen.getByRole('option', { name: /Ground floor/i }));

    expect(setDrawElementType).toHaveBeenCalledWith('BuildingElementGround');
    expect(setDrawMode).toHaveBeenCalledWith('polygon');
    expect(setDrawPoints).toHaveBeenCalledWith([]);
  });
});
