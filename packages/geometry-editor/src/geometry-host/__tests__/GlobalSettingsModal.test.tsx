// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GeometryWorkspaceResourcePort } from "../../../../geometry-editor-host/src/index";
import { GlobalSettingsModal } from "../../components/GlobalSettingsModal";
import {
  createGeometryStore,
  GeometryStoreProvider,
} from "../../stores/geometryStore";

function createResources(
  overrides: Partial<GeometryWorkspaceResourcePort> = {}
): GeometryWorkspaceResourcePort {
  return {
    availability: "available",
    readText: vi.fn(async () => '{"name":"Community defaults"}'),
    readFile: vi.fn(),
    writeText: vi.fn(),
    writeBytes: vi.fn(),
    removeFile: vi.fn(),
    ensureDirectory: vi.fn(),
    exists: vi.fn(async () => true),
    list: vi.fn(async (path) =>
      path === "input/defaults"
        ? [{ name: "defaults_template.json", kind: "file" }]
        : []
    ),
    ...overrides,
  };
}

describe("GlobalSettingsModal", () => {
  it("uses one public modal for defaults and every core global-values section", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const resources = createResources();

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
        />
      </GeometryStoreProvider>
    );

    expect(screen.getByText("Global Settings")).toBeInTheDocument();
    await screen.findByText("input/defaults/defaults_template.json");
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling Details")).toBeInTheDocument();
    expect(screen.getByText("Air Tightness")).toBeInTheDocument();
    expect(screen.getByText("Ventilation Environment")).toBeInTheDocument();
    expect(screen.getByText("Thermal Bridging")).toBeInTheDocument();

    await user.click(screen.getByText("Dwelling Details"));
    const postcode = screen.getByLabelText("Property postcode");
    await user.type(postcode, "mk40 1aa");
    expect(store.getState().propertyPostcode).toBe("MK40 1AA");
  });

  it("duplicates defaults through the injected workspace without a private editor", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore();
    const writeText = vi.fn(async () => undefined);
    const resources = createResources({
      exists: vi.fn(async (path) => !path.endsWith("/copy.json")),
      writeText,
    });
    vi.spyOn(window, "prompt").mockReturnValue("copy");

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
        />
      </GeometryStoreProvider>
    );

    await screen.findByText("input/defaults/defaults_template.json");
    await user.click(screen.getByTitle("Duplicate"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "input/defaults/copy.json",
        '{"name":"Community defaults"}'
      );
    });
    expect(store.getState().defaultsPath).toBe("input/defaults/copy.json");
  });

  it("keeps global values usable when the Community host has no implicit defaults file", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const onIndicatorChange = vi.fn();
    const resources = createResources({
      exists: vi.fn(async () => false),
      list: vi.fn(async () => []),
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
          onIndicatorChange={onIndicatorChange}
        />
      </GeometryStoreProvider>
    );

    await waitFor(() => {
      const indicator =
        onIndicatorChange.mock.calls[onIndicatorChange.mock.calls.length - 1]?.[0];
      expect(indicator?.variant).toBe("error");
      expect(indicator?.issues[0]).toBe("No defaults file is selected.");
    });
    expect(
      screen.getByText("No JSON files found under input/defaults/")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling Details")).toBeInTheDocument();
  });

  it("combines defaults errors with required global-value issues in the filename indicator", async () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().setComplianceSettings({ complianceValidationEnabled: true });
    const onIndicatorChange = vi.fn();
    const resources = createResources({
      exists: vi.fn(async () => false),
      list: vi.fn(async () => []),
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
          onIndicatorChange={onIndicatorChange}
        />
      </GeometryStoreProvider>
    );

    await waitFor(() => {
      const indicator =
        onIndicatorChange.mock.calls[onIndicatorChange.mock.calls.length - 1]?.[0];
      expect(indicator?.variant).toBe("error");
      expect(indicator?.issues[0]).toBe("No defaults file is selected.");
      expect(indicator?.issues).toContain(
        "Number of hot-tapped rooms is required when strict checks are on."
      );
    });
  });

  it("keeps disconnected workspace resources idle and gives host-neutral guidance", async () => {
    const user = userEvent.setup();
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const list = vi.fn(async () => []);
    const exists = vi.fn(async () => false);
    const resources = createResources({
      availability: "unavailable",
      list,
      exists,
    });

    render(
      <GeometryStoreProvider store={store}>
        <GlobalSettingsModal
          isOpen
          onClose={vi.fn()}
          workspaceResourcePort={resources}
        />
      </GeometryStoreProvider>
    );

    expect(
      screen.getByText(/Use Files to choose or reconnect a workspace folder/i)
    ).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: /Global values/i }));
    expect(screen.getByText("Dwelling Details")).toBeInTheDocument();
  });
});
