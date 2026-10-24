/** A selection toolbar that can ask about its current selection in a side chat. */
export interface SideChatSelectionOwner {
  readonly contains: (node: Node) => boolean;
  readonly ask: () => boolean;
}

const owners: SideChatSelectionOwner[] = [];

export function registerSideChatSelectionOwner(owner: SideChatSelectionOwner): () => void {
  owners.push(owner);
  return () => {
    const index = owners.lastIndexOf(owner);
    if (index !== -1) owners.splice(index, 1);
  };
}

/** Returns false when no toolbar owns the selection, so the key event goes through. */
export function askSelectionInSideChat(selection: Pick<Selection, "anchorNode"> | null): boolean {
  const anchor = selection?.anchorNode;
  if (!anchor) return false;
  return owners.findLast((owner) => owner.contains(anchor))?.ask() ?? false;
}
