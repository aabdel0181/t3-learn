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
  y: number;
}

/**
 * Lays the side-chat tree out as a tidy tree that grows left to right: each
 * depth is a column, leaves take consecutive rows, and a parent centres between
 * its first and last child. A busy lesson has many leaves but rarely more than
 * a few levels, so the tree grows down, where the panel scrolls, not wide.
 * `rows` come root first in preorder, so walking them backwards visits every
 * child before its parent. A row whose parent is not in `rows` gets no edge but
 * keeps its depth.
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
    y: 0,
  }));
  const placedById = new Map(placed.map((entry) => [entry.row.threadId, entry]));
  for (const entry of placed) {
    const parent = entry.row.parentId === null ? undefined : placedById.get(entry.row.parentId);
    if (parent === undefined) continue;
    entry.parent = parent;
    parent.firstChild ??= entry;
    parent.lastChild = entry;
  }

  const rowHeight = opts.nodeHeight + opts.gapY;
  let nextRow = 0;
  for (const entry of placed) {
    if (entry.firstChild === null) entry.y = nextRow++ * rowHeight;
  }
  for (const entry of placed.toReversed()) {
    if (entry.firstChild !== null && entry.lastChild !== null) {
      entry.y = (entry.firstChild.y + entry.lastChild.y) / 2;
    }
  }

  const columnWidth = opts.nodeWidth + opts.gapX;
  const xOf = (entry: PlacedRow) => entry.row.depth * columnWidth;
  const edges: Array<SideChatTreeLayoutEdge> = [];
  for (const entry of placed) {
    if (entry.parent === null) continue;
    const x1 = xOf(entry.parent) + opts.nodeWidth;
    const y1 = entry.parent.y + opts.nodeHeight / 2;
    const x2 = xOf(entry);
    const y2 = entry.y + opts.nodeHeight / 2;
    const mid = (x1 + x2) / 2;
    edges.push({
      from: entry.parent.row.threadId,
      to: entry.row.threadId,
      path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
    });
  }

  return {
    nodes: placed.map((entry) => ({
      threadId: entry.row.threadId,
      x: xOf(entry),
      y: entry.y,
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    })),
    edges,
    width: placed.reduce((max, entry) => Math.max(max, xOf(entry) + opts.nodeWidth), 0),
    height: placed.reduce((max, entry) => Math.max(max, entry.y + opts.nodeHeight), 0),
  };
}
