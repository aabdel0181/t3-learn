import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { SideChatExcerpt } from "./SideChatExcerpt";

const LONG_EXCERPT = "The agent reads its observation space every step. ".repeat(20);

function excerpt(text: string) {
  return (
    <div className="w-64">
      <SideChatExcerpt text={text} onReveal={() => {}} />
    </div>
  );
}

const quote = () => page.getByRole("button", { name: "Show this highlight where it was asked" });

function renderedLines(element: Element) {
  return Math.round(
    element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
  );
}

it("clamps a long excerpt to three lines until expanded", async () => {
  await using _screen = await render(excerpt(LONG_EXCERPT));

  const showMore = page.getByRole("button", { name: "Show more" });
  await expect.element(showMore).toHaveAttribute("aria-expanded", "false");
  expect(renderedLines(quote().element())).toBe(3);

  await userEvent.click(showMore);

  await expect
    .element(page.getByRole("button", { name: "Show less" }))
    .toHaveAttribute("aria-expanded", "true");
  expect(renderedLines(quote().element())).toBeGreaterThan(3);
});

it("starts a new excerpt collapsed and measured again after one was expanded", async () => {
  await using screen = await render(excerpt(LONG_EXCERPT));
  await userEvent.click(page.getByRole("button", { name: "Show more" }));
  await expect.element(page.getByRole("button", { name: "Show less" })).toBeInTheDocument();

  await screen.rerender(excerpt(`${LONG_EXCERPT}And it is a different highlight.`));

  await expect
    .element(page.getByRole("button", { name: "Show more" }))
    .toHaveAttribute("aria-expanded", "false");
  await vi.waitFor(() => expect(renderedLines(quote().element())).toBe(3));

  await screen.rerender(excerpt("observation space"));

  await expect.element(quote()).toHaveTextContent("observation space");
  await expect.element(page.getByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Show less" })).not.toBeInTheDocument();
});

it("drops the toggle when an expanded excerpt is replaced by a short one", async () => {
  await using screen = await render(excerpt(LONG_EXCERPT));
  await userEvent.click(page.getByRole("button", { name: "Show more" }));
  await expect.element(page.getByRole("button", { name: "Show less" })).toBeInTheDocument();

  await screen.rerender(excerpt("observation space"));

  await expect.element(quote()).toHaveTextContent("observation space");
  await expect.element(page.getByRole("button", { name: "Show less" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Show more" })).not.toBeInTheDocument();
});

it("offers no toggle for a short excerpt", async () => {
  await using _screen = await render(excerpt("observation space"));

  await expect.element(quote()).toHaveTextContent("observation space");
  await expect.element(page.getByRole("button", { name: "Show more" })).not.toBeInTheDocument();
});
