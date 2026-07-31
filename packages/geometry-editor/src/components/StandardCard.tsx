// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import './StandardCard.css';

interface StandardCardProps {
  title?: string;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const StandardCard: React.FC<StandardCardProps> = ({
  title,
  headerContent,
  children,
  className = '',
  style = {},
}) => {
  return (
    <div
      className={`standard-card ${className}`}
      style={style}
    >
      {(title || headerContent) && (
        <div className="standard-card-header">
          {headerContent ? headerContent : <h2 className="standard-card-title">{title}</h2>}
        </div>
      )}
      <div className="standard-card-content">
        {children}
      </div>
    </div>
  );
};
