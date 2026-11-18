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
    const addInput = screen.getByLabelText('FHS floor number to add');
    expect(addInput).toHaveAttribute('placeholder', '3');
    fireEvent.change(addInput, { target: { value: '1' } });
    expect(screen.getByText('F1: Ground exists')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));

    expect(onAddFloor).toHaveBeenCalledWith(-1);
  });

  it('shows each floor\'s derived base and height as placeholders, ground\'s base as 0', () => {
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
    expect(upperInput).toHaveValue('');
    expect(upperInput).toHaveAttribute('placeholder', '2.4');
    const groundHeight = screen.getByLabelText('Storey height for F1: Ground in metres');
    expect(groundHeight).toHaveValue('');
    expect(groundHeight).toHaveAttribute('placeholder', '2.4');
  });

  it('types a storey height, and an emptied height goes back to the walls', () => {
    const onUpdateFloor = vi.fn();
    const typedFloors = [{ ...floors[0]!, height: 2.5, heightUserOverride: true }, floors[1]!];
    render(
      <FloorPickerDropdown
        currentFloorZ={0}
        floors={typedFloors}
        elementsById={elementsById}
        onSelectFloor={vi.fn()}
        onAddFloor={vi.fn()}
        onDeleteFloor={vi.fn()}
        onUpdateFloor={onUpdateFloor}
      />,
    );
    fireEvent.click(screen.getByTitle('Current floor'));
    const ground = screen.getByLabelText('Storey height for F1: Ground in metres');
    expect(ground).toHaveValue('2.5');
    fireEvent.change(ground, { target: { value: '' } });
    fireEvent.blur(ground);
    expect(onUpdateFloor).toHaveBeenLastCalledWith('floor-0', { heightUserOverride: false });
    const upper = screen.getByLabelText('Storey height for F2 in metres');
    fireEvent.change(upper, { target: { value: '2.65' } });
    fireEvent.blur(upper);
    expect(onUpdateFloor).toHaveBeenLastCalledWith('floor-1', { height: 2.65, heightUserOverride: true });
  });

  it('offers "Copy of F2" for the storey above, and only Empty under a roof', () => {
    const onCopyFloor = vi.fn();
    const props = {
      currentFloorZ: 0,
      floors,
      onSelectFloor: vi.fn(),
      onAddFloor: vi.fn(),
      onDeleteFloor: vi.fn(),
      onCopyFloor,
    };
    const { unmount } = render(<FloorPickerDropdown {...props} elementsById={elementsById} />);
    fireEvent.click(screen.getByTitle('Current floor'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy of F2' }));
    expect(onCopyFloor).toHaveBeenCalledWith(1, 2);
    unmount();

    const roof = {
      id: 'roof', name: 'Roof', type: 'BuildingElementOpaque', width: 4, height: 4, area: 16, pitch: 35, base_height: 4.8,
      coordinates: [{ x: 0, y: -1, z: 1 }, { x: 4, y: -1, z: 1 }, { x: 4, y: 4, z: 1 }], parent_element: null,
    };
    render(<FloorPickerDropdown {...props} elementsById={{ ...elementsById, roof }} />);
    fireEvent.click(screen.getByTitle('Current floor'));
    expect(screen.getByRole('button', { name: 'Empty' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy of/ })).toBeNull();
  });

  it('edits F1 base height directly', () => {
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
    const input = screen.getByLabelText('Base height for F1: Ground in metres');
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: '0.3' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      baseHeight: 0.3,
      baseHeightUserOverride: true,
    });
  });

  it('edits F2 base height directly', () => {
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

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-1', {
      baseHeight: 2.7,
      baseHeightUserOverride: true,
    });
  });

  it('shows F1 Ground before any floor record exists', () => {
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

    expect(screen.getByRole('option', { name: /F1: Ground/i })).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: /Base height for F1: Ground/i });
    fireEvent.change(input, { target: { value: '0.2' } });
    fireEvent.blur(input);
    expect(onEnsureFloorForZ).toHaveBeenCalledWith(0);
    expect(onUpdateFloor).toHaveBeenCalledWith('floor-0', {
      baseHeight: 0.2,
      baseHeightUserOverride: true,
    });
    expect(screen.queryByText('No floors yet.')).toBeNull();
  });

  it('displays and edits basement base height directly', () => {
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
    expect(input).toHaveAttribute('placeholder', '-2.4');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: '-2.7' } });
    fireEvent.blur(input);

    expect(onUpdateFloor).toHaveBeenCalledWith('floor-b1', {
      baseHeight: -2.7,
      baseHeightUserOverride: true,
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

  it('does not render base inputs when onUpdateFloor is not provided', () => {
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
