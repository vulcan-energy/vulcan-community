// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloorPickerDropdown } from '../canvas/FloorPickerDropdown';

describe('FloorPickerDropdown', () => {
  // Two floors with stored heights of 2.4 m. No walls have a `height` field, so the
  // wall-derivation chain falls through to stored Floor.height = 2.4. Cumulative base
  // heights then read: F1 (ground) -> 0 m, F2 -> 2.4 m.
  const floors = [
    { id: 'floor-0', name: '0', zIndex: 0, height: 2.4, isRoofSpace: false },
    { id: 'floor-1', name: '1', zIndex: 1, height: 2.4, isRoofSpace: true },
  ];

  const elementsById = {
    wall0: {
      id: 'wall0',
      name: 'Ground wall',
      type: 'BuildingElementOpaque',
      floorId: 'floor-0',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      zoneId: 'zone-1',
      parent_element: null,
    },
    wall1: {
      id: 'wall1',
      name: 'First wall',
      type: 'BuildingElementOpaque',
      floorId: 'floor-1',
      coordinates: [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }],
      zoneId: 'zone-1',
      parent_element: null,
    },
  } as any;

  it('switches floors when a floor row is clicked', () => {
    const onSelectFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={onSelectFloor}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    fireEvent.click(screen.getByRole('option', { name: /f2/i }));

    expect(onSelectFloor).toHaveBeenCalledWith(1);
  });

  it('shows a validation toast when trying to add an existing floor', () => {
    const onAddFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={onAddFloor}
        onDeleteFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    expect(screen.getByText('Adds F3')).toBeInTheDocument();
    const addInput = screen.getByLabelText('FHS floor number to add');
    fireEvent.change(addInput, { target: { value: '1' } });
    expect(screen.getByText('F1: Ground exists')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAddFloor).not.toHaveBeenCalled();
    expect(screen.getByText('F1: Ground already exists')).toBeInTheDocument();
  });

  it('converts entered FHS floor numbers to internal canvas floors when adding', () => {
    const onAddFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={onAddFloor}
        onDeleteFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const addInput = screen.getByLabelText('FHS floor number to add');
    fireEvent.change(addInput, { target: { value: '0' } });
    expect(screen.getByText('Adds F0: Basement 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAddFloor).toHaveBeenCalledWith(-1);
  });

  it('displays cumulative base heights per FHS floor (F1 = 0 m, F2 = 2.4 m)', () => {
    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const groundInput = screen.getByLabelText('Base height for F1: Ground in metres');
    const upperInput = screen.getByLabelText('Base height for F2 in metres');
    expect(groundInput).toHaveAttribute('type', 'text');
    expect(upperInput).toHaveAttribute('type', 'text');
    expect(groundInput).toHaveValue('0');
    expect(upperInput).toHaveValue('2.4');
  });

  it('F1 base-height input is read-only (ground reference is always 0)', () => {
    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const input = screen.getByLabelText('Base height for F1: Ground in metres');
    expect(input).toBeDisabled();
  });

  it('displays and edits basement base height as a negative slab elevation', () => {
    const onUpdateFloor = vi.fn();
    const floorsWithBasement = [
      { id: 'floor-b1', name: '-1', zIndex: -1, height: 2.4, isRoofSpace: false },
      ...floors,
    ];
    const elementsWithBasement = {
      ...elementsById,
      wallB: {
        id: 'wallB',
        name: 'Basement wall',
        type: 'BuildingElementOpaque',
        floorId: 'floor-b1',
        coordinates: [{ x: 0, y: 0, z: -1 }, { x: 2, y: 0, z: -1 }],
        height: 2.4,
        zoneId: 'zone-1',
        parent_element: null,
      },
    } as any;

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floorsWithBasement}
        elementsById={elementsWithBasement}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const input = screen.getByLabelText('Base height for F0: Basement 1 in metres');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('-2.4');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: '-2.7' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-b1', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('editing F2 base height routes the new storey to internal floor 0 with override=true', () => {
    const onUpdateFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const input = screen.getByLabelText('Base height for F2 in metres');
    fireEvent.change(input, { target: { value: '2.7' } });
    fireEvent.blur(input);

    // F2's base = internal Floor 0's storey. Typed 2.7 -> set Floor 0 height to 2.7 with override.
    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('auto-clears the override flag when typed value matches the wall-derived storey', () => {
    const onUpdateFloor = vi.fn();
    // Existing override on internal Floor 0 (3.0 m), walls suggest 2.4 m. User types the wall value to
    // snap back — commit should set override=false.
    const floorsWithOverride = [
      { ...floors[0], height: 3.0, heightUserOverride: true },
      floors[1],
    ];
    const elementsWithWall = {
      ...elementsById,
      wall0: { ...elementsById.wall0, height: 2.4 },
    } as any;

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floorsWithOverride}
        elementsById={elementsWithWall}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const input = screen.getByLabelText('Base height for F2 in metres');
    fireEvent.change(input, { target: { value: '2.4' } });
    fireEvent.blur(input);

    // Typed value matches wall-derived → override=false (walls keep driving).
    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      height: 2.4,
      heightUserOverride: false,
    });
  });

  it('shows a stale-override warning when walls disagree with an explicit override', () => {
    const onUpdateFloor = vi.fn();
    const floorsWithOverride = [
      { ...floors[0], height: 3.0, heightUserOverride: true },
      floors[1],
    ];
    const elementsWithWall = {
      ...elementsById,
      wall0: { ...elementsById.wall0, height: 2.4 },
    } as any;

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floorsWithOverride}
        elementsById={elementsWithWall}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    // Warning targets F2's row because its base depends on internal Floor 0's overridden storey.
    const warningButton = screen.getByLabelText('Reset F2 base height to wall-derived value');
    fireEvent.click(warningButton);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', { heightUserOverride: false });
  });

  it('does not render height inputs when onUpdateFloor is not provided', () => {
    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    expect(screen.queryByLabelText('Base height for F1: Ground in metres')).toBeNull();
  });

  it('confirms floor deletion before calling the delete handler', () => {
    const onDeleteFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={onDeleteFloor}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    fireEvent.click(screen.getByLabelText('Delete F2'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDeleteFloor).toHaveBeenCalledWith('floor-1');
  });
});
