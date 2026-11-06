import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWiki } from "./context";
import { lint } from "./lint";
import { applyQueueEntry, maintainCtx } from "./maintain";
import type { Message } from "./print";
import { queueItems, readQueue } from "./queue";

// `cortex maintain contradictions` end to end on a planted wiki, against a fake llama.cpp: /systemone (the judge's `noul`,
// by callout) and /chat/completions (the `resolve` call, scripted by the page it is about).
//   Prompt caching : newer_source_wins, judged well: written, `draft`, callout gone
//   Context window : the model does not decide (unsure): queue
//   Tokenizer      : both_hold, the judge doubts: queue with the proposal, then `queue apply`
//   Embeddings     : a section too long for one call: review

const NOW = new Date("2026-11-06T10:00:00+01:00");
const roots: string[] = [];
const servers: { stop(close?: boolean): void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.stop(true)); roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })); });

type Chat = { messages: { role: string; content: string }[] };
const userOf = (b: Chat) => b.messages.find((m) => m.role === "user")!.content;
/** `resolve`: the scripted model, by page title, with the number of the call for that page. `noul`: the judge's probability, by callout text (default 0.95). */
function fake(o: { resolve?: (page: string, n: number, user: string) => object | undefined; noul?: (callout: string) => number } = {}) {
  const chats: Chat[] = [], judged: string[] = [], calls = new Map<string, number>();
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url), b: any = await req.json();
    if (url.pathname.endsWith("/systemone")) {
      judged.push(b.state.callout);
      return Response.json({ answers: { keeps: { type: "noul", noul: o.noul?.(b.state.callout) ?? 0.95 } } });
    }
    chats.push(b);
    const user = userOf(b), page = /^Page: (.*)$/m.exec(user)![1], n = (calls.get(page) ?? 0) + 1;
    calls.set(page, n);
    const r = o.resolve?.(page, n, user);
    if (!r) return new Response("no script", { status: 500 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(r) } }] });
  } });
  servers.push(server);
  return { base_url: `http://127.0.0.1:${server.port}/v1`, chats, judged };
}

const R = (n: string) => `/raw/2026/10/${n}/source.md`;
const page = (type: string, title: string, o: { status?: string; sources?: [string, string, string][]; body: string; extra?: string }) =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: D ${title}.\nstatus: ${o.status ?? "stable"}\ntags: []\n${o.extra ?? ""}generated: { by: "someone", at: 2026-10-01T10:00:00+02:00 }\n${
    o.sources ? `sources:\n${o.sources.map(([id, resource, t]) => `  - id: ${id}\n    resource: ${resource}\n    title: ${t}`).join("\n")}\n` : ""}---\n${o.body}\n`;

const CACHING = `Le cache de prompt réutilise le préfixe d'un prompt déjà calculé [^anthropic].\n\n## Tarifs\n> [!warning] Contradiction\n> Le blog annonce que les lectures du cache coûtent 25 % du prix normal [^blog].\n\nLes lectures du cache coûtent 10 % du prix normal [^anthropic].\n\n## Usage\nIl réduit la latence des requêtes répétées [^anthropic].\n\n[^anthropic]: Anthropic docs, ${R("a")}\n[^blog]: Blog, ${R("b")}`;
const CACHING_FIXED = "D'après le billet de blog, les lectures du cache coûtent 25 % du prix normal [^blog] ; la documentation d'Anthropic disait 10 % [^anthropic].";
const verdict = (v: string, section = "", note = "Le billet est plus récent.") => ({ verdict: v, section, note });

async function wiki(base_url: string, o: { judge?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cortex-contradictions-"));
  roots.push(root);
  await Bun.write(join(root, "cortex.json"), JSON.stringify({ client: "openai", model: "m", base_url, language: "French", page_path: "{type}/{slug}", ...(o.judge === false ? {} : { judge: { base_url } }) }));
  for (const n of ["a", "b", "c"]) await Bun.write(join(root, `raw/2026/10/${n}/source.md`), `---\ntype: RawSource\ntitle: Raw ${n}\nstatus: compiled\n---\nTexte ${n}.\n`);
  const w = (p: string, text: string) => Bun.write(join(root, `wiki/${p}.md`), text);
  await w("concepts/prompt-caching", page("Concept", "Prompt caching", { sources: [["anthropic", R("a"), "Anthropic docs"], ["blog", R("b"), "Blog"]], extra: `verified: { by: "human:fm", at: 2026-10-02T10:00:00+02:00 }\n`, body: CACHING }));
  await w("concepts/context-window", page("Concept", "Context window", { status: "draft", sources: [["blog", R("b"), "Blog"]], body: `## Limites\n> [!warning] Contradiction\n> Le blog parle d'un million de tokens [^blog].\n\nLa fenêtre est de 200 000 tokens.\n\n[^blog]: Blog, ${R("b")}` }));
  await w("entities/tokenizer", page("Entity", "Tokenizer", { sources: [["blog", R("b"), "Blog"]], body: `Un tokenizer découpe le texte [^blog].\n> [!warning] Contradiction\n> Il découpe aussi en octets [^blog].\n\n## Détails\nRien d'autre.\n\n[^blog]: Blog, ${R("b")}` }));
  await w("concepts/embeddings", page("Concept", "Embeddings", { sources: [["blog", R("b"), "Blog"]], body: `## Long\n> [!warning] Contradiction\n> Autre chose [^blog].\n\n${"Un fait détaillé sur les vecteurs [^blog]. ".repeat(400)}\n\n[^blog]: Blog, ${R("b")}` }));
  await w("concepts/quiet", page("Concept", "Quiet", { body: "Rien à signaler." }));
  await w("concepts/old", page("Concept", "Old", { status: "deprecated", extra: "superseded_by: /wiki/concepts/quiet.md\n", body: "## X\n> [!warning] Contradiction\n> Ignorée." }));
  await w("sources/anthropic-docs", page("Source", "Anthropic docs", { sources: [["a", R("a"), "Raw a"]], body: `La documentation d'Anthropic fixe la lecture du cache à 10 % [^a].\n\n## Points clés\n- Tarifs [^a]\n\n[^a]: Raw a, ${R("a")}` }));
  await w("sources/blog", page("Source", "Blog", { sources: [["b", R("b"), "Raw b"]], body: `Un billet de blog récent parle de tarifs à 25 % et d'un million de tokens [^b].\n\n## Points clés\n- Tarifs [^b]\n\n[^b]: Raw b, ${R("b")}` }));
  return root;
}

const text = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const snapshot = (root: string) => Object.fromEntries([...new Bun.Glob("{wiki,.cortex}/**/*").scanSync({ cwd: root, dot: true })].sort().map((p) => [p, text(root, p)]));
const run = async (root: string, o: { apply?: boolean; limit?: number } = {}) => {
  const messages: Message[] = [];
  const r = await maintainCtx(openWiki(root), "contradictions", { now: () => NOW, ...o }, (m) => messages.push(m));
  return { ...r, messages };
};
const queue = (root: string) => queueItems(readQueue(root).entries);
const script = (page: string, n: number) => ({
  "Prompt caching": verdict("newer_source_wins", CACHING_FIXED),
  "Context window": verdict("unsure", "", "Les deux chiffres sont plausibles."),
  "Tokenizer": verdict("both_hold", "Un tokenizer découpe le texte, en caractères ou en octets selon le modèle [^blog].", "Les deux sont vrais selon le modèle."),
  "Embeddings": verdict("both_hold", "x"),
} as Record<string, object>)[page];

test("without --apply: the sections with a callout are listed, the model and the judge are not called, nothing is written", async () => {
  const s = fake({ resolve: script });
  const root = await wiki(s.base_url);
  const before = snapshot(root);
  const r = await run(root);
  expect(r.ok).toBe(true);
  expect(r.items.map((i) => [i.action, i.pages[0], i.note])).toEqual([
    ["would-resolve", "wiki/concepts/context-window.md", "Limites"],
    ["would-resolve", "wiki/concepts/embeddings.md", "Long"],
    ["would-resolve", "wiki/concepts/prompt-caching.md", "Tarifs"],
    ["would-resolve", "wiki/entities/tokenizer.md", "(préambule)"],
  ]);
  expect(r.messages.at(-1)!.text).toContain("rien n'a été modifié");
  expect(s.chats).toHaveLength(0);
  expect(s.judged).toHaveLength(0);
  expect(snapshot(root)).toEqual(before);
  expect(existsSync(join(root, ".cortex/maintain.json"))).toBe(false);
});

test("--apply: a verdict the judge confirms is written (callout gone, page draft), the others go to the queue with their proposal", async () => {
  const s = fake({ resolve: script, noul: (c) => (/octets/.test(c) ? 0.4 : 0.95) });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.ok).toBe(true);
  expect(r.items.map((i) => [i.action, i.pages[0]])).toEqual([
    ["queued", "wiki/concepts/context-window.md"],
    ["review", "wiki/concepts/embeddings.md"],
    ["resolved", "wiki/concepts/prompt-caching.md"],
    ["queued", "wiki/entities/tokenizer.md"],
  ]);

  // the model got the section and the summaries of the Source pages, not the raw sources
  const user = userOf(s.chats.find((c) => /^Page: Prompt caching/m.test(userOf(c)))!);
  expect(user).toContain("Le blog annonce que les lectures du cache coûtent 25 %");
  expect(user).toContain("[^blog] Blog: Un billet de blog récent parle de tarifs à 25 %");
  expect(user).toContain("[^anthropic] Anthropic docs: La documentation d'Anthropic fixe la lecture du cache à 10 %");
  expect(user).toContain("Valid footnote ids: anthropic, blog");
  expect(user).not.toContain("Texte a.");
  expect(s.chats).toHaveLength(3); // the long section never reached the model

  // the written page: only the section changed, byte for byte elsewhere
  const done = text(root, "wiki/concepts/prompt-caching.md");
  expect(done).toContain(`## Tarifs\n\n${CACHING_FIXED}\n\n## Usage\nIl réduit la latence des requêtes répétées [^anthropic].\n\n[^anthropic]: Anthropic docs, ${R("a")}\n[^blog]: Blog, ${R("b")}`);
  expect(done).toContain("Le cache de prompt réutilise le préfixe d'un prompt déjà calculé [^anthropic].\n\n## Tarifs");
  expect(done).not.toContain("[!warning]");
  expect(done).toMatch(/^status: draft$/m);
  expect(done).toContain("verified:"); // a past event: kept
  expect(done).toMatch(/generated: \{ by: "openai\/m:maintain", at: 2026-11-06T/);

  // the judge saw the section before, the callout and the rewritten section
  expect(s.judged).toHaveLength(2); // unsure is not judged
  expect(s.judged[0]).toContain("Le blog annonce");

  const q = queue(root);
  expect(q.map((i) => [i.kind, i.status, i.pages[0]])).toEqual([
    ["contradiction", "open", "wiki/concepts/context-window.md"],
    ["review", "open", "wiki/concepts/embeddings.md"],
    ["contradiction", "open", "wiki/entities/tokenizer.md"],
  ]);
  expect(q[0].proposal).toContain("Verdict: unsure");
  expect(q[0].proposal).not.toContain("---");
  expect(q[1].reason).toContain("trop longue");
  expect(q[2].proposal).toMatch(/^Verdict: both_hold\nSection: \(préambule\)\nBase: [0-9a-f]{12}\nNote: Les deux sont vrais selon le modèle\.\n\n---\n\nUn tokenizer découpe le texte, en caractères/);
  expect(q[2].reason).toContain("0.40");
  // untouched pages
  expect(text(root, "wiki/concepts/context-window.md")).toContain("[!warning] Contradiction");
  expect(text(root, "wiki/entities/tokenizer.md")).toContain("[!warning] Contradiction");

  // journal, state, lint
  const log = readFileSync(join(root, "wiki/log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.some((e) => e.kind === "update" && /contradiction résolue dans « Prompt caching » § Tarifs \(newer_source_wins\) : Le billet est plus récent/.test(e.text))).toBe(true);
  expect(log.some((e) => /maintenance contradictions : 1 résolue\(s\), 3 entrée\(s\)/.test(e.text))).toBe(true);
  expect(JSON.parse(text(root, ".cortex/maintain.json")).contradictions.queued).toBeDefined();
  expect((await lint(root)).filter((i) => i.level === "error")).toEqual([]);

  // a rerun: what was resolved is gone, what was proposed is not asked again
  const before = snapshot(root), calls = s.chats.length;
  const again = await run(root, { apply: true });
  expect(again.items.map((i) => i.pages[0])).toEqual([]);
  expect(s.chats).toHaveLength(calls);
  expect(snapshot(root)).toEqual(before);
});

test("cortex queue apply writes a proposal as a human decision (no judge), closes the entry, refuses unsure and stale proposals", async () => {
  const s = fake({ resolve: script, noul: () => 0.3 });
  const root = await wiki(s.base_url);
  await run(root, { apply: true });
  expect(queue(root).filter((i) => i.kind === "contradiction")).toHaveLength(3);
  const judged = s.judged.length;
  const w = () => openWiki(root);
  const entry = (p: string) => queue(root).find((i) => i.kind === "contradiction" && i.pages[0] === p)!;

  const unsure = await applyQueueEntry(w(), entry("wiki/concepts/context-window.md"));
  expect(unsure.ok).toBe(false);
  expect(unsure.messages.at(-1)!.text).toContain("n'a pas tranché");

  // stale: the section moved on since the proposal
  const tok = entry("wiki/entities/tokenizer.md");
  await Bun.write(join(root, "wiki/entities/tokenizer.md"), text(root, "wiki/entities/tokenizer.md").replace("Il découpe aussi en octets", "Il découpe aussi en morceaux"));
  const stale = await applyQueueEntry(w(), tok);
  expect(stale.ok).toBe(false);
  expect(stale.messages.at(-1)!.text).toContain("a changé depuis la proposition");
  expect(entry("wiki/entities/tokenizer.md").status).toBe("open");

  // a fresh run proposes the new text; applying it works
  await run(root, { apply: true });
  const fresh = queue(root).filter((i) => i.kind === "contradiction" && i.status === "open" && i.pages[0] === "wiki/entities/tokenizer.md").at(-1)!;
  expect(fresh.n).not.toBe(tok.n);
  const ok = await applyQueueEntry(w(), fresh);
  expect(ok.ok).toBe(true);
  const done = text(root, "wiki/entities/tokenizer.md");
  expect(done).toContain("Un tokenizer découpe le texte, en caractères ou en octets selon le modèle [^blog].\n\n## Détails\nRien d'autre.\n\n[^blog]: Blog,");
  expect(done).not.toContain("[!warning]");
  expect(done).toMatch(/^status: draft$/m);
  expect(queue(root).find((i) => i.n === fresh.n)!.status).toBe("done");
  expect(s.judged).toHaveLength(judged + 1); // only the rerun's judging of the changed section, none for the apply
  expect((await lint(root)).filter((i) => i.level === "error")).toEqual([]);
});

test("the model is asked again when it loses a footnote; a model that never answers well sends the section to review", async () => {
  const s = fake({
    resolve: (p, n) => {
      if (p === "Prompt caching") return n === 1 ? verdict("newer_source_wins", "Le blog dit 25 % [^blog].") : verdict("newer_source_wins", CACHING_FIXED);
      if (p === "Tokenizer") return verdict("both_hold", "Un tokenizer découpe le texte [^inconnu].");
    },
  });
  const root = await wiki(s.base_url);
  const r = await run(root, { apply: true });
  expect(r.items.find((i) => i.pages[0] === "wiki/concepts/prompt-caching.md")!.action).toBe("resolved");
  expect(text(root, "wiki/concepts/prompt-caching.md")).toContain(CACHING_FIXED);
  expect(s.chats.filter((c) => /^Page: Prompt caching/m.test(userOf(c))).length).toBe(2);
  expect(s.chats.some((c) => c.messages.some((m) => /footnotes lost|unknown footnote ids/.test(m.content)))).toBe(true);
  // Tokenizer: never a valid answer; Context window: the server has no script (500): a failure, nothing queued for it
  expect(r.items.find((i) => i.pages[0] === "wiki/entities/tokenizer.md")!.action).toBe("review");
  expect(r.items.find((i) => i.pages[0] === "wiki/concepts/context-window.md")!.action).toBe("failed");
  expect(r.ok).toBe(false);
  expect(queue(root).filter((i) => i.pages[0] === "wiki/concepts/context-window.md")).toEqual([]);
});

test("without a judge nothing is applied: the resolutions go to the queue; --limit caps the sections handled", async () => {
  const s = fake({ resolve: script });
  const root = await wiki(s.base_url, { judge: false });
  const r = await run(root, { apply: true, limit: 3 });
  expect(r.messages.map((m) => m.text).join("\n")).toContain("pas de juge");
  expect(r.items.map((i) => i.action)).toEqual(["queued", "review", "queued"]);
  expect(text(root, "wiki/concepts/prompt-caching.md")).toContain("[!warning] Contradiction");
  expect(queue(root).find((i) => i.pages[0] === "wiki/concepts/prompt-caching.md")!.reason).toContain("sans juge");
  expect(s.judged).toHaveLength(0);
  // the human applies it
  const e = queue(root).find((i) => i.pages[0] === "wiki/concepts/prompt-caching.md")!;
  expect((await applyQueueEntry(openWiki(root), e)).ok).toBe(true);
  expect(text(root, "wiki/concepts/prompt-caching.md")).toContain(CACHING_FIXED);
});

test("a wiki without callout: nothing to do; a foreign contradiction entry cannot be applied", async () => {
  const s = fake();
  const root = await wiki(s.base_url);
  for (const p of ["concepts/prompt-caching", "concepts/context-window", "entities/tokenizer", "concepts/embeddings"]) await Bun.write(join(root, `wiki/${p}.md`), page("Concept", p, { body: "Rien." }));
  const r = await run(root, { apply: true });
  expect(r.items).toEqual([]);
  expect(r.messages.at(-1)!.text).toContain("Aucun encadré");
  const { enqueueCtx } = await import("./queue");
  const w = openWiki(root);
  await enqueueCtx(w, { kind: "contradiction", title: "à la main", reason: "vu en lisant", pages: ["wiki/concepts/quiet.md"] }, NOW);
  const a = await applyQueueEntry(openWiki(root), queue(root)[0]);
  expect(a.ok).toBe(false);
  expect(a.messages.at(-1)!.text).toContain("à résoudre à la main");
});

test("--apply: replacing the last section of a page keeps the final newline of the file", async () => {
  const s = fake({ resolve: (p, n) => (p === "Last section" ? verdict("newer_source_wins", "Le fait ancien et le nouveau, tous deux sourcés [^blog].") : script(p, n)) });
  const root = await wiki(s.base_url);
  await Bun.write(join(root, "wiki/concepts/last-section.md"), page("Concept", "Last section", { sources: [["blog", R("b"), "Blog"]], body: `## Un\nTexte [^blog].\n\n## Fin\n> [!warning] Contradiction\n> Autre [^blog].\n\nFait ancien [^blog].\n\n[^blog]: Blog, ${R("b")}` }));
  await run(root, { apply: true });
  const out = text(root, "wiki/concepts/last-section.md");
  expect(out).toContain("## Fin\n\nLe fait ancien et le nouveau, tous deux sourcés [^blog].\n\n[^blog]: Blog,");
  expect(out).not.toContain("Contradiction");
  expect(out.endsWith(`${R("b")}\n`)).toBe(true);
});
