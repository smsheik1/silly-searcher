# Silly Searcher

Semantic find-in-page for Chrome. Press a shortcut, describe what you're looking for in plain words, and it highlights the passages that actually mean it — even when the words don't match.

No backend. The extension calls TypeSafe's Jev model directly from your browser using your own API key.

## Install

1. Download `silly-searcher.zip` from the releases (or clone this repo).
2. Unzip it.
3. Open `chrome://extensions`, enable **Developer mode**.
4. **Load unpacked** → select the unzipped `silly-searcher` folder.
5. The options page opens on first install. Paste your TypeSafe API key, hit **Save & verify key**.

## Use

- Press **Cmd+Shift+F** (Mac) or **Ctrl+Shift+F** (Linux/Windows), or click the Silly Searcher icon.
- Type what you mean — "where does it mention refunds after cancellation?" — and hit Enter.
- Matches highlight on the page; `↑` `↓` jumps between them. Bright highlight is the key sentence, pale is the surrounding passage.

## How it works

1. The content script extracts up to 160 readable passages (paragraphs, list items, headings, table cells — nav/header/footer/sidebars excluded), capped at 60,000 characters. Passages over 2200 characters are split at sentence boundaries instead of dropped.
2. Each passage gets an independent yes/no relevance judgment (`noul`) from Jev, plus a strongest-sentence pick for passages with 2+ sentences.
3. Results are ranked by relevance probability; anything under 0.58 is dropped. Highlights map back to exact DOM ranges.

## Tests

The search logic lives in `lib/search.mjs` — pure functions with no `chrome.*` or DOM dependencies, so they run in plain node. `background.js` is a thin MV3 wrapper around it.

```
node --test tests/*.test.mjs
```

`tests/search.test.mjs` covers validation boundaries, payload shape, answer parsing, the 60k byte budget (including CJK worst cases), and mocked end-to-end searches. `tests/split.test.mjs` extracts the passage splitter from the shipped `content.js` and tests it. `tests/package.test.mjs` checks the manifest and file references.

## What gets sent where

Each search sends the page's readable passages and your query to `https://api.typesafe.ai/v1/systemone`. Nothing else leaves the browser — no URL, no title, no cookies. Your API key lives in `chrome.storage.local`, locked to trusted extension contexts — stored unencrypted, like most extension settings. Content inside iframes and shadow DOM is not searched.

To minimize cost: identical searches are cached and never re-billed, concurrent duplicate searches share one call, and malformed requests are rejected before any network call.

## Credits

Built from [Needle](https://github.com/Shubhamsaboo/awesome-llm-apps/tree/main/advanced_llm_apps/needle) by Shubham Saboo (Apache-2.0) — the extraction, search dock, and highlight machinery are his. The direct TypeSafe calling pattern and safety discipline borrow from [Unclutter](https://github.com/kitze/unclutter) (MIT) and [dingdinglz/semantic-find-userscript](https://github.com/dingdinglz/semantic-find-userscript) (sentence-boundary splitting, endpoint allowlisting).

## License

Apache-2.0 — see [LICENSE](LICENSE). This is a derivative of Needle; the original copyright notices are retained above and in the source headers.
