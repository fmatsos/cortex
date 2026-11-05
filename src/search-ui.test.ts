import { expect, test } from "bun:test";

// Pure logic of the search interface (facets, diagnostics, counters, excerpts, history): the site itself is not launched.
const q = () => import("../site/src/lib/query");
const eng = () => import("../site/src/lib/search-engine");

const doc = (id: string, title: string, o: Record<string, unknown> = {}) =>
	({ id, title, description: "", type: "Concept", tags: [] as string[], status: "stable", verified: true, text: "", ...o });
async function engine(docs: ReturnType<typeof doc>[]) {
	const { buildTerms, createEngine } = await eng();
	const Fuse = (await import("fuse.js")).default;
	return createEngine({ docs, terms: buildTerms(docs), vocab: [] }, Fuse);
}

test("puces : phrases et tags gardent leurs accents, le dédoublonnage reste replié (UX48)", async () => {
	const { chips, parseQuery } = await q();
	const labels = (s: string) => chips(parseQuery(s)).map((c) => c.label);
	expect(labels('"fenêtre de contexte"')).toEqual(["“fenêtre de contexte”"]);
	expect(labels("#Mémoire -à-éviter")).toEqual(["#Mémoire", "without à-éviter"]);
	expect(labels('"Fenêtre" "fenetre"')).toEqual(["“Fenêtre”"]); // a single chip, two tokens
	const { setLocale } = await import("../site/src/lib/i18n/index");
	setLocale("fr");
	try { expect(labels('"a b" -c')).toEqual(["« a b »", "sans c"]); } finally { setLocale("en"); }
	expect(chips(parseQuery('"Fenêtre" "fenetre"'))[0].raws).toEqual(['"Fenêtre"', '"fenetre"']);
	// the engine, for its part, always compares folded
	expect(parseQuery('"Fenêtre de contexte"').phrases[0].text).toBe("fenetre de contexte");
});

test("facettes : type et statut à choix unique, tags et indicateurs cumulables, retrait par jeton (UX04)", async () => {
	const { toggleFacet, clearOps, activeValues, parseQuery } = await q();
	expect(toggleFacet("", "type", "Concept")).toBe("type:Concept");
	expect(toggleFacet("contexte type:Concept", "type", "Source")).toBe("contexte type:Source"); // replaces, does not add up
	expect(toggleFacet("contexte type:concept", "type", "Concept")).toBe("contexte"); // active → removed, even when typed by hand
	expect(toggleFacet("x status:draft", "status", "stable")).toBe("x status:stable");
	expect(toggleFacet("#llm", "tag", "agents")).toBe("#llm #agents");
	expect(toggleFacet("#Mémoire x", "tag", "memoire")).toBe("x"); // folded comparison
	expect(toggleFacet("", "tag", "deux words")).toBe('tag:"deux words"');
	expect(toggleFacet("", "is", "fav")).toBe("is:fav");
	expect(toggleFacet("is:fav x", "is", "fav")).toBe("x");
	expect(toggleFacet("-type:source", "type", "Source")).toBe("-type:source type:Source"); // a negated filter is not the facet
	expect(clearOps('a "b c" #t type:source -#u status:draft')).toBe('a "b c"');
	expect([...activeValues(parseQuery("type:sources #A -#b"), "type")]).toEqual(["Source"]);
	expect([...activeValues(parseQuery("#A -#b"), "tag")]).toEqual(["a"]);
});

test("diagnostic : valeur inconnue, filtres exclusifs, contradiction, tag absent — pas une requête valide sans résultat (UX41)", async () => {
	const { diagnose, parseQuery, removeToken } = await q();
	const d = (s: string, tags?: string[]) => diagnose(parseQuery(s), tags ? new Set(tags) : undefined);
	expect(d("contexte type:concept status:stable is:fav")).toEqual([]); // valid, even if it finds nothing
	expect(d("status:brouillon")[0].text).toContain("does not exist");
	expect(d("type:truc")[0].raws).toEqual(["type:truc"]);
	expect(d("is:xyz")[0].fix).toBe("Remove is:xyz");
	const two = d("type:concept type:source");
	expect(two).toHaveLength(1);
	expect(two[0].text).toContain("AND");
	expect(two[0].raws).toEqual(["type:source"]); // we keep the first
	expect(removeToken("type:concept type:source x", two[0].raws[0])).toBe("type:concept x");
	expect(d("type:concept type:synthèses")).toHaveLength(1);
	expect(d("#llm -#llm")[0].text).toContain("contradict");
	expect(d("-type:source type:concept")).toEqual([]); // negated and positive with different values: consistent
	expect(d("#llm #zzz", ["llm"]).map((x) => x.raws)).toEqual([["#zzz"]]);
	expect(d("#zzz")).toEqual([]); // unknown tags: we don't know, we say nothing
});

test("indicateurs is:review et is:partial", async () => {
	const { matches, parseQuery } = await q();
	const a = doc("a", "A", { needsReview: true, partial: false }), b = doc("b", "B", { partial: true });
	const ok = (d: ReturnType<typeof doc>, s: string) => matches(d, parseQuery(s), () => false);
	expect([ok(a, "is:review"), ok(b, "is:review"), ok(a, "is:à-relire")].slice(0, 2)).toEqual([true, false]);
	expect(ok(a, "is:arelire")).toBe(true);
	expect([ok(a, "is:partial"), ok(b, "is:partial"), ok(b, "-is:partial")]).toEqual([false, true, false]);
});

test("lien vers l'article : la requête n'accompagne le lien que si elle cherche du texte (UX26)", async () => {
	const { withPassage, passageQuery } = await q();
	expect(withPassage("/wiki/a/", "fenêtre de contexte")).toBe("/wiki/a/?q=fen%C3%AAtre%20de%20contexte");
	expect(withPassage("/wiki/a/", '  "fenêtre" #llm ')).toBe("/wiki/a/?q=%22fen%C3%AAtre%22%20%23llm");
	expect(withPassage("/wiki/a/", "#llm type:source")).toBe("/wiki/a/"); // filters only: nothing to highlight
	expect(passageQuery("-bruit")).toBe("");
});

test("extraits : une phrase exacte centre l'extrait et se surligne, sans chevauchement (UX40)", async () => {
	const { ranges, search } = await eng();
	expect(ranges("La fenêtre de contexte et le contexte.", new Set(["contexte"]), ["fenetre de contexte"])).toEqual([[3, 22], [29, 37]]);
	// word / phrase overlap: a single range
	expect(ranges("fenêtre de contexte", new Set(["contexte", "fenetre"]), ["fenetre de contexte"])).toEqual([[0, 19]]);
	expect(ranges("rien", new Set(), [])).toEqual([]);
	const e = await engine([
		doc("a", "Débat", { text: "Du bruit. ".repeat(60) + "Parlons de la fenêtre de contexte des modèles." }),
		doc("b", "Autre", { text: "fenêtre seule, contexte seul" }),
	]);
	const r = search(e, '"fenêtre de contexte"', () => false);
	expect(r.hits.map((h) => h.doc.id)).toEqual(["a"]);
	expect(r.hits[0].snippet).toContain("<mark>fenêtre de contexte</mark>");
	expect(r.hits[0].snippet.startsWith("…")).toBe(true); // centered on the phrase, not on the start of the text
	expect(r.hits[0].snippet).not.toContain("Du bruit. Du bruit. Du bruit. Du bruit. Du bruit. Du bruit. Du bruit. Du bruit. Du bruit.");
	// filters only: no useless excerpt
	expect(search(e, "type:concept", () => false).hits.every((h) => h.snippet === "")).toBe(true);
});

test("compteurs de facettes : dans le contexte de la requête, en retirant seulement la facette modifiée (UX11)", async () => {
	const { facetCounts, suggest } = await eng();
	const e = await engine([
		doc("a", "A", { tags: ["llm"], type: "Concept" }),
		doc("b", "B", { tags: ["llm", "outil"], type: "Source", status: "draft", verified: false }),
		doc("c", "C", { tags: ["llm"], type: "Source", partial: true }),
		doc("d", "D", { tags: ["autre"], type: "Source" }),
		doc("f", "F", { tags: ["autre"], type: "Entity", needsReview: true }),
	]);
	const none = () => false;
	const all = facetCounts(e, "", none);
	expect(all.total).toBe(5);
	expect(all.type).toEqual({ Concept: 1, Source: 3, Entity: 1 });
	expect(all.flags).toEqual({ fav: 0, unverified: 1, review: 1, partial: 1 });
	expect(all.tags[0]).toEqual({ tag: "llm", count: 3 });

	// #llm active: types count among #llm pages; the type facet is not constrained by type:
	const ctx = facetCounts(e, "#llm type:source", none);
	expect(ctx.total).toBe(2);
	expect(ctx.type).toEqual({ Concept: 1, Source: 2 }); // « type:source » removed to count Concept
	expect(ctx.status).toEqual({ stable: 1, draft: 1 }); // status counts among #llm type:source
	expect(ctx.flags.partial).toBe(1);
	expect(facetCounts(e, "", (id) => id === "a").flags.fav).toBe(1);

	// suggestions: « #llm type: » announces the types among #llm pages
	const s = suggest(e, "#llm type:", none).filters;
	expect(s.map((f) => [f.label, f.count])).toEqual([["type:source", 2], ["type:concept", 1]]);
	expect(suggest(e, "#llm #", none).filters.map((f) => f.label)).toEqual(["#outil"]); // not #llm, already active
	expect(suggest(e, "type:", none).filters.find((f) => f.label === "type:source")?.count).toBe(3);
});

test("historique : dédoublonné sans accents, borné, vide ignoré, relecture tolérante (UX09)", async () => {
	const { pushRecent, parseRecent } = await import("../site/src/lib/recent");
	expect(pushRecent([], "  fenêtre   de contexte ")).toEqual(["fenêtre de contexte"]);
	expect(pushRecent(["a", "b"], "   ")).toEqual(["a", "b"]);
	expect(pushRecent(["a", "Fenêtre", "b"], "fenetre")).toEqual(["fenetre", "a", "b"]); // same query → moved to the front
	expect(pushRecent(["1", "2", "3"], "4", 3)).toEqual(["4", "1", "2"]);
	expect(parseRecent('["a","","  ",3,"b"]')).toEqual(["a", "b"]);
	expect(parseRecent("pas du JSON")).toEqual([]);
	expect(parseRecent('{"a":1}')).toEqual([]);
	expect(parseRecent(null)).toEqual([]);
});
