// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { GeometrySchemaParameterInfo } from '../../../geometry-editor-host/src/schemaPort';

/**
 * Format ParameterInfo from schema into React content for tooltip display
 */
export function formatSchemaInfoForTooltip(info: GeometrySchemaParameterInfo): React.ReactNode {
  const parts: React.ReactNode[] = [];

  // Source indicator: JSON schema text vs HEM/FHS guidance summaries (see HEM_FHS_Guidance/Dwelling Details.pdf)
  const sourceLabel =
    info.source === 'hem_guidance' || (typeof info.jsonPath === 'string' && info.jsonPath.startsWith('#/hardcoded/'))
      ? 'HEM Guidance'
      : 'Schema';

  // Description (rendered as markdown)
  if (info.description) {
    parts.push(
      <div key="description" className="tooltip-markdown">
        <ReactMarkdown
          components={{
            code: ({ inline, className, children, ...props }: any) => {
              delete props.node;
              if (inline) {
                return <code className={className} {...props}>{children}</code>;
              }
              return (
                <pre className={className}>
                  <code {...props}>{children}</code>
                </pre>
              );
            },
            text: ({ children }) => <span>{children}</span>
          }}
        >
          {info.description}
        </ReactMarkdown>
      </div>
    );
  }

  // Metadata section (type, units, constraints)
  const metadata: React.ReactNode[] = [];

  metadata.push(
    <span key="source" className="tooltip-metadata-item">
      <strong>Source:</strong> {sourceLabel}
    </span>
  );

  // Type
  if (info.type) {
    const typeStr = Array.isArray(info.type) ? info.type.join(' | ') : info.type;
    metadata.push(
      <span key="type" className="tooltip-metadata-item">
        <strong>Type:</strong> {typeStr}
      </span>
    );
  }

  // Units
  if (info.units) {
    metadata.push(
      <span key="units" className="tooltip-metadata-item">
        <strong>Units:</strong> {info.units}
      </span>
    );
  }

  // Constraints
  if (info.constraints) {
    const constraintParts: string[] = [];
    if (info.constraints.min !== undefined) {
      constraintParts.push(`Min: ${info.constraints.min}`);
    }
    if (info.constraints.max !== undefined) {
      constraintParts.push(`Max: ${info.constraints.max}`);
    }
    if (info.constraints.enum && info.constraints.enum.length > 0) {
      const enumPreview = info.constraints.enum.slice(0, 3).join(', ');
      const enumSuffix = info.constraints.enum.length > 3
        ? ` (+${info.constraints.enum.length - 3} more)`
        : '';
      constraintParts.push(`Values: ${enumPreview}${enumSuffix}`);
    }
    if (constraintParts.length > 0) {
      metadata.push(
        <span key="constraints" className="tooltip-metadata-item">
          <strong>Constraints:</strong> {constraintParts.join(', ')}
        </span>
      );
    }
  }

  // Variants (if property only applies to certain element types)
  if (info.variants && info.variants.length > 0) {
    const variantText = info.variants.length === 1
      ? `Only in ${info.variants[0]}`
      : `Applies to: ${info.variants.join(', ')}`;
    metadata.push(
      <span key="variants" className="tooltip-metadata-item tooltip-variant">
        {variantText}
      </span>
    );
  }

  if (metadata.length > 0) {
    parts.push(
      <div key="metadata" className="tooltip-metadata">
        {metadata}
      </div>
    );
  }

  // If no content at all, return a fallback
  if (parts.length === 0) {
    return (
      <div className="tooltip-no-info">
        No schema information available
      </div>
    );
  }

  return <div className="tooltip-schema-content">{parts}</div>;
}
