import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { MessageId, ThreadId } from "@t3tools/contracts";
import { MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveAssistantAnchorRanges } from "../../lib/assistantTextSelection";
import { acquireNamedHighlight } from "../../lib/namedHighlight";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import type { SideChatMark } from "../../state/entities";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SIDE_CHAT_MARK_HIGHLIGHT_NAME = "t3-side-chat-mark";

export interface SideChatMarksLayout {
  readonly tags: ReadonlyArray<{
    threadId: ThreadId;
    label: string;
    state: "open" | "done";
    /** The middle of the mark's last line, where its tag sits in the row's right gutter. */
    top: number;
  }>;
  readonly unresolved: ReadonlyArray<SideChatMark>;
}

type SideChatMarkTag = SideChatMarksLayout["tags"][number];

const NO_TAGS: SideChatMarksLayout["tags"] = [];
const NO_MARKS: ReadonlyArray<SideChatMark> = [];

/**
 * Paints `marks` in `source` and reports where each tag goes, relative to `layer`.
 * Shiki, math and mermaid rewrite the reply after it mounts, which paints the marks
 * again. Opening a panel only reflows it: the painted ranges are live, so only the
 * tags move. Either happens at most once a frame.
 */
function observeSideChatMarks(input: {
  readonly layer: HTMLElement;
  readonly source: HTMLElement;
  readonly marks: ReadonlyArray<SideChatMark>;
  readonly onLayout: (layout: SideChatMarksLayout) => void;
}): () => void {
  const { layer, source, marks, onLayout } = input;
  const highlight = acquireNamedHighlight(SIDE_CHAT_MARK_HIGHLIGHT_NAME);
  let painted: Array<{ readonly mark: SideChatMark; readonly range: Range }> = [];
  let unresolved: SideChatMark[] = [];
  let stale = true;
  let frame: number | null = null;
  const clear = () => {
    for (const { range } of painted) highlight.remove(range);
    painted = [];
  };
  const paint = () => {
    clear();
    unresolved = [];
    const ranges = resolveAssistantAnchorRanges(
      source,
      marks.map((mark) => mark.anchor),
    );
    marks.forEach((mark, index) => {
      const range = ranges[index] ?? null;
      if (range === null) {
        unresolved.push(mark);
        return;
      }
      highlight.add(range);
      painted.push({ mark, range });
    });
  };
  const layout = () => {
    frame = null;
    if (stale) {
      stale = false;
      paint();
    }
    const origin = layer.getBoundingClientRect();
    const tags: SideChatMarkTag[] = [];
    for (const { mark, range } of painted) {
      const rects = range.getClientRects();
      const end = rects.item(rects.length - 1);
      if (end === null) continue;
      tags.push({
        threadId: mark.threadId,
        label: mark.label,
        state: mark.state,
        top: end.top + end.height / 2 - origin.top,
      });
    }
    onLayout({ tags, unresolved });
  };
  const schedule = () => {
    frame ??= requestAnimationFrame(layout);
  };
  const mutations = new MutationObserver(() => {
    stale = true;
    schedule();
  });
  // Hidden text is left out of the reply's text, so hiding or showing some resolves again.
  mutations.observe(source, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ["hidden", "aria-hidden"],
  });
  const stopObservingResize = observeResize(layer, schedule);
  layout();
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    mutations.disconnect();
    stopObservingResize();
    clear();
  };
}

function sideChatMarkTagsEqual(
  left: SideChatMarksLayout["tags"],
  right: SideChatMarksLayout["tags"],
): boolean {
  return (
    left.length === right.length &&
    left.every((tag, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        tag.threadId === other.threadId &&
        tag.label === other.label &&
        tag.state === other.state &&
        tag.top === other.top
      );
    })
  );
}

/** Matches the tag's `size-4`. */
const TAG_SIZE_PX = 16;

interface GutterSlot {
  readonly key: ThreadId;
  readonly top: number;
  readonly tags: SideChatMarkTag[];
}

/** Tags that would overlap, because their marks end on the same line, share one slot. */
function gutterSlots(tags: SideChatMarksLayout["tags"]): GutterSlot[] {
  const slots: GutterSlot[] = [];
  for (const tag of tags.toSorted((left, right) => left.top - right.top)) {
    const slot = slots.at(-1);
    if (slot !== undefined && tag.top - slot.top < TAG_SIZE_PX) slot.tags.push(tag);
    else slots.push({ key: tag.threadId, top: tag.top, tags: [tag] });
  }
  return slots;
}

function SideChatTagSlot(props: {
  readonly slot: GutterSlot;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const { slot, onOpen } = props;
  const [only, ...others] = slot.tags;
  const className = cn(
    "pointer-events-auto absolute right-0.5 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    slot.tags.some((tag) => tag.state === "open")
      ? "border-primary text-primary"
      : "text-muted-foreground",
  );
  if (only !== undefined && others.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Open side chat “${only.label}”`}
              className={className}
              style={{ top: slot.top }}
              onClick={() => onOpen(only.threadId)}
            />
          }
        >
          <MessageCircleIcon className="size-2.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">{only.label}</TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Open one of ${slot.tags.length} side chats`}
            className={className}
            style={{ top: slot.top }}
          />
        }
      >
        <MessageCircleIcon className="size-2.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {slot.tags.map((tag) => (
          <MenuItem key={tag.threadId} onClick={() => onOpen(tag.threadId)}>
            {tag.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The tags of an assistant row's side chats, over the row's `relative` wrapper.
 * The layer sits outside the reply's text, so tags never enter find, copy or a
 * selection. Each tag sits in the gutter the row reserves on its right, level with
 * the line where its mark ends. Marks it cannot find in the reply go to
 * `onUnresolvedChange`.
 */
export function SideChatMarks(props: {
  readonly messageId: MessageId;
  readonly marks: ReadonlyArray<SideChatMark>;
  readonly onOpen: (threadId: ThreadId) => void;
  readonly onUnresolvedChange: (marks: ReadonlyArray<SideChatMark>) => void;
}): React.ReactElement {
  const { messageId, marks, onOpen, onUnresolvedChange } = props;
  const layerRef = useRef<HTMLDivElement>(null);
  const [tags, setTags] = useState(NO_TAGS);

  useEffect(() => {
    const layer = layerRef.current;
    const source = layer?.parentElement?.querySelector<HTMLElement>(
      `[data-assistant-citation-source="${CSS.escape(messageId)}"]`,
    );
    if (!layer || !source) return;
    let reported = NO_MARKS;
    const stop = observeSideChatMarks({
      layer,
      source,
      marks,
      onLayout: (layout) => {
        setTags((current) => (sideChatMarkTagsEqual(current, layout.tags) ? current : layout.tags));
        if (arrayElementsEqual(reported, layout.unresolved)) return;
        reported = layout.unresolved;
        onUnresolvedChange(reported);
      },
    });
    return () => {
      stop();
      if (reported.length > 0) onUnresolvedChange(NO_MARKS);
    };
  }, [marks, messageId, onUnresolvedChange]);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 select-none">
      {gutterSlots(tags).map((slot) => (
        <SideChatTagSlot key={slot.key} slot={slot} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** The way into side chats whose highlighted text is no longer in the reply. */
export function SideChatMarksChip(props: {
  readonly marks: ReadonlyArray<SideChatMark>;
  readonly onOpen: (threadId: ThreadId) => void;
}) {
  const { marks, onOpen } = props;
  const [first, ...others] = marks;
  if (first === undefined) return null;
  const label = `↳ ${marks.length} side chat${marks.length === 1 ? "" : "s"}`;
  if (others.length === 0) {
    return (
      <Button size="micro" variant="ghost-muted" onClick={() => onOpen(first.threadId)}>
        {label}
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button size="micro" variant="ghost-muted" />}>{label}</MenuTrigger>
      <MenuPopup align="start">
        {marks.map((mark) => (
          <MenuItem key={mark.threadId} onClick={() => onOpen(mark.threadId)}>
            {mark.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
