<script lang="ts">
	// Living style guide: the owner validates the design system here before any page is redesigned. Nothing is mocked
	// up: every sample is the real component, token or icon, rendered by the site (Part I section 2-5 and Part II of
	// docs/UI-REDESIGN.md). Showcase labels are plain French on purpose (a reference for the owner, not site content).
	// The page is prerendered but not linked from the navigation (kit.prerender entries default to every route).
	import { onMount } from "svelte";
	import tokens from "../../../../design/tokens.json";
	import { iconUse, ICON_NAMES, type IconName } from "#lib/icons.js";
	import Icon from "#lib/components/icon.svelte";
	import CortexMark from "#lib/components/cortex-mark.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import AssistantAvatar, { type FolioState } from "#lib/components/assistant/assistant-avatar.svelte";
	import TypeBadge from "#lib/components/type-badge.svelte";
	import KindBadge from "#lib/components/kind-badge.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TrustIcon from "#lib/components/trust-icon.svelte";
	import ChipButton from "#lib/components/chip-button.svelte";
	import Breadcrumb from "#lib/components/breadcrumb.svelte";
	import ResultRow from "#lib/components/result-row.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import * as NativeSelect from "#lib/components/ui/native-select/index.js";
	import { Separator } from "#lib/components/ui/separator/index.js";
	import * as Alert from "#lib/components/ui/alert/index.js";
	import * as Empty from "#lib/components/ui/empty/index.js";
	import * as Card from "#lib/components/ui/card/index.js";
	import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.js";
	import * as Tabs from "#lib/components/ui/tabs/index.js";

	// ---- colours -------------------------------------------------------------------------------------------------
	// tokens.css only scopes the dark palette on :root, so the dark panel cannot be a plain wrapper: both panels set
	// their palette inline from design/tokens.json (the single source the CSS is generated from). Aliases are resolved.
	type Mode = "light" | "dark";
	const palette = (mode: Mode): Record<string, string> => {
		const own: Record<string, string> = { ...tokens[mode] };
		for (const [name, ref] of Object.entries(tokens.aliases)) own[name] = own[ref.slice(1, -1)];
		return own;
	};
	const PALETTES = { light: palette("light"), dark: palette("dark") } as const;
	const lum = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const contrast = (a: string, b: string) => {
		const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
		return (hi + 0.05) / (lo + 0.05);
	};

	// k: text = 4.5:1 (AA), ui = 3:1 (non-text component), deco = a decorative rule, no threshold.
	type Row = { n: string; pair?: [fg: string, bg: string]; k?: "text" | "ui" | "deco"; note?: string };
	const text = (n: string, bg: string): Row => ({ n, pair: [n, bg], k: "text" });
	const GROUPS: { title: string; rows: Row[] }[] = [
		{ title: "Surfaces et texte", rows: [
			{ n: "--background" }, text("--foreground", "--background"),
			{ n: "--card" }, text("--card-foreground", "--card"),
			{ n: "--popover" }, text("--popover-foreground", "--popover"),
			{ n: "--secondary" }, text("--secondary-foreground", "--secondary"),
			{ n: "--muted" }, text("--muted-foreground", "--muted"),
			{ n: "--accent" }, text("--accent-foreground", "--accent"),
		] },
		{ title: "Bande d'en-tête", rows: [
			{ n: "--header" }, text("--header-foreground", "--header"),
			{ n: "--header-border", pair: ["--header-border", "--header"], k: "ui", note: "filet sous l'en-tête" },
		] },
		{ title: "Actions, liens et états", rows: [
			{ n: "--primary", pair: ["--primary", "--background"], k: "ui" }, text("--primary-foreground", "--primary"),
			text("--destructive", "--background"),
			{ n: "--ring", pair: ["--ring", "--background"], k: "ui" },
			text("--link", "--background"), text("--link-visited", "--background"),
			{ n: "--mark", pair: ["--foreground", "--mark"], k: "text", note: "texte courant sur surlignage" },
		] },
		{ title: "Bordures", rows: [
			{ n: "--border", pair: ["--border", "--background"], k: "deco" },
			{ n: "--input", pair: ["--input", "--card"], k: "ui", note: "contour d'un champ sur sa carte" },
		] },
		{ title: "Types de page", rows: ["concept", "entity", "synthesis", "source", "other"].map((x) => text(`--type-${x}`, "--background")) },
		{ title: "Entrées du journal", rows: ["add", "ingest", "query", "lint", "update"].map((x) => text(`--kind-${x}`, "--background")) },
		{ title: "Graphe", rows: [
			{ n: "--graph-background" },
			{ n: "--graph-edge", pair: ["--graph-edge", "--graph-background"], k: "ui" },
			{ n: "--graph-edge-active", pair: ["--graph-edge-active", "--graph-background"], k: "ui" },
			text("--graph-label", "--graph-background"),
		] },
		{ title: "Favori, notes et avertissements", rows: [
			text("--favorite", "--background"),
			{ n: "--note-background" }, text("--note-foreground", "--note-background"),
			{ n: "--warning-background" }, text("--warning-foreground", "--warning-background"),
		] },
		{ title: "Confiance (alias)", rows: ["verified", "unverified", "review", "stale", "partial", "draft", "deprecated"].map((x) => text(`--trust-${x}`, "--background")) },
	];
	const ratioText = (r: number) => `${r.toFixed(2).replace(".", ",")}:1`;
	const grade = (r: number, k: "text" | "ui" | "deco") => (k === "deco" ? "décoratif" : k === "text" ? (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : "sous 4,5:1") : r >= 3 ? "3:1 atteint" : "sous 3:1");
	const aliasOf = (n: string) => (tokens.aliases as Record<string, string>)[n]?.slice(1, -1);
	const panelStyle = (mode: Mode) =>
		Object.entries(PALETTES[mode]).map(([k, v]) => `${k}:${v}`).join(";") + `;color-scheme:${mode};background:${PALETTES[mode]["--background"]};color:${PALETTES[mode]["--foreground"]}`;
	const MODES = [{ mode: "light", title: "Clair" }, { mode: "dark", title: "Sombre" }] as const;

	// ---- typography ----------------------------------------------------------------------------------------------
	const SCALE = [
		{ cls: "text-[2.75rem] leading-[1.15] font-semibold tracking-tight", spec: "Titre 1 : 44 px, interligne 1,15, Source Sans 3 600", sample: "Retrouver une connaissance" },
		{ cls: "text-4xl leading-[1.15] font-semibold tracking-tight", spec: "Titre 2 : 36 px, interligne 1,15, Source Sans 3 600", sample: "Lire, puis vérifier les sources" },
		{ cls: "text-[1.75rem] leading-[1.15] font-semibold tracking-tight", spec: "Titre 3 : 28 px, interligne 1,15, Source Sans 3 600", sample: "Explorer les relations du graphe" },
		{ cls: "text-base", spec: "Corps de l'interface : 16 px, interligne 1,6, Source Sans 3 400", sample: "Navigation, commandes, formulaires et résultats de recherche." },
		{ cls: "text-base font-semibold", spec: "Corps appuyé : 16 px, Source Sans 3 600", sample: "Titre de résultat ou libellé de commande" },
		{ cls: "text-sm text-muted-foreground", spec: "Métadonnées : 14 px, texte secondaire", sample: "Concept, mis à jour le 25 novembre 2026, 3 sources" },
		{ cls: "text-xs text-muted-foreground", spec: "Détail : 12 px, seulement pour le non essentiel", sample: "Identifiant technique et compteurs secondaires" },
		{ cls: "font-mono text-sm", spec: "Code et identifiants : monospace système, 14 px", sample: "cortex export --out ./site" },
	];
	// Same markup as the export (src/export.ts: noteCallouts, footnote calls), the callout icons come from the sprite.
	const calloutTitle = (cls: string, icon: IconName, title: string) => `<p class="${cls}">${iconUse(icon, { class: "callout-icon" })}${title}</p>`;
	const PROSE = `
<h2>Un titre de section</h2>
<p>La prose longue est composée en Source Serif 4, 18 px sur ordinateur et 17 px sur mobile, interligne 1,7, sur une mesure de 70 caractères au plus. Un <a href="#couleurs">lien interne</a> est souligné et prend la couleur du lien<sup class="fn-ref"><a href="#fn-1" id="fnref-1-1" aria-label="Note 1">1</a></sup>, avec du <code>code en ligne</code> en monospace.</p>
<h3>Une liste et une citation</h3>
<ul><li>Les puces restent simples, sans surcharge décorative.</li><li>Les titres, les callouts et les tableaux gardent la sans de l'interface.</li></ul>
<ol><li>Première étape d'une procédure.</li><li>Seconde étape, qui contient un peu plus de texte pour montrer le retour à la ligne et l'alignement du numéro.</li></ol>
<blockquote><p>Une citation se distingue par un filet de 3 px et un texte secondaire, sans fond ni cadre arrondi.</p></blockquote>
<table><thead><tr><th>Type</th><th>Forme dans le graphe</th><th>Couleur</th></tr></thead><tbody><tr><td>Concept</td><td>Croix pleine</td><td><code>--type-concept</code></td></tr><tr><td>Entité</td><td>Carré plein</td><td><code>--type-entity</code></td></tr><tr><td>Synthèse</td><td>Losange plein</td><td><code>--type-synthesis</code></td></tr><tr><td>Source</td><td>Triangle plein</td><td><code>--type-source</code></td></tr></tbody></table>
<aside class="personal-note" role="note">${calloutTitle("personal-note-title", "note", "Note personnelle")}<p>Une note du propriétaire : fond papier jaune, filet de 4 px à gauche, titre en sans.</p></aside>
<aside class="callout-warning" role="note">${calloutTitle("callout-warning-title", "warning", "Avertissement")}<p>Une réserve sur la fiabilité d'une page : fond rouille, même structure que la note.</p></aside>`;

	// ---- shapes --------------------------------------------------------------------------------------------------
	const SPACING = [4, 8, 12, 16, 24, 32, 48, 64];
	// literal class names: Tailwind only generates what it can read
	const RADII = { xs: "rounded-xs", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl", "2xl": "rounded-2xl", "3xl": "rounded-3xl", "4xl": "rounded-4xl" };

	// ---- components ----------------------------------------------------------------------------------------------
	const BUTTONS = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
	const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;
	const BADGES = ["default", "secondary", "destructive", "outline", "stable", "caution", "ghost", "link"] as const;
	const FOCUS = "outline-2 outline-offset-2 outline-ring"; // what :focus-visible applies, shown without moving the focus
	const TYPES = ["Concept", "Entity", "Synthesis", "Source", "Inconnu"];
	const KINDS = ["add", "ingest", "query", "lint", "update"];
	const TRUST: [IconName, string][] = [["verified", "Vérifiée"], ["unverified", "Jamais relue"], ["needs-review", "À relire"], ["stale", "Périmée"], ["draft", "Brouillon"], ["deprecated", "Dépréciée"], ["warning", "Source partielle"]];
	const ROWS = [
		{ id: "a", type: "Concept", title: "Index d'un second cerveau", description: "Un wiki que l'agent entretient : pages, sources et liens.", status: "stable", verified: true },
		{ id: "b", type: "Entity", title: "Source Sans 3", description: "Famille sans empattement de l'interface.", status: "draft", partial: true },
		{ id: "c", type: "Synthesis", title: "Choix du design carré", description: "Pourquoi aucun rayon, aucune ombre, un anneau de focus de 2 px.", status: "stable", needsReview: true },
		{ id: "d", type: "Source", title: "Notes de lecture, novembre", description: "Extrait de la source brute.", status: "deprecated" },
	];

	let theme = $state("system");
	let chip = $state([true, false]);
	let tab = $state("lire");
	let tabLine = $state("resume");
	let reduced = $state<boolean | null>(null);
	let ready = $state(false);
	onMount(() => {
		ready = true;
		const q = matchMedia("(prefers-reduced-motion: reduce)");
		reduced = q.matches;
		const on = () => (reduced = q.matches);
		q.addEventListener("change", on);
		return () => q.removeEventListener("change", on);
	});
	const STATES: FolioState[] = ["idle", "pending", "answer", "error"];
	const AVATAR_SIZES = [24, 48, 96];
	const SECTIONS = [["couleurs", "Couleurs"], ["typographie", "Typographie"], ["formes", "Formes"], ["icones", "Icônes"], ["composants", "Composants"], ["marque", "Marque et avatar"]];
	const h2 = "anchor-target border-b pb-2 text-[1.75rem] leading-[1.15] font-semibold tracking-tight";
	const h3 = "anchor-target mt-8 mb-3 text-lg font-semibold";
	const cap = "text-muted-foreground text-sm";
	const box = "bg-card border p-4";
</script>

<svelte:head>
	<title>Design system · Cortex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div data-ready={ready}>
	<header class="max-w-3xl">
		<h1 class="text-3xl font-semibold tracking-tight">Design system</h1>
		<p class="text-muted-foreground mt-2">Référence vivante de Cortex : les jetons, les polices, les icônes, les composants et la marque, tels que le site les rend. Rien n'est une maquette. Le thème du site se change dans l'en-tête ; la section Couleurs montre les deux palettes côte à côte.</p>
		<nav aria-label="Sections de la page" class="mt-4">
			<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{#each SECTIONS as [id, label] (id)}<li><a href="#{id}" class="text-link underline underline-offset-4">{label}</a></li>{/each}
			</ul>
		</nav>
	</header>

	<!-- 1. colours -->
	<section aria-labelledby="h-couleurs" id="couleurs" class="mt-12">
		<h2 id="h-couleurs" class={h2}>Couleurs</h2>
		<p class="{cap} mt-3 max-w-3xl">Chaque jeton de <code>design/tokens.json</code>, en clair et en sombre. Le ratio est calculé contre le fond de sa paire (WCAG 2.2) : 4,5:1 pour le texte, 3:1 pour un composant d'interface, aucun seuil pour un filet décoratif. Le sombre n'est pas une inversion du clair.</p>
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			{#each MODES as { mode, title } (mode)}
				{@const p = PALETTES[mode]}
				<div data-panel={mode} class="border p-4" style={panelStyle(mode)}>
					<h3 class="text-lg font-semibold">{title}</h3>
					<!-- the real components, painted with this panel's palette -->
					<div class="bg-card text-card-foreground mt-3 flex flex-col gap-3 border p-3">
						<p>Texte courant, <a href="#couleurs" class="text-link underline underline-offset-4">un lien</a>, <mark>un surlignage</mark> et <span class="text-muted-foreground">un texte secondaire</span>.</p>
						<div class="flex flex-wrap items-center gap-2">
							<Button size="sm">Principal</Button>
							<Button size="sm" variant="outline">Contour</Button>
							<Button size="sm" variant="secondary">Secondaire</Button>
							<Button size="sm" variant="destructive">Détruire</Button>
							<Badge variant="caution">Brouillon</Badge>
							<Badge variant="outline">Concept</Badge>
						</div>
						<Input placeholder="Un champ" aria-label="Un champ, aperçu {title}" />
						<div class="flex flex-wrap gap-2 text-sm">
							<span class="px-2 py-1" style="background:{p['--note-background']};color:{p['--note-foreground']}">Note</span>
							<span class="px-2 py-1" style="background:{p['--warning-background']};color:{p['--warning-foreground']}">Avertissement</span>
						</div>
					</div>
					{#each GROUPS as group (group.title)}
						<h4 class="text-muted-foreground mt-5 mb-1 text-sm font-semibold">{group.title}</h4>
						<ul class="border-t">
							{#each group.rows as row (row.n)}
								{@const hex = p[row.n]}
								{@const r = row.pair ? contrast(p[row.pair[0]], p[row.pair[1]]) : undefined}
								<li class="flex items-center gap-3 border-b py-1.5" data-token={row.n}>
									<span class="size-6 shrink-0 border" style="background:{hex}"></span>
									<span class="min-w-0 flex-1 text-sm"><code class="font-mono break-all">{row.n}</code>
										<span class="text-muted-foreground whitespace-nowrap">{hex}{#if aliasOf(row.n)} = {aliasOf(row.n)}{/if}</span></span>
									{#if row.pair && r !== undefined && row.k}
										<span class="text-right text-sm tabular-nums" title={row.note ?? `${row.pair[0]} sur ${row.pair[1]}`}>{ratioText(r)} <span class="text-muted-foreground">{grade(r, row.k)}</span></span>
									{/if}
								</li>
							{/each}
						</ul>
					{/each}
				</div>
			{/each}
		</div>
	</section>

	<!-- 2. typography -->
	<section aria-labelledby="h-typographie" id="typographie" class="mt-14">
		<h2 id="h-typographie" class={h2}>Typographie</h2>
		<p class="{cap} mt-3 max-w-3xl">Source Sans 3 pour l'interface, Source Serif 4 pour la prose longue, monospace système pour le code. Polices auto-hébergées (SIL OFL 1.1).</p>
		<ul class="mt-6 border-t">
			{#each SCALE as s (s.spec)}
				<li class="grid gap-1 border-b py-3 md:grid-cols-[18rem_1fr] md:gap-6">
					<span class="{cap} font-mono text-sm">{s.spec}</span>
					<span class={s.cls}>{s.sample}</span>
				</li>
			{/each}
		</ul>
		<h3 class={h3}>Prose d'article (<code class="font-mono text-base">.wiki</code>)</h3>
		<article class="{box} md:p-6">
			<div class="wiki">{@html PROSE}</div>
			<ol class="text-muted-foreground mt-6 border-t pt-3 text-sm"><li class="note-item" id="fn-1">Une note de bas de page, cible du renvoi ci-dessus. <a href="#fnref-1-1" class="text-link underline underline-offset-4">Retour au texte</a></li></ol>
		</article>
	</section>

	<!-- 3. shapes -->
	<section aria-labelledby="h-formes" id="formes" class="mt-14">
		<h2 id="h-formes" class={h2}>Formes</h2>
		<p class="{cap} mt-3 max-w-3xl">Rayon 0 partout, bordures de 1 px, aucune ombre. Les surfaces se distinguent par le fond, le contour et l'ordre de superposition. Seuls les symboles gardent la courbe qui les rend reconnaissables.</p>
		<h3 class={h3}>Rayons</h3>
		<ul class="flex flex-wrap gap-4">
			{#each Object.entries(RADII) as [r, cls] (r)}
				<li class="flex flex-col items-center gap-1.5"><span class="bg-primary size-12 {cls}"></span><code class="font-mono text-sm">{cls}</code><span class={cap}>0px</span></li>
			{/each}
		</ul>
		<h3 class={h3}>Traits et séparateurs</h3>
		<div class="grid gap-4 md:grid-cols-3">
			<div class="{box}"><div class="border-border border p-3 text-sm">Filet ordinaire, 1 px <code class="font-mono">--border</code></div></div>
			<div class="{box}"><div class="border-input border p-3 text-sm">Contrôle, 1 px <code class="font-mono">--input</code></div></div>
			<div class="{box}"><div class="border-primary border-b-2 p-3 text-sm">Repère actif, 2 px <code class="font-mono">--primary</code></div></div>
		</div>
		<div class="{box} mt-4 flex items-center gap-4 text-sm">
			<span>Séparateur horizontal</span><Separator class="flex-1" />
			<span>vertical</span><Separator orientation="vertical" class="h-6" />
			<span>fin</span>
		</div>
		<h3 class={h3}>Anneau de focus</h3>
		<div class="{box} flex flex-wrap items-center gap-6">
			<div class="flex flex-col items-start gap-1.5">
				<span class="bg-card inline-flex h-9 items-center border px-3 text-sm outline-2 outline-offset-2 outline-ring" data-focus-static>Anneau statique</span>
				<span class={cap}>2 px <code class="font-mono">--ring</code>, décalage 2 px</span>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button id="focus-demo">Tab jusqu'ici</Button>
				<Button variant="outline">puis ici</Button>
				<a href="#formes" class="text-link inline-flex h-9 items-center px-2 text-sm underline underline-offset-4">un lien</a>
				<Input class="w-40" placeholder="un champ" aria-label="Champ de démonstration du focus" />
			</div>
		</div>
		<h3 class={h3}>Échelle d'espacement</h3>
		<ul class="{box} flex flex-col gap-2">
			{#each SPACING as s (s)}
				<li class="flex items-center gap-3 text-sm"><span class="w-12 shrink-0 tabular-nums">{s} px</span><span class="bg-primary h-4" style="width:{s}px"></span></li>
			{/each}
		</ul>
	</section>

	<!-- 4. icons -->
	<section aria-labelledby="h-icones" id="icones" class="mt-14">
		<h2 id="h-icones" class={h2}>Icônes</h2>
		<p class="{cap} mt-3 max-w-3xl">{ICON_NAMES.length} icônes sur une grille de 24, trait 1,75 (2 sous 18 px), terminaisons droites, jointures vives. Chaque instance est un <code>&lt;use&gt;</code> du sprite de la page. Tailles 16, 20 et 24 px.</p>
		<ul class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] border-t border-l">
			{#each ICON_NAMES as name (name)}
				<li class="bg-card flex flex-col items-center gap-2 border-r border-b p-3" data-icon={name}>
					<span class="flex items-center gap-3"><Icon {name} size={16} /><Icon {name} size={20} /><Icon {name} size={24} /></span>
					<code class="font-mono text-sm">{name}</code>
				</li>
			{/each}
		</ul>
		<p class="{cap} mt-3 flex items-center gap-2"><Icon name="star" size={24} filled class="text-favorite" /> <code class="font-mono">star</code> avec <code class="font-mono">filled</code> : réservé à l'étoile active des favoris.</p>
	</section>

	<!-- 5. components -->
	<section aria-labelledby="h-composants" id="composants" class="mt-14">
		<h2 id="h-composants" class={h2}>Composants</h2>
		<p class="{cap} mt-3 max-w-3xl">Primitives de <code>ui/</code> et composants Cortex. Les cellules « focus » reproduisent l'anneau sans déplacer le focus ; « invalide » pose <code>aria-invalid</code>.</p>

		<h3 id="c-button" class={h3}>Button</h3>
		<div class="{box} flex flex-col gap-5">
			{#each BUTTONS as variant (variant)}
				<div>
					<code class="font-mono text-sm">{variant}</code>
					<div class="mt-1.5 flex flex-wrap items-center gap-3">
						<Button {variant}>Action</Button>
						<Button {variant}><Icon name="download" size={16} />Avec icône</Button>
						<Button {variant} disabled>Désactivé</Button>
						<Button {variant} class={variant === "destructive" ? "outline-destructive outline-2 outline-offset-2" : FOCUS}>Focus</Button>
						<Button {variant} href="#c-button">Lien</Button>
					</div>
				</div>
			{/each}
			<div>
				<code class="font-mono text-sm">tailles</code>
				<div class="mt-1.5 flex flex-wrap items-center gap-3">
					{#each BUTTON_SIZES as size (size)}<Button variant="outline" {size}>{size}</Button>{/each}
					<Button variant="outline" size="icon" aria-label="Fermer"><Icon name="close-selection" size={16} /></Button>
					<Button variant="outline" size="icon-sm" aria-label="Copier"><Icon name="copy-link" size={16} /></Button>
				</div>
			</div>
		</div>

		<h3 id="c-badge" class={h3}>Badge</h3>
		<div class="{box} flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">{#each BADGES as variant (variant)}<Badge {variant}>{variant}</Badge>{/each}</div>
			<div class="flex flex-wrap items-center gap-2">
				<Badge size="sm" variant="secondary">petit</Badge>
				<Badge variant="outline"><Icon name="concept" size={16} />avec symbole</Badge>
				<Badge variant="outline" href="#c-badge">lien</Badge>
			</div>
		</div>

		<h3 id="c-fields" class={h3}>Input, Textarea, Native Select</h3>
		<div class="{box} grid gap-5 md:grid-cols-2">
			<label class="flex flex-col gap-1.5 text-sm font-medium">Normal<Input placeholder="Rechercher dans le wiki" /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Focus<Input value="Valeur saisie" class={FOCUS} /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Désactivé<Input value="Non modifiable" disabled /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Invalide<Input value="not-an-address" aria-invalid="true" /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Textarea<Textarea placeholder="Une question ou une note" /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Textarea invalide<Textarea aria-invalid="true" value="Trop court" /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Native Select
				<NativeSelect.Root><NativeSelect.Option value="all">Tous les types</NativeSelect.Option><NativeSelect.Option value="concept">Concept</NativeSelect.Option><NativeSelect.Option value="entity">Entité</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Select désactivé
				<NativeSelect.Root disabled><NativeSelect.Option value="all">Tous les types</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Select invalide
				<NativeSelect.Root aria-invalid="true"><NativeSelect.Option value="">Choisir un type</NativeSelect.Option><NativeSelect.Option value="concept">Concept</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">Select petit
				<NativeSelect.Root size="sm"><NativeSelect.Option value="a">Plus récent</NativeSelect.Option><NativeSelect.Option value="b">Plus ancien</NativeSelect.Option></NativeSelect.Root>
			</label>
		</div>

		<h3 id="c-alert" class={h3}>Alert, Empty, Card</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<Alert.Root>
				<Icon name="note" size={16} />
				<Alert.Title>Information</Alert.Title>
				<Alert.Description>Un message neutre : contour de 1 px, fond carte, aucun ornement.</Alert.Description>
			</Alert.Root>
			<Alert.Root variant="destructive">
				<Icon name="warning" size={16} />
				<Alert.Title>Échec de l'opération</Alert.Title>
				<Alert.Description>La variante destructive change le contour et le texte, jamais la forme.</Alert.Description>
				<Alert.Action><Button size="xs" variant="outline">Réessayer</Button></Alert.Action>
			</Alert.Root>
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon"><Icon name="search" size={20} /></Empty.Media>
					<Empty.Title>Aucun résultat</Empty.Title>
					<Empty.Description>Aucune page ne correspond à cette recherche. Essayez moins de filtres.</Empty.Description>
				</Empty.Header>
				<Empty.Content><Button variant="outline" size="sm">Effacer les filtres</Button></Empty.Content>
			</Empty.Root>
			<div class="flex flex-col gap-4">
				<Card.Root>
					<Card.Header>
						<Card.Title>Carte</Card.Title>
						<Card.Description>Un vrai groupe, pas une enveloppe de section.</Card.Description>
					</Card.Header>
					<Card.Content class="px-4 text-sm">Contenu de la carte : fond <code class="font-mono">--card</code>, contour 1 px.</Card.Content>
					<Card.Footer class="border-t px-4 py-3"><Button size="sm" variant="outline">Action</Button></Card.Footer>
				</Card.Root>
				<Card.Root size="sm">
					<Card.Header><Card.Title>Carte compacte</Card.Title><Card.Description>Variante <code class="font-mono">size="sm"</code>.</Card.Description></Card.Header>
				</Card.Root>
			</div>
		</div>

		<h3 id="c-menu" class={h3}>Dropdown Menu</h3>
		<div class="{box} flex flex-wrap items-center gap-4">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger variant="outline" id="menu-demo">Préférences<Icon name="chevron-down" size={16} /></DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Label>Affichage</DropdownMenu.Label>
					<DropdownMenu.RadioGroup bind:value={theme}>
						<DropdownMenu.RadioItem value="system">Système</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem value="light">Clair</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem value="dark">Sombre</DropdownMenu.RadioItem>
					</DropdownMenu.RadioGroup>
					<DropdownMenu.Separator />
					<DropdownMenu.Item><Icon name="copy-link" size={16} />Copier le lien</DropdownMenu.Item>
					<DropdownMenu.Item disabled><Icon name="download" size={16} />Télécharger</DropdownMenu.Item>
					<DropdownMenu.Item variant="destructive"><Icon name="clear" size={16} />Effacer l'historique</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<span class={cap}>Choix courant : <code class="font-mono">{theme}</code>. Clic, Entrée, Espace ou flèche bas pour ouvrir ; flèches, Origine, Fin pour parcourir ; Échap pour fermer.</span>
		</div>

		<h3 id="c-tabs" class={h3}>Tabs</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<div class={box}>
				<code class="font-mono text-sm">default (segmenté)</code>
				<Tabs.Root bind:value={tab} class="mt-2">
					<Tabs.List aria-label="Onglets segmentés">
						<Tabs.Trigger value="lire">Lire</Tabs.Trigger>
						<Tabs.Trigger value="sources">Sources</Tabs.Trigger>
						<Tabs.Trigger value="liens">Liens</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="lire" class="p-2 text-sm">Panneau « Lire » : le texte de la réponse.</Tabs.Content>
					<Tabs.Content value="sources" class="p-2 text-sm">Panneau « Sources » : les pages citées.</Tabs.Content>
					<Tabs.Content value="liens" class="p-2 text-sm">Panneau « Liens » : les pages voisines.</Tabs.Content>
				</Tabs.Root>
			</div>
			<div class={box}>
				<code class="font-mono text-sm">line (soulignement)</code>
				<Tabs.Root bind:value={tabLine} class="mt-2">
					<Tabs.List variant="line" aria-label="Onglets soulignés">
						<Tabs.Trigger value="resume">Résumé</Tabs.Trigger>
						<Tabs.Trigger value="detail">Détail</Tabs.Trigger>
						<Tabs.Trigger value="gone" disabled>Désactivé</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="resume" class="p-2 text-sm">Panneau « Résumé » : repère actif de 2 px sous l'onglet.</Tabs.Content>
					<Tabs.Content value="detail" class="p-2 text-sm">Panneau « Détail » : flèches gauche et droite changent d'onglet.</Tabs.Content>
				</Tabs.Root>
			</div>
		</div>

		<h3 id="c-cortex" class={h3}>Badges Cortex</h3>
		<div class="{box} flex flex-col gap-4">
			<div><span class={cap}>Types de page</span><div class="mt-1.5 flex flex-wrap gap-2">{#each TYPES as type (type)}<TypeBadge {type} />{/each}</div></div>
			<div><span class={cap}>Entrées du journal</span><div class="mt-1.5 flex flex-wrap gap-2">{#each KINDS as kind (kind)}<KindBadge {kind} />{/each}</div></div>
			<div><span class={cap}>Statuts : brouillon et déprécié ; « stable » n'affiche rien</span>
				<div class="mt-1.5 flex flex-wrap items-center gap-4"><StatusBadge status="draft" /><StatusBadge status="deprecated" /><StatusBadge status="stable" /><Badge variant="stable">stable</Badge><Badge variant="caution">brouillon</Badge><Badge variant="destructive">déprécié</Badge></div></div>
			<div><span class={cap}>Confiance : icône seule (libellé en infobulle et pour les lecteurs d'écran), puis avec son libellé</span>
				<ul class="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">{#each TRUST as [icon, label] (icon)}<li class="flex items-center gap-1.5 text-sm"><TrustIcon {icon} {label} /><span aria-hidden="true">{label}</span></li>{/each}</ul></div>
		</div>

		<h3 id="c-chip" class={h3}>Chip button et fil d'Ariane</h3>
		<div class="{box} flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<ChipButton pressed={chip[0]} onclick={() => (chip[0] = !chip[0])}>Appuyé</ChipButton>
				<ChipButton pressed={chip[1]} onclick={() => (chip[1] = !chip[1])}>Relâché</ChipButton>
				<span class={cap}>Deux états (<code class="font-mono">aria-pressed</code>), cliquez pour basculer.</span>
			</div>
			<Breadcrumb type="Concept" title="Index d'un second cerveau" />
		</div>

		<h3 id="c-row" class={h3}>Result row</h3>
		<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
			<ul class="bg-card divide-y border">
				{#each ROWS as doc (doc.id)}<li class="p-4"><ResultRow {doc} href="#c-row" showFav /></li>{/each}
				<li class="p-4"><ResultRow doc={ROWS[0]} href="#c-row" titleHtml="Index d'un <mark>second</mark> cerveau" snippetHtml="…un wiki que l'agent entretient, avec un <mark>second</mark> niveau de sources…" /></li>
			</ul>
			<div>
				<span class={cap}>Forme compacte (palette)</span>
				<ul class="bg-card mt-1.5 divide-y border">
					{#each ROWS as doc (doc.id)}<li class="p-3"><ResultRow {doc} compact /></li>{/each}
				</ul>
			</div>
		</div>
	</section>

	<!-- 6. brand -->
	<section aria-labelledby="h-marque" id="marque" class="mt-14 mb-8">
		<h2 id="h-marque" class={h2}>Marque et avatar</h2>
		<p class="{cap} mt-3 max-w-3xl">Le folio indexé : deux feuilles décalées, une marge, des lignes d'index et un curseur carré. Dessin unique en SVG, jamais d'image. Les couleurs viennent des jetons.</p>
		<h3 class={h3}>Marque</h3>
		<div class="{box} flex flex-wrap items-center gap-x-12 gap-y-6">
			<div>
				<span class="inline-flex items-center gap-2 py-1 font-semibold tracking-tight"><CortexMark size={24} /><CortexWordmark /></span>
				<p class={cap}>En-tête : marque 24 px et mot</p>
			</div>
			<div>
				<span class="flex items-end gap-3"><CortexMark size={72} /><span class="pb-2 text-3xl font-semibold tracking-tight"><CortexWordmark /></span></span>
				<p class="{cap} mt-1">Accueil : marque 72 px, mot au titre 1</p>
			</div>
		</div>
		<h3 class={h3}>Avatar de l'assistant</h3>
		<div class="{box} overflow-x-auto">
			<table class="w-fit text-sm">
				<thead><tr><th scope="col" class="p-2 pr-16 text-left font-semibold">État</th>{#each AVATAR_SIZES as s (s)}<th scope="col" class="p-2 pr-16 text-left font-semibold">{s} px</th>{/each}</tr></thead>
				<tbody>
					{#each STATES as state (state)}
						<tr class="border-t">
							<th scope="row" class="p-2 text-left align-middle font-normal"><code class="font-mono">{state}</code></th>
							{#each AVATAR_SIZES as s (s)}<td class="p-2 pr-16 align-middle"><AssistantAvatar {state} size={s} /></td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="{cap} mt-3 max-w-3xl">
			<code class="font-mono">idle</code> : immobile, curseur sur le premier repère. <code class="font-mono">pending</code> : le curseur parcourt les repères par pas orthogonaux. <code class="font-mono">answer</code> : curseur sur le dernier repère, règle de conclusion tracée une fois. <code class="font-mono">error</code> : l'index s'interrompt sur un repère angulaire.
			Avec <code class="font-mono">prefers-reduced-motion: reduce</code>, rien ne bouge : chaque état est une composition fixe distincte (en attente, le curseur reste sur le repère du milieu). L'animation ne porte jamais seule l'information, le texte de statut reste dans le panneau.
			{#if reduced !== null}<span data-motion={reduced ? "reduce" : "no-preference"}> Votre système demande actuellement : {reduced ? "mouvement réduit" : "animations permises"}.</span>{/if}
		</p>
	</section>
</div>
