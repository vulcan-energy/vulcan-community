// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { easeRemoteCursors } from '../RemotePresenceLayer';
import { PeopleControl } from '../ElementsZonesPanel';

describe('easeRemoteCursors', () => {
  it('starts a new cursor at its target, eases an existing one, settles, and drops one no longer targeted', () => {
    const displayed = new Map<string, { x: number; y: number }>();
    expect(easeRemoteCursors(displayed, [{ key: 'a', x: 1, y: 2 }], 16)).toBe(false);
    expect(displayed.get('a')).toEqual({ x: 1, y: 2 });

    // A jump of 1 m: part of the way in one frame, nearly all of it by 150 ms.
    expect(easeRemoteCursors(displayed, [{ key: 'a', x: 2, y: 2 }], 16)).toBe(true);
    const afterFrame = displayed.get('a')!.x;
    expect(afterFrame).toBeGreaterThan(1.2);
    expect(afterFrame).toBeLessThan(1.4);
    for (let elapsed = 16; elapsed < 150; elapsed += 16) easeRemoteCursors(displayed, [{ key: 'a', x: 2, y: 2 }], 16);
    expect(displayed.get('a')!.x).toBeGreaterThan(1.95);
    for (let frame = 0; frame < 30; frame += 1) easeRemoteCursors(displayed, [{ key: 'a', x: 2, y: 2 }], 16);
    expect(easeRemoteCursors(displayed, [{ key: 'a', x: 2, y: 2 }], 16)).toBe(false);
    expect(displayed.get('a')).toEqual({ x: 2, y: 2 });

    easeRemoteCursors(displayed, [], 16);
    expect(displayed.size).toBe(0);
  });
});

describe('PeopleControl', () => {
  it('renders nothing when nobody else is here', () => {
    const { container } = render(<PeopleControl people={{ items: [], followingKey: null, onFollow: vi.fn() }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists people with at most one qualifier and follows on click', () => {
    const onFollow = vi.fn();
    render(
      <PeopleControl
        people={{
          items: [
            { key: 'u-alex', name: 'Alex', color: 'red', initials: 'A', qualifier: 'F2' },
            { key: 'u-sam', name: 'Sam', color: 'blue', initials: 'S' },
          ],
          followingKey: 'u-sam',
          onFollow,
        }}
      />,
    );
    const alex = screen.getByRole('button', { name: /Alex/ });
    expect(alex).toHaveTextContent('AAlexF2');
    expect(alex).toHaveAttribute('aria-pressed', 'false');
    const sam = screen.getByRole('button', { name: /Sam/ });
    expect(sam).toHaveTextContent(/^SSam$/);
    expect(sam).toHaveAttribute('aria-pressed', 'true');
    expect(sam).toHaveAttribute('title', 'Following · click to stop');
    fireEvent.click(alex);
    expect(onFollow).toHaveBeenCalledWith('u-alex');
  });
});
