import { describe, expect, it, vi } from "vite-plus/test";

import {
  askSelectionInSideChat,
  registerSideChatSelectionOwner,
} from "./sideChatSelectionRegistry";

describe("side-chat selection registry", () => {
  it("asks the toolbar whose viewport holds the selection and lets the key through otherwise", () => {
    const lessonText = {} as Node;
    const panelText = {} as Node;
    const askLesson = vi.fn(() => true);
    const askPanel = vi.fn(() => true);
    const disposeLesson = registerSideChatSelectionOwner({
      contains: (node) => node === lessonText,
      ask: askLesson,
    });
    const disposePanel = registerSideChatSelectionOwner({
      contains: (node) => node === panelText,
      ask: askPanel,
    });

    expect(askSelectionInSideChat({ anchorNode: panelText })).toBe(true);
    expect(askPanel).toHaveBeenCalledTimes(1);
    expect(askLesson).not.toHaveBeenCalled();

    expect(askSelectionInSideChat({ anchorNode: {} as Node })).toBe(false);
    expect(askSelectionInSideChat({ anchorNode: null })).toBe(false);
    expect(askSelectionInSideChat(null)).toBe(false);

    disposePanel();
    disposeLesson();
    expect(askSelectionInSideChat({ anchorNode: panelText })).toBe(false);
    expect(askPanel).toHaveBeenCalledTimes(1);
  });
});
