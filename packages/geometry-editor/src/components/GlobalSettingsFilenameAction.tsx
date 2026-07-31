// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { FilenameBarActionContext } from './FilenameBar';
import { ValidationIndicator } from './ValidationIndicator';

export type GlobalSettingsFilenameActionProps = Readonly<{
  context: FilenameBarActionContext;
}>;

/** Canonical Global Settings filename action shared by Community and Official hosts. */
export function GlobalSettingsFilenameAction({
  context,
}: GlobalSettingsFilenameActionProps) {
  if (!context.onOpenDefaults) return null;

  return (
    <button
      type="button"
      className="btn btn-nav filename-bar-action"
      onClick={context.onOpenDefaults}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span>Global Settings</span>
        {context.globalSettingsIndicator ? (
          <ValidationIndicator
            hasIssues
            issues={context.globalSettingsIndicator.issues}
            size="small"
            variant={context.globalSettingsIndicator.variant}
          />
        ) : context.defaultsInvalid ? (
          <span
            style={{
              width: 8,
              height: 8,
              background: 'var(--validation-error)',
              borderRadius: 9999,
              border: '1px solid var(--validation-error-border)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        ) : null}
      </span>
    </button>
  );
}
