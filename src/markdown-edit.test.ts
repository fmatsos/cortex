import { expect, test } from "bun:test";
import { fromFile, insert } from "../site/src/lib/markdown-edit";

test("markdown-edit: the toolbar wraps the selection, prefixes its lines, and selects what is left to type", () => {
  expect(insert("bold", "un mot ici", 3, 6, "texte")).toEqual({ text: "un **mot** ici", start: 5, end: 8 });
  expect(insert("italic", "ab", 1, 1, "texte")).toEqual({ text: "a*texte*b", start: 2, end: 7 }); // empty selection: a placeholder, selected
  expect(insert("link", "voir doc ici", 5, 8, "lien")).toEqual({ text: "voir [doc](url) ici", start: 11, end: 14 }); // the address is selected
  expect(insert("bullets", "a\nb\nc", 2, 5, "")).toEqual({ text: "a\n- b\n- c", start: 2, end: 9 }); // two lines
  expect(insert("checkbox", "a\nb", 0, 0, "")).toEqual({ text: "- [ ] a\nb", start: 0, end: 7 }); // the cursor's line
  expect(insert("heading", "a\nb", 3, 3, "")).toEqual({ text: "a\n## b", start: 2, end: 6 });
  expect(insert("bullets", "a\nb\n", 0, 4, "")).toEqual({ text: "- a\n- b\n", start: 0, end: 7 }); // a selection ending at a line break does not take the next line
});

test("markdown-edit: an imported file's first # heading is the title and leaves the body, anything else stays whole", () => {
  expect(fromFile("# Ma note\n\nCorps.\n")).toEqual({ title: "Ma note", body: "Corps.\n" });
  expect(fromFile("﻿\r\n# Titre ##\r\n\r\ntexte\r\n- a")).toEqual({ title: "Titre", body: "texte\n- a" });
  expect(fromFile("Corps sans titre\n# plus bas\n")).toEqual({ title: "", body: "Corps sans titre\n# plus bas\n" });
  expect(fromFile("## Sous-titre\n\ntexte")).toEqual({ title: "", body: "## Sous-titre\n\ntexte" }); // not an H1
  expect(fromFile("#hashtag")).toEqual({ title: "", body: "#hashtag" });
  expect(fromFile("# Seul")).toEqual({ title: "Seul", body: "" });
});
