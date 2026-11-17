// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createContext } from "react";

/** Closes Global Settings; its Fabric tab provides it so a count can show elements on the drawing. */
export const FabricTabCloseContext = createContext<(() => void) | null>(null);
