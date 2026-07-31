// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import './Tooltip.css';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import {
  useGeometrySchemaPort,
  useGeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src/editorServicePorts';
import type { GeometrySchemaParameterInfo } from '../../../geometry-editor-host/src/schemaPort';

interface TooltipProps {
  path?: string;
  content?: string | React.ReactNode;
  paramId?: string;
  contextPath?: string[]; // Optional context path to limit schema search scope
  elementType?: string; // Optional element type to prefer when multiple matches exist
  useFHSSchema?: boolean;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  maxWidth?: number;
  className?: string;
}

interface TooltipState {
  isVisible: boolean;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  schemaInfo: GeometrySchemaParameterInfo | null;
}

// Simple cache for markdown content
const markdownCache = new Map<string, string>();

export const Tooltip: React.FC<TooltipProps> = ({
  path,
  content,
  paramId,
  contextPath,
  elementType,
  useFHSSchema,
  children,
  position = 'bottom',
  maxWidth = 400,
  className = ''
}) => {
  const schemaPort = useGeometrySchemaPort();
  const workspaceResourcePort = useGeometryWorkspaceResourcePort();
  const schemaModeIsFhs = useFHSSchema ?? false;
  const schemaMode = schemaModeIsFhs ? 'fhs' : 'core';
  const [state, setState] = useState<TooltipState>({
    isVisible: false,
    content: null,
    isLoading: false,
    error: null,
    schemaInfo: null
  });

  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [tooltipDims, setTooltipDims] = useState({ width: 0, height: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPositioned, setIsPositioned] = useState(false);
  const contextPathKey = contextPath?.join('/') ?? '';

  useEffect(() => {
    setState(prev => ({
      ...prev,
      schemaInfo: null,
      error: null,
    }));
  }, [paramId, elementType, schemaModeIsFhs, contextPathKey]);

  // Load schema info (only if paramId is provided)
  const loadSchemaInfo = useCallback(() => {
    if (!paramId) return;
    if (state.schemaInfo !== null) return; // Already loaded

    try {
      if (schemaPort.availability !== 'available') {
        setState(prev => ({ ...prev, error: 'Schema information is unavailable' }));
        return;
      }
      // Check if schema is loaded
      const schema = schemaPort.getRootSchema(schemaMode);
      if (!schema) {
        console.warn('[Tooltip] Schema not loaded yet, trying to preload...');
        void schemaPort.preload(schemaMode).then(() => {
          // Retry after schema is loaded
          const info = schemaPort.findParameter(paramId, contextPath, elementType, schemaMode);
          if (info) {
            setState(prev => ({ ...prev, schemaInfo: info }));
          } else {
            setState(prev => ({ ...prev, error: 'Parameter not found in schema' }));
          }
        }).catch((error: unknown) => {
          console.error('[Tooltip] Error loading schema info:', error);
          setState(prev => ({ ...prev, error: 'Failed to load schema information' }));
        });
        return;
      }

      const info = schemaPort.findParameter(paramId, contextPath, elementType, schemaMode);
      if (info) {
        setState(prev => ({ ...prev, schemaInfo: info }));
      } else {
        setState(prev => ({ ...prev, error: 'Parameter not found in schema' }));
      }
    } catch (error) {
      console.error('[Tooltip] Error loading schema info:', error);
      setState(prev => ({ ...prev, error: 'Failed to load schema information' }));
    }
  }, [paramId, contextPath, elementType, schemaMode, schemaPort, state.schemaInfo]);

  // Load markdown content (only if path is provided and no direct content or paramId)
  const loadContent = useCallback(async () => {
    if (!path || content !== undefined || paramId) return; // Skip if paramId provided or no path or direct content provided
    if (state.content !== null) return; // Already loaded

    // Check cache first
    if (markdownCache.has(path)) {
      setState(prev => ({
        ...prev,
        content: markdownCache.get(path)!,
        isLoading: false
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      if (workspaceResourcePort.availability !== 'available') {
        throw new Error('Geometry workspace documentation is unavailable');
      }
      const markdownContent = await workspaceResourcePort.readText(path);

      // Cache the content
      markdownCache.set(path, markdownContent);

      setState(prev => ({
        ...prev,
        content: markdownContent,
        isLoading: false
      }));
    } catch (error) {
      console.error('[Tooltip] Error loading markdown:', error);
      setState(prev => ({
        ...prev,
        error: error as string,
        isLoading: false
      }));
    }
  }, [path, content, paramId, state.content, workspaceResourcePort]);

  // Handle mouse enter
  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isVisible: true }));
      if (paramId) {
        loadSchemaInfo();
      } else {
        loadContent();
      }
    }, 500); // 500ms delay as per PRD
  }, [loadContent, paramId, loadSchemaInfo]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isVisible: false }));
  }, []);

  // Calculate tooltip position (portal/fixed)
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setTooltipDims({ width: tooltipRect.width, height: tooltipRect.height });
    let x = 0;
    let y = 0;
    switch (position) {
      case 'bottom':
        x = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
        y = triggerRect.bottom + 8;
        break;
      case 'top':
        x = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
        y = triggerRect.top - tooltipRect.height - 8;
        break;
      case 'left':
        x = triggerRect.left - tooltipRect.width - 8;
        y = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2);
        break;
      case 'right':
        x = triggerRect.right + 8;
        y = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2);
        break;
    }
    // Clamp to viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (x < 8) x = 8;
    if (x + tooltipRect.width > viewportWidth - 8) x = viewportWidth - tooltipRect.width - 8;
    if (y < 8) y = 8;
    if (y + tooltipRect.height > viewportHeight - 8) y = viewportHeight - tooltipRect.height - 8;
    setTooltipPosition({ x, y });
    setIsPositioned(true);
  }, [position]);

  // Update position when tooltip becomes visible
  useEffect(() => {
    if (state.isVisible) {
      setIsPositioned(false);
      setTimeout(updatePosition, 10);
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [state.isVisible, updatePosition, tooltipDims.width, tooltipDims.height]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Determine what content to render
  const renderTooltipContent = () => {
    // Priority: paramId > content > path (markdown)

    // If paramId is provided, render schema info
    if (paramId) {
      if (state.error && !state.schemaInfo) {
        return (
          <div className="tooltip-content">
            <div className="tooltip-error">
              <span>Schema information not available</span>
            </div>
          </div>
        );
      }

      if (state.schemaInfo) {
        return (
          <div className="tooltip-content">
            {formatSchemaInfoForTooltip(state.schemaInfo)}
          </div>
        );
      }

      // Still loading schema info
      return (
        <div className="tooltip-content">
          <div className="tooltip-loading">
            <div className="tooltip-spinner"></div>
            <span>Loading...</span>
          </div>
        </div>
      );
    }

    // If direct content is provided, render it
    if (content !== undefined) {
      return (
        <div className="tooltip-content">
          <div className="tooltip-direct-content">
            {content}
          </div>
        </div>
      );
    }

    // Otherwise, render markdown content (existing logic)
    return (
      <div className="tooltip-content">
        {state.isLoading && (
          <div className="tooltip-loading">
            <div className="tooltip-spinner"></div>
            <span>Loading...</span>
          </div>
        )}

        {state.error && (
          <div className="tooltip-error">
            <span>Documentation not available</span>
          </div>
        )}

        {state.content && !state.isLoading && !state.error && (
          <div className="tooltip-markdown">
            {(() => {
              // Use basic rendering for now - we can add remark-gfm later if needed
              return (
                <ReactMarkdown
                  components={{
                    // Add safe fallbacks for problematic elements
                    code: ({ inline, className, children, ...props }: any) => {
                      if (inline) {
                        return <code className={className} {...props}>{children}</code>;
                      }
                      return (
                        <pre className={className}>
                          <code {...props}>{children}</code>
                        </pre>
                      );
                    },
                    // Ensure all text content is safely rendered
                    text: ({ children }) => <span>{children}</span>
                  }}
                >
                  {state.content}
                </ReactMarkdown>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  // The tooltip element to render in portal
  const tooltipElement = state.isVisible ? (
    <div
      ref={tooltipRef}
      className={`tooltip tooltip-${position}`}
      style={{
        left: isPositioned ? tooltipPosition.x : -9999,
        top: isPositioned ? tooltipPosition.y : -9999,
        maxWidth: maxWidth,
        position: 'fixed',
        zIndex: 9999,
        opacity: isPositioned ? 1 : 0,
        pointerEvents: isPositioned ? 'auto' : 'none',
        transition: 'opacity 0.1s'
      }}
    >
      {renderTooltipContent()}
    </div>
  ) : null;

  return (
    <div
      className={`tooltip-container ${className}`}
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {typeof window !== 'undefined' && ReactDOM.createPortal(tooltipElement, document.body)}
    </div>
  );
};
