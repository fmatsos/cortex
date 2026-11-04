import { expect, test } from "bun:test";
import {
	collectionQuery, currentSection, domainOf, graphFocus, hitRanges, hitTerms, originalSource, relatedEntries, relatedReasons, actor,
	shareUrl, sharedSources, showToc, tocItems,
} from "../site/src/lib/article";
import { parseQuery } from "../site/src/lib/query";
import { render, wrapTables } from "./export";

const h = (id: string) => ({ level: 2 as const, id, text: id });

test("sommaire : Notes et Sources rejoignent les titres du corps, seulement quand elles existent", () => {
	expect(tocItems([h("a")], 0, 0).map((t) => t.id)).toEqual(["a"]);
	expect(tocItems([h("a")], 3, 2).map((t) => [t.id, t.text])).toEqual([["a", "a"], ["h-notes", "Notes (3)"], ["h-sources", "Sources (2)"]]);
	expect(tocItems([], 0, 1).map((t) => t.id)).toEqual(["h-sources"]);
});

test("sommaire : affiché dès trois sections, dès deux si la page est longue, jamais pour une seule", () => {
	expect(showToc([h("a")], 99999)).toBe(false);
	expect(showToc([h("a"), h("b")], 500)).toBe(false);
	expect(showToc([h("a"), h("b")], 4000)).toBe(true);
	expect(showToc([h("a"), h("b"), h("c")], 100)).toBe(true);
});

test("section courante : dernier titre passé sous la ligne, dernière section tout en bas", () => {
	const tops = [{ id: "a", top: -400 }, { id: "b", top: -20 }, { id: "c", top: 300 }];
	expect(currentSection(tops, 100)).toBe("b");
	expect(currentSection([{ id: "a", top: 50 }], 10)).toBe(""); // rien n'a encore passé la ligne
	expect(currentSection(tops, 100, true)).toBe("c");
	expect(currentSection([], 100, true)).toBe("");
});

test("pages liées : motifs courts et dédupliqués, sources communes nommées", () => {
	const labels = (r: { label: string }[]) => r.map((x) => x.label);
	expect(labels(relatedReasons(["source partagée", "source partagée", "tag partagé : llm", "tag partagé : agents", "tag partagé : llm"])))
		.toEqual(["source commune", "llm, agents"]);
	expect(relatedReasons(["lien sortant", "lien entrant", "source partagée"], ["Chroma Research", "OpenAI"]))
		.toEqual([{ icon: "copy-link", label: "citée ici" }, { icon: "backlink", label: "cite cette page" }, { icon: "source", label: "2 sources communes", detail: "Chroma Research · OpenAI" }]);
	expect(relatedReasons([])).toEqual([]);
	expect(relatedReasons([], ["Titre"])).toEqual([{ icon: "source", label: "source commune", detail: "Titre" }]); // le serveur connaît la source même sans raison exportée
	expect(actor("human:franck")).toBe("franck");
	expect(actor("claude-code/opus-5.5")).toBe("claude-code · opus-5.5");
});

test("pages liées : une destination déjà en rétrolien n'est pas répétée", () => {
	const link = (id: string) => ({ id, title: id, type: "Concept" });
	const out = relatedEntries([link("a"), link("b")], [{ ...link("a"), reasons: ["lien entrant"] }, { ...link("c"), reasons: ["tag partagé : x"] }]);
	expect(out).toEqual([{ id: "c", title: "c", type: "Concept", why: [{ icon: "tags", label: "x" }] }]);
});

test("sources partagées : titres des sources communes à chaque page liée", () => {
	const src = (id: string) => ({ id, title: `T-${id}` });
	const page = { sources: [src("s1"), src("s2")], related: [{ id: "x", title: "x", type: "Concept", reasons: [] }, { id: "y", title: "y", type: "Concept", reasons: [] }] };
	const pages = [{ id: "x", sources: [src("s2"), src("s3")] }, { id: "y", sources: [src("s9")] }, { id: "z", sources: [src("s1")] }];
	expect(sharedSources(page, pages)).toEqual({ x: ["T-s2"] });
});

test("liens : domaine, source originale, graphe, collection, adresse à copier", () => {
	expect(domainOf("https://www.example.org/a/b?x=1")).toBe("example.org");
	expect(domainOf("pas une url")).toBe("");
	expect(originalSource([{ id: "a", title: "A" }, { id: "b", title: "B", url: "https://blog.test/x" }])).toMatchObject({ id: "b", url: "https://blog.test/x", domain: "blog.test" });
	expect(originalSource([{ id: "a", title: "A" }])).toBeUndefined();
	expect(graphFocus("concepts/context-rot")).toBe("?focus=concepts/context-rot");
	expect(graphFocus("a b/é")).toBe("?focus=a%20b/%C3%A9");
	expect(collectionQuery("Concept")).toBe("?q=type%3Aconcept");
	expect(collectionQuery("Synthesis")).toBe("?q=type%3Asynthesis");
	expect(collectionQuery("Inconnu")).toBeUndefined();
	expect(shareUrl("https://x.test/wiki/a/?q=context&z=1#h")).toBe("https://x.test/wiki/a/?z=1#h");
	expect(shareUrl("https://x.test/wiki/a/")).toBe("https://x.test/wiki/a/");
});

test("lecture d'un résultat : mots (préfixes compris), phrases, accents et chevauchements", () => {
	const terms = (q: string) => hitTerms(parseQuery(q));
	const text = "Le Contexte se dégrade : le context rot touche le contexte long.";
	const words = (q: string) => hitRanges(text, terms(q)).map(([a, b]) => text.slice(a, b));
	expect(words("contexte")).toEqual(["Contexte", "contexte"]);
	expect(words("cont")).toEqual(["Contexte", "context", "contexte"]); // la frappe en cours compte
	expect(words("degrade")).toEqual(["dégrade"]); // sans accents
	expect(words("c")).toEqual([]); // une lettre seule ne doit être que le mot entier
	expect(words('"context rot"')).toEqual(["context rot"]);
	expect(words('context "context rot"')).toEqual(["Contexte", "context rot", "contexte"]); // la phrase absorbe le mot qu'elle recouvre
	expect(words("type:source -long")).toEqual([]); // filtres et exclusions ne se surlignent pas
	expect(hitRanges("é́x", terms("ex"))).toEqual([]); // repli de longueur différente : ignoré plutôt que décalé
});

test("tableaux : chaque tableau est enveloppé dans une région défilante focalisable et nommée", () => {
	const t = "<table><tr><td>x</td></tr></table>";
	expect(wrapTables("<p>a</p>")).toBe("<p>a</p>");
	const one = wrapTables(`<h2 id="a">Les <em>prix</em> & coûts</h2>${t}`);
	expect(one).toContain('<div class="table-wrap" role="region" tabindex="0" aria-label="Tableau : Les prix &amp; coûts">');
	expect(one.endsWith(`${t}</div>`)).toBe(true);
	const two = wrapTables(`${t}<h2>B</h2>${t}`);
	expect(two).toContain('aria-label="Tableau 1 sur 2"');
	expect(two).toContain('aria-label="Tableau 2 sur 2 : B"');
	expect(wrapTables(`<h2>"A"</h2>${t}`)).toContain('aria-label="Tableau : &quot;A&quot;"'); // l'attribut reste bien formé
});

test("export : les tableaux du Markdown sortent enveloppés, le texte indexé n'en est pas changé", () => {
	const md = "## Prix\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSuite.";
	const r = render(md, "wiki/concepts/x/", new Set());
	expect(r.html).toContain('<div class="table-wrap" role="region" tabindex="0" aria-label="Tableau : Prix"><table>');
	expect(r.toc.map((x) => x.id)).toEqual(["prix"]);
});
