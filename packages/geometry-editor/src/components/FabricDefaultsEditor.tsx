// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import type { GeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';
import { useKeyedState } from '../hooks/useKeyedState';
import {
  applyFabricMergeTemplateUpdates,
  elementTypeForFabricRole,
  FABRIC_MERGE_ROLE_LABELS,
  FABRIC_MERGE_ROLES,
  resolveFabricMergeTemplates,
  subtypeForFabricRole,
  type FabricMergeRole,
} from '../lib/fabricDefaultsTemplates';
import {
  coerceFabricDraftValue,
  getFabricPropertyDisplayTitle,
  listFabricDefaultPropDescriptors,
  normalizeFabricDraftForPersist,
  type FabricPropDescriptor,
} from '../lib/fabricDefaultsEditableProps';
import { resolveFieldPresentation, type ResolvedFieldPresentation } from '../lib/fieldPresentation';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import { useGeometryStore } from '../stores/geometryStore';
import { StandardDropdown } from './StandardDropdown';
import { StandardInput } from './StandardInput';
import { Tooltip } from './Tooltip';

function defaultsContentSig(root: unknown): string {
  try {
    return JSON.stringify(root);
  } catch {
    return '';
  }
}

/** Normalize fabric drafts for equality (drops keys whose value is undefined). */
function fabricDraftSig(obj: unknown): string {
  try {
    if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
    const d = obj as Partial<Record<FabricMergeRole, Record<string, unknown>>>;
    const norm: Record<string, Record<string, unknown>> = {};
    for (const role of FABRIC_MERGE_ROLES) {
      const slice = d[role];
      if (!slice) continue;
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(slice)) {
        if (v !== undefined) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length > 0) norm[role] = cleaned;
    }
    return JSON.stringify(norm);
  } catch {
    return '';
  }
}

function cloneDraft(
  defaultsJson: unknown,
  useFHSSchema: boolean,
  schemaPort: GeometrySchemaPort,
): Partial<Record<FabricMergeRole, Record<string, unknown>>> {
  const resolved = resolveFabricMergeTemplates(defaultsJson);
  const next: Partial<Record<FabricMergeRole, Record<string, unknown>>> = {};
  for (const role of FABRIC_MERGE_ROLES) {
    const loc = resolved.get(role);
    if (!loc) continue;
    const descriptors = listFabricDefaultPropDescriptors(
      useFHSSchema,
      role,
      loc.template,
      schemaPort,
    );
    const slice: Record<string, unknown> = {};
    for (const d of descriptors) {
      slice[d.key] = Object.prototype.hasOwnProperty.call(loc.template, d.key)
        ? loc.template[d.key]
        : undefined;
    }
    next[role] = slice;
  }
  return next;
}

function renderControl(args: {
  role: FabricMergeRole;
  desc: FabricPropDescriptor;
  value: unknown;
  disabled: boolean;
  presentation: ResolvedFieldPresentation;
  onChange: (v: unknown) => void;
}): React.ReactNode {
  const { desc, value, disabled, presentation, onChange } = args;
  const unit = presentation.unit.status === 'resolved' ? presentation.unit.display : undefined;

  if (desc.kind === 'enum' && desc.enumValues?.length) {
    const v = value === undefined || value === null ? '' : String(value);
    const opts = [
      { value: '', label: '—' },
      ...desc.enumValues.map((ev) => ({ value: ev, label: ev })),
    ];
    return (
      <StandardDropdown
        value={v}
        unit={unit}
        onChange={(s) => onChange(s === '' ? '' : s)}
        options={opts}
        variant="ghost"
        size="sm"
        disabled={disabled}
      />
    );
  }

  if (desc.kind === 'boolean') {
    const v =
      value === true ? 'true' : value === false ? 'false' : '';
    return (
      <StandardDropdown
        value={v}
        onChange={(s) => {
          if (s === '') onChange('');
          else onChange(s === 'true');
        }}
        options={[
          { value: '', label: '—' },
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        variant="ghost"
        size="sm"
        disabled={disabled}
      />
    );
  }

  const str =
    value === undefined || value === null
      ? ''
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : String(value);

  return (
    <StandardInput
      type="text"
      inputMode={desc.kind === 'number' || desc.kind === 'integer' ? 'decimal' : undefined}
      value={str}
      unit={desc.kind === 'number' || desc.kind === 'integer' ? unit : undefined}
      onChange={(e) => onChange(e.target.value)}
      variant="ghost"
      size="sm"
      disabled={disabled}
    />
  );
}

export type FabricDefaultsEditorPanelProps = {
  filePath: string;
  defaultsRoot: unknown | null;
  loading: boolean;
  loadError: string | null;
  /** Resets a discarded or saved structured draft from the shared defaults session. */
  sessionRevision?: number;
  /** The shared defaults session owns persistence and store synchronisation. */
  onSave(merged: unknown): Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

/**
 * Structured fields for the shared defaults editing session.
 */
export function FabricDefaultsEditorPanel({
  filePath,
  defaultsRoot,
  loading,
  loadError,
  sessionRevision = 0,
  onSave,
  onDirtyChange,
}: FabricDefaultsEditorPanelProps): React.ReactElement {
  const schemaPort = useGeometrySchemaPort();
  const useFHSSchema = useGeometryStore((s) => !!s.complianceSettings?.complianceValidationEnabled);

  const initialSchemaReady = (
    schemaPort.availability === 'available' &&
    !!schemaPort.getRootSchema(useFHSSchema ? 'fhs' : 'core')
  );
  const [schemaReady, setSchemaReady] = useKeyedState(
    schemaPort.availability,
    initialSchemaReady,
  );
  const defaultsSig = useMemo(() => defaultsContentSig(defaultsRoot), [defaultsRoot]);
  const draftResetKey = [
    filePath,
    defaultsSig,
    `session:${sessionRevision}`,
    `fhs:${useFHSSchema ? '1' : '0'}`,
    `schema:${schemaReady ? '1' : '0'}`,
  ].join('\0');
  const resolved = useMemo(() => resolveFabricMergeTemplates(defaultsRoot), [defaultsRoot]);
  const initialDraft = useMemo(
    () => defaultsRoot && schemaReady
      ? cloneDraft(defaultsRoot, useFHSSchema, schemaPort)
      : {},
    [defaultsRoot, schemaPort, schemaReady, useFHSSchema],
  );
  const [draftByRole, setDraftByRole] = useKeyedState(draftResetKey, initialDraft);
  const [baselineDraft, setBaselineDraft] = useKeyedState(
    draftResetKey,
    JSON.parse(JSON.stringify(initialDraft)) as typeof initialDraft,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useKeyedState<string | null>(
    draftResetKey,
    schemaPort.availability === 'available'
      ? null
      : 'Geometry schemas are unavailable in this editor.',
  );

  useEffect(() => {
    if (schemaPort.availability !== 'available') return;
    void Promise.all([
      schemaPort.preload('core'),
      schemaPort.preload('fhs'),
    ]).then(() => {
      setSchemaReady(true);
    }).catch((error: unknown) => {
      setSchemaReady(false);
      setSaveError(error instanceof Error ? error.message : String(error));
    });
  }, [schemaPort, setSaveError, setSchemaReady]);

  const dirty = useMemo(() => {
    const normDraft = normalizeFabricDraftForPersist(
      draftByRole,
      resolved,
      useFHSSchema,
      schemaPort,
    );
    const normBaseline = normalizeFabricDraftForPersist(
      baselineDraft,
      resolved,
      useFHSSchema,
      schemaPort,
    );
    return fabricDraftSig(normDraft) !== fabricDraftSig(normBaseline);
  }, [baselineDraft, draftByRole, resolved, schemaPort, useFHSSchema]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const patchField = useCallback((role: FabricMergeRole, key: string, raw: unknown, desc: FabricPropDescriptor) => {
    setDraftByRole((prev) => {
      const roleDraft = { ...(prev[role] ?? {}) };
      let next: unknown;
      if (desc.kind === 'boolean') {
        if (raw === '' || raw === undefined) next = undefined;
        else next = raw === true || raw === 'true';
      } else if (desc.kind === 'enum') {
        next = raw === '' || raw === undefined ? undefined : String(raw);
      } else if (desc.kind === 'number' || desc.kind === 'integer') {
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          next = desc.kind === 'integer' ? Math.trunc(raw) : raw;
        } else if (typeof raw === 'string' && raw.trim() === '') {
          next = undefined;
        } else if (typeof raw === 'string') {
          next = raw;
        } else {
          next = coerceFabricDraftValue(desc, raw);
        }
      } else {
        next =
          typeof raw === 'string' && raw.trim() === ''
            ? undefined
            : coerceFabricDraftValue(desc, raw);
      }
      roleDraft[key] = next as unknown;
      return { ...prev, [role]: roleDraft };
    });
  }, [setDraftByRole]);

  const handleSave = useCallback(async () => {
    if (!defaultsRoot) {
      setSaveError('No defaults file loaded.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updates = normalizeFabricDraftForPersist(
        draftByRole,
        resolved,
        useFHSSchema,
        schemaPort,
      );
      const merged = applyFabricMergeTemplateUpdates(defaultsRoot, resolved, updates);
      await onSave(merged);

      const nextDraft = cloneDraft(merged, useFHSSchema, schemaPort);
      setBaselineDraft(JSON.parse(JSON.stringify(nextDraft)) as typeof nextDraft);
      setDraftByRole(nextDraft);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [
    defaultsRoot,
    draftByRole,
    resolved,
    schemaPort,
    setBaselineDraft,
    setDraftByRole,
    setSaveError,
    useFHSSchema,
    onSave,
  ]);

  const effPath = (filePath || '').trim();
  const canSave = !!effPath && !!defaultsRoot && dirty && !loading && !saving;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: '0 4px 8px', fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
        <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{effPath || '—'}</div>
      </div>

      {loadError ? (
        <div style={{ flexShrink: 0, fontSize: 12, color: 'var(--error-text)', marginBottom: 8 }}>{loadError}</div>
      ) : null}
      {saveError ? (
        <div style={{ flexShrink: 0, fontSize: 12, color: 'var(--error-text)', marginBottom: 8 }}>{saveError}</div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 6 }}>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Loading defaults…</div>
        ) : !defaultsRoot ? (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Could not load this file.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 8 }}>
            {FABRIC_MERGE_ROLES.map((role) => {
              const loc = resolved.get(role);
              const roleDraft = draftByRole[role] ?? {};
              const descriptors = loc && schemaReady
                ? listFabricDefaultPropDescriptors(
                    useFHSSchema,
                    role,
                    loc.template,
                    schemaPort,
                  )
                : [];

              return (
                <div key={role}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                    {FABRIC_MERGE_ROLE_LABELS[role]}
                  </div>

                  {!loc ? (
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                      No matching template in this defaults file.
                    </div>
                  ) : descriptors.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>No editable advanced properties for this template.</div>
                  ) : (
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 12,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 4,
                        overflow: 'hidden',
                      }}
                    >
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', width: '42%' }}>Property</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', width: '58%' }}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {descriptors.map((desc) => {
                          const elementType = elementTypeForFabricRole(role);
                          const labelText = getFabricPropertyDisplayTitle(
                            desc.key,
                            elementType,
                            useFHSSchema,
                            desc.schema,
                            schemaPort,
                          );
                          const presentation = resolveFieldPresentation({
                            mode: useFHSSchema ? 'fhs' : 'core',
                            propertyKey: desc.key,
                            elementType,
                            subtype: loc ? subtypeForFabricRole(role, loc.template) : undefined,
                            opaqueFabricVariant: role === 'opaque_wall'
                              ? 'wall'
                              : role === 'opaque_roof'
                                ? 'roof'
                                : role === 'opaque_external_door'
                                  ? 'external_door'
                                  : undefined,
                            label: labelText,
                            schemaNode: desc.schema,
                          }, schemaPort);
                          const current = roleDraft[desc.key];

                          return (
                            <tr key={desc.key}>
                              <td
                                style={{
                                  padding: '6px 8px',
                                  borderBottom: '1px solid var(--border-subtle)',
                                  verticalAlign: 'middle',
                                  color: 'var(--text-primary)',
                                }}
                              >
                                <Tooltip
                                  content={presentation.tooltipInfo
                                    ? formatSchemaInfoForTooltip(presentation.tooltipInfo)
                                    : undefined}
                                  useFHSSchema={useFHSSchema}
                                  position="right"
                                  maxWidth={350}
                                >
                                  <span style={{ fontSize: 12, fontWeight: 500, cursor: 'help' }}>{presentation.label}</span>
                                </Tooltip>
                              </td>
                              <td style={{ padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                                {renderControl({
                                  role,
                                  desc,
                                  value: current,
                                  disabled: saving || loading,
                                  presentation,
                                  onChange: (v) => patchField(role, desc.key, v, desc),
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          marginTop: 'auto',
          borderTop: '1px solid var(--border-subtle)',
          padding: '14px 16px',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
          boxShadow: '0 -6px 16px rgba(0,0,0,0.06)',
        }}
      >
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save fabric defaults'}
        </button>
      </div>
    </div>
  );
}
