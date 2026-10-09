// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import type { CanvasPreview } from '../../hooks/useAutoThermalBridgePreview';
import { JUNCTION_TYPE_DESCRIPTIONS } from '../../lib/simplifiedFabricMap';
import './ThermalBridgePreview.css';
import { externalDetailCandidateKey } from '../../geometry/thermalBridge/externalDetailContracts';

export function ThermalBridgePreviewControls({ preview, width, height, viewMode, showStatus = true }: {
  preview: CanvasPreview;
  width: number;
  height: number;
  viewMode: string;
  showStatus?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = Boolean(preview.menu);
  const closeMenu = preview.closeMenu;
  useEffect(() => {
    if (!menuOpen) return;
    const previouslyFocused = document.activeElement;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onOutside = (event: MouseEvent) => {
      // Konva emits its click during mouseup, before the browser's native click.
      // Canvas handlers own dismissal so that following click cannot close a new chooser.
      const canvasContainer = menuRef.current?.closest('.geometry-canvas');
      if (event.target instanceof HTMLCanvasElement && canvasContainer?.contains(event.target)) return;
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener('click', onOutside);
    return () => {
      document.removeEventListener('click', onOutside);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [menuOpen, closeMenu]);
  if (!preview.active) return null;
  const shown = preview.menu ?? preview.hover;
  if (preview.kind === 'duct') {
    const run = preview.runs.find((candidate) => shown?.ids.includes(candidate.proposalId));
    return <>
      {shown && run && <div className="tb-preview-label" style={{
        left: Math.max(8, Math.min(shown.anchor.x + 12, width - 290)),
        top: Math.max(8, Math.min(shown.anchor.y + 12, height - 70)),
      }}>
        <span>{run.role[0]!.toUpperCase()}{run.role.slice(1)} · {run.lengthM.toFixed(2)} m · Click to add</span>
      </div>}
      {showStatus && <ThermalBridgePreviewStatus preview={preview} viewMode={viewMode} />}
    </>;
  }
  const rows = shown?.ids.flatMap((id) => {
    const row = preview.candidates.find((candidate) => candidate.proposalId === id);
    return row ? [row] : [];
  }) ?? [];
  const issue = preview.issues.find((row) => shown?.ids.includes(`issue:${row.tb.id}`));
  const position = shown ? {
    left: Math.max(8, Math.min(shown.anchor.x + 12, width - 290)),
    top: Math.max(8, Math.min(shown.anchor.y + 12, height - (preview.menu ? Math.min(300, height / 2) + 80 : 70))),
  } : undefined;
  return <>
    {shown && (rows.length > 0 || issue || preview.menu) && <div
      ref={menuRef}
      className={`tb-preview-label${preview.menu ? ' tb-preview-menu' : ''}`}
      style={position}
      role={preview.menu ? 'dialog' : undefined}
      aria-label={preview.menu ? 'Choose thermal bridge' : undefined}
      data-suppress-canvas-keyboard={preview.menu ? '' : undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {preview.menu ? <>
        <div className="tb-preview-menu-heading">Choose junction
          <button type="button" className="btn btn-ghost btn-small" aria-label="Close junction choices" onClick={preview.closeMenu}>×</button>
        </div>
        {rows.length === 0 && <span>No suggestions remain here.</span>}
        {rows.map((row) => <div className="tb-preview-row" key={row.proposalId}
          onMouseEnter={() => preview.onHover([row.proposalId], shown.anchor)}
          onFocus={() => preview.onHover([row.proposalId], shown.anchor)}>
          <button type="button" className="btn btn-ghost tb-preview-add" disabled={!!row.addabilityError} onClick={() => preview.add(row.proposalId)} title={row.reason}>
            Add {row.junctionCode} · {row.suggestedLengthM.toFixed(2)} m
            <span>{row.openingName}</span>
          </button>
          {row.junctionOptions.length > 1 && <select
            className="standard-dropdown standard-dropdown-ghost"
            aria-label={`Junction type for ${row.openingName}`}
            value={row.junctionCode}
            onChange={(event) => preview.override(row.proposalId, event.target.value)}
          >{row.junctionOptions.map((code) => <option key={code} value={code}>{code} — {JUNCTION_TYPE_DESCRIPTIONS[code]}</option>)}</select>}
          {row.externalDetailSuggestion && row.externalDetailSuggestion.candidates.length > 1 && <select
            className="standard-dropdown standard-dropdown-ghost"
            aria-label={`Construction detail for ${row.openingName}`}
            value={row.externalDetailSuggestion.selected ? externalDetailCandidateKey(row.externalDetailSuggestion.selected) : ''}
            onChange={(event) => preview.chooseDetail(row.externalDetailSuggestion!.groupKey, event.target.value)}
          >
            <option value="">Default ψ</option>
            {row.externalDetailSuggestion.candidates.map((detail) => <option key={externalDetailCandidateKey(detail)} value={externalDetailCandidateKey(detail)}>
              {detail.detail.detailCode} · ψ {detail.detail.psiWPerMK} · {detail.detail.title}
            </option>)}
          </select>}
          {row.addabilityError && <small>{row.addabilityError}</small>}
          <small>{row.externalDetailSuggestion?.selected ? row.externalDetailSuggestion.selected.detail.detailCode : 'Default ψ'} · {row.linearThermalTransmittance}</small>
        </div>)}
      </> : issue ? <span>{issue.notes.join(' · ')} · Click to inspect</span> : rows.length > 1
        ? <span>{rows.length} suggestions · Click to choose</span>
        : rows[0] && <>
          <span>{rows[0].junctionCode} · {rows[0].suggestedLengthM.toFixed(2)} m · {rows[0].addabilityError ?? 'Click to add'}</span>
          {(rows[0].junctionOptions.length > 1 || (rows[0].externalDetailSuggestion?.candidates.length ?? 0) > 1) && <button type="button" className="btn btn-ghost btn-small"
            aria-label="Change suggested junction type" onClick={() => preview.configure(rows[0].proposalId, shown.anchor)}>▾</button>}
          {rows[0].externalDetailSuggestion && !rows[0].externalDetailSuggestion.selected && <small>Default ψ</small>}
        </>}
    </div>}
    {showStatus && <ThermalBridgePreviewStatus preview={preview} viewMode={viewMode} />}
  </>;
}


/** Fits in the existing draw toolbar accessory so the floor pill follows its placement. */
export function ThermalBridgePreviewStatus({ preview, viewMode, inline = false }: {
  preview: CanvasPreview;
  viewMode: string;
  inline?: boolean;
}) {
  if (!preview.active) return null;
  return (
    <div className={`tb-preview-status${inline ? ' tb-preview-status-inline' : ''}`} aria-live="polite">
      {preview.error ? <span role="alert">{preview.error}</span> : (preview.menu || (preview.kind !== 'duct' && (preview.hover?.ids.length ?? 0) > 0)) ? null :
        <span>{preview.kind === 'duct'
          ? preview.runs.length ? `${preview.runs.length} runs · Click to add · Release A to draw` : 'No suggestions on this floor'
          : preview.candidates.some((candidate) => !candidate.addabilityError)
          ? `Click to add · Release A to ${viewMode === '3d' ? 'exit' : 'draw'}`
          : preview.candidates.length ? 'No addable suggestions on this floor' : 'No suggestions on this floor'}</span>}
      {preview.unplacedCount > 0 && <span>{preview.unplacedCount} suggestions need a floor · Review all…</span>}
      {preview.otherFloorCount > 0 && <span>{preview.otherFloorCount} suggestions on other floors</span>}
    </div>
  );
}
