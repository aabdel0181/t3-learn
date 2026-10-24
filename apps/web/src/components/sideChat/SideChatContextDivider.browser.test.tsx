import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { SideChatContextDivider } from "./SideChatContextDivider";

const THREAD_ID = ThreadId.make("thread-side-chat");
const ITEM_ID = TurnItemId.make("item-side-chat-context");

// The live wire never carries a handoff's summary, so the divider has to fetch it.
const turnItemDetail = vi.hoisted(() => ({ targets: [] as Array<unknown> }));
vi.mock(import("../../state/queries"), () => ({
  useTurnItemDetail: ((target: { readonly threadId: string; readonly itemId: string } | null) => {
    turnItemDetail.targets.push(target);
    const found = target?.threadId === THREAD_ID && target.itemId === ITEM_ID;
    return {
      data: found
        ? { item: { type: "handoff", summary: "Summary of the lesson so far:\nLESSON SUMMARY" } }
        : null,
      error: null,
      isPending: target !== null && !found,
    };
  }) as never,
}));

function setup() {
  turnItemDetail.targets = [];
}

it("fetches what the AI was given only once the divider is expanded", async () => {
  setup();
  await using _screen = await render(
    <SideChatContextDivider
      label="Side chat context"
      environmentId={EnvironmentId.make("environment-local")}
      threadId={THREAD_ID}
      itemId={ITEM_ID}
      revision="2026-10-22T10:00:00.000Z"
    />,
  );

  await expect.element(page.getByText("Side chat context")).toBeVisible();
  await expect.element(page.getByText("LESSON SUMMARY")).not.toBeInTheDocument();
  const show = page.getByRole("button", { name: "Side chat context: show what the AI was given" });
  await expect.element(show).toHaveAttribute("aria-expanded", "false");
  expect(turnItemDetail.targets.every((target) => target === null)).toBe(true);

  await userEvent.click(show);

  await expect.element(page.getByText("LESSON SUMMARY", { exact: false })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Side chat context: hide what the AI was given" }))
    .toHaveAttribute("aria-expanded", "true");
});
