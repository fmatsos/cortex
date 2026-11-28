/**
 * The editing helpers of the Add page's text box: Markdown inserted around a selection, and a `.md` file read as a title and a body.
 * Pure (text and selection in, text and selection out): the component applies the result to the `<textarea>`.
 */
export type Edit = { text: string; start: number; end: number };
export type Insert = "heading" | "bold" | "italic" | "bullets" | "link" | "checkbox";

/** `before` and `after` around the selection (a placeholder when it is empty, selected for typing over); the selection stays on the wrapped text. */
export function wrap(text: string, start: number, end: number, before: string, after: string, placeholder: string): Edit {
	const sel = text.slice(start, end) || placeholder;
	return { text: text.slice(0, start) + before + sel + after + text.slice(end), start: start + before.length, end: start + before.length + sel.length };
}

/** `prefix` at the start of every line the selection touches (the line of the cursor when it is empty); the selection covers those lines. */
export function prefixLines(text: string, start: number, end: number, prefix: string): Edit {
	const from = text.lastIndexOf("\n", start - 1) + 1;
	const stop = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
	const to = stop === -1 ? text.length : stop;
	const block = text.slice(from, to).split("\n").map((l) => prefix + l).join("\n");
	return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

/** The Markdown syntax the toolbar inserts, by name. */
export function insert(what: Insert, text: string, start: number, end: number, placeholder: string): Edit {
	switch (what) {
		case "heading": return prefixLines(text, start, end, "## ");
		case "bullets": return prefixLines(text, start, end, "- ");
		case "checkbox": return prefixLines(text, start, end, "- [ ] ");
		case "bold": return wrap(text, start, end, "**", "**", placeholder);
		case "italic": return wrap(text, start, end, "*", "*", placeholder);
		case "link": {
			// `[selection](url)`: the address is what is left to type, so it is the part selected
			const label = text.slice(start, end) || placeholder, at = start + label.length + 3;
			return { text: `${text.slice(0, start)}[${label}](url)${text.slice(end)}`, start: at, end: at + 3 };
		}
	}
}

/** A Markdown file as a note: a first `# Heading` (after blank lines) is the title and leaves the body; otherwise the title is empty. */
export function fromFile(raw: string): { title: string; body: string } {
	const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const m = /^\s*#[ \t]+([^\n]*?)[ \t#]*(?:\n|$)/.exec(text);
	return m ? { title: m[1]!.trim(), body: text.slice(m[0].length).replace(/^\n+/, "") } : { title: "", body: text };
}
