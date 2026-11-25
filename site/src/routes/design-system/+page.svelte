<script lang="ts">
	// Living style guide: the owner validates the design system here before any page is redesigned. Nothing is mocked
	// up: every sample is the real component, token or icon, rendered by the site (Part I section 2-5 and Part II of
	// docs/UI-REDESIGN.md). Every label goes through the i18n dictionaries (`ds.` keys) like the rest of the site; the layout
	// re-mounts its content on a language switch ({#key lang.current}), so the arrays below, built at instance creation, follow.
	// Sentences with inline markup stay whole in the dictionary: `code` is written between backticks and `{name}` marks a slot
	// the template fills (a link, a highlight), so no HTML ever comes from the JSON. The page is prerendered but not linked from the navigation (kit.prerender entries default to every route).
	import { onMount } from "svelte";
	import { intlLocale, t } from "#lib/i18n/index.js";
	import tokens from "../../../../design/tokens.json";
	import { iconUse, ICON_NAMES, type IconName } from "#lib/icons.js";
	import Icon from "#lib/components/icon.svelte";
	import CortexMark from "#lib/components/cortex-mark.svelte";
	import CortexWordmark from "#lib/components/cortex-wordmark.svelte";
	import AssistantAvatar, { type AvatarState } from "#lib/components/assistant/assistant-avatar.svelte";
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
		{ title: t("ds.grp.surfaces"), rows: [
			{ n: "--background" }, text("--foreground", "--background"),
			{ n: "--card" }, text("--card-foreground", "--card"),
			{ n: "--popover" }, text("--popover-foreground", "--popover"),
			{ n: "--secondary" }, text("--secondary-foreground", "--secondary"),
			{ n: "--muted" }, text("--muted-foreground", "--muted"),
			{ n: "--accent" }, text("--accent-foreground", "--accent"),
		] },
		{ title: t("ds.grp.header"), rows: [
			{ n: "--header" }, text("--header-foreground", "--header"),
			{ n: "--header-border", pair: ["--header-border", "--header"], k: "ui", note: t("ds.note.header") },
		] },
		{ title: t("ds.grp.actions"), rows: [
			{ n: "--primary", pair: ["--primary", "--background"], k: "ui" }, text("--primary-foreground", "--primary"),
			text("--destructive", "--background"),
			{ n: "--ring", pair: ["--ring", "--background"], k: "ui" },
			text("--link", "--background"), text("--link-visited", "--background"),
			{ n: "--mark", pair: ["--foreground", "--mark"], k: "text", note: t("ds.note.mark") },
		] },
		{ title: t("ds.grp.borders"), rows: [
			{ n: "--border", pair: ["--border", "--background"], k: "deco" },
			{ n: "--input", pair: ["--input", "--card"], k: "ui", note: t("ds.note.input") },
		] },
		{ title: t("ds.grp.types"), rows: ["concept", "entity", "synthesis", "source", "other"].map((x) => text(`--type-${x}`, "--background")) },
		{ title: t("ds.grp.kinds"), rows: ["add", "ingest", "query", "lint", "update"].map((x) => text(`--kind-${x}`, "--background")) },
		{ title: t("ds.grp.graph"), rows: [
			{ n: "--graph-background" },
			{ n: "--graph-edge", pair: ["--graph-edge", "--graph-background"], k: "ui" },
			{ n: "--graph-edge-active", pair: ["--graph-edge-active", "--graph-background"], k: "ui" },
			text("--graph-label", "--graph-background"),
		] },
		{ title: t("ds.grp.favorite"), rows: [
			text("--favorite", "--background"),
			{ n: "--note-background" }, text("--note-foreground", "--note-background"),
			{ n: "--warning-background" }, text("--warning-foreground", "--warning-background"),
		] },
		{ title: t("ds.grp.trust"), rows: ["verified", "unverified", "review", "stale", "partial", "draft", "deprecated"].map((x) => text(`--trust-${x}`, "--background")) },
	];
	const ratioText = (r: number) => `${r.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}:1`;
	const grade = (r: number, k: "text" | "ui" | "deco") => (k === "deco" ? t("ds.grade.deco") : k === "text" ? (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : t("ds.grade.belowText")) : r >= 3 ? t("ds.grade.ui") : t("ds.grade.belowUi"));
	const aliasOf = (n: string) => (tokens.aliases as Record<string, string>)[n]?.slice(1, -1);
	const panelStyle = (mode: Mode) =>
		Object.entries(PALETTES[mode]).map(([k, v]) => `${k}:${v}`).join(";") + `;color-scheme:${mode};background:${PALETTES[mode]["--background"]};color:${PALETTES[mode]["--foreground"]}`;
	const MODES = [{ mode: "light", title: t("ds.mode.light") }, { mode: "dark", title: t("ds.mode.dark") }] as const;
	const slots = (s: string) => s.split(/\{(\w+)\}/); // text, slot name, text, slot name, ...

	// ---- typography ----------------------------------------------------------------------------------------------
	const SCALE = [
		{ cls: "text-[2.75rem] leading-[1.15] font-semibold tracking-tight", spec: t("ds.scale.h1.spec"), sample: t("ds.scale.h1.sample") },
		{ cls: "text-4xl leading-[1.15] font-semibold tracking-tight", spec: t("ds.scale.h2.spec"), sample: t("ds.scale.h2.sample") },
		{ cls: "text-[1.75rem] leading-[1.15] font-semibold tracking-tight", spec: t("ds.scale.h3.spec"), sample: t("ds.scale.h3.sample") },
		{ cls: "text-base", spec: t("ds.scale.body.spec"), sample: t("ds.scale.body.sample") },
		{ cls: "text-base font-semibold", spec: t("ds.scale.strong.spec"), sample: t("ds.scale.strong.sample") },
		{ cls: "text-sm text-muted-foreground", spec: t("ds.scale.meta.spec"), sample: t("ds.scale.meta.sample") },
		{ cls: "text-xs text-muted-foreground", spec: t("ds.scale.detail.spec"), sample: t("ds.scale.detail.sample") },
		{ cls: "font-mono text-sm", spec: t("ds.scale.code.spec"), sample: "cortex export --out ./site" },
	];
	// Same markup as the export (src/export.ts: noteCallouts, footnote calls), the callout icons come from the sprite.
	// The sample is HTML built here from the dictionary strings, escaped by `x`; `fill` swaps a `{slot}` for template markup.
	const x = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const fill = (v: string, map: Record<string, string>) => x(v).replace(/\{(\w+)\}/g, (_, k: string) => map[k] ?? "");
	const calloutTitle = (cls: string, icon: IconName, title: string) => `<p class="${cls}">${iconUse(icon, { class: "callout-icon" })}${x(title)}</p>`;
	const PROSE = `
<h2>${x(t("ds.prose.h2"))}</h2>
<p>${fill(t("ds.prose.p1"), { link: `<a href="#couleurs">${x(t("ds.prose.link"))}</a>`, fn: `<sup class="fn-ref"><a href="#fn-1" id="fnref-1-1" aria-label="${x(t("ds.prose.note1"))}">1</a></sup>`, code: `<code>${x(t("ds.prose.code"))}</code>` })}</p>
<h3>${x(t("ds.prose.h3"))}</h3>
<ul><li>${x(t("ds.prose.li1"))}</li><li>${x(t("ds.prose.li2"))}</li></ul>
<ol><li>${x(t("ds.prose.ol1"))}</li><li>${x(t("ds.prose.ol2"))}</li></ol>
<blockquote><p>${x(t("ds.prose.quote"))}</p></blockquote>
<table><thead><tr><th>${x(t("ds.prose.th.type"))}</th><th>${x(t("ds.prose.th.shape"))}</th><th>${x(t("ds.prose.th.color"))}</th></tr></thead><tbody><tr><td>${x(t("type.Concept"))}</td><td>${x(t("ds.prose.shape.cross"))}</td><td><code>--type-concept</code></td></tr><tr><td>${x(t("type.Entity"))}</td><td>${x(t("ds.prose.shape.square"))}</td><td><code>--type-entity</code></td></tr><tr><td>${x(t("type.Synthesis"))}</td><td>${x(t("ds.prose.shape.diamond"))}</td><td><code>--type-synthesis</code></td></tr><tr><td>${x(t("type.Source"))}</td><td>${x(t("ds.prose.shape.triangle"))}</td><td><code>--type-source</code></td></tr></tbody></table>
<aside class="personal-note" role="note">${calloutTitle("personal-note-title", "note", t("ds.prose.noteTitle"))}<p>${x(t("ds.prose.noteBody"))}</p></aside>
<aside class="callout-warning" role="note">${calloutTitle("callout-warning-title", "warning", t("ds.prose.warnTitle"))}<p>${x(t("ds.prose.warnBody"))}</p></aside>`;

	// ---- shapes --------------------------------------------------------------------------------------------------
	const SPACING = [4, 8, 12, 16, 24, 32, 48, 64];
	// literal class names: Tailwind only generates what it can read
	const RADII = { xs: "rounded-xs", sm: "rounded-sm", md: "rounded-md", lg: "rounded-lg", xl: "rounded-xl", "2xl": "rounded-2xl", "3xl": "rounded-3xl", "4xl": "rounded-4xl" };

	// ---- components ----------------------------------------------------------------------------------------------
	const BUTTONS = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;
	const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;
	const BADGES = ["default", "secondary", "destructive", "outline", "stable", "caution", "ghost", "link"] as const;
	const FOCUS = "outline-2 outline-offset-2 outline-ring"; // what :focus-visible applies, shown without moving the focus
	const TYPES = ["Concept", "Entity", "Synthesis", "Source", t("ds.badges.unknownType")];
	const KINDS = ["add", "ingest", "query", "lint", "update"];
	const TRUST: [IconName, string][] = [["verified", t("ds.trust.verified")], ["unverified", t("ds.trust.unverified")], ["needs-review", t("ds.trust.review")], ["stale", t("ds.trust.stale")], ["draft", t("ds.trust.draft")], ["deprecated", t("ds.trust.deprecated")], ["warning", t("ds.trust.partial")]];
	const ROWS = [
		{ id: "a", type: "Concept", title: t("ds.row.a.title"), description: t("ds.row.a.description"), status: "stable", verified: true },
		{ id: "b", type: "Entity", title: "Source Sans 3", description: t("ds.row.b.description"), status: "draft", partial: true },
		{ id: "c", type: "Synthesis", title: t("ds.row.c.title"), description: t("ds.row.c.description"), status: "stable", needsReview: true },
		{ id: "d", type: "Source", title: t("ds.row.d.title"), description: t("ds.row.d.description"), status: "deprecated" },
	];

	let theme = $state("system");
	let chip = $state([true, false]);
	let tab = $state("lire"); // internal ids, never shown
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
	const STATES: AvatarState[] = ["idle", "pending", "answer", "error"];
	const AVATAR_SIZES = [24, 48, 96];
	const SECTIONS = [["couleurs", t("ds.sec.couleurs")], ["typographie", t("ds.sec.typographie")], ["formes", t("ds.sec.formes")], ["icones", t("ds.sec.icones")], ["composants", t("ds.sec.composants")], ["marque", t("ds.sec.marque")]];
	const h2 = "anchor-target border-b pb-2 text-[1.75rem] leading-[1.15] font-semibold tracking-tight";
	const h3 = "anchor-target mt-8 mb-3 text-lg font-semibold";
	const cap = "text-muted-foreground text-sm";
	const box = "bg-card border p-4";
	// the highlighted result row: the dictionary sentence has a {mark} slot, the word is wrapped here
	const highlighted = (sentence: string) => slots(sentence).map((seg, i) => (i % 2 ? `<mark>${x(t("ds.row.hl.word"))}</mark>` : x(seg))).join("");
</script>

{#snippet rich(s: string, cls = "font-mono")}{#each s.split("`") as seg, i}{#if i % 2}<code class={cls}>{seg}</code>{:else}{seg}{/if}{/each}{/snippet}

<svelte:head>
	<title>{t("ds.title")} · Cortex</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div data-ready={ready}>
	<header class="max-w-3xl">
		<h1 class="text-3xl font-semibold tracking-tight">{t("ds.title")}</h1>
		<p class="text-muted-foreground mt-2">{t("ds.intro")}</p>
		<nav aria-label={t("ds.nav")} class="mt-4">
			<ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{#each SECTIONS as [id, label] (id)}<li><a href="#{id}" class="text-link underline underline-offset-4">{label}</a></li>{/each}
			</ul>
		</nav>
	</header>

	<!-- 1. colours -->
	<section aria-labelledby="h-couleurs" id="couleurs" class="mt-12">
		<h2 id="h-couleurs" class={h2}>{t("ds.sec.couleurs")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.col.intro"))}</p>
		<div class="mt-6 grid gap-6 lg:grid-cols-2">
			{#each MODES as { mode, title } (mode)}
				{@const p = PALETTES[mode]}
				<div data-panel={mode} class="border p-4" style={panelStyle(mode)}>
					<h3 class="text-lg font-semibold">{title}</h3>
					<!-- the real components, painted with this panel's palette -->
					<div class="bg-card text-card-foreground mt-3 flex flex-col gap-3 border p-3">
						<p>{#each slots(t("ds.panel.text")) as seg, i}{#if i % 2 === 0}{seg}{:else if seg === "link"}<a href="#couleurs" class="text-link underline underline-offset-4">{t("ds.panel.link")}</a>{:else if seg === "mark"}<mark>{t("ds.panel.mark")}</mark>{:else}<span class="text-muted-foreground">{t("ds.panel.muted")}</span>{/if}{/each}</p>
						<div class="flex flex-wrap items-center gap-2">
							<Button size="sm">{t("ds.panel.primary")}</Button>
							<Button size="sm" variant="outline">{t("ds.panel.outline")}</Button>
							<Button size="sm" variant="secondary">{t("ds.panel.secondary")}</Button>
							<Button size="sm" variant="destructive">{t("ds.panel.destroy")}</Button>
							<Badge variant="caution">{t("ds.panel.draft")}</Badge>
							<Badge variant="outline">{t("ds.panel.concept")}</Badge>
						</div>
						<Input placeholder={t("ds.panel.field")} aria-label={t("ds.panel.fieldAria", { title })} />
						<div class="flex flex-wrap gap-2 text-sm">
							<span class="px-2 py-1" style="background:{p['--note-background']};color:{p['--note-foreground']}">{t("ds.panel.note")}</span>
							<span class="px-2 py-1" style="background:{p['--warning-background']};color:{p['--warning-foreground']}">{t("ds.panel.warning")}</span>
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
										<span class="text-right text-sm tabular-nums" title={row.note ?? t("ds.pairOn", { fg: row.pair[0], bg: row.pair[1] })}>{ratioText(r)} <span class="text-muted-foreground">{grade(r, row.k)}</span></span>
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
		<h2 id="h-typographie" class={h2}>{t("ds.sec.typographie")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.typo.intro"))}</p>
		<ul class="mt-6 border-t">
			{#each SCALE as s (s.spec)}
				<li class="grid gap-1 border-b py-3 md:grid-cols-[18rem_1fr] md:gap-6">
					<span class="{cap} font-mono text-sm">{s.spec}</span>
					<span class={s.cls}>{s.sample}</span>
				</li>
			{/each}
		</ul>
		<h3 class={h3}>{@render rich(t("ds.prose.heading"), "font-mono text-base")}</h3>
		<article class="{box} md:p-6">
			<div class="wiki">{@html PROSE}</div>
			<ol class="text-muted-foreground mt-6 border-t pt-3 text-sm"><li class="note-item" id="fn-1">{#each slots(t("ds.prose.footnote")) as seg, i}{#if i % 2 === 0}{seg}{:else}<a href="#fnref-1-1" class="text-link underline underline-offset-4">{t("ds.prose.back")}</a>{/if}{/each}</li></ol>
		</article>
	</section>

	<!-- 3. shapes -->
	<section aria-labelledby="h-formes" id="formes" class="mt-14">
		<h2 id="h-formes" class={h2}>{t("ds.sec.formes")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.shapes.intro"))}</p>
		<h3 class={h3}>{t("ds.shapes.radii")}</h3>
		<ul class="flex flex-wrap gap-4">
			{#each Object.entries(RADII) as [r, cls] (r)}
				<li class="flex flex-col items-center gap-1.5"><span class="bg-primary size-12 {cls}"></span><code class="font-mono text-sm">{cls}</code><span class={cap}>0px</span></li>
			{/each}
		</ul>
		<h3 class={h3}>{t("ds.shapes.strokes")}</h3>
		<div class="grid gap-4 md:grid-cols-3">
			<div class="{box}"><div class="border-border border p-3 text-sm">{@render rich(t("ds.shapes.stroke.border"))}</div></div>
			<div class="{box}"><div class="border-input border p-3 text-sm">{@render rich(t("ds.shapes.stroke.input"))}</div></div>
			<div class="{box}"><div class="border-primary border-b-2 p-3 text-sm">{@render rich(t("ds.shapes.stroke.primary"))}</div></div>
		</div>
		<div class="{box} mt-4 flex items-center gap-4 text-sm">
			<span>{t("ds.shapes.sep.h")}</span><Separator class="flex-1" />
			<span>{t("ds.shapes.sep.v")}</span><Separator orientation="vertical" class="h-6" />
			<span>{t("ds.shapes.sep.end")}</span>
		</div>
		<h3 class={h3}>{t("ds.shapes.float")}</h3>
		<p class="{cap} max-w-3xl">{@render rich(t("ds.shapes.float.p1"))}</p>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.shapes.float.p2"))}</p>
		<div class="{box} mt-3 grid gap-6 sm:grid-cols-2">
			<div class="bg-card shadow-surface border p-3 text-sm">{@render rich(t("ds.shapes.surface"))}</div>
			<div class="bg-popover text-popover-foreground border-input shadow-overlay border p-3 text-sm" data-floating>{@render rich(t("ds.shapes.overlay"))}</div>
		</div>
		<h3 class={h3}>{t("ds.focus.heading")}</h3>
		<div class="{box} flex flex-wrap items-center gap-6">
			<div class="flex flex-col items-start gap-1.5">
				<span class="bg-card inline-flex h-9 items-center border px-3 text-sm outline-2 outline-offset-2 outline-ring" data-focus-static>{t("ds.focus.static")}</span>
				<span class={cap}>{@render rich(t("ds.focus.spec"))}</span>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<Button id="focus-demo">{t("ds.focus.tab1")}</Button>
				<Button variant="outline">{t("ds.focus.tab2")}</Button>
				<a href="#formes" class="text-link inline-flex h-9 items-center px-2 text-sm underline underline-offset-4">{t("ds.focus.link")}</a>
				<Input class="w-40" placeholder={t("ds.focus.field")} aria-label={t("ds.focus.fieldAria")} />
			</div>
		</div>
		<h3 class={h3}>{t("ds.spacing")}</h3>
		<ul class="{box} flex flex-col gap-2">
			{#each SPACING as s (s)}
				<li class="flex items-center gap-3 text-sm"><span class="w-12 shrink-0 tabular-nums">{s} px</span><span class="bg-primary h-4" style="width:{s}px"></span></li>
			{/each}
		</ul>
	</section>

	<!-- 4. icons -->
	<section aria-labelledby="h-icones" id="icones" class="mt-14">
		<h2 id="h-icones" class={h2}>{t("ds.sec.icones")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.icons.intro", { count: ICON_NAMES.length }))}</p>
		<ul class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] border-t border-l">
			{#each ICON_NAMES as name (name)}
				<li class="bg-card flex flex-col items-center gap-2 border-r border-b p-3" data-icon={name}>
					<span class="flex items-center gap-3"><Icon {name} size={16} /><Icon {name} size={20} /><Icon {name} size={24} /></span>
					<code class="font-mono text-sm">{name}</code>
				</li>
			{/each}
		</ul>
		<p class="{cap} mt-3 flex items-center gap-2"><Icon name="star" size={24} filled class="text-favorite" /> {@render rich(t("ds.icons.star"))}</p>
	</section>

	<!-- 5. components -->
	<section aria-labelledby="h-composants" id="composants" class="mt-14">
		<h2 id="h-composants" class={h2}>{t("ds.sec.composants")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.comp.intro"))}</p>

		<h3 id="c-button" class={h3}>Button</h3>
		<div class="{box} flex flex-col gap-5">
			{#each BUTTONS as variant (variant)}
				<div>
					<code class="font-mono text-sm">{variant}</code>
					<div class="mt-1.5 flex flex-wrap items-center gap-3">
						<Button {variant}>{t("ds.c.action")}</Button>
						<Button {variant}><Icon name="download" size={16} />{t("ds.c.withIcon")}</Button>
						<Button {variant} disabled>{t("ds.c.disabled")}</Button>
						<Button {variant} class={variant === "destructive" ? "outline-destructive outline-2 outline-offset-2" : FOCUS}>{t("ds.c.focus")}</Button>
						<Button {variant} href="#c-button">{t("ds.c.link")}</Button>
					</div>
				</div>
			{/each}
			<div>
				<code class="font-mono text-sm">{t("ds.c.sizes")}</code>
				<div class="mt-1.5 flex flex-wrap items-center gap-3">
					{#each BUTTON_SIZES as size (size)}<Button variant="outline" {size}>{size}</Button>{/each}
					<Button variant="outline" size="icon" aria-label={t("ds.c.close")}><Icon name="close-selection" size={16} /></Button>
					<Button variant="outline" size="icon-sm" aria-label={t("ds.c.copy")}><Icon name="copy-link" size={16} /></Button>
				</div>
			</div>
		</div>

		<h3 id="c-badge" class={h3}>Badge</h3>
		<div class="{box} flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">{#each BADGES as variant (variant)}<Badge {variant}>{variant}</Badge>{/each}</div>
			<div class="flex flex-wrap items-center gap-2">
				<Badge size="sm" variant="secondary">{t("ds.badge.small")}</Badge>
				<Badge variant="outline"><Icon name="concept" size={16} />{t("ds.badge.symbol")}</Badge>
				<Badge variant="outline" href="#c-badge">{t("ds.badge.link")}</Badge>
			</div>
		</div>

		<h3 id="c-fields" class={h3}>Input, Textarea, Native Select</h3>
		<div class="{box} grid gap-5 md:grid-cols-2">
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.normal")}<Input placeholder={t("ds.field.search")} /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.c.focus")}<Input value={t("ds.field.value")} class={FOCUS} /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.c.disabled")}<Input value={t("ds.field.readonly")} disabled /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.invalid")}<Input value="not-an-address" aria-invalid="true" /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.textarea")}<Textarea placeholder={t("ds.field.textareaPlaceholder")} /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.textareaInvalid")}<Textarea aria-invalid="true" value={t("ds.field.tooShort")} /></label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.select")}
				<NativeSelect.Root><NativeSelect.Option value="all">{t("ds.field.allTypes")}</NativeSelect.Option><NativeSelect.Option value="concept">{t("ds.panel.concept")}</NativeSelect.Option><NativeSelect.Option value="entity">{t("ds.field.entity")}</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.selectDisabled")}
				<NativeSelect.Root disabled><NativeSelect.Option value="all">{t("ds.field.allTypes")}</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.selectInvalid")}
				<NativeSelect.Root aria-invalid="true"><NativeSelect.Option value="">{t("ds.field.chooseType")}</NativeSelect.Option><NativeSelect.Option value="concept">{t("ds.panel.concept")}</NativeSelect.Option></NativeSelect.Root>
			</label>
			<label class="flex flex-col gap-1.5 text-sm font-medium">{t("ds.field.selectSmall")}
				<NativeSelect.Root size="sm"><NativeSelect.Option value="a">{t("ds.field.newest")}</NativeSelect.Option><NativeSelect.Option value="b">{t("ds.field.oldest")}</NativeSelect.Option></NativeSelect.Root>
			</label>
		</div>

		<h3 id="c-alert" class={h3}>Alert, Empty, Card</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<Alert.Root>
				<Icon name="note" size={16} />
				<Alert.Title>{t("ds.alert.info")}</Alert.Title>
				<Alert.Description>{t("ds.alert.infoBody")}</Alert.Description>
			</Alert.Root>
			<Alert.Root variant="destructive">
				<Icon name="warning" size={16} />
				<Alert.Title>{t("ds.alert.fail")}</Alert.Title>
				<Alert.Description>{t("ds.alert.failBody")}</Alert.Description>
				<Alert.Action><Button size="xs" variant="outline">{t("ds.alert.retry")}</Button></Alert.Action>
			</Alert.Root>
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon"><Icon name="search" size={20} /></Empty.Media>
					<Empty.Title>{t("ds.empty.title")}</Empty.Title>
					<Empty.Description>{t("ds.empty.body")}</Empty.Description>
				</Empty.Header>
				<Empty.Content><Button variant="outline" size="sm">{t("ds.empty.clear")}</Button></Empty.Content>
			</Empty.Root>
			<div class="flex flex-col gap-4">
				<Card.Root>
					<Card.Header>
						<Card.Title>{t("ds.card.title")}</Card.Title>
						<Card.Description>{t("ds.card.description")}</Card.Description>
					</Card.Header>
					<Card.Content class="px-4 text-sm">{@render rich(t("ds.card.body"))}</Card.Content>
					<Card.Footer class="border-t px-4 py-3"><Button size="sm" variant="outline">{t("ds.c.action")}</Button></Card.Footer>
				</Card.Root>
				<Card.Root size="sm">
					<Card.Header><Card.Title>{t("ds.card.compact")}</Card.Title><Card.Description>{@render rich(t("ds.card.compactBody"))}</Card.Description></Card.Header>
				</Card.Root>
			</div>
		</div>

		<h3 id="c-menu" class={h3}>Dropdown Menu</h3>
		<div class="{box} flex flex-wrap items-center gap-4">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger variant="outline" id="menu-demo">{t("ds.menu.trigger")}<Icon name="chevron-down" size={16} /></DropdownMenu.Trigger>
				<DropdownMenu.Content>
					<DropdownMenu.Label>{t("ds.menu.display")}</DropdownMenu.Label>
					<DropdownMenu.RadioGroup bind:value={theme}>
						<DropdownMenu.RadioItem value="system">{t("ds.menu.system")}</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem value="light">{t("ds.menu.light")}</DropdownMenu.RadioItem>
						<DropdownMenu.RadioItem value="dark">{t("ds.menu.dark")}</DropdownMenu.RadioItem>
					</DropdownMenu.RadioGroup>
					<DropdownMenu.Separator />
					<DropdownMenu.Item><Icon name="copy-link" size={16} />{t("ds.menu.copyLink")}</DropdownMenu.Item>
					<DropdownMenu.Item disabled><Icon name="download" size={16} />{t("ds.menu.download")}</DropdownMenu.Item>
					<DropdownMenu.Item variant="destructive"><Icon name="clear" size={16} />{t("ds.menu.clear")}</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<span class={cap}>{@render rich(t("ds.menu.hint", { value: `\`${theme}\`` }))}</span>
		</div>

		<h3 id="c-tabs" class={h3}>Tabs</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<div class={box}>
				<code class="font-mono text-sm">{t("ds.tabs.segmented")}</code>
				<Tabs.Root bind:value={tab} class="mt-2">
					<Tabs.List aria-label={t("ds.tabs.segmentedAria")}>
						<Tabs.Trigger value="lire">{t("ds.tabs.read")}</Tabs.Trigger>
						<Tabs.Trigger value="sources">{t("ds.tabs.sources")}</Tabs.Trigger>
						<Tabs.Trigger value="liens">{t("ds.tabs.links")}</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="lire" class="p-2 text-sm">{t("ds.tabs.readBody")}</Tabs.Content>
					<Tabs.Content value="sources" class="p-2 text-sm">{t("ds.tabs.sourcesBody")}</Tabs.Content>
					<Tabs.Content value="liens" class="p-2 text-sm">{t("ds.tabs.linksBody")}</Tabs.Content>
				</Tabs.Root>
			</div>
			<div class={box}>
				<code class="font-mono text-sm">{t("ds.tabs.line")}</code>
				<Tabs.Root bind:value={tabLine} class="mt-2">
					<Tabs.List variant="line" aria-label={t("ds.tabs.lineAria")}>
						<Tabs.Trigger value="resume">{t("ds.tabs.summary")}</Tabs.Trigger>
						<Tabs.Trigger value="detail">{t("ds.tabs.detail")}</Tabs.Trigger>
						<Tabs.Trigger value="gone" disabled>{t("ds.c.disabled")}</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="resume" class="p-2 text-sm">{t("ds.tabs.summaryBody")}</Tabs.Content>
					<Tabs.Content value="detail" class="p-2 text-sm">{t("ds.tabs.detailBody")}</Tabs.Content>
				</Tabs.Root>
			</div>
		</div>

		<h3 id="c-cortex" class={h3}>{t("ds.badges.heading")}</h3>
		<div class="{box} flex flex-col gap-4">
			<div><span class={cap}>{t("ds.grp.types")}</span><div class="mt-1.5 flex flex-wrap gap-2">{#each TYPES as type (type)}<TypeBadge {type} />{/each}</div></div>
			<div><span class={cap}>{t("ds.grp.kinds")}</span><div class="mt-1.5 flex flex-wrap gap-2">{#each KINDS as kind (kind)}<KindBadge {kind} />{/each}</div></div>
			<div><span class={cap}>{t("ds.badges.statuses")}</span>
				<div class="mt-1.5 flex flex-wrap items-center gap-4"><StatusBadge status="draft" /><StatusBadge status="deprecated" /><StatusBadge status="stable" /><Badge variant="stable">{t("ds.badges.stable")}</Badge><Badge variant="caution">{t("ds.badges.draft")}</Badge><Badge variant="destructive">{t("ds.badges.deprecated")}</Badge></div></div>
			<div><span class={cap}>{t("ds.badges.trust")}</span>
				<ul class="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">{#each TRUST as [icon, label] (icon)}<li class="flex items-center gap-1.5 text-sm"><TrustIcon {icon} {label} /><span aria-hidden="true">{label}</span></li>{/each}</ul></div>
		</div>

		<h3 id="c-chip" class={h3}>{t("ds.chip.heading")}</h3>
		<div class="{box} flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<ChipButton pressed={chip[0]} onclick={() => (chip[0] = !chip[0])}>{t("ds.chip.pressed")}</ChipButton>
				<ChipButton pressed={chip[1]} onclick={() => (chip[1] = !chip[1])}>{t("ds.chip.released")}</ChipButton>
				<span class={cap}>{@render rich(t("ds.chip.hint"))}</span>
			</div>
			<Breadcrumb type="Concept" title={ROWS[0].title} />
		</div>

		<h3 id="c-row" class={h3}>Result row</h3>
		<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
			<ul class="bg-card divide-y border">
				{#each ROWS as doc (doc.id)}<li class="p-4"><ResultRow {doc} href="#c-row" showFav /></li>{/each}
				<li class="p-4"><ResultRow doc={ROWS[0]} href="#c-row" titleHtml={highlighted(t("ds.row.hl.title"))} snippetHtml={highlighted(t("ds.row.hl.snippet"))} /></li>
			</ul>
			<div>
				<span class={cap}>{t("ds.row.compact")}</span>
				<ul class="bg-card mt-1.5 divide-y border">
					{#each ROWS as doc (doc.id)}<li class="p-3"><ResultRow {doc} compact /></li>{/each}
				</ul>
			</div>
		</div>
	</section>

	<!-- 6. brand -->
	<section aria-labelledby="h-marque" id="marque" class="mt-14 mb-8">
		<h2 id="h-marque" class={h2}>{t("ds.sec.marque")}</h2>
		<p class="{cap} mt-3 max-w-3xl">{@render rich(t("ds.brand.intro"))}</p>
		<h3 class={h3}>{t("ds.brand.mark")}</h3>
		<div class="{box} flex flex-wrap items-center gap-x-12 gap-y-6">
			<div>
				<span class="inline-flex items-center gap-2 py-1 font-semibold tracking-tight"><CortexMark size={24} /><CortexWordmark /></span>
				<p class={cap}>{t("ds.brand.header")}</p>
			</div>
			<div>
				<span class="flex items-end gap-3"><CortexMark size={72} /><span class="pb-2 text-3xl font-semibold tracking-tight"><CortexWordmark /></span></span>
				<p class="{cap} mt-1">{t("ds.brand.home")}</p>
			</div>
		</div>
		<h3 class={h3}>{t("ds.avatar.heading")}</h3>
		<div class="{box} overflow-x-auto">
			<table class="w-fit text-sm">
				<thead><tr><th scope="col" class="p-2 pr-16 text-left font-semibold">{t("ds.avatar.state")}</th>{#each AVATAR_SIZES as s (s)}<th scope="col" class="p-2 pr-16 text-left font-semibold">{s} px</th>{/each}</tr></thead>
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
			{@render rich(t("ds.avatar.states"))}
			{@render rich(t("ds.avatar.reducedMotion"))}
			{#if reduced !== null}<span data-motion={reduced ? "reduce" : "no-preference"}> {reduced ? t("ds.avatar.systemReduce") : t("ds.avatar.systemAllow")}</span>{/if}
		</p>
	</section>
</div>
