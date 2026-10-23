import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { SideChatContextDivider } from "./SideChatContextDivider";

it("collapses side-chat context until asked and shows what the AI was given", async () => {
  await using _screen = await render(
    <SideChatContextDivider
      label="Side chat context"
      summary={"Summary of the lesson so far:\nLESSON SUMMARY"}
    />,
  );

  await expect.element(page.getByText("Side chat context")).toBeVisible();
  await expect.element(page.getByText("LESSON SUMMARY")).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Show what the AI was given" }))
    .toHaveAttribute("aria-expanded", "false");

  await userEvent.click(page.getByRole("button", { name: "Show what the AI was given" }));

  await expect.element(page.getByText("LESSON SUMMARY", { exact: false })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Hide" }))
    .toHaveAttribute("aria-expanded", "true");
});
