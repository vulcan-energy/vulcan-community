// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useMemo, useState } from 'react';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import {
  computeRuIso6946,
  CORRIDOR_ROW_LABELS,
  GARAGE_ROW_LABELS,
  roundRu,
  ruFromCorridorTable,
  ruFromGarageTable,
  ruFromStairwellTable,
  RU_CALCULATOR_STATE_KEY,
  sumAeUeFromAreaAndU,
  type CorridorRowId,
  type GarageRowId,
  type RuCalculatorFormulaStateV1,
  type RuCalculatorStateV1,
  type RuCalculatorTableStateV1,
  type StairwellFacing,
} from '../lib/unheatedSpaceRu';
import { loadBundledAssemblyLibrary } from '../lib/assemblyLibrary';
import type { BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import { computeUFromSavedAssembly } from '../lib/multiSelectAssemblyApply';
import type { AssemblyExample } from '../lib/assemblyTypes';
import {
  unavailableGeometryWorkspaceResourcePort,
  type GeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src/workspaceResourcePort';

type TableCategory = 'garage_single' | 'garage_double' | 'stairwell' | 'corridor';

const GARAGE_SINGLE_ROWS: GarageRowId[] = [
  'single_full_three',
  'single_one_wall_floor',
  'single_partial_forward',
];

const GARAGE_DOUBLE_ROWS: GarageRowId[] = [
  'double_full_three',
  'double_half',
  'double_partial_forward',
];

const TABLE_CATEGORY_OPTIONS: { value: TableCategory; label: string }[] = [
  { value: 'garage_single', label: 'Integral garage — single (3 m × 6 m archetype)' },
  { value: 'garage_double', label: 'Integral garage — double (6 m × 6 m archetype)' },
  { value: 'stairwell', label: 'Stairwell' },
  { value: 'corridor', label: 'Access corridor' },
];

const ENVELOPE_OPTIONS = [
  { value: 'inside', label: 'Inside thermal envelope (insulation wraps outside of garage)' },
  { value: 'outside', label: 'Outside thermal envelope (separating walls are external walls)' },
];

const STAIRWELL_OPTIONS: { value: StairwellFacing; label: string }[] = [
  { value: 'exposed', label: 'Facing wall exposed to outside' },
  { value: 'not_exposed', label: 'Facing wall not exposed (e.g. sandwiched)' },
];

export interface UnheatedSpaceRuCalculatorProps {
  /** Hydrated once per mount (parent should remount with `key` when reopening the modal). */
  initialState: RuCalculatorStateV1;
  currentRu?: number;
  onApply: (thermalResistanceUnconditionedSpace: number, extraJsonPatch: Record<string, unknown>) => void;
  flat?: boolean;
  showHeading?: boolean;
  variant?: 'default' | 'modal';
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
}

export const UnheatedSpaceRuCalculator: React.FC<UnheatedSpaceRuCalculatorProps> = ({
  initialState,
  currentRu,
  onApply,
  flat,
  showHeading = true,
  variant = 'default',
  workspaceResourcePort = unavailableGeometryWorkspaceResourcePort,
}) => {
  const [mode, setMode] = useState<'table' | 'formula'>(initialState.mode);
  const [table, setTable] = useState<RuCalculatorTableStateV1>(initialState.table);
  const [formula, setFormula] = useState<RuCalculatorFormulaStateV1>(initialState.formula);

  const [library, setLibrary] = useState<BundledAssemblyLibrary | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBundledAssemblyLibrary(workspaceResourcePort).then((lib) => {
      if (!cancelled) setLibrary(lib);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceResourcePort]);

  const wallExamples = useMemo(() => {
    if (!library) return [];
    return library.examples.filter((ex) => ex.elementType === 'wall');
  }, [library]);

  const assemblyById = useMemo(() => {
    const m = new Map<string, AssemblyExample>();
    for (const ex of wallExamples) {
      if (ex.id) m.set(ex.id, ex);
    }
    return m;
  }, [wallExamples]);

  const selectedExposedAssembly = formula.exposedAssemblyId
    ? assemblyById.get(formula.exposedAssemblyId)
    : undefined;

  const assemblyU = useMemo(() => {
    if (!library || !selectedExposedAssembly) return null;
    const { u, errors } = computeUFromSavedAssembly(selectedExposedAssembly, library);
    if (errors.length > 0 || u == null) return null;
    return u;
  }, [library, selectedExposedAssembly]);

  const effectiveSumAeUeWperK = useMemo(() => {
    if (formula.sumMode === 'combined') {
      const s = parseFloat(formula.sumAeUe);
      return Number.isFinite(s) && s >= 0 ? s : null;
    }
    const ae = parseFloat(formula.exposedAe);
    if (formula.exposedAssemblyId.trim()) {
      if (assemblyU == null) return null;
      return sumAeUeFromAreaAndU(ae, assemblyU);
    }
    const u = parseFloat(formula.uManual);
    const uWm2K = Number.isFinite(u) && u >= 0 ? u : null;
    if (uWm2K == null) return null;
    return sumAeUeFromAreaAndU(ae, uWm2K);
  }, [formula, assemblyU]);

  const tablePreviewRu = useMemo(() => {
    try {
      if (table.tableCategory === 'garage_single' || table.tableCategory === 'garage_double') {
        return ruFromGarageTable(table.garageRow, table.garageEnvelope);
      }
      if (table.tableCategory === 'stairwell') {
        return ruFromStairwellTable(table.stairwellFacing);
      }
      return ruFromCorridorTable(table.corridorRow);
    } catch {
      return null;
    }
  }, [table]);

  const formulaPreviewRu = useMemo(() => {
    const Ai = parseFloat(formula.ai);
    const V = parseFloat(formula.vol);
    const n = parseFloat(formula.n);
    const s = effectiveSumAeUeWperK;
    if (s == null) return null;
    return computeRuIso6946({
      areaInterfaceM2: Ai,
      sumAeUeWperK: s,
      volumeM3: V,
      nAirChangesPerHour: n,
    });
  }, [formula.ai, formula.vol, formula.n, effectiveSumAeUeWperK]);

  const garageRowOptions = useMemo(() => {
    const rows = table.tableCategory === 'garage_single' ? GARAGE_SINGLE_ROWS : GARAGE_DOUBLE_ROWS;
    return rows.map((id) => ({ value: id, label: GARAGE_ROW_LABELS[id] }));
  }, [table.tableCategory]);

  const onCategoryChange = (cat: TableCategory) => {
    setTable((t) => {
      let garageRow = t.garageRow;
      if (cat === 'garage_single') {
        garageRow = 'single_full_three';
      } else if (cat === 'garage_double') {
        garageRow = 'double_full_three';
      }
      return { ...t, tableCategory: cat, garageRow };
    });
  };

  const buildPersistedSnapshot = (): RuCalculatorStateV1 => ({
    v: 1,
    mode,
    formula: { ...formula },
    table: { ...table },
  });

  const applyTable = () => {
    if (tablePreviewRu == null) return;
    onApply(roundRu(tablePreviewRu), {
      [RU_CALCULATOR_STATE_KEY]: { ...buildPersistedSnapshot(), mode: 'table' },
    });
  };

  const applyFormula = () => {
    if (formulaPreviewRu == null) return;
    onApply(roundRu(formulaPreviewRu), {
      [RU_CALCULATOR_STATE_KEY]: { ...buildPersistedSnapshot(), mode: 'formula' },
    });
  };

  const assemblyOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Manual U only (no assembly link)' }];
    for (const ex of wallExamples) {
      opts.push({ value: ex.id, label: ex.name || ex.id });
    }
    return opts;
  }, [wallExamples]);

  const blockStyle: React.CSSProperties = {
    marginBottom: variant === 'modal' ? 0 : flat ? '10px' : 'var(--spacing-md)',
    padding: variant === 'modal' ? '4px 0 0' : flat ? '8px 0' : '12px',
    borderBottom: variant === 'modal' ? 'none' : '1px solid var(--border-subtle)',
  };

  const splitHelp =
    formula.sumMode === 'split' ? (
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 6px 0' }}>
        Use this for one exposed wall. For several surfaces, or roof/floor, enter one total W/K value instead.
      </p>
    ) : null;

  return (
    <div style={blockStyle}>
      {showHeading ? (
        <div style={{ fontWeight: 600, marginBottom: '8px' }}>Unheated space thermal resistance</div>
      ) : null}
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
        Calculate the extra thermal resistance of the unheated space (m²·K/W) and write it back to this field.
      </p>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="ru-mode"
            checked={mode === 'table'}
            onChange={() => setMode('table')}
          />
          Guidance tables
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="ru-mode"
            checked={mode === 'formula'}
            onChange={() => setMode('formula')}
          />
          Custom dimensions
        </label>
      </div>

      {mode === 'table' ? (
        <div style={{ display: 'grid', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
              Case
            </div>
            <StandardDropdown
              value={table.tableCategory}
              onChange={(v) => v && onCategoryChange(v as TableCategory)}
              options={TABLE_CATEGORY_OPTIONS}
              size="md"
              variant="ghost"
            />
          </div>

          {(table.tableCategory === 'garage_single' || table.tableCategory === 'garage_double') && (
            <>
              <div>
                <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Garage configuration
                </div>
                <StandardDropdown
                  value={table.garageRow}
                  onChange={(v) => v && setTable((t) => ({ ...t, garageRow: v as GarageRowId }))}
                  options={garageRowOptions}
                  size="md"
                  variant="ghost"
                />
              </div>
              <div>
                <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Thermal position
                </div>
                <StandardDropdown
                  value={table.garageEnvelope}
                  onChange={(v) => v && setTable((t) => ({ ...t, garageEnvelope: v as 'inside' | 'outside' }))}
                  options={ENVELOPE_OPTIONS}
                  size="md"
                  variant="ghost"
                />
              </div>
            </>
          )}

          {table.tableCategory === 'stairwell' && (
            <div>
              <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Stairwell
              </div>
              <StandardDropdown
                value={table.stairwellFacing}
                onChange={(v) => v && setTable((t) => ({ ...t, stairwellFacing: v as StairwellFacing }))}
                options={STAIRWELL_OPTIONS}
                size="md"
                variant="ghost"
              />
            </div>
          )}

          {table.tableCategory === 'corridor' && (
            <div>
              <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Corridor configuration
              </div>
              <StandardDropdown
                value={table.corridorRow}
                onChange={(v) => v && setTable((t) => ({ ...t, corridorRow: v as CorridorRowId }))}
                options={(Object.keys(CORRIDOR_ROW_LABELS) as CorridorRowId[]).map((id) => ({
                  value: id,
                  label: CORRIDOR_ROW_LABELS[id],
                }))}
                size="md"
                variant="ghost"
              />
            </div>
          )}

          {tablePreviewRu != null && (
            <div style={{ fontSize: '13px' }}>
              Selected R_u = <strong>{roundRu(tablePreviewRu)}</strong> m²·K/W
              {currentRu != null && Number.isFinite(currentRu) ? (
                <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
                  (field currently {roundRu(currentRu)})
                </span>
              ) : null}
            </div>
          )}

          <button
            type="button"
            className="btn btn-nav btn-small"
            disabled={tablePreviewRu == null}
            onClick={applyTable}
          >
            Apply R_u to field
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            Use this when the guidance-table cases do not fit.
          </p>
          <div
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Area between heated room and unheated space (A_i)
            </div>
            <div style={{ fontSize: '14px' }}>
              <strong>{formula.ai || 'Not available'}</strong>
              {formula.ai ? ' m² from this element' : ''}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Exposed heat loss:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="ru-sum-mode"
                checked={formula.sumMode === 'combined'}
                onChange={() => setFormula((f) => ({ ...f, sumMode: 'combined' }))}
              />
              One total W/K value
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="ru-sum-mode"
                checked={formula.sumMode === 'split'}
                onChange={() => setFormula((f) => ({ ...f, sumMode: 'split' }))}
              />
              Area x U-value
            </label>
          </div>

          {formula.sumMode === 'combined' ? (
            <StandardInput
              type="number"
              label="Exposed envelope heat loss (W/K)"
              value={formula.sumAeUe}
              onChange={(e) => setFormula((f) => ({ ...f, sumAeUe: e.target.value }))}
              step="0.01"
              min="0"
              variant="ghost"
              size="md"
              helperText="Total across the exposed surfaces you are counting."
            />
          ) : (
            <>
              {splitHelp}
              <StandardInput
                type="number"
                label="Exposed wall area (m²)"
                value={formula.exposedAe}
                onChange={(e) => setFormula((f) => ({ ...f, exposedAe: e.target.value }))}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
              />
              <div>
                <div style={{ fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Exposed wall assembly (optional)
                </div>
                <StandardDropdown
                  value={formula.exposedAssemblyId}
                  onChange={(v) => setFormula((f) => ({ ...f, exposedAssemblyId: v ?? '' }))}
                  options={assemblyOptions}
                  size="md"
                  variant="ghost"
                  helperText="Pick one to derive the U-value automatically."
                />
                {formula.exposedAssemblyId.trim() ? (
                  <div style={{ fontSize: '12px', marginTop: '4px', color: 'var(--text-secondary)' }}>
                    {assemblyU != null ? (
                  <>Derived U-value: <strong>{roundRu(assemblyU)}</strong> W/m²K</>
                ) : library ? (
                  <span style={{ color: 'var(--text-warning, #b45309)' }}>Could not compute U for this assembly.</span>
                ) : (
                  <span>Loading assembly library…</span>
                )}
                  </div>
                ) : null}
              </div>
              <StandardInput
                type="number"
                label={
                  formula.exposedAssemblyId.trim()
                    ? 'Manual U-value (clear assembly above to edit)'
                    : 'Exposed wall U-value (W/m²K)'
                }
                value={formula.uManual}
                onChange={(e) => setFormula((f) => ({ ...f, uManual: e.target.value }))}
                step="0.01"
                min="0"
                variant="ghost"
                size="md"
                disabled={Boolean(formula.exposedAssemblyId.trim())}
              />
            </>
          )}

          <StandardInput
            type="number"
            label="Unheated space volume (V, m³)"
            value={formula.vol}
            onChange={(e) => setFormula((f) => ({ ...f, vol: e.target.value }))}
            step="0.01"
            min="0"
            variant="ghost"
            size="md"
          />
          <StandardInput
            type="number"
            label="Air changes per hour (n, ach)"
            value={formula.n}
            onChange={(e) => setFormula((f) => ({ ...f, n: e.target.value }))}
            step="0.1"
            min="0"
            variant="ghost"
            size="md"
          />
          {formula.sumMode === 'split' &&
            formula.exposedAssemblyId.trim() &&
            assemblyU == null &&
            library &&
            selectedExposedAssembly && (
              <div style={{ fontSize: '12px', color: 'var(--text-warning, #b45309)' }}>
                Fix or clear the assembly selection to continue.
              </div>
            )}
          {formulaPreviewRu != null && (
            <div style={{ fontSize: '13px' }}>
              Calculated R_u = <strong>{roundRu(formulaPreviewRu)}</strong> m²·K/W
            </div>
          )}
          {formulaPreviewRu == null &&
            formula.ai &&
            formula.vol &&
            formula.n &&
            (formula.sumMode === 'combined' ? formula.sumAeUe : formula.exposedAe) && (
              <div style={{ fontSize: '12px', color: 'var(--text-warning, #b45309)' }}>
                Check the heat-loss, volume, and ventilation inputs.
              </div>
            )}
          <button
            type="button"
            className="btn btn-nav btn-small"
            disabled={formulaPreviewRu == null}
            onClick={applyFormula}
          >
            Apply R_u to field
          </button>
        </div>
      )}
    </div>
  );
};
