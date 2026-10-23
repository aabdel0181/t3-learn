import {
  SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS,
  SIDE_CHAT_LABEL_MAX_CHARS,
  type OrchestrationV2SideChatAnchor,
} from "@t3tools/contracts";

const LABEL_ELLIPSIS = "…";
const MARKDOWN_MARKER = /[*_`]/;
const WHITESPACE = /\s/;
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The label for a side chat, from its highlighted text. The label schema counts UTF-16 units,
 * so the cut keeps whole graphemes whose lengths total at most `SIDE_CHAT_LABEL_MAX_CHARS - 1`
 * and the ellipsis takes the last unit. An excerpt with no visible characters gives `""`.
 */
export function deriveSideChatLabel(excerpt: string): string {
  const collapsed = excerpt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SIDE_CHAT_LABEL_MAX_CHARS) {
    return collapsed;
  }
  const budget = SIDE_CHAT_LABEL_MAX_CHARS - LABEL_ELLIPSIS.length;
  let used = 0;
  for (const { segment } of graphemeSegmenter.segment(collapsed)) {
    if (used + segment.length > budget) break;
    used += segment.length;
  }
  return `${collapsed.slice(0, used).trimEnd()}${LABEL_ELLIPSIS}`;
}

interface PlainText {
  readonly text: string;
  /** For each character of `text`, where it came from in the raw string. */
  readonly rawOffsets: ReadonlyArray<number>;
}

/** Drops Markdown emphasis and code markers and collapses each whitespace run to one space. */
function projectToPlainText(raw: string): PlainText {
  let text = "";
  const rawOffsets: Array<number> = [];
  let inWhitespace = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (MARKDOWN_MARKER.test(char)) continue;
    if (WHITESPACE.test(char)) {
      if (!inWhitespace) {
        text += " ";
        rawOffsets.push(index);
        inWhitespace = true;
      }
      continue;
    }
    inWhitespace = false;
    text += char;
    rawOffsets.push(index);
  }
  return { text, rawOffsets };
}

/**
 * Anchor offsets count rendered text, not Markdown, so the excerpt is found by its content.
 * The prefix picks between repeats, then the anchor offset does. Returns raw `[start, end)`.
 */
function locateExcerpt(
  messageText: string,
  anchor: Pick<OrchestrationV2SideChatAnchor, "start" | "prefix">,
  excerpt: string,
): { readonly start: number; readonly end: number } {
  const plain = projectToPlainText(messageText);
  const needle = projectToPlainText(excerpt).text.trim();
  const prefix = projectToPlainText(anchor.prefix).text.trim();

  const matches: Array<number> = [];
  if (needle !== "") {
    for (let at = plain.text.indexOf(needle); at !== -1; at = plain.text.indexOf(needle, at + 1)) {
      matches.push(at);
    }
  }
  if (matches.length === 0) {
    const offset = Math.min(anchor.start, messageText.length);
    return { start: offset, end: offset };
  }

  // Whitespace runs are collapsed, so at most one space can sit between the prefix and a match.
  const followsPrefix = (at: number) =>
    plain.text
      .slice(Math.max(0, at - prefix.length - 1), at)
      .trimEnd()
      .endsWith(prefix);
  const byPrefix = prefix === "" ? undefined : matches.find(followsPrefix);
  const chosen =
    byPrefix ??
    matches.reduce((best, at) =>
      Math.abs(at - anchor.start) < Math.abs(best - anchor.start) ? at : best,
    );

  return {
    start: plain.rawOffsets[chosen] ?? chosen,
    end: (plain.rawOffsets[chosen + needle.length - 1] ?? chosen + needle.length - 1) + 1,
  };
}

interface Paragraph {
  readonly start: number;
  readonly end: number;
}

function splitParagraphs(text: string): ReadonlyArray<Paragraph> {
  const paragraphs: Array<Paragraph> = [];
  let start = 0;
  const push = (end: number) => {
    if (text.slice(start, end).trim() !== "") {
      paragraphs.push({ start, end });
    }
  };
  for (const match of text.matchAll(PARAGRAPH_BREAK)) {
    push(match.index);
    start = match.index + match[0].length;
  }
  push(text.length);
  return paragraphs;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** True when a cut before `index` would separate the two halves of a surrogate pair. */
function splitsSurrogatePair(text: string, index: number): boolean {
  return isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index));
}

function isCutInsideWord(text: string, index: number): boolean {
  return !WHITESPACE.test(text.charAt(index - 1)) && !WHITESPACE.test(text.charAt(index));
}

/**
 * A window of at most `SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS` inside `bounds`, centred on the
 * match. A cut that lands inside a word moves to the nearest whitespace that keeps the match;
 * otherwise it stays at the window edge. No cut lands inside a surrogate pair.
 */
function windowAround(
  text: string,
  bounds: Paragraph,
  match: { readonly start: number; readonly end: number },
): string {
  const max = SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS;
  const center = Math.floor((match.start + match.end) / 2);
  let start = Math.min(Math.max(center - Math.floor(max / 2), bounds.start), bounds.end - max);
  let end = start + max;

  if (start > bounds.start && splitsSurrogatePair(text, start)) start += 1;
  if (end < bounds.end && splitsSurrogatePair(text, end)) end -= 1;

  if (start > bounds.start && isCutInsideWord(text, start)) {
    for (let index = start; index < Math.min(match.start, end); index += 1) {
      if (WHITESPACE.test(text.charAt(index))) {
        start = index;
        break;
      }
    }
  }
  if (end < bounds.end && isCutInsideWord(text, end)) {
    for (let index = end - 1; index >= Math.max(match.end, start); index -= 1) {
      if (WHITESPACE.test(text.charAt(index))) {
        end = index;
        break;
      }
    }
  }
  return text.slice(start, end).trim();
}

/**
 * The text around the highlight that a side chat is given as its context: the paragraphs the
 * highlight touches, plus the previous and then the next paragraph while they fit. A highlight
 * span that is already over the limit is windowed around the match instead.
 */
export function extractExcerptContext(
  messageText: string,
  anchor: Pick<OrchestrationV2SideChatAnchor, "start" | "prefix">,
  excerpt: string,
): string {
  const paragraphs = splitParagraphs(messageText);
  if (paragraphs.length === 0) return "";

  const match = locateExcerpt(messageText, anchor, excerpt);
  const lastStart = Math.max(match.end - 1, match.start);
  let first = 0;
  let last = 0;
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.start <= match.start) first = index;
    if (paragraph.start <= lastStart) last = index;
  });
  last = Math.max(first, last);

  const max = SIDE_CHAT_EXCERPT_CONTEXT_MAX_CHARS;
  let from = paragraphs[first]?.start ?? 0;
  let to = paragraphs[last]?.end ?? messageText.length;
  if (to - from > max) {
    return windowAround(messageText, { start: from, end: to }, match);
  }

  const previous = paragraphs[first - 1];
  if (previous !== undefined && to - previous.start <= max) {
    from = previous.start;
  }
  const next = paragraphs[last + 1];
  if (next !== undefined && next.end - from <= max) {
    to = next.end;
  }
  return messageText.slice(from, to).trim();
}
