// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  developmentSecurityHeaders,
  productionSecurityHeaders,
  renderStaticHeaders,
} from '../../securityHeaders';

const productionCspDirectives = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
] as const;

const productionHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': productionCspDirectives.join('; '),
} as const;

function parseStaticHeaders(source: string): Record<string, string> {
  const lines = source.trimEnd().split('\n');
  expect(lines.shift()).toBe('/*');
  return Object.fromEntries(lines.map((line) => {
    const match = line.match(/^ {2}([^:]+): (.+)$/);
    expect(match).not.toBeNull();
    return [match![1], match![2]];
  }));
}

function parseNginxHeaders(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/^add_header (\S+) "([^"]+)" always;$/gm)]
      .map((match) => [match[1], match[2]]),
  );
}

describe('Community editor security headers', () => {
  it('ships the exact production isolation headers and CSP for static hosts', () => {
    const staticHeaders = readFileSync(
      resolve(import.meta.dirname, '../../../../deployment/netlify/_headers'),
      'utf8',
    );

    expect(productionSecurityHeaders).toEqual(productionHeaders);
    expect(parseStaticHeaders(staticHeaders)).toEqual(productionHeaders);
    expect(staticHeaders).toBe(renderStaticHeaders(productionSecurityHeaders));
    expect(productionCspDirectives).not.toContain(expect.stringContaining('ws:'));
  });

  it('reuses the production policy for preview and adds ws only for dev HMR', () => {
    const viteConfig = readFileSync(
      resolve(import.meta.dirname, '../../vite.config.ts'),
      'utf8',
    );

    expect(developmentSecurityHeaders).toEqual({
      ...productionHeaders,
      'Content-Security-Policy': productionCspDirectives
        .map((directive) => directive.startsWith('connect-src ')
          ? `${directive} ws:`
          : directive)
        .join('; '),
    });
    expect(viteConfig).toContain("fileName: '_headers',");
    expect(viteConfig).toContain('source: renderStaticHeaders(productionSecurityHeaders),');
    expect(viteConfig).toMatch(/server:\s*\{[\s\S]*?headers: developmentSecurityHeaders,/);
    expect(viteConfig).toMatch(/preview:\s*\{[\s\S]*?headers: productionSecurityHeaders,/);
  });

  it('keeps the nginx sample aligned with the production policy', () => {
    const nginxConfig = readFileSync(
      resolve(import.meta.dirname, '../../../../deployment/nginx.conf'),
      'utf8',
    );

    expect(parseNginxHeaders(nginxConfig)).toEqual(productionHeaders);
  });
});
