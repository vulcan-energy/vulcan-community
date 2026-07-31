// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import {
  defineFilenameActionContributions,
  resolveFilenameActionContributions,
  type FilenameActionContributions,
} from '../../../geometry-editor-host/src/filenameActionRegistry';
import { StandardInput } from './StandardInput';
import { useGeometryStore } from '../stores/geometryStore';
import type { BuildErrorItem } from '../types/buildErrors';
import type { GeometryDocumentHostPort } from '../../../geometry-document/src';
import './GlobalButtonSystem.css';
import './FilenameBar.css';

export type FilenameBarActionContext = Readonly<{
  documentHost: GeometryDocumentHostPort;
  filename: string;
  hostModelName?: string;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  onOpenDefaults?: () => void;
  defaultsInvalid?: boolean;
  globalSettingsIndicator?: { variant: 'error' | 'warning' | 'info'; issues: string[] } | null;
}>;

export type FilenameBarProps = Omit<FilenameBarActionContext, 'filename'> & Readonly<{
  saveError: string | null;
  /**
   * Required storage suffix for hosts that present a stem-only filename field.
   * Official omits this and retains its existing filename behavior.
   */
  fileNameExtension?: string;
  /** Host-specific heading for save failures. */
  saveErrorTitle?: string;
  buildError?: string | null;
  buildErrorItems?: readonly BuildErrorItem[];
  defaultsPath?: string | undefined;
  filenameActionContributions?: FilenameActionContributions<
    FilenameBarActionContext,
    React.ReactNode
  >;
}>;

const EMPTY_FILENAME_ACTION_CONTRIBUTIONS =
  defineFilenameActionContributions<FilenameBarActionContext, React.ReactNode>({
    filenameActions: [],
  });

const LAST_SAVE_VALIDATION_MESSAGE =
  'This saved model is hidden from Scenarios until it passes validation on re-save.';

type DisplayBuildError = {
  item: BuildErrorItem;
  location: string;
  field?: string;
  userMessage: string;
  pathSegments: string[];
};

const titleCaseToken = (token: string) =>
  token
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const decodeJsonPointerSegment = (segment: string) =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');

const pointerSegments = (path?: string) =>
  (path || '')
    .split('/')
    .filter(Boolean)
    .map(decodeJsonPointerSegment);

const buildErrorLocation = (path?: string) => {
  const segments = pointerSegments(path);
  const zoneIdx = segments.indexOf('Zone');
  const elementIdx = segments.indexOf('BuildingElement');

  if (zoneIdx >= 0 && segments[zoneIdx + 1]) {
    const zone = segments[zoneIdx + 1];
    if (elementIdx >= 0 && segments[elementIdx + 1]) {
      return {
        location: `${zone} > ${segments[elementIdx + 1]}`,
        field: segments[elementIdx + 2],
      };
    }
    return {
      location: zone,
      field: segments[zoneIdx + 2],
    };
  }

  if (segments.length >= 2) {
    return {
      location: `${titleCaseToken(segments[0])} > ${titleCaseToken(segments[1])}`,
      field: segments[2],
    };
  }

  if (segments.length === 1) {
    return { location: titleCaseToken(segments[0]) };
  }

  return { location: 'Model' };
};

const compactPathLabel = (segments: string[]) => {
  if (segments.length === 0) return 'model';
  return segments.map(titleCaseToken).join(' > ');
};

const requiredFieldFromMessage = (message: string) => {
  const match = message.match(/^"([^"]+)" is a required property$/);
  return match?.[1] ? titleCaseToken(match[1]) : null;
};

const minimumFromMessage = (message: string) => {
  const match = message.match(/^(.+?) is less than the minimum of (.+)$/);
  return match?.[2]?.trim() || null;
};

const maximumFromMessage = (message: string) => {
  const match = message.match(/^(.+?) is greater than the maximum of (.+)$/);
  return match?.[2]?.trim() || null;
};

const unexpectedFieldsFromMessage = (message: string) => {
  const match = message.match(/were unexpected\)$/);
  if (!match) return null;
  const fields = [...message.matchAll(/'([^']+)'/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  if (fields.length === 0) return null;
  const shown = fields.slice(0, 5).map(titleCaseToken).join(', ');
  return fields.length > 5 ? `${shown}, and ${fields.length - 5} more` : shown;
};

const formatBuildErrorForDisplay = (item: BuildErrorItem): DisplayBuildError => {
  const pathSegments = pointerSegments(item.path);
  const { location, field } = buildErrorLocation(item.path);
  const fieldLabel = field ? titleCaseToken(field) : undefined;
  const keyword = item.keyword || '';
  const requiredField = requiredFieldFromMessage(item.message);
  const minimum = minimumFromMessage(item.message);
  const maximum = maximumFromMessage(item.message);
  const unexpectedFields = unexpectedFieldsFromMessage(item.message);
  const explicitUserMessage = item.userMessage?.trim();

  let userMessage: string;
  if (explicitUserMessage) {
    userMessage = explicitUserMessage;
  } else if (
    location === 'Appliances' &&
    (item.message.includes('is not allowed for {}') || item.message.includes('has less than'))
  ) {
    userMessage = 'Add at least one appliance entry.';
  } else if (
    pathSegments[0] === 'HotWaterDemand' &&
    (item.message.includes('has less than') || keyword === 'minProperties')
  ) {
    userMessage = 'Add at least one hot water outlet.';
  } else if (
    pathSegments[0] === 'InfiltrationVentilation' &&
    pathSegments[1] === 'MechanicalVentilation' &&
    (item.message.includes("schemas listed in the 'oneOf' keyword") || keyword === 'oneOf' || keyword === 'anyOf')
  ) {
    userMessage = 'Add ventilation position details: height, orientation, and pitch.';
  } else if (requiredField || keyword === 'required') {
    userMessage = requiredField
      ? `Add ${requiredField}.`
      : 'Add the missing required field.';
  } else if (minimum || keyword === 'minimum' || keyword === 'exclusiveMinimum') {
    userMessage = `${fieldLabel || 'Value'} must be at least ${minimum || 'the allowed minimum'}.`;
  } else if (maximum || keyword === 'maximum' || keyword === 'exclusiveMaximum') {
    userMessage = `${fieldLabel || 'Value'} must be no more than ${maximum || 'the allowed maximum'}.`;
  } else if (item.message.includes('has less than') || keyword === 'minProperties') {
    userMessage = `Add at least one entry for ${compactPathLabel(pathSegments)}.`;
  } else if (item.message.includes("schemas listed in the 'oneOf' keyword") || keyword === 'oneOf' || keyword === 'anyOf') {
    userMessage = fieldLabel
      ? `${fieldLabel} does not match an allowed option.`
      : 'Choose a supported option for these settings.';
  } else if (unexpectedFields || keyword === 'unevaluatedProperties' || keyword === 'additionalProperties') {
    userMessage = unexpectedFields
      ? `Remove fields not allowed here: ${unexpectedFields}.`
      : 'Remove fields that are not allowed here.';
  } else if (keyword === 'const' || keyword === 'allOf' || item.message.includes('is not allowed for')) {
    userMessage = location === 'Appliances'
      ? 'Check the appliance entries against the selected schema.'
      : 'These settings conflict with the selected schema.';
  } else {
    userMessage = fieldLabel
      ? `Check ${fieldLabel}.`
      : 'Check this section.';
  }

  return { item, location, field, userMessage, pathSegments };
};

const isNoisyUnexpectedPropertiesError = (error: DisplayBuildError) =>
  error.item.keyword === 'unevaluatedProperties' ||
  error.item.keyword === 'additionalProperties' ||
  error.item.message.includes('Unevaluated properties are not allowed') ||
  error.item.message.includes('Additional properties are not allowed');

const filterDisplayBuildErrors = (errors: DisplayBuildError[]) => {
  const concreteErrorParents = new Set<string>();

  for (const error of errors) {
    if (isNoisyUnexpectedPropertiesError(error)) continue;
    if (error.pathSegments.length > 1) {
      concreteErrorParents.add(error.pathSegments.slice(0, -1).join('/'));
    }
  }

  return errors.filter((error) => {
    if (!isNoisyUnexpectedPropertiesError(error)) return true;
    return !concreteErrorParents.has(error.pathSegments.join('/'));
  });
};

const buildErrorRowKey = (error: DisplayBuildError) =>
  `${error.item.source}|${error.item.path ?? ''}|${error.item.keyword ?? ''}|${error.item.code ?? ''}|${error.item.schemaPath ?? ''}|${error.item.message}|${error.item.technicalMessage ?? ''}`;

const filenameWithoutExtension = (fileName: string, extension: string) =>
  extension.length > 0 && fileName.toLowerCase().endsWith(extension.toLowerCase())
    ? fileName.slice(0, -extension.length)
    : fileName;

const filenameWithExtension = (fileName: string, extension: string) => {
  if (extension.length === 0) return fileName;
  return `${filenameWithoutExtension(fileName, extension)}${extension}`;
};

export const FilenameBar: React.FC<FilenameBarProps> = ({
  documentHost,
  hostModelName,
  saveStatus,
  saveError,
  fileNameExtension = '',
  saveErrorTitle = 'HEM input build failed',
  onOpenDefaults,
  defaultsInvalid,
  globalSettingsIndicator,
  buildError,
  buildErrorItems = [],
  filenameActionContributions = EMPTY_FILENAME_ACTION_CONTRIBUTIONS,
}) => {
  const documentSnapshot = useSyncExternalStore(
    documentHost.subscribe,
    documentHost.getSnapshot,
    documentHost.getSnapshot,
  );
  const filename = documentSnapshot.document.fileName;
  const displayedFilename = filenameWithoutExtension(filename, fileNameExtension);
  const currentSaveStatus = saveStatus;
  const currentSaveError = saveError;
  const showSaveErrorIndicator = currentSaveStatus === 'error' && !!currentSaveError;
  const lastSaveValidationFailed = useGeometryStore(
    (state) => state.complianceSettings.scenariosBaseModelEnabled === false,
  );
  const showLastSaveValidationFailure =
    lastSaveValidationFailed
    && buildErrorItems.length === 0
    && !buildError
    && !showSaveErrorIndicator
    && currentSaveStatus !== 'saving';
  const hasSaveErrorDropdownContent =
    showSaveErrorIndicator || !!buildError || showLastSaveValidationFailure;
  const [isSaveErrorModalOpen, setIsSaveErrorModalOpen] = useState(false);
  const [saveErrorCopied, setSaveErrorCopied] = useState(false);
  const [prevHasSaveErrorDropdownContent, setPrevHasSaveErrorDropdownContent] = useState(hasSaveErrorDropdownContent);
  const zones = useGeometryStore((s) => s.zones);
  const elementsById = useGeometryStore((s) => s.elementsById);
  const elementIds = useGeometryStore((s) => s.elementIds);
  const setSelection = useGeometryStore((s) => s.setSelection);
  const setSelectedElementIds = useGeometryStore((s) => s.setSelectedElementIds);
  const setCurrentFloorZ = useGeometryStore((s) => s.setCurrentFloorZ);

  /** True while the user still has the default placeholder filename; drives the "Rename" guidance button. */
  const isUnnamedDraft = useMemo(() => {
    const trimmed = displayedFilename.trim().toLowerCase();
    return trimmed === '' || trimmed === 'draft_model';
  }, [displayedFilename]);

  // Popover positioning follows the adjacent filename-action dropdowns.
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const buildErrorChipRef = useRef<HTMLButtonElement>(null);
  const errorAnchorRef = useRef<HTMLElement | null>(null);
  const saveErrorDropdownRef = useRef<HTMLDivElement>(null);
  const saveErrorCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveErrorPosition, setSaveErrorPosition] = useState({ x: 0, y: 0 });

  if (prevHasSaveErrorDropdownContent !== hasSaveErrorDropdownContent) {
    setPrevHasSaveErrorDropdownContent(hasSaveErrorDropdownContent);
    if (!hasSaveErrorDropdownContent) {
      if (isSaveErrorModalOpen) setIsSaveErrorModalOpen(false);
      if (saveErrorCopied) setSaveErrorCopied(false);
    }
  }

  const isSaveErrorDropdownOpen = isSaveErrorModalOpen && hasSaveErrorDropdownContent;

  const filenameActionContext = useMemo<FilenameBarActionContext>(
    () => ({
      documentHost,
      filename,
      hostModelName,
      saveStatus,
      onOpenDefaults,
      defaultsInvalid,
      globalSettingsIndicator,
    }),
    [
      defaultsInvalid,
      documentHost,
      filename,
      globalSettingsIndicator,
      onOpenDefaults,
      hostModelName,
      saveStatus,
    ],
  );
  const availableFilenameActions = useMemo(
    () =>
      resolveFilenameActionContributions(
        filenameActionContributions,
        filenameActionContext,
      ),
    [filenameActionContext, filenameActionContributions],
  );

  const closeSaveErrorDropdown = useCallback(() => {
    setIsSaveErrorModalOpen(false);
    setSaveErrorCopied(false);
  }, []);

  const positionSaveErrorDropdown = useCallback((anchor: HTMLElement | null) => {
    const target = anchor || errorAnchorRef.current || saveButtonRef.current;
    if (!target) return;
    const buttonRect = target.getBoundingClientRect();
    setSaveErrorPosition({
      x: buttonRect.left,
      y: buttonRect.bottom + 8,
    });
  }, []);

  const openSaveErrorDropdown = useCallback((anchor: HTMLElement | null) => {
    errorAnchorRef.current = anchor;
    positionSaveErrorDropdown(anchor);
    setSaveErrorCopied(false);
    setIsSaveErrorModalOpen(true);
  }, [positionSaveErrorDropdown]);

  const updateSaveErrorPosition = useCallback(() => {
    const anchor = errorAnchorRef.current || saveButtonRef.current;
    if (!anchor) return;
    const buttonRect = anchor.getBoundingClientRect();
    setSaveErrorPosition({
      x: buttonRect.left,
      y: buttonRect.bottom + 8,
    });
  }, []);

  useEffect(() => {
    if (!isSaveErrorDropdownOpen) return;
    window.addEventListener('scroll', updateSaveErrorPosition, true);
    window.addEventListener('resize', updateSaveErrorPosition);
    return () => {
      window.removeEventListener('scroll', updateSaveErrorPosition, true);
      window.removeEventListener('resize', updateSaveErrorPosition);
    };
  }, [isSaveErrorDropdownOpen, updateSaveErrorPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (saveButtonRef.current && saveButtonRef.current.contains(event.target as Node)) return;
      if (saveErrorDropdownRef.current && saveErrorDropdownRef.current.contains(event.target as Node)) return;
      closeSaveErrorDropdown();
    };
    if (isSaveErrorDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [closeSaveErrorDropdown, isSaveErrorDropdownOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSaveErrorDropdown();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeSaveErrorDropdown]);

  const buildErrorCopyText = useMemo(() => {
    if (buildErrorItems.length > 0) {
      return buildErrorItems
        .map((item, index) => {
          const location = item.path ? ` at ${item.path}` : '';
          const code = item.code ? ` [${item.code}]` : '';
          return `${index + 1}. ${item.message}${location}${code}`;
        })
        .join('\n');
    }
    return currentSaveError || buildError || '';
  }, [buildErrorItems, buildError, currentSaveError]);
  const groupedBuildErrors = useMemo(() => {
    const displayErrors = filterDisplayBuildErrors(buildErrorItems.map(formatBuildErrorForDisplay));
    const groups: Array<{ location: string; errors: DisplayBuildError[] }> = [];
    const byLocation = new Map<string, DisplayBuildError[]>();

    for (const error of displayErrors) {
      const existing = byLocation.get(error.location);
      if (existing) {
        existing.push(error);
      } else {
        const next = [error];
        byLocation.set(error.location, next);
        groups.push({ location: error.location, errors: next });
      }
    }

    return groups;
  }, [buildErrorItems]);
  const displayBuildErrorRows = useMemo(
    () => groupedBuildErrors.flatMap((group) => group.errors),
    [groupedBuildErrors],
  );
  const displayedBuildErrorCount = useMemo(
    () => displayBuildErrorRows.length,
    [displayBuildErrorRows],
  );
  const saveErrorPathMatch = useMemo(() => {
    const raw = (currentSaveError || '').trim();
    const pathMatch = raw.match(/\bat\s+(.+)$/i);
    if (!pathMatch) return null;
    const tokens = pathMatch[1]
      .split('/')
      .flatMap((t) => {
        const trimmed = t.trim();
        return trimmed ? [trimmed] : [];
      });
    if (tokens.length < 4) return null;
    const zoneIdx = tokens.findIndex((t) => /^zone$/i.test(t));
    const elementIdx = tokens.findIndex((t) => /^buildingelement$/i.test(t));
    if (zoneIdx < 0 || elementIdx < 0 || zoneIdx + 1 >= tokens.length || elementIdx + 1 >= tokens.length) return null;
    return {
      zoneName: tokens[zoneIdx + 1],
      elementName: tokens[elementIdx + 1],
      field: tokens[tokens.length - 1],
    };
  }, [currentSaveError]);

  const saveErrorFocusTarget = useMemo(() => {
    const toLower = (s: string) => s.trim().toLowerCase();
    const allElements = elementIds.flatMap((id) => {
      const element = elementsById[id];
      return element ? [element] : [];
    });

    let candidates = allElements;
    if (saveErrorPathMatch?.zoneName) {
      const matchingZoneIds = zones.flatMap((z) =>
        toLower(String(z.name || '')) === toLower(saveErrorPathMatch.zoneName) ? [z.id] : [],
      );
      if (matchingZoneIds.length > 0) {
        candidates = candidates.filter((el) => !!el.zoneId && matchingZoneIds.includes(el.zoneId));
      }
    }
    if (saveErrorPathMatch?.elementName) {
      candidates = candidates.filter((el) => toLower(String(el.name || '')) === toLower(saveErrorPathMatch.elementName));
    }

    if (candidates.length === 0) return null;

    const minMatch = (currentSaveError || '').match(/is less than the minimum of ([0-9.]+)/i);
    const maxMatch = (currentSaveError || '').match(/is greater than the maximum of ([0-9.]+)/i);
    const fallbackField = ((currentSaveError || '').match(/\b(height|width|area|perimeter|base_height)\b/i)?.[1] || '') as string;
    const resolvedField = (saveErrorPathMatch?.field || fallbackField || '').trim();
    // Only infer an element target when we can confidently identify an element-scoped field.
    // This prevents unrelated schema errors (e.g. HeatSourceWet) from being pinned to a random element.
    if (!resolvedField) return null;
    const field = resolvedField as keyof typeof candidates[number];
    let narrowed = candidates;

    if (minMatch) {
      const threshold = Number(minMatch[1]);
      narrowed = candidates.filter((el) => {
        const v = Number(el?.[field]);
        return Number.isFinite(v) && v < threshold;
      });
    } else if (maxMatch) {
      const threshold = Number(maxMatch[1]);
      narrowed = candidates.filter((el) => {
        const v = Number(el?.[field]);
        return Number.isFinite(v) && v > threshold;
      });
    }

    const chosen = narrowed.length === 1 ? narrowed[0] : (candidates.length === 1 ? candidates[0] : candidates[0]);
    const zoneName = chosen.zoneId ? (zones.find((z) => z.id === chosen.zoneId)?.name || '') : '';
    return {
      elementId: chosen.id,
      ambiguous: narrowed.length > 1 && candidates.length > 1,
      elementName: chosen.name || 'Element',
      zoneName: String(zoneName || ''),
    };
  }, [saveErrorPathMatch, zones, elementIds, elementsById, currentSaveError]);
  const saveErrorSummary = useMemo(() => {
    const raw = (currentSaveError || '').trim();
    if (!raw) return 'Build failed.';

    // Remove internal prefixes, error codes, and "N errors found." preamble.
    const cleaned = raw
      .replace(/Conversion failed:\s*/gi, '')
      .replace(/JSON building failed:\s*/gi, '')
      .replace(/Schema validation failed:\s*/gi, '')
      .replace(/FHS validation failed:\s*/gi, '')
      .replace(/\[[A-Z]\d+\]\s*/g, '')
      .replace(/^\d+\s+errors?\s+found\.\s*/i, '')
      .trim();

    const describeLocation = (target: typeof saveErrorFocusTarget) => {
      if (!target) return '';
      const loc = target.zoneName ? ` in ${target.zoneName}` : '';
      return `${target.elementName}${loc}`;
    };

    const minMatch = cleaned.match(/(.+?) is less than the minimum of ([0-9.]+) at (.+)/i);
    if (minMatch) {
      const fieldPath = minMatch[3]?.trim() || '';
      const field = fieldPath.split('/').filter(Boolean).pop() || '';
      if (saveErrorFocusTarget?.elementName) {
        const loc = describeLocation(saveErrorFocusTarget);
        // Guard: if the extracted field token is actually a zone/element name the path
        // parsing was confused — omit the field rather than show a nonsense label.
        const fieldIsLocation =
          field.toLowerCase() === saveErrorFocusTarget.zoneName?.toLowerCase() ||
          field.toLowerCase() === saveErrorFocusTarget.elementName?.toLowerCase();
        const fieldLabel = field && !fieldIsLocation ? `${field} ` : '';
        return `${loc}: ${fieldLabel}value below minimum ${minMatch[2]}.`;
      }
      return `${field || 'Value'} is below minimum ${minMatch[2]}.`;
    }

    const maxMatch = cleaned.match(/(.+?) is greater than the maximum of ([0-9.]+) at (.+)/i);
    if (maxMatch) {
      const fieldPath = maxMatch[3]?.trim() || '';
      const field = fieldPath.split('/').filter(Boolean).pop() || '';
      if (saveErrorFocusTarget?.elementName) {
        const loc = describeLocation(saveErrorFocusTarget);
        const fieldIsLocation =
          field.toLowerCase() === saveErrorFocusTarget.zoneName?.toLowerCase() ||
          field.toLowerCase() === saveErrorFocusTarget.elementName?.toLowerCase();
        const fieldLabel = field && !fieldIsLocation ? `${field} ` : '';
        return `${loc}: ${fieldLabel}value above maximum ${maxMatch[2]}.`;
      }
      return `${field || 'Value'} is above maximum ${maxMatch[2]}.`;
    }

    const requiredMatch = cleaned.match(/missing required property ['"]?([^'"]+)['"]?/i);
    if (requiredMatch) {
      return `Required field "${requiredMatch[1]}" is missing.`;
    }

    return cleaned;
  }, [currentSaveError, saveErrorFocusTarget]);

  useEffect(() => {
    return () => {
      if (saveErrorCopiedTimeoutRef.current) {
        clearTimeout(saveErrorCopiedTimeoutRef.current);
      }
    };
  }, []);

  const getSaveButtonIcon = () => {
    switch (currentSaveStatus) {
      case 'saving':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="31.416" strokeDashoffset="31.416">
              <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416" repeatCount="indefinite"/>
              <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416" repeatCount="indefinite"/>
            </circle>
          </svg>
        );
      case 'success':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'error':
        return null;
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M17 21v-8H7v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7 3v5h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
    }
  };

  const getSaveButtonClass = () => {
    switch (currentSaveStatus) {
      case 'saving':
        return 'saving';
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      default:
        return '';
    }
  };

  const getSaveButtonTooltip = () => {
    switch (currentSaveStatus) {
      case 'saving':
        return 'Saving...';
      case 'success':
        return 'Saved successfully';
      case 'error':
        return 'Save failed';
      default:
        return 'Save model';
    }
  };

  const saveErrorDropdownElement = isSaveErrorDropdownOpen ? (
    <div
      ref={saveErrorDropdownRef}
      className="files-dropdown save-error-dropdown"
      style={{
        left: saveErrorPosition.x,
        top: saveErrorPosition.y,
        position: 'fixed',
        zIndex: 1000,
        transition: 'opacity 0.1s',
        width: 420,
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <div className="files-dropdown-header">
        <div className="files-dropdown-title">
          {showLastSaveValidationFailure ? 'Validation' : saveErrorTitle}
          {displayedBuildErrorCount > 0 && (
            <span className="save-error-header-count">
              {displayedBuildErrorCount} error{displayedBuildErrorCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="files-dropdown-header-actions">
          {buildErrorCopyText !== '' && (
          <button
            className="files-dropdown-refresh"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(buildErrorCopyText);
                setSaveErrorCopied(true);
                if (saveErrorCopiedTimeoutRef.current) {
                  clearTimeout(saveErrorCopiedTimeoutRef.current);
                }
                saveErrorCopiedTimeoutRef.current = setTimeout(() => setSaveErrorCopied(false), 1200);
              } catch {
                // Clipboard may be unavailable in some contexts.
              }
            }}
            title={saveErrorCopied ? 'Copied' : 'Copy error'}
            aria-label={saveErrorCopied ? 'Copied' : 'Copy error'}
          >
            {saveErrorCopied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="9" y="9" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M5 15V7a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
          )}
          <button
            className="files-dropdown-refresh"
            onClick={closeSaveErrorDropdown}
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
      <div className="files-dropdown-content">
        <div className="files-dropdown-item" style={{ cursor: 'default' }}>
          {showLastSaveValidationFailure ? (
            <div className="save-error-details">
              {LAST_SAVE_VALIDATION_MESSAGE}
            </div>
          ) : buildErrorItems.length > 0 ? (
            <div className="save-error-details">
              <div className="save-error-rows">
                {displayBuildErrorRows.map((error) => (
                  <div
                    className="save-error-row"
                    key={buildErrorRowKey(error)}
                  >
                    <div className="save-error-location">{error.location}</div>
                    <div className="save-error-row-content">
                      <div className="save-error-user-message">{error.userMessage}</div>
                      <details className="save-error-technical">
                        <summary>Details</summary>
                        <div className="save-error-technical-body">{error.item.technicalMessage || error.item.message}</div>
                        {(error.item.path || error.item.code || error.item.keyword) && (
                          <div className="save-error-technical-meta">
                            {[error.item.path, error.item.keyword, error.item.code].filter(Boolean).join(' • ')}
                          </div>
                        )}
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : saveErrorFocusTarget ? (
            <button
              type="button"
              className="save-error-details save-error-details-button"
              onClick={() => {
                const target = elementsById[saveErrorFocusTarget.elementId];
                const z = target?.coordinates?.[0]?.z;
                if (typeof z === 'number' && Number.isFinite(z)) {
                  setCurrentFloorZ(z);
                }
                setSelectedElementIds([saveErrorFocusTarget.elementId]);
                setSelection({ type: 'element', id: saveErrorFocusTarget.elementId });
                closeSaveErrorDropdown();
              }}
              title={saveErrorFocusTarget.ambiguous ? 'Click to select one matching element' : 'Click to select this element'}
            >
              {saveErrorSummary}
            </button>
          ) : (
            <div className="save-error-details">{saveErrorSummary}</div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
    <div className="filename-bar">
      <div className="filename-bar-left">
        {availableFilenameActions.map((action) => (
          <React.Fragment key={action.id}>
            {action.render(filenameActionContext)}
          </React.Fragment>
        ))}
      </div>

      <div className="filename-bar-center">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <StandardInput
            id="filename-field"
            type="text"
            value={displayedFilename}
            onChange={(e) => documentHost.updateFileName(
              filenameWithExtension(e.target.value, fileNameExtension),
            )}
            placeholder="Enter filename (without extension)"
            variant="ghost"
          />
          {isUnnamedDraft ? (
            <button
              type="button"
              onClick={() => document.getElementById('filename-field')?.focus()}
              title="Rename from draft_model before saving"
              style={{
                fontSize: '12px', padding: '4px 8px',
                backgroundColor: 'var(--validation-error)',
                color: 'var(--semantic-on-color)', borderRadius: '4px',
                border: 'none', cursor: 'pointer', flexShrink: 0,
              }}
            >
              Rename to Save
            </button>
          ) : null}
        </div>
      </div>

      <div className="filename-bar-right">
        <div className="filename-bar-save-stack">
        <button
          ref={saveButtonRef}
          onClick={() => {
            void documentHost.save().catch((error) => {
              console.error('[FilenameBar] Save command failed:', error);
            });
          }}
          disabled={saveStatus === 'saving'}
          className={`btn btn-standard btn-yellow save-button ${getSaveButtonClass()}`}
          title={getSaveButtonTooltip()}
        >
          <span className="save-button-content">
            {getSaveButtonIcon()}
            <span className="save-button-text">Save</span>
            {showSaveErrorIndicator && (
              <span
                role="button"
                tabIndex={0}
                className="save-error-indicator"
                title="View save error details"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openSaveErrorDropdown(saveButtonRef.current);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    openSaveErrorDropdown(saveButtonRef.current);
                  }
                }}
              >
                ⚠
              </span>
            )}
          </span>
        </button>
        </div>
        {buildError && currentSaveStatus !== 'saving' && (
          <button
            ref={buildErrorChipRef}
            type="button"
            onClick={() => {
              openSaveErrorDropdown(buildErrorChipRef.current);
            }}
            title={buildErrorCopyText || buildError || undefined}
            style={{
              fontSize: '12px', padding: '4px 8px',
              backgroundColor: 'var(--validation-error)',
              color: 'var(--semantic-on-color)', borderRadius: '4px',
              border: 'none', cursor: 'pointer', flexShrink: 0,
            }}
          >
            Build Error{displayedBuildErrorCount > 0 ? ` (${displayedBuildErrorCount})` : ''}
          </button>
        )}
        {showLastSaveValidationFailure ? (
          <button
            ref={buildErrorChipRef}
            type="button"
            onClick={() => {
              openSaveErrorDropdown(buildErrorChipRef.current);
            }}
            title="View validation status"
            style={{
              fontSize: '12px', padding: '4px 8px',
              backgroundColor: 'var(--validation-warning)',
              color: 'var(--validation-warning-on-fill)', borderRadius: '4px',
              border: 'none', cursor: 'pointer', flexShrink: 0,
            }}
          >
            Validation failed at last save
          </button>
        ) : null}
      </div>
    </div>

    {isSaveErrorDropdownOpen && typeof window !== 'undefined'
      ? ReactDOM.createPortal(saveErrorDropdownElement, document.body)
      : null}

    </>
  );
};
