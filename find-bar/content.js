(() => {
	const MAX_MATCHES = 2000;
	const SKIP_TAGS = new Set([
		"SCRIPT",
		"STYLE",
		"NOSCRIPT",
		"TEMPLATE",
		"TEXTAREA",
		"INPUT",
		"SELECT",
	]);
	const IS_MAC = /Mac/.test(navigator.platform);

	let host = null;
	let input = null;
	let countEl = null;
	let matches = [];
	let current = -1;
	let debounceTimer = null;

	// Registered at document_start in the capture phase so we see the shortcut
	// before the page's own handlers do.
	window.addEventListener(
		"keydown",
		(e) => {
			const mod = IS_MAC ? e.metaKey : e.ctrlKey;
			if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
				e.preventDefault();
				e.stopImmediatePropagation();
				open();
			}
		},
		true,
	);

	// ---------- UI ----------

	function build() {
		host = document.createElement("div");
		const root = host.attachShadow({ mode: "closed" });

		const sheet = new CSSStyleSheet();
		sheet.replaceSync(`
      :host { all: initial; }
      .bar {
        position: fixed; top: 12px; right: 16px; z-index: 2147483647;
        display: flex; align-items: center; gap: 4px;
        padding: 6px 6px 6px 12px;
        font: 13px system-ui, -apple-system, sans-serif;
        color: #18181b; background: #fff;
        border: 1px solid #d4d4d8; border-radius: 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,.18);
      }
      input {
        width: 220px; border: none; outline: none; background: transparent;
        font: inherit; color: inherit;
      }
      .count { min-width: 56px; text-align: right; color: #71717a; font-variant-numeric: tabular-nums; }
      button {
        all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px;
        display: grid; place-items: center; color: #52525b;
      }
      button:hover { background: #f4f4f5; }
      @media (prefers-color-scheme: dark) {
        .bar { color: #f4f4f5; background: #27272a; border-color: #3f3f46; }
        .count, button { color: #a1a1aa; }
        button:hover { background: #3f3f46; }
      }
    `);
		root.adoptedStyleSheets = [sheet];

		const bar = el("div", "bar");
		input = el("input");
		input.type = "text";
		input.placeholder = "Find on page";
		input.spellcheck = false;
		countEl = el("span", "count");

		bar.append(
			input,
			countEl,
			button("↑", "Previous (Shift+Enter)", () => step(-1)),
			button("↓", "Next (Enter)", () => step(1)),
			button("✕", "Close (Esc)", close),
		);
		root.append(bar);

		input.addEventListener("input", () => {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => search(input.value), 150);
		});

		input.addEventListener("keydown", (e) => {
			// Keep keystrokes from triggering the page's own shortcuts.
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				flushPendingSearch();
				step(e.shiftKey ? -1 : 1);
			} else if (e.key === "Escape") {
				e.preventDefault();
				close();
			}
		});
		input.addEventListener("keyup", (e) => e.stopPropagation());
		input.addEventListener("keypress", (e) => e.stopPropagation());
	}

	function el(tag, className) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		return node;
	}

	function button(label, title, onClick) {
		const b = el("button");
		b.textContent = label;
		b.title = title;
		b.addEventListener("click", onClick);
		return b;
	}

	function open() {
		if (!host) build();
		if (!host.isConnected) document.documentElement.append(host);

		// Like the native find bar: seed with the current selection if there is one.
		const selected = window.getSelection()?.toString().trim();
		if (selected && selected.length < 200 && !selected.includes("\n")) {
			input.value = selected;
		}

		input.focus();
		input.select();
		search(input.value);
	}

	function close() {
		clearTimeout(debounceTimer);
		// Leave the current match selected, the way the native find bar does.
		const range = matches[current];
		clearHighlights();
		host?.remove();
		if (range) {
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
		matches = [];
		current = -1;
	}

	// ---------- Search ----------

	function flushPendingSearch() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
			search(input.value);
		}
	}

	function search(query) {
		debounceTimer = null;
		clearHighlights();
		matches = [];
		current = -1;

		if (!query || !document.body) {
			updateCount();
			return;
		}

		const needle = query.toLowerCase();
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node) {
					const parent = node.parentElement;
					if (!parent || SKIP_TAGS.has(parent.tagName))
						return NodeFilter.FILTER_REJECT;
					if (!node.data.trim()) return NodeFilter.FILTER_REJECT;
					if (!parent.checkVisibility()) return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				},
			},
		);

		// Note: only finds matches within a single text node, so a phrase split
		// across elements (e.g. "foo <b>bar</b>") won't match.
		for (
			let node = walker.nextNode();
			node && matches.length < MAX_MATCHES;
			node = walker.nextNode()
		) {
			const haystack = node.data.toLowerCase();
			let i = haystack.indexOf(needle);
			while (i !== -1 && matches.length < MAX_MATCHES) {
				const range = new Range();
				range.setStart(node, Math.min(i, node.length));
				range.setEnd(node, Math.min(i + needle.length, node.length));
				matches.push(range);
				i = haystack.indexOf(needle, i + needle.length);
			}
		}

		if (matches.length === 0) {
			updateCount();
			return;
		}

		CSS.highlights.set("find-bar-all", new Highlight(...matches));

		// Start at the first match that's at or below the top of the viewport.
		const firstVisible = matches.findIndex(
			(r) => r.getBoundingClientRect().top >= 0,
		);
		goTo(firstVisible === -1 ? 0 : firstVisible);
	}

	function step(delta) {
		if (matches.length === 0) return;
		goTo(current + delta);
	}

	function goTo(index) {
		const n = matches.length;
		current = ((index % n) + n) % n;
		const range = matches[current];
		CSS.highlights.set("find-bar-current", new Highlight(range));

		const rect = range.getBoundingClientRect();
		const offscreen = rect.top < 0 || rect.bottom > window.innerHeight;
		if (offscreen) {
			range.startContainer.parentElement?.scrollIntoView({
				block: "center",
				behavior: "instant",
			});
		}
		updateCount();
	}

	function clearHighlights() {
		CSS.highlights.delete("find-bar-all");
		CSS.highlights.delete("find-bar-current");
	}

	function updateCount() {
		if (!countEl) return;
		if (!input.value) countEl.textContent = "";
		else if (matches.length === 0) countEl.textContent = "No results";
		else {
			const capped = matches.length >= MAX_MATCHES ? "+" : "";
			countEl.textContent = `${current + 1}/${matches.length}${capped}`;
		}
	}
})();
