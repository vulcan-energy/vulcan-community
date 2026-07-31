// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import './StatusPill.css';

export type StatusPillType =
  | 'custom'
  | 'calculated'
  | 'default-used'
  | 'no-default-schema';

interface StatusPillProps {
  type: StatusPillType;
  className?: string;
  labelOverride?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ type, className = '', labelOverride }) => {
  const getPillContent = () => {
    if (labelOverride && labelOverride.trim() !== '') {
      return labelOverride;
    }
    switch (type) {
      case 'custom':
        return 'Custom';
      case 'calculated':
        return 'Calculated';
      case 'default-used':
        return 'Default';
      case 'no-default-schema':
        return 'Schema';
      default:
        return '';
    }
  };

  return (
    <span className={`status-pill status-pill-${type} ${className}`}>
      {getPillContent()}
    </span>
  );
};
