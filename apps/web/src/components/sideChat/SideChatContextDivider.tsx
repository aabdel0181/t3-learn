import { useState } from "react";

import { TimelineSystemDivider } from "../chat/TimelineSystemDivider";

/** A timeline divider that keeps the text a side chat handed to the AI folded until asked for. */
export function SideChatContextDivider(props: {
  readonly label: string;
  readonly summary: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="min-w-0">
      <TimelineSystemDivider
        label={props.label}
        actionLabel={expanded ? "Hide" : "Show what the AI was given"}
        actionExpanded={expanded}
        onAction={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <div className="whitespace-pre-wrap break-words pb-2 text-muted-foreground text-xs">
          {props.summary}
        </div>
      ) : null}
    </div>
  );
}
