// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { ElementType } from '../../geometry/types';
import { ElementTypePicker } from '../ElementTypePicker';

const options: ElementType[] = ['BuildingElementOpaque', 'System'];
const addElement = () => <ElementTypePicker value={null} options={options} valueLabel="+ Element" ariaLabel="+ Element" onChange={vi.fn()} />;

it('opens "+ Element" on the group last picked from', async () => {
  const user = userEvent.setup();
  const first = render(addElement());
  await user.click(screen.getByRole('button', { name: '+ Element' }));
  expect(screen.queryByRole('option', { name: /Plant system/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Heating & Hot Water/ }));
  await user.click(screen.getByRole('option', { name: /Plant system/ }));
  first.unmount();

  render(addElement());
  await user.click(screen.getByRole('button', { name: '+ Element' }));
  expect(screen.getByRole('option', { name: /Plant system/ })).toBeInTheDocument();
});
