import { arrayElementsEqual } from "@t3tools/client-runtime/state/entities";
import type { MessageId, ThreadId } from "@t3tools/contracts";
import { MessageCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { resolveAssistantAnchorRange } from "../../lib/assistantTextSelection";
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
    top: number;
    left: number;
  }>;
  readonly unresolved: ReadonlyArray<SideChatMark>;
}

type SideChatMarkTag = SideChatMarksLayout["tags"][number];

const NO_TAGS: SideChatMarksLayout["tags"] = [];
const NO_MARKS: ReadonlyArray<SideChatMark> = [];

/**
 * Paints `marks` in `source` and reports where each tag goes, relative to `layer`.
 * Shiki, math and mermaid rewrite the reply after it mounts, and opening a panel
 * reflows it, so either repaints, at most once a frame.
 */
function observeSideChatMarks(input: {
  readonly layer: HTMLElement;
  readonly source: HTMLElement;
  readonly marks: ReadonlyArray<SideChatMark>;
  readonly onLayout: (layout: SideChatMarksLayout) => void;
}): () => void {
  const { layer, source, marks, onLayout } = input;
  const highlight = acquireNamedHighlight(SIDE_CHAT_MARK_HIGHLIGHT_NAME);
  let painted: Range[] = [];
  let frame: number | null = null;
  const clear = () => {
    for (const range of painted) highlight.remove(range);
    painted = [];
  };
  const paint = () => {
    frame = null;
    clear();
    const origin = layer.getBoundingClientRect();
    const tags: SideChatMarkTag[] = [];
    const unresolved: SideChatMark[] = [];
    for (const mark of marks) {
      const range = resolveAssistantAnchorRange(source, mark.anchor);
      if (range === null) {
        unresolved.push(mark);
        continue;
      }
      highlight.add(range);
      painted.push(range);
      const rects = range.getClientRects();
      const end = rects.item(rects.length - 1);
      if (end === null) continue;
      tags.push({
        threadId: mark.threadId,
        label: mark.label,
        state: mark.state,
        top: end.top - origin.top,
        left: end.right - origin.left,
      });
    }
    onLayout({ tags, unresolved });
  };
  const schedule = () => {
    frame ??= requestAnimationFrame(paint);
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(source, { childList: true, subtree: true, characterData: true });
  const stopObservingResize = observeResize(layer, schedule);
  paint();
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
        tag.top === other.top &&
        tag.left === other.left
      );
    })
  );
}

/**
 * The tags of an assistant row's side chats, over the row's `relative` wrapper.
 * The layer sits outside the reply's text, so tags never enter find, copy or a
 * selection. Marks it cannot find in the reply go to `onUnresolvedChange`.
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
      {tags.map((tag) => (
        <Tooltip key={tag.threadId}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Open side chat “${tag.label}”`}
                className={cn(
                  "pointer-events-auto absolute flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  tag.state === "open" ? "border-primary text-primary" : "text-muted-foreground",
                )}
                style={{ top: tag.top, left: tag.left }}
                onClick={() => onOpen(tag.threadId)}
              />
            }
          >
            <MessageCircleIcon className="size-2.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{tag.label}</TooltipPopup>
        </Tooltip>
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
