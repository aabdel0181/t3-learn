import { assert, it } from "@effect/vitest";
import { SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS, SIDE_CHAT_LABEL_MAX_CHARS } from "@t3tools/contracts";

import { deriveSideChatLabel, extractExcerptContext } from "./sideChatText.ts";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Long enough that two of these can never share one 1500-character context.
const filler = "lorem ".repeat(140).trim();

it("collapses whitespace and caps the label", () => {
  assert.strictEqual(deriveSideChatLabel("  observation\n  space "), "observation space");

  const label = deriveSideChatLabel("word ".repeat(40));
  assert.isAtMost(label.length, SIDE_CHAT_LABEL_MAX_CHARS);
  assert.isTrue(label.endsWith("…"));
});

it("returns the highlighted paragraph with its neighbours when they fit", () => {
  const text =
    "A short opening paragraph that sets the scene, quickly.\n\nThe observation space is a Box.\n\nA closing paragraph.";
  const start = text.indexOf("observation space");
  assert.strictEqual(start, 61);

  assert.strictEqual(extractExcerptContext(text, { start, prefix: "" }, "observation space"), text);
});

it("adds the previous paragraph before the next one and stops at the limit", () => {
  const before = "a".repeat(1000);
  const highlighted = "The observation space is a Box.";
  const after = "c".repeat(1000);
  const text = `${before}\n\n${highlighted}\n\n${after}`;

  assert.strictEqual(
    extractExcerptContext(
      text,
      { start: text.indexOf("observation space"), prefix: "" },
      "observation space",
    ),
    `${before}\n\n${highlighted}`,
  );
});

it("uses the selection prefix to pick between repeated text", () => {
  const first = `At first, the reward is sparse. ${filler}`;
  const second = `Later, the reward is dense. ${filler}`;
  const third = `Finally, nothing else matters. ${filler}`;
  const text = `${first}\n\n${second}\n\n${third}`;
  // The anchor sits inside the first paragraph, so only the prefix can choose the second.
  const start = text.indexOf("reward");

  assert.strictEqual(extractExcerptContext(text, { start, prefix: "" }, "reward"), first);
  assert.strictEqual(
    extractExcerptContext(text, { start, prefix: "Later, the " }, "reward"),
    second,
  );
});

it("finds an excerpt the reply wrote with Markdown emphasis", () => {
  const first = `An opening paragraph. ${filler}`;
  // The markers sit inside the excerpt, so the raw text never contains it verbatim.
  const second = `The agent reads the **observation** _space_ each step. ${filler}`;
  const third = `A closing paragraph. ${filler}`;
  const text = `${first}\n\n${second}\n\n${third}`;
  assert.isFalse(text.includes("observation space"));

  // The anchor sits in the first paragraph, so only matching the rendered text can reach the
  // second one.
  assert.strictEqual(
    extractExcerptContext(text, { start: 0, prefix: "" }, "observation space"),
    second,
  );
});

it("windows a long paragraph around the excerpt", () => {
  const text = `${"word ".repeat(600)}MARKER${" word".repeat(600)}`;

  const context = extractExcerptContext(
    text,
    { start: text.indexOf("MARKER"), prefix: "" },
    "MARKER",
  );

  assert.isAtMost(context.length, SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS);
  assert.include(context, "MARKER");
  // The window is cut at whitespace rather than inside a word.
  assert.isTrue(context.startsWith("word"));
  assert.isTrue(context.endsWith("word"));
});

it("falls back to the anchor offset when the excerpt is not in the text", () => {
  assert.strictEqual(
    extractExcerptContext("z".repeat(5000), { start: 2500, prefix: "" }, "nowhere").length,
    SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS,
  );

  const text = `${"z".repeat(4000)}Q${"z".repeat(999)}`;
  assert.include(extractExcerptContext(text, { start: 4000, prefix: "" }, "nowhere"), "Q");
});

it("never splits an emoji when truncating labels or context", () => {
  const label = deriveSideChatLabel("🚀".repeat(100));
  assert.isFalse(LONE_SURROGATE.test(label));
  assert.isAtMost(label.length, SIDE_CHAT_LABEL_MAX_CHARS);

  // A joined emoji is 11 UTF-16 units and one grapheme, so only whole ones fit in the 119 units.
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
  assert.strictEqual(deriveSideChatLabel(family.repeat(30)), `${family.repeat(10)}…`);

  const text = "🚀".repeat(1200);
  const context = extractExcerptContext(text, { start: 1201, prefix: "" }, "nowhere");
  assert.isFalse(LONE_SURROGATE.test(context));
  assert.isAtMost(context.length, SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS);
});
