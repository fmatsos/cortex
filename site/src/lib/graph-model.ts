/**
 * Logique pure du graphe (testée par bun test) : vue filtrée, relations orientées, sélection, recherche de nœud,
 * paramètre `?focus=`, particules et temporisateurs. Aucune dépendance au DOM ni à Svelte : le composant ne fait
 * que brancher ces fonctions sur force-graph.
 */
import { fold } from "./fold";
import type { GraphData } from "./types";

export type GNode = GraphData["nodes"][number];
export type GLink = GraphData["links"][number];

export type GraphFilters = { off: ReadonlySet<string>; tag: string };

/** Vue filtrée du graphe : pages visibles (avec leur degré dans cette vue) et liens dont les deux extrémités le sont. */
export type GraphView = { nodes: GNode[]; links: GLink[]; ids: Set<string> };

/**
 * Applique les filtres (types masqués, tag). Le `degree` de chaque nœud est recalculé dans la vue : la taille d'un nœud
 * ne suggère jamais des relations qui ne sont plus affichées (UX46). Les pages liées sont comptées une fois, même pour un lien réciproque.
 */
export function buildView(data: Pick<GraphData, "nodes" | "links">, { off, tag }: GraphFilters): GraphView {
	const kept = data.nodes.filter((n) => !off.has(n.type) && (!tag || n.tags.includes(tag)));
	const ids = new Set(kept.map((n) => n.id));
	const links = data.links.filter((l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target));
	const peers = new Map<string, Set<string>>();
	const add = (a: string, b: string) => (peers.get(a) ?? peers.set(a, new Set()).get(a)!).add(b);
	for (const l of links) { add(l.source, l.target); add(l.target, l.source); }
	return { nodes: kept.map((n) => ({ ...n, degree: peers.get(n.id)?.size ?? 0 })), links, ids };
}

/** La sélection survit à un changement de filtre tant que son nœud reste visible ; sinon elle est levée. */
export const reconcileSelection = (selId: string | null | undefined, ids: ReadonlySet<string>): string | null => (selId && ids.has(selId) ? selId : null);

export const idOf = (x: string | { id: string }) => (typeof x === "string" ? x : x.id);

export type Relations = { cites: string[]; citedBy: string[] };

/**
 * Relations orientées d'une page : `cites` = pages vers lesquelles elle fait un lien, `citedBy` = pages qui font un lien vers elle.
 * Un lien réciproque (`mutual`) figure dans les deux listes. Les extrémités peuvent être des ids ou des objets nœud (force-graph).
 */
export function relationsOf(id: string, links: Iterable<{ source: string | { id: string }; target: string | { id: string }; mutual?: boolean }>): Relations {
	const cites = new Set<string>(), citedBy = new Set<string>();
	for (const l of links) {
		const a = idOf(l.source), b = idOf(l.target);
		if (a === id && b !== id) { cites.add(b); if (l.mutual) citedBy.add(b); }
		else if (b === id && a !== id) { citedBy.add(a); if (l.mutual) cites.add(a); }
	}
	return { cites: [...cites], citedBy: [...citedBy] };
}

/** Relations de toutes les pages de la vue, en une passe (liste accessible). */
export function relationIndex(view: Pick<GraphView, "nodes" | "links">): Map<string, Relations> {
	const m = new Map<string, Relations>(view.nodes.map((n) => [n.id, { cites: [], citedBy: [] }]));
	for (const l of view.links) {
		m.get(l.source)?.cites.push(l.target);
		m.get(l.target)?.citedBy.push(l.source);
		if (l.mutual) { m.get(l.source)?.citedBy.push(l.target); m.get(l.target)?.cites.push(l.source); }
	}
	return m;
}

export type SimLink = { source: string | { id: string }; target: string | { id: string }; twin?: boolean };

/**
 * Liens à donner à force-graph. Les particules vont de `source` vers `target` ; un lien réciproque reçoit un jumeau inverse
 * (`twin`, sans trait propre) pour que des particules circulent dans les deux sens sur la même arête (UX45).
 */
export function simLinks(links: readonly GLink[]): SimLink[] {
	const out: SimLink[] = [];
	for (const l of links) {
		out.push({ source: l.source, target: l.target });
		if (l.mutual) out.push({ source: l.target, target: l.source, twin: true });
	}
	return out;
}

export type ParticleOpts = { calm: boolean; paused: boolean; hot: boolean; dim: boolean; linkCount: number };
/** Au-delà de ce nombre de liens, plus de particules ambiantes (coût de dessin) ; le voisinage mis en valeur en garde toujours. */
export const AMBIENT_MAX_LINKS = 250;

/** Nombre de particules d'un lien : 3 sur le voisinage en valeur, 1 en ambiance (jamais sous mouvement réduit, en pause ou quand un voisinage est isolé). */
export function particleCount({ calm, paused, hot, dim, linkCount }: ParticleOpts): number {
	if (calm || paused) return 0;
	if (hot) return 3;
	return dim || linkCount > AMBIENT_MAX_LINKS ? 0 : 1;
}

/** Normalise `?focus=` : décodé, sans barre initiale ni finale, sans extension `.md`. Renvoie l'id d'un nœud connu ou `null`. */
export function resolveFocus(search: string, nodes: readonly Pick<GNode, "id">[]): { id: string | null; asked: string | null } {
	const raw = new URLSearchParams(search).get("focus");
	if (raw === null) return { id: null, asked: null };
	const asked = raw.trim().replace(/^\/?(wiki\/)?/, "").replace(/\/+$/, "").replace(/\.md$/, "");
	return { id: asked && nodes.some((n) => n.id === asked) ? asked : null, asked: asked || null };
}

/**
 * Recherche d'une page par son titre (insensible à la casse et aux accents). Ordre : titre qui commence par la requête,
 * puis un mot du titre, puis sous-chaîne, puis tous les mots présents ; à égalité, les plus liées d'abord puis l'ordre alphabétique.
 */
export function searchNodes<T extends Pick<GNode, "title" | "degree">>(nodes: readonly T[], query: string, limit = 8): T[] {
	const q = fold(query).trim();
	if (!q) return [];
	const words = q.split(/\s+/);
	const scored: { n: T; s: number; t: string }[] = [];
	for (const n of nodes) {
		const t = fold(n.title);
		let s = -1;
		if (t.startsWith(q)) s = 0;
		else if (t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) s = 1;
		else if (t.includes(q)) s = 2;
		else if (words.length > 1 && words.every((w) => t.includes(w))) s = 3;
		if (s >= 0) scored.push({ n, s, t });
	}
	scored.sort((a, b) => a.s - b.s || b.n.degree - a.n.degree || a.t.localeCompare(b.t));
	return scored.slice(0, limit).map((x) => x.n);
}

/**
 * Temporisateur à une seule échéance : en programmer un nouveau annule le précédent, `cancel` l'annule (interaction manuelle, démontage).
 * Les fonctions de minuterie sont injectables pour le test.
 */
export function createTimer(set: (fn: () => void, ms: number) => unknown = setTimeout, clear: (h: any) => void = clearTimeout) {
	let handle: unknown;
	let pending = false;
	const cancel = () => { if (pending) clear(handle); pending = false; handle = undefined; };
	return {
		schedule(fn: () => void, ms: number) {
			cancel();
			pending = true;
			handle = set(() => { pending = false; handle = undefined; fn(); }, ms);
		},
		cancel,
		get pending() { return pending; },
	};
}
