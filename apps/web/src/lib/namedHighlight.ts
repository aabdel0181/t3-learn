/**
 * Ranges added to the CSS highlight registered as `name`, which several owners
 * share. The registry entry is made by the first range and goes with the last.
 */
export function acquireNamedHighlight(name: string): {
  readonly add: (range: Range) => void;
  readonly remove: (range: Range) => void;
} {
  const registry =
    typeof CSS !== "undefined" && typeof Highlight !== "undefined" ? CSS.highlights : undefined;
  return {
    add: (range) => {
      if (!registry) return;
      const highlight = registry.get(name);
      if (highlight) highlight.add(range);
      else registry.set(name, new Highlight(range));
    },
    remove: (range) => {
      const highlight = registry?.get(name);
      if (!highlight?.delete(range)) return;
      if (highlight.size === 0) registry?.delete(name);
    },
  };
}
