# Silly Searcher — Future Improvements

Living list, ranked most → least game-changing. New ideas get appended with
dates; completed items move to "Done". North star: *I can't lose information
anymore.*

## Game changers

1. **Search across tabs + browsing history.** "Find that thing I was reading
   yesterday about cancellation fees." Same Jev machinery, but the corpus is
   everything you've seen — a memory prosthetic, not a page tool. The feature
   that would make this irreplaceable.
2. **One question across many tabs.** Open 10 docs, ask once, get ranked
   answers per tab with citations. A research superpower; nothing else in the
   browser does this.
3. **Follow-up chat with the page.** After finding the passage, ask "what's
   the catch?" and get an answer grounded in page content. Turns a find tool
   into a reading assistant.
4. **Query suggestions from page content.** The cold-start problem is real
   ("takes time to get used to thinking about what to search"). The page
   knows what's in it — it should propose the questions.

## High-value utilities

5. **Copy/export matches.** Finding is step one; grabbing the text (single
   sentence or all matches) is step two.
6. **Sensitivity control.** Expose the 0.58 relevance threshold as a
   strict/loose setting instead of hardcoded magic.

## Correctness floor

Already shipped: direct no-backend Jev calls, failed-search result restore,
passage splitting (not dropping), SPA invalidation, byte-budget requests,
key verification on save, committed test suite (41 green).

Parked: Firefox/Safari port (needs CSS.highlights fallback), iframe/shadow
DOM search, README troubleshooting table, PDF support ("bring your own text"
needs a web surface first).
