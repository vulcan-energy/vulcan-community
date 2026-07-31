// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type CommunitySecurityHeaders = Readonly<Record<string, string>>;

const CONTENT_SECURITY_POLICY = 'Content-Security-Policy';

const productionCspDirectives = Object.freeze([
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
]);

export const productionSecurityHeaders: CommunitySecurityHeaders = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  [CONTENT_SECURITY_POLICY]: productionCspDirectives.join('; '),
});

export const developmentSecurityHeaders: CommunitySecurityHeaders = Object.freeze({
  ...productionSecurityHeaders,
  [CONTENT_SECURITY_POLICY]: productionCspDirectives
    .map((directive) => directive.startsWith('connect-src ')
      ? `${directive} ws:`
      : directive)
    .join('; '),
});

export function renderStaticHeaders(headers: CommunitySecurityHeaders): string {
  const headerLines = Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}`);
  return `/*\n${headerLines.join('\n')}\n`;
}
