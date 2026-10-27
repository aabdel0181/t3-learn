import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useState } from "react";

import { type TurnItemDetailSource, useTurnItemDetail } from "../../state/queries";
import { TimelineSystemDivider } from "../chat/TimelineSystemDivider";

/**
 * A timeline divider that keeps the text a side chat handed to the AI folded until asked for.
 * Live events never carry that text, so it is fetched on expand.
 */
export function SideChatContextDivider(props: {
  readonly label: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly revision: string;
  /** Unset, the detail is read from the environment; the guest page reads it through its own route. */
  readonly source?: TurnItemDetailSource | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = useTurnItemDetail(
    expanded
      ? {
          environmentId: props.environmentId,
          threadId: props.threadId,
          itemId: props.itemId,
          revision: props.revision,
        }
      : null,
    props.source,
  );
  const item = detail.data?.item;
  const summary = item?.type === "handoff" ? item.summary : undefined;

  return (
    <div className="min-w-0">
      <TimelineSystemDivider
        label={props.label}
        actionLabel={`${props.label}: ${expanded ? "hide" : "show"} what the AI was given`}
        actionExpanded={expanded}
        onAction={() => setExpanded(!expanded)}
      />
      {expanded ? (
        <div className="whitespace-pre-wrap break-words pb-2 text-muted-foreground text-xs">
          {summary ??
            (detail.error !== null
              ? `Couldn't load what the AI was given: ${detail.error}`
              : detail.data !== null
                ? "No longer available."
                : "Loading…")}
        </div>
      ) : null}
    </div>
  );
}
