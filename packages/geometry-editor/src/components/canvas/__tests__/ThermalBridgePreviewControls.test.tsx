// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../geometry/types';
import type { AutoThermalBridgeCandidate } from '../../../geometry/thermalBridge/autoThermalBridgeCandidates';
import type { ExternalDetailAutoTbSuggestion } from '../../../geometry/thermalBridge/externalDetailsForAutoTb';
import type { ThermalBridgePreviewAnchor, AutoThermalBridgePreview } from '../../../hooks/useAutoThermalBridgePreview';
import { ThermalBridgePreviewControls, ThermalBridgePreviewStatus } from '../ThermalBridgePreviewControls';

function candidate(
  proposalId: string,
  junctionCode: string,
  junctionOptions: readonly string[] = [junctionCode],
): AutoThermalBridgeCandidate {
  return {
    proposalId,
    openingId: `opening-${proposalId}`,
    openingName: `Opening ${proposalId}`,
    zoneId: 'zone-1',
    edgeRole: 'roof_window_sill',
    junctionCode,
    junctionOptions,
    suggestedLengthM: 1.25,
    linearThermalTransmittance: 0.08,
    reason: `Suggested ${junctionCode}`,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    status: 'new',
  };
}

function preview(overrides: Partial<AutoThermalBridgePreview> = {}): AutoThermalBridgePreview {
  return {
    active: true,
    held: true,
    pinned: false,
    pin: vi.fn(),
    unpin: vi.fn(),
    release: vi.fn(),
    dismiss: vi.fn(),
    closeMenu: vi.fn(),
    candidates: [],
    issues: [],
    otherFloorCount: 0,
    unplacedCount: 0,
    error: null,
    hover: null,
    menu: null,
    onHover: vi.fn(),
    onActivate: vi.fn(),
    configure: vi.fn(),
    add: vi.fn(),
    override: vi.fn(),
    chooseDetail: vi.fn(),
    ...overrides,
  } as AutoThermalBridgePreview;
}

function renderControls(value: AutoThermalBridgePreview, viewMode = '2d') {
  return render(<ThermalBridgePreviewControls preview={value} width={800} height={600} viewMode={viewMode} />);
}

describe('ThermalBridgePreviewControls', () => {
  it('lets the owning canvas handle its native click without immediately closing a new chooser', () => {
    const row = candidate('opening-top', 'R1');
    const closeMenu = vi.fn();
    const value = preview({ pinned: true, menu: { ids: [row.proposalId], anchor: { x: 100, y: 100 } }, candidates: [row], closeMenu });
    render(<div className="geometry-canvas">
      <div className="canvas-container"><canvas data-testid="own-canvas" /></div>
      <ThermalBridgePreviewControls preview={value} width={800} height={600} viewMode="2d" />
    </div>);
    fireEvent.click(screen.getByTestId('own-canvas'));
    expect(closeMenu).not.toHaveBeenCalled();
    fireEvent.click(document.body);
    expect(closeMenu).toHaveBeenCalledOnce();
  });

  it.each([[1, '1 suggestion'], [3, '3 suggestions']])('counts %i duct run(s) as suggestions', (count, noun) => {
    const duct = { active: true, kind: 'duct', runs: Array.from({ length: count }, () => ({})), chooseUnit: false,
      error: null, menu: null, hover: null, unplacedCount: 0, otherFloorCount: 0 } as never;
    render(<ThermalBridgePreviewStatus preview={duct} viewMode="2d" />);
    expect(screen.getByText(`${noun} · Click to add · Release A to draw`)).toBeInTheDocument();
  });

  it('does not invite adding when every current-floor candidate has a blocking reason', () => {
    renderControls(preview({ candidates: [{ ...candidate('blocked', 'E5'), addabilityError: 'Missing host floor.' }] }));
    expect(screen.getByText('No addable suggestions on this floor')).toBeInTheDocument();
    expect(screen.queryByText(/Click to add/)).not.toBeInTheDocument();
  });

  it('shows one candidate as a direct add with an optional junction control', () => {
    const row = candidate('roof-window-lower', 'R2', ['R2', 'R11']);
    const configure = vi.fn();
    const add = vi.fn();
    renderControls(preview({
      candidates: [row],
      hover: { ids: [row.proposalId], anchor: { x: 100, y: 100 } },
      configure,
      add,
    }));

    expect(screen.getByText('R2 · 1.25 m · Click to add')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change suggested junction type' }));
    expect(configure).toHaveBeenCalledWith(row.proposalId, { x: 100, y: 100 });
    expect(add).not.toHaveBeenCalled();
  });

  it('changes a junction from the pinned optional menu without adding it', () => {
    const row = candidate('roof-window-lower', 'R2', ['R2', 'R11']);
    const override = vi.fn();
    renderControls(preview({
      pinned: true,
      menu: { ids: [row.proposalId], anchor: { x: 100, y: 100 } },
      candidates: [row],
      override,
    }));

    expect(screen.getByRole('dialog', { name: 'Choose thermal bridge' })).toHaveAttribute('data-suppress-canvas-keyboard');
    fireEvent.change(screen.getByRole('combobox', { name: 'Junction type for Opening roof-window-lower' }), {
      target: { value: 'R11' },
    });
    expect(override).toHaveBeenCalledWith(row.proposalId, 'R11');
    expect(screen.getByRole('button', { name: /Add R2/ })).toBeInTheDocument();
  });

  it('adds one selected physical row immediately from an overlap chooser and isolates the canvas click', () => {
    const first = candidate('opening-top', 'R1');
    const second = candidate('opening-bottom', 'R2');
    const add = vi.fn();
    const canvasClick = vi.fn();
    const value = preview({
      pinned: true,
      menu: { ids: [first.proposalId, second.proposalId], anchor: { x: 100, y: 100 } },
      candidates: [first, second],
      add,
    });
    render(<div onClick={canvasClick}>
      <ThermalBridgePreviewControls preview={value} width={800} height={600} viewMode="2d" />
    </div>);

    fireEvent.click(screen.getByRole('button', { name: /Add R2 · 1.25 m Opening opening-bottom/ }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(second.proposalId);
    expect(canvasClick).not.toHaveBeenCalled();
  });

  it('moves keyboard focus into the chooser and restores prior focus when it closes', async () => {
    const previousFocus = document.createElement('button');
    previousFocus.textContent = 'Before chooser';
    document.body.append(previousFocus);
    previousFocus.focus();
    const row = candidate('opening-bottom', 'R2');
    const closeMenu = vi.fn();
    const view = renderControls(preview({
      pinned: true,
      menu: { ids: [row.proposalId], anchor: { x: 100, y: 100 } },
      candidates: [row],
      closeMenu,
    }));

    const close = screen.getByRole('button', { name: 'Close junction choices' });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.click(close);
    expect(closeMenu).toHaveBeenCalledTimes(1);
    view.rerender(<ThermalBridgePreviewControls preview={preview({ candidates: [row] })}
      width={800} height={600} viewMode="2d" />);
    await waitFor(() => expect(previousFocus).toHaveFocus());
    previousFocus.remove();
  });

  it('closes the pinned chooser on an outside click without adding a candidate', () => {
    const row = candidate('opening-bottom', 'R2');
    const closeMenu = vi.fn();
    const add = vi.fn();
    const value = preview({
      pinned: true,
      menu: { ids: [row.proposalId], anchor: { x: 100, y: 100 } },
      candidates: [row],
      closeMenu,
      add,
      onActivate: vi.fn(() => closeMenu()),
    });
    render(<div data-testid="canvas" onClick={() => value.onActivate([row.proposalId], { x: 120, y: 100 })}>
      <ThermalBridgePreviewControls preview={value} width={800} height={600} viewMode="2d" />
    </div>);

    const canvas = screen.getByTestId('canvas');
    fireEvent.pointerDown(canvas);
    fireEvent.click(canvas);
    expect(closeMenu).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps the table ψ default and exposes optional external detail selection', () => {
    const row = candidate('wall-detail', 'E1');
    const profile = {
      id: 'profile-a', source: 'catalogue-a', sourceName: 'Catalogue A', sourceShortName: 'A',
      sourceUrl: 'https://example.test', importedAt: '2026-01-01', category: 'manufacturer',
      elementType: 'wall', systemName: 'Wall system', label: 'Wall system',
      junctions: [],
    } as const;
    const details = [
      { profile, detail: { junctionCode: 'E1', detailCode: 'A1', title: 'Detail A', psiWPerMK: 0.04 } },
      { profile, detail: { junctionCode: 'E1', detailCode: 'A2', title: 'Detail B', psiWPerMK: 0.06 } },
    ];
    const suggestion: ExternalDetailAutoTbSuggestion = {
      groupKey: 'catalogue-a::profile-a::E1', hostElementId: 'wall-1', profile,
      candidates: details,
    };
    const chooseDetail = vi.fn();
    const add = vi.fn();
    renderControls(preview({
      pinned: true,
      menu: { ids: [row.proposalId], anchor: { x: 100, y: 100 } },
      candidates: [{ ...row, externalDetailSuggestion: suggestion }],
      chooseDetail,
      add,
    }));

    const chooser = screen.getByRole('combobox', { name: 'Construction detail for Opening wall-detail' });
    expect(chooser).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Default ψ' })).toBeInTheDocument();
    expect(screen.getByText('Default ψ · 0.08')).toBeInTheDocument();
    const detailOption = screen.getByRole('option', { name: /A2 · ψ 0.06 · Detail B/ });
    fireEvent.change(chooser, { target: { value: (detailOption as HTMLOptionElement).value } });
    expect(chooseDetail).toHaveBeenCalledWith(suggestion.groupKey, (detailOption as HTMLOptionElement).value);
    expect(add).not.toHaveBeenCalled();
  });

  it('shows a safe empty state when pinned candidate IDs have become stale', () => {
    renderControls(preview({
      pinned: true,
      menu: { ids: ['removed-candidate'], anchor: { x: 100, y: 100 } },
      candidates: [],
    }));

    expect(screen.getByRole('dialog', { name: 'Choose thermal bridge' })).toBeInTheDocument();
    expect(screen.getByText('No suggestions remain here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close junction choices' })).toBeInTheDocument();
  });

  it('shows the other-floor count and warning details for an inspected existing bridge', () => {
    const anchor: ThermalBridgePreviewAnchor = { x: 120, y: 100 };
    const warning = {
      tb: { id: 'tb-warning', coordinates: [{ x: 0, y: 0, z: 0 }] } as Element,
      notes: ['Junction host could not be verified'],
    };
    renderControls(preview({
      hover: { ids: ['issue:tb-warning'], anchor },
      issues: [warning] as never,
      otherFloorCount: 3,
    }));

    expect(screen.getByText('3 suggestions on other floors')).toBeInTheDocument();
    expect(screen.getByText('Junction host could not be verified · Click to inspect')).toBeInTheDocument();
  });

  it('shows no suggestion hint when preview mode is inactive', () => {
    const row = candidate('opening-bottom', 'R2');
    renderControls(preview({
      active: false,
      held: false,
      candidates: [row],
    }));

    expect(screen.queryByText(/Click to add/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hold A/)).not.toBeInTheDocument();
  });

  it('says release A exits preview mode in 3D', () => {
    const row = candidate('opening-bottom', 'R2');
    renderControls(preview({ held: true, candidates: [row] }), '3d');
    expect(screen.getByText('Click to add · Release A to exit')).toBeInTheDocument();
  });
});
