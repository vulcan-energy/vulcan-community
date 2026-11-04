// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SearchableDescribedSelect } from '../SearchableDescribedSelect';

const options = [
  { value: 'england', label: 'England' },
  { value: 'wales', label: 'Wales' },
  { value: 'northern ireland', label: 'Northern Ireland' },
];

function setup(searchable = true) {
  const onChange = vi.fn();
  render(
    <SearchableDescribedSelect
      aria-label="Country"
      value="wales"
      onChange={onChange}
      searchable={searchable}
      sections={[{ options }]}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Country' });
  return { onChange, trigger };
}

describe('SearchableDescribedSelect keyboard', () => {
  it('arrow keys move through options, Enter picks, and focus returns to the trigger', () => {
    const { onChange, trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const search = screen.getByRole('combobox', { name: 'Search…' });
    // Opens on the current answer; the id holds no space even for a value that does.
    const active = () => document.getElementById(search.getAttribute('aria-activedescendant')!);
    expect(active()).toHaveAccessibleName('Wales');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(active()).toHaveAccessibleName('Northern Ireland');
    expect(search.getAttribute('aria-activedescendant')).not.toMatch(/\s/);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(active()).toHaveAccessibleName('England');

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('england');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Enter picks the first match of a search', () => {
    const { onChange, trigger } = setup();
    fireEvent.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Search…' });
    fireEvent.change(search, { target: { value: 'north' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('northern ireland');
  });

  it('Esc closes without a choice and focus returns to the trigger', () => {
    const { onChange, trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('holds focus in the search box: an option is not a Tab stop', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('tabindex', '-1');
    }
  });

  it('works the same without a search box', () => {
    const { onChange, trigger } = setup(false);
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveFocus();
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('england');
    expect(trigger).toHaveFocus();
  });
});
