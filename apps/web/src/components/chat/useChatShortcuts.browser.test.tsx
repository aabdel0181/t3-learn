import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { useEffect } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { useChatShortcuts } from "./useChatShortcuts";

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

// Spelled with ctrl rather than mod so the chord is the same on every platform.
const keybindings = compileResolvedKeybindingsConfig([
  { key: "ctrl+shift+m", command: "modelPicker.toggle" },
  { key: "ctrl+shift+enter", command: "thread.steerQueuedMessage" },
  { key: "ctrl+f", command: "chat.find" },
]);

const focusOnMount = (element: HTMLElement | null) => element?.focus();

// Stands in for the right panel's launcher, which needs the whole app around it. Like the
// real one it takes focus, advertises its letters in `data-surface-launcher-keys`, and
// claims one from its own window capture listener unless the key was already handled.
function Launcher(props: { keys: string; received: string[] }) {
  useEffect(() => {
    const claim = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!props.keys.toLowerCase().split("").includes(event.key.toLowerCase())) return;
      event.preventDefault();
      props.received.push(event.key);
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [props.keys, props.received]);
  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      aria-label="Open a surface"
      data-surface-launcher-keys={props.keys}
    />
  );
}

// The chat's shortcut listener registers when the chat mounts, so a launcher that opens
// later registers after it. Tests mount the chat first and add the launcher by rerendering.
function Chat(props: {
  composerKeys: string[];
  ran?: string[];
  launcher?: { keys: string; received: string[] };
  sideChatPanel?: boolean;
}) {
  useChatShortcuts({
    enabled: true,
    keybindings,
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    // Type-to-focus only calls insertTextAtEnd and the model picker chord only calls
    // toggleModelPicker, so the stand-in composer implements just those.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
        toggleModelPicker: () => {
          props.ran?.push("modelPicker");
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {
      "thread.steerQueuedMessage": () => {
        props.ran?.push("steerQueuedMessage");
      },
      "chat.find": () => {
        props.ran?.push("find");
      },
    },
    fallback: () => undefined,
  });
  if (props.sideChatPanel) {
    return <section data-side-chat-panel tabIndex={-1} aria-label="Side chat" ref={focusOnMount} />;
  }
  return props.launcher ? <Launcher {...props.launcher} /> : null;
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

it("leaves the launcher's letters to the launcher, in either case", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("tT");

  expect(received).toEqual(["t", "T"]);
  expect(composerKeys).toEqual([]);
});

it("still types other letters into the composer while the launcher is open", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("a");

  expect(composerKeys).toEqual(["a"]);
  expect(received).toEqual([]);
});

it("keeps keys and composer chords pressed in the side-chat panel off the lesson composer", async () => {
  const composerKeys: string[] = [];
  const ran: string[] = [];
  await using screen = await render(
    <Chat composerKeys={composerKeys} ran={ran} sideChatPanel />,
    options,
  );
  await expect.element(screen.getByRole("region", { name: "Side chat" })).toHaveFocus();
  const findPrevented: boolean[] = [];
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "f") findPrevented.push(event.defaultPrevented);
  };
  window.addEventListener("keydown", onKeyDown);
  using _listener = { [Symbol.dispose]: () => window.removeEventListener("keydown", onKeyDown) };

  await userEvent.keyboard("a{Control>}{Shift>}m{Enter}{/Shift}f{/Control}");

  expect({ composerKeys, ran, findPrevented }).toEqual({
    composerKeys: [],
    ran: [],
    // The browser's own find searches the side chat.
    findPrevented: [false],
  });
});
