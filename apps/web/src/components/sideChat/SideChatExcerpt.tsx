import { useEffect, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

/** The highlighted passage a side chat was asked about, pinned above its timeline. */
export function SideChatExcerpt(props: { readonly text: string; readonly onReveal: () => void }) {
  const { text } = props;
  // Expansion belongs to one excerpt: a different text starts collapsed instead of inheriting it.
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const expanded = expandedText === text;
  const [overflows, setOverflows] = useState(false);
  const [quote, setQuote] = useState<HTMLElement | null>(null);

  // Only the clamped text can overflow. Once expanded the toggle keeps its last answer, and
  // collapsing observes again.
  useEffect(() => {
    if (!quote || expanded) return;
    return observeResize(quote, () => setOverflows(quote.scrollHeight > quote.clientHeight));
  }, [quote, expanded]);

  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <button
        type="button"
        aria-label="Show this highlight where it was asked"
        className="block w-full min-w-0 cursor-pointer rounded-sm border-border border-l-2 pl-2 text-left text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onReveal}
      >
        {/* A new excerpt remounts the box so it is measured again even when its size is unchanged.
            line-clamp-3 sets its own display (-webkit-box), so `block` is only for the expanded box. */}
        <span
          key={text}
          ref={setQuote}
          className={cn("break-words", expanded ? "block" : "line-clamp-3")}
        >
          {text}
        </span>
      </button>
      {overflows ? (
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpandedText(expanded ? null : text)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
