import type { SideChatTreeRow } from "@t3tools/client-runtime/state/thread-relationships";
import type { ThreadId } from "@t3tools/contracts";

export interface SideChatTreeLayoutOptions {
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly gapX: number;
  readonly gapY: number;
}

export interface SideChatTreeLayoutNode {
  readonly threadId: ThreadId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SideChatTreeLayoutEdge {
  readonly from: ThreadId;
  readonly to: ThreadId;
  readonly path: string;
}

export interface SideChatTreeLayout {
  readonly nodes: Array<SideChatTreeLayoutNode>;
  readonly edges: Array<SideChatTreeLayoutEdge>;
  readonly width: number;
  readonly height: number;
}

interface PlacedRow {
  readonly row: SideChatTreeRow;
  parent: PlacedRow | null;
  firstChild: PlacedRow | null;
  lastChild: PlacedRow | null;
  x: number;
}

/**
 * Lays the side-chat tree out as a tidy tree: leaves take consecutive columns,
 * a parent centres between its first and last child, and each depth is a row.
 * `rows` come root first in preorder, so walking them backwards visits every
 * child before its parent. A row whose parent is not in `rows` is a root.
 */
export function layoutSideChatTree(
  rows: ReadonlyArray<SideChatTreeRow>,
  opts: SideChatTreeLayoutOptions,
): SideChatTreeLayout {
  const placed = rows.map((row): PlacedRow => ({
    row,
    parent: null,
    firstChild: null,
    lastChild: null,
    x: 0,
  }));
  const placedById = new Map(placed.map((entry) => [entry.row.threadId, entry]));
  for (const entry of placed) {
    const parent = entry.row.parentId === null ? undefined : placedById.get(entry.row.parentId);
    if (parent === undefined) continue;
    entry.parent = parent;
    parent.firstChild ??= entry;
    parent.lastChild = entry;
  }

  const columnWidth = opts.nodeWidth + opts.gapX;
  let nextColumn = 0;
  for (const entry of placed) {
    if (entry.firstChild === null) entry.x = nextColumn++ * columnWidth;
  }
  for (const entry of placed.toReversed()) {
    if (entry.firstChild !== null && entry.lastChild !== null) {
      entry.x = (entry.firstChild.x + entry.lastChild.x) / 2;
    }
  }

  const rowHeight = opts.nodeHeight + opts.gapY;
  const yOf = (entry: PlacedRow) => entry.row.depth * rowHeight;
  const edges: Array<SideChatTreeLayoutEdge> = [];
  for (const entry of placed) {
    if (entry.parent === null) continue;
    const x1 = entry.parent.x + opts.nodeWidth / 2;
    const y1 = yOf(entry.parent) + opts.nodeHeight;
    const x2 = entry.x + opts.nodeWidth / 2;
    const y2 = yOf(entry);
    const mid = (y1 + y2) / 2;
    edges.push({
      from: entry.parent.row.threadId,
      to: entry.row.threadId,
      path: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
    });
  }

  return {
    nodes: placed.map((entry) => ({
      threadId: entry.row.threadId,
      x: entry.x,
      y: yOf(entry),
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    })),
    edges,
    width: placed.reduce((max, entry) => Math.max(max, entry.x + opts.nodeWidth), 0),
    height: placed.reduce((max, entry) => Math.max(max, yOf(entry) + opts.nodeHeight), 0),
  };
}
