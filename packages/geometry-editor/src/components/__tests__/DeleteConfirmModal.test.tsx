// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmModal } from '../DeleteConfirmModal';

const baseProps = {
  onClose: () => {},
  onConfirm: () => {},
  title: 'Delete Zone',
  message: "This will delete zone 'Living Room' and 2 elements.",
  itemType: 'zone' as const,
};

describe('DeleteConfirmModal', () => {
  it('exposes dialog semantics: role, aria-modal, and aria-labelledby pointing at the title', () => {
    render(<DeleteConfirmModal {...baseProps} isOpen onClose={() => {}} onConfirm={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: 'Delete Zone' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Delete Zone');
  });

  it('focuses the cancel button by default on open (initialFocus defaults to "cancel")', () => {
    render(<DeleteConfirmModal {...baseProps} isOpen onClose={() => {}} onConfirm={() => {}} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('focuses the confirm button on open when initialFocus="confirm"', () => {
    render(
      <DeleteConfirmModal {...baseProps} isOpen initialFocus="confirm" onClose={() => {}} onConfirm={() => {}} />
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('confirms exactly once when Enter is pressed while the confirm button has focus', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal {...baseProps} isOpen initialFocus="confirm" onClose={() => {}} onConfirm={onConfirm} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirms exactly once when Space is pressed while the confirm button has focus', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal {...baseProps} isOpen initialFocus="confirm" onClose={() => {}} onConfirm={onConfirm} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.keyboard(' ');

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm when Enter is pressed while the cancel button has focus', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal {...baseProps} isOpen onClose={() => {}} onConfirm={onConfirm} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('traps Tab within the dialog: Cancel -> Delete -> Close modal -> Cancel, and Shift+Tab reverses it', async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmModal {...baseProps} isOpen onClose={() => {}} onConfirm={() => {}} />);

    const closeButton = screen.getByRole('button', { name: 'Close modal' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const confirmButton = screen.getByRole('button', { name: 'Delete' });

    expect(cancelButton).toHaveFocus();

    await user.tab();
    expect(confirmButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(cancelButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(confirmButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it('cancels on Escape even when focus is on the confirm button, not just the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DeleteConfirmModal {...baseProps} isOpen initialFocus="confirm" onClose={onClose} onConfirm={() => {}} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the element that opened the dialog once it closes', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { rerender } = render(
      <DeleteConfirmModal {...baseProps} isOpen onClose={() => {}} onConfirm={() => {}} />
    );
    expect(opener).not.toHaveFocus();

    rerender(<DeleteConfirmModal {...baseProps} isOpen={false} onClose={() => {}} onConfirm={() => {}} />);

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
