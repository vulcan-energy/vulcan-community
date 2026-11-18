// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextShadingDirections } from '../ContextShadingDirections';
import { editStoredRow } from '../../../lib/contextShadingDrawing';

const rows = [
  { from: 220, to: 264, distance: 4.97, key: 1 },
  { from: 264, to: 335, distance: 0, key: 2 },
];
const noIssues = [null, null];

describe('Directions table', () => {
  it('lists one read-only row per part, and a flag on the part with an issue', () => {
    render(
      <ContextShadingDirections
        rows={rows}
        editable={false}
        issues={[null, { message: "Direction 264°–335°: distance is 0 m. The object touches or overlaps the dwelling's closest wall. HEM needs a distance above 0. Move it away from the wall.", variant: 'error' }]}
        hoveredIndex={null}
        onHover={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    const first = screen.getByTestId('context-shading-direction-0');
    expect(first).toHaveTextContent('2202644.97');
    expect(screen.getByTestId('context-shading-direction-1')).toHaveTextContent('2643350.00');
    expect(first.querySelector('.field-validation-indicator')).toBeNull();
    expect(screen.getByTestId('context-shading-direction-1').querySelector('.field-validation-indicator'))
      .toHaveAttribute('title', "Direction 264°–335°: distance is 0 m. The object touches or overlaps the dwelling's closest wall. HEM needs a distance above 0. Move it away from the wall.");
  });

  it('reports the row under the pointer, and marks the hovered row', () => {
    const onHover = vi.fn();
    render(<ContextShadingDirections rows={rows} editable={false} issues={noIssues} hoveredIndex={1} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getByTestId('context-shading-direction-0'));
    expect(onHover).toHaveBeenLastCalledWith(0);
    fireEvent.mouseLeave(screen.getByTestId('context-shading-direction-0'));
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('context-shading-direction-1')).toHaveClass('is-hovered');
  });

  it('commits a cell on blur only, never per keystroke', () => {
    const onEdit = vi.fn(() => null);
    render(<ContextShadingDirections rows={[rows[0]]} editable issues={[null]} hoveredIndex={null} onHover={vi.fn()} onEdit={onEdit} />);
    const from = screen.getByLabelText('From, direction 1');
    for (const text of ['2', '20', '200']) fireEvent.change(from, { target: { value: text } });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.blur(from);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(0, 'start_angle', 200);
    expect(from).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the reason a refused edit gives, under the table, and marks the cell', () => {
    const onEdit = vi.fn((_index: number, field: string) => (field === 'end_angle' ? 'That would move the line through the dwelling.' : null));
    render(<ContextShadingDirections rows={[rows[0]]} editable issues={[null]} hoveredIndex={null} onHover={vi.fn()} onEdit={onEdit} />);
    const to = screen.getByLabelText('To, direction 1');
    fireEvent.focus(to);
    fireEvent.change(to, { target: { value: '300' } });
    fireEvent.blur(to);
    expect(onEdit).toHaveBeenCalledWith(0, 'end_angle', 300);
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('That would move the line through the dwelling.');
    // The refused text stays, so the user sees what was refused; typing again clears the mark and the reason.
    expect(to).toHaveValue('300');
    fireEvent.change(to, { target: { value: '30' } });
    expect(to).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses text, a range or a fraction without asking the object, and says why', () => {
    const onEdit = vi.fn(() => null);
    render(<ContextShadingDirections rows={[rows[0]]} editable issues={[null]} hoveredIndex={null} onHover={vi.fn()} onEdit={onEdit} />);
    const from = screen.getByLabelText('From, direction 1');
    const refuse = (text: string, reason: string) => {
      fireEvent.focus(from);
      fireEvent.change(from, { target: { value: text } });
      fireEvent.blur(from);
      expect(screen.getByRole('alert')).toHaveTextContent(reason);
      expect(from).toHaveAttribute('aria-invalid', 'true');
      expect(from).toHaveValue(text);
    };
    refuse('361', 'From must be between 0 and 360 degrees.');
    refuse('-5', 'From must be between 0 and 360 degrees.');
    refuse('12.5', 'From must be a whole number of degrees.');
    refuse('abc', 'From must be a number.');
    expect(onEdit).not.toHaveBeenCalled();
    // A distance takes a fraction.
    const distance = screen.getByLabelText('Distance, direction 1');
    fireEvent.change(distance, { target: { value: '4.25' } });
    fireEvent.blur(distance);
    expect(onEdit).toHaveBeenCalledWith(0, 'distance', 4.25);
  });

  it('drops a refused text once another cell is edited', () => {
    render(<ContextShadingDirections rows={[rows[0]]} editable issues={[null]} hoveredIndex={null} onHover={vi.fn()} onEdit={() => null} />);
    const from = screen.getByLabelText('From, direction 1');
    fireEvent.focus(from);
    fireEvent.change(from, { target: { value: 'abc' } });
    fireEvent.blur(from);
    expect(from).toHaveValue('abc');
    const distance = screen.getByLabelText('Distance, direction 1');
    fireEvent.focus(distance);
    fireEvent.change(distance, { target: { value: '5' } });
    fireEvent.blur(distance);
    expect(from).toHaveValue('220');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows nothing without parts', () => {
    const { container } = render(<ContextShadingDirections rows={[]} editable issues={[]} hoveredIndex={null} onHover={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('editStoredRow', () => {
  it('writes the field on a row with one range', () => {
    expect(editStoredRow({ start_angle: 10, end_angle: 40, distance: 3 }, 0, 'distance', 5)).toEqual({ distance: 5 });
  });

  it('refuses a distance of 0 or less, and From equal to To, on a row with one range', () => {
    const row = { start_angle: 10, end_angle: 40, distance: 3 };
    expect(editStoredRow(row, 0, 'distance', 0)).toBeNull();
    expect(editStoredRow(row, 0, 'distance', -1)).toBeNull();
    expect(editStoredRow(row, 0, 'start_angle', 40)).toBeNull();
    // Equal in whole degrees, as the converter reads them.
    expect(editStoredRow(row, 0, 'end_angle', 10.4)).toBeNull();
    expect(editStoredRow(row, 0, 'end_angle', 370)).toBeNull();
    expect(editStoredRow(row, 0, 'end_angle', 50)).toEqual({ end_angle: 50 });
  });

  it('writes the part and keeps the row envelope in step with its parts', () => {
    const parts = [
      { start_angle: 220, end_angle: 264, distance: 4.97 },
      { start_angle: 264, end_angle: 335, distance: 0.28 },
    ];
    expect(editStoredRow({ start_angle: 220, end_angle: 335, distance: 0.28, parts }, 0, 'distance', 0.2)).toEqual({
      parts: [{ ...parts[0], distance: 0.2 }, parts[1]],
      start_angle: 220,
      end_angle: 335,
      distance: 0.2,
    });
    expect(editStoredRow({ start_angle: 220, end_angle: 335, distance: 0.28, parts }, 1, 'end_angle', 340)).toMatchObject({ end_angle: 340 });
  });

  it('refuses an angle edit the converter would reject, and changes nothing', () => {
    const parts = [
      { start_angle: 220, end_angle: 264, distance: 4.97 },
      { start_angle: 264, end_angle: 335, distance: 0.28 },
    ];
    const row = { start_angle: 220, end_angle: 335, distance: 0.28, parts };
    // Overlaps the next part, so the sweep passes 360 degrees.
    expect(editStoredRow(row, 0, 'end_angle', 300)).toBeNull();
    // Out of clockwise order.
    expect(editStoredRow(row, 1, 'start_angle', 200)).toBeNull();
    // A part with no width.
    expect(editStoredRow(row, 0, 'end_angle', 220)).toBeNull();
    // Total over 360 degrees.
    expect(editStoredRow(row, 1, 'end_angle', 221)).toBeNull();
    // A gap is allowed, and so is a distance edit.
    expect(editStoredRow(row, 0, 'end_angle', 250)).toMatchObject({ end_angle: 335 });
    expect(editStoredRow(row, 0, 'distance', 2)).not.toBeNull();
  });
});
