// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../geometry/types';
import type { ValidationResult } from '../../geometry/validation/types';
import { FloorPickerDropdown } from '../canvas/FloorPickerDropdown';

describe('FloorPickerDropdown', () => {
  // Two floors with 2.4 m vertical walls. Storey heights are derived from those walls.
  const floors = [
    { id: 'floor-0', name: '0', zIndex: 0, height: 2.4, isRoofSpace: false },
    { id: 'floor-1', name: '1', zIndex: 1, height: 2.4, isRoofSpace: true },
  ];

  const elementsById = {
    wall0: {
      id: 'wall0',
      name: 'Ground wall',
      type: 'BuildingElementOpaque',
      width: 2,
      height: 2.4,
      area: 4.8,
      pitch: 90,
      floorId: 'floor-0',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      zoneId: 'zone-1',
      parent_element: null,
    },
    wall1: {
      id: 'wall1',
      name: 'First wall',
      type: 'BuildingElementOpaque',
      width: 2,
      height: 2.4,
      area: 4.8,
      pitch: 90,
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

  it('displays each floor\'s effective storey height', () => {
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
    const groundInput = screen.getByLabelText('Storey height for F1: Ground in metres');
    const upperInput = screen.getByLabelText('Storey height for F2 in metres');
    expect(groundInput).toHaveAttribute('type', 'text');
    expect(upperInput).toHaveAttribute('type', 'text');
    expect(groundInput).toHaveValue('2.4');
    expect(upperInput).toHaveValue('2.4');
    expect(screen.getByTitle('Base elevation of F1: Ground, in metres')).toHaveTextContent('0 m');
    expect(screen.getByTitle('Base elevation of F2, in metres')).toHaveTextContent('2.4 m');
  });

  it('edits F1 storey height directly', () => {
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
    const input = screen.getByLabelText('Storey height for F1: Ground in metres');
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: '2.7' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('shows F1 Ground before any floor record exists', () => {
    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={[]}
        elementsById={{}}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));

    expect(screen.getByRole('option', { name: /F1: Ground/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Storey height for F1: Ground in metres')).toHaveValue('');
    expect(screen.getByTitle('Base elevation of F1: Ground, in metres')).toHaveTextContent('0 m');
    expect(screen.queryByText('No floors yet.')).toBeNull();
  });

  it('creates the ground floor before committing an edited height from the placeholder row', () => {
    const onEnsureFloorForZ = vi.fn(() => 'floor-0');
    const onUpdateFloor = vi.fn();

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={[]}
        elementsById={{}}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
        onEnsureFloorForZ={onEnsureFloorForZ}
      />,
    );

    fireEvent.click(screen.getByTitle('Current floor'));
    const input = screen.getByLabelText('Storey height for F1: Ground in metres');
    fireEvent.change(input, { target: { value: '2.7' } });
    fireEvent.blur(input);

    expect(onEnsureFloorForZ).toHaveBeenCalledWith(0);
    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('displays and edits basement storey height directly', () => {
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
    const input = screen.getByLabelText('Storey height for F0: Basement 1 in metres');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('2.4');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: '2.7' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-b1', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('editing F2 storey height updates internal floor 1 with override=true', () => {
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
    const input = screen.getByLabelText('Storey height for F2 in metres');
    fireEvent.change(input, { target: { value: '2.7' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-1', {
      height: 2.7,
      heightUserOverride: true,
    });
  });

  it('flags the floor picker when validation finds an overlap or separation warning', () => {
    const getElementValidation = vi.fn((element: Element): ValidationResult => ({
      hasIssues: false,
      issues: [],
      hasWarnings: element.id === 'wall1',
      warnings:
        element.id === 'wall1'
          ? [
              {
                message: 'Floor geometry may overlap or separate.',
                fieldKey: 'floor_stack',
                source: 'geometry',
              },
            ]
          : [],
    }));

    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={floors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        getElementValidation={getElementValidation}
      />,
    );

    // The dot is available on the closed picker button and remains attached to the affected row
    // when the picker is opened.
    expect(screen.getByTitle('Floor geometry may overlap or separate.')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Current floor'));
    expect(screen.getAllByTitle('Floor geometry may overlap or separate.')).toHaveLength(2);
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
    const input = screen.getByLabelText('Storey height for F1: Ground in metres');
    fireEvent.change(input, { target: { value: '2.4' } });
    fireEvent.blur(input);

    // Typed value matches wall-derived → override=false (walls keep driving).
    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      height: 2.4,
      heightUserOverride: false,
    });
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
    expect(screen.queryByLabelText('Storey height for F1: Ground in metres')).toBeNull();
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
