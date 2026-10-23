import { ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent, type Locator } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import {
  type ComposerInputScope,
  isLessonComposerFocused,
  shouldTypeToFocusComposer,
} from "./composerFocusRedirect";
import { usePasteToFocusComposer } from "./usePasteToFocusComposer";

// router: false because nothing here navigates.
const options = { router: false } as const;

// composedPath() is only filled while the event is dispatched, so the helper is asked
// from a window capture listener, the way the chat and the side chat ask it.
function TypingProbe(props: { scope: ComposerInputScope; results: boolean[] }) {
  useEffect(() => {
    const record = (event: KeyboardEvent) => {
      props.results.push(shouldTypeToFocusComposer(event, props.scope));
    };
    window.addEventListener("keydown", record, true);
    return () => window.removeEventListener("keydown", record, true);
  }, [props.results, props.scope]);
  return null;
}

function LessonComposer(props: { composerRef: { current: ChatComposerHandle } }) {
  usePasteToFocusComposer(ThreadId.make("lesson-1"), props.composerRef);
  return null;
}

async function typeIn(target: Locator, keys: string) {
  target.element().focus();
  await userEvent.keyboard(keys);
}

function pasteIn(target: Locator, text: string) {
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  target
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
}

it("routes typing inside the side-chat panel to the side chat and outside it to the lesson", async () => {
  const results: boolean[] = [];
  await using screen = await render(
    <>
      <TypingProbe scope="lesson" results={results} />
      <TypingProbe scope="side-chat" results={results} />
      <main tabIndex={-1} aria-label="Lesson" />
      <section data-side-chat-panel tabIndex={-1} aria-label="Side chat" />
    </>,
    options,
  );

  await typeIn(screen.getByRole("region", { name: "Side chat" }), "a");
  await typeIn(screen.getByRole("main", { name: "Lesson" }), "a");

  // Inside the panel: lesson, side chat. Outside it: lesson, side chat.
  expect(results).toEqual([false, true, true, false]);
});

it("lets the side chat take typing while its sheet is open", async () => {
  const results: boolean[] = [];
  const sheet = (
    <div data-slot="sheet-popup" data-open="">
      <section data-side-chat-panel tabIndex={-1} aria-label="Side chat" />
    </div>
  );
  await using screen = await render(
    <>
      <TypingProbe scope="side-chat" results={results} />
      {sheet}
    </>,
    options,
  );
  const panel = screen.getByRole("region", { name: "Side chat" });

  await typeIn(panel, "a");
  // A popup open outside the sheet still owns the keys.
  await screen.rerender(
    <>
      <TypingProbe scope="side-chat" results={results} />
      {sheet}
      <div data-slot="menu-popup" data-open="" />
    </>,
  );
  await typeIn(panel, "a");

  expect(results).toEqual([true, false]);
});

it("never pastes into the lesson composer from inside the side-chat panel", async () => {
  const inserted: string[] = [];
  // Paste-to-focus only asks these two, so the stand-in composer implements just them.
  const composerRef = {
    current: {
      isModelPickerOpen: () => false,
      pasteTextAtEnd: (text: string) => {
        inserted.push(text);
        return true;
      },
    } as Partial<ChatComposerHandle> as ChatComposerHandle,
  };
  await using screen = await render(
    <>
      <LessonComposer composerRef={composerRef} />
      <main aria-label="Lesson" />
      <section data-side-chat-panel aria-label="Side chat" />
    </>,
    options,
  );

  pasteIn(screen.getByRole("region", { name: "Side chat" }), "inside");
  pasteIn(screen.getByRole("main", { name: "Lesson" }), "outside");

  expect(inserted).toEqual(["outside"]);
});

it("does not count the side chat's editor as the lesson composer", async () => {
  await using screen = await render(
    <>
      <div data-testid="composer-editor" role="textbox" tabIndex={-1} aria-label="Lesson message" />
      <section data-side-chat-panel aria-label="Side chat">
        <div
          data-testid="composer-editor"
          role="textbox"
          tabIndex={-1}
          aria-label="Side chat message"
        />
      </section>
    </>,
    options,
  );

  screen.getByRole("textbox", { name: "Lesson message" }).element().focus();
  expect(isLessonComposerFocused(document.activeElement)).toBe(true);
  screen.getByRole("textbox", { name: "Side chat message" }).element().focus();
  expect(isLessonComposerFocused(document.activeElement)).toBe(false);
});
