import { expect, test } from "bun:test";
import { addNoteDefs, fold, noteDef, noteId, normalizeNotes, verifyFacts, verifyQuote } from "./cite";

const source = `# L'évaluation des modèles

Le **contexte** est « saturé » quand l'on dépasse 50 000 tokens ; la qualité baisse alors, très nettement, selon Chroma.
Les modèles de type state-of-the-art n'échappent pas à la règle (voir aussi: Œuvres complètes).
Un modèle de 4B milliards de paramètres sait résumer un texte court mais perd le fil sur un document très long et touffu.`;

test("fold: accents, case, punctuation, markup, spaces", () => {
  expect(fold("  L'ÉVALUATION,   des **modèles** !")).toBe("l evaluation des modeles");
  expect(fold("state-of-the-art")).toBe("state of the art");
  expect(fold("")).toBe("");
});

test("an exact quote, accents, case and punctuation aside, is found", () => {
  expect(verifyQuote(source, "Le contexte est saturé quand l'on dépasse 50 000 tokens")).toBe("exact");
  expect(verifyQuote(source, "LE CONTEXTE EST « SATURÉ » QUAND L'ON DÉPASSE 50000 TOKENS")).toBe("none"); // 50000 is not 50 000
  expect(verifyQuote(source, "le contexte est sature quand l on depasse 50 000 tokens")).toBe("exact");
  expect(verifyQuote(source, "Les modèles de type state of the art")).toBe("exact");
  expect(verifyQuote(source, "oeuvres completes")).toBe("none"); // « Œ » is not « oe »: documented limit, no false positive
});

test("a quote spans a line break of the source", () => {
  expect(verifyQuote(source, "la qualité baisse alors, très nettement, selon Chroma. Les modèles de type")).toBe("exact");
});

test("a match falls on word boundaries", () => {
  expect(verifyQuote(source, "contex")).toBe("none");
  expect(verifyQuote(source, "ontexte est")).toBe("none");
});

test("a reworded quote with a verbatim run of 12 words is partial", () => {
  const q = "Un modèle de 4B milliards de paramètres sait résumer un texte court mais ça dépend vraiment";
  expect(verifyQuote(source, q)).toBe("partial");
  expect(verifyQuote(source, "Un modèle de 4B milliards de paramètres sait résumer un texte court")).toBe("exact");
});

test("rejected: invented, too short a run, empty", () => {
  expect(verifyQuote(source, "Le contexte est toujours infini et ne baisse jamais en qualité")).toBe("none");
  expect(verifyQuote(source, "Un modèle de 4B milliards de paramètres sait résumer autre chose du tout là")).toBe("none"); // 11 words in a row
  expect(verifyQuote(source, "")).toBe("none");
  expect(verifyQuote(source, " ... ")).toBe("none");
  expect(verifyQuote("", "quelque chose")).toBe("none");
});

test("verifyFacts splits kept and rejected, keeping the facts' own fields and order", () => {
  const facts = [
    { claim: "a", quote: "le contexte est saturé" },
    { claim: "b", quote: "rien de tel dans la source" },
    { claim: "c", quote: "perd le fil sur un document très long" },
    { claim: "d", quote: "" },
  ];
  const { kept, rejected } = verifyFacts(source, facts);
  expect(kept.map((f) => f.claim)).toEqual(["a", "c"]);
  expect(rejected.map((f) => f.claim)).toEqual(["b", "d"]);
});

test("noteId: slug of the source title, suffix when taken", () => {
  expect(noteId("Chroma : Context Rot — étude", [])).toBe("chroma-context-rot-etude");
  expect(noteId("Chroma Context Rot", ["chroma-context-rot"])).toBe("chroma-context-rot-2");
  expect(noteId("Chroma Context Rot", ["chroma-context-rot", "chroma-context-rot-2"])).toBe("chroma-context-rot-3");
  expect(noteId("日本語", [])).toBe("source");
  expect(noteId("x".repeat(100), []).length).toBeLessThanOrEqual(40);
});

test("noteDef: source title and url or raw path, on one line", () => {
  expect(noteDef("chroma", "Context Rot", "https://research.trychroma.com/context-rot")).toBe("[^chroma]: Context Rot, https://research.trychroma.com/context-rot");
  expect(noteDef("a", "Un titre\n sur  deux lignes", "raw/a/source.md")).toBe("[^a]: Un titre sur deux lignes, raw/a/source.md");
  expect(noteDef("a", "Seulement un titre")).toBe("[^a]: Seulement un titre");
});

test("addNoteDefs: after the body, after existing definitions, once", () => {
  const d1 = noteDef("a", "Alpha", "raw/a"), d2 = noteDef("b", "Beta", "raw/b");
  const body = "Une phrase.[^a]\n";
  const one = addNoteDefs(body, [d1]);
  expect(one).toBe(`Une phrase.[^a]\n\n${d1}\n`);
  const two = addNoteDefs(one, [d2]);
  expect(two).toBe(`Une phrase.[^a]\n\n${d1}\n${d2}\n`);
  expect(addNoteDefs(two, [d1, d2])).toBe(two); // replayed: nothing added
  expect(addNoteDefs("", [d1])).toBe(`${d1}\n`);
  expect(addNoteDefs(body, [d1, d1.replace("Alpha", "Autre")])).toBe(one); // two definitions of one id: the first wins
});

test("normalizeNotes: every note points at the given id, definitions untouched", () => {
  const r = normalizeNotes("Un.[^x] Deux.[^id] Trois.[^y-2]\n\n[^x]: def", "id");
  expect(r.body).toBe("Un.[^id] Deux.[^id] Trois.[^id]\n\n[^x]: def");
  expect(r.count).toBe(3);
  expect(normalizeNotes("Sans note.", "id")).toEqual({ body: "Sans note.", count: 0 });
});
