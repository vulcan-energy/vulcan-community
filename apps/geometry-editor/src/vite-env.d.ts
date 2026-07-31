// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.mjs' {
  export function loadPyodide(options: Readonly<{ indexURL: string }>): Promise<unknown>;
}
