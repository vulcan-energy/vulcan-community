// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type React from 'react';
import type { GeometryCanvasRemoteSelection } from './RemotePresenceLayer';

/** A colleague's avatar disc, ringed in their colour: initials, under their image once it loads. */
export function PersonDisc({ color, initials, imageUrl }: Readonly<{ color: string; initials: string; imageUrl?: string }>) {
  return (
    <span aria-hidden className="people-disc" style={{ '--person-colour': color } as React.CSSProperties}>
      {initials}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          crossOrigin="anonymous"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
    </span>
  );
}

/** The discs of colleagues who have this selected, named on hover; nothing when nobody has. */
export function ColleagueDiscs({ colleagues }: Readonly<{ colleagues: readonly GeometryCanvasRemoteSelection[] }>) {
  if (colleagues.length === 0) return null;
  return (
    <span className="people-discs" data-colleague-selection title={colleagues.map((colleague) => colleague.label).join(', ')}>
      {colleagues.map((colleague) => (
        <PersonDisc
          key={colleague.key}
          color={colleague.color}
          initials={colleague.initials}
          imageUrl={colleague.imageUrl}
        />
      ))}
    </span>
  );
}
