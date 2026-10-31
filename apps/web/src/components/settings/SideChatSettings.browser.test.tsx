import { render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "../../index.css";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useScopedSettingsMixed: (() => false) as never,
  useUpdateScopedSettings: (() => vi.fn()) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({ environment: null })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => new Map()) as never,
}));
vi.mock(import("./useScopedModelAvailability"), async (original) => ({
  ...(await original()),
  useScopedModelDisabledReason: (() => () => null) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsSection: (({ title, children }: { title?: string; children: ReactNode }) => (
    <section>
      {title ? <h1>{title}</h1> : null}
      {children}
    </section>
  )) as never,
  SettingsRow: (({
    title,
    children,
    control,
  }: {
    title?: string;
    children?: ReactNode;
    control?: ReactNode;
  }) => (
    <div>
      {title ? <h2>{title}</h2> : null}
      {control}
      {children}
    </div>
  )) as never,
}));

import { SideChatSettings } from "./SideChatSettings";
import { hasSideChatSettings } from "./sideChatSettingsSupport";

describe("SideChatSettings", () => {
  it("hides side-chat rows when an older server omits the settings keys", async () => {
    const {
      sideChatInstructions: _instructions,
      sideChatSkills: _skills,
      sideChatModelSelection: _model,
      ...legacySettings
    } = DEFAULT_UNIFIED_SETTINGS;
    state.settings = legacySettings;
    await using _screen = await render(
      <StrictMode>
        <SideChatSettings />
      </StrictMode>,
    );

    expect(page.getByText("Side chats").query()).toBeNull();
    expect(page.getByText("Model for new side chats").query()).toBeNull();
  });

  it("renders side-chat rows when the server advertises the settings keys", async () => {
    state.settings = { ...DEFAULT_UNIFIED_SETTINGS };
    state.settings.sideChatInstructions = "";
    state.settings.sideChatSkills = [];
    state.settings.sideChatModelSelection = null;
    expect(hasSideChatSettings(state.settings)).toBe(true);
    await using _screen = await render(
      <StrictMode>
        <SideChatSettings />
      </StrictMode>,
    );

    expect(page.getByText("Side chats").query()).not.toBeNull();
    expect(page.getByText("Model for new side chats").query()).not.toBeNull();
  });
});
