# Assistant citations

Citations carry the selected excerpt and source identity in ordinary message text.
Drafts, clipboard copies, stashes, and sent messages keep that representation
without a separate citation store. The saved quote remains usable when its source
disappears or changes. The [shared format](../../packages/shared/src/assistantCitations.ts) uses
stable environment IDs without a browser origin, so moving between local, remote,
and tunnel connections does not change a citation's identity.

Source navigation is best effort. [Text selectors](../../apps/web/src/lib/assistantTextSelection.ts)
refer to rendered text after whitespace normalization, measured in UTF-16 units.
They cannot be applied to raw Markdown. The original excerpt keeps its whitespace;
normalization is only for locating it. Repeated text needs an unambiguous context
match, even if one occurrence still sits at the saved offsets. Guessing could
highlight the wrong claim.

Navigation owns the highlight's lifetime across virtual-row remounts. The source
row must be fetched, unfolded, mounted, and measured before quote positioning
takes over from normal timeline scrolling. Remounting must not revive a dismissed
highlight. The [navigation hash](../../apps/web/src/lib/assistantCitationNavigation.ts)
uses base64url because router normalization otherwise decodes whitespace and
source IDs inside the citation URI.

The server expands citations when it builds provider text from a user message, at turn start
and when steering, inside `projectComposerContextForProvider`
([composer context references](./composer-context-references.md#provider-projection)). Each link
becomes an `[assistant-quote-N]` marker, and one `<assistant_citations>` block after the context
envelope carries the saved excerpts as JSON. The source is never looked up, and the user's
comment stays apart from the quoted text. Citations leave the user's prose before context
references are projected: captured context is data and must not turn into a citation, and quoted
text must not resolve a context reference. Persisted messages keep the link form, which is also
what handoff history replays ([context handoffs](./context-handoffs.md)). Input limits apply after
expansion as well as before it: a draft that fits as encoded links can exceed the provider limit
once expanded, so the composer measures both.
