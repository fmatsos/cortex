<script lang="ts">
	import { features } from "#lib/features.js";
	import { t } from "#lib/i18n/index.js";
	import { toRoute } from "#lib/links.js";
	import { toMaintenance } from "#lib/path-links.js";

	// The help page: how the wiki is made and how to use the site. Static text, in the site language: every sentence is a `help.`
	// key of the dictionaries (fr.json, en.json), like the design-system page; the layout re-mounts its content on a language
	// switch, so the table of contents below, built at instance creation, follows. Inline `code` is written between backticks
	// in the dictionary and drawn by `rich`: no HTML ever comes from the JSON. The page describes the site as it is, and says
	// where a feature depends on the wiki's configuration (cortex.json) or on `cortex serve`.
	const SECTIONS = [
		["what", t("help.what.title")],
		["find", t("help.find.title")],
		["read", t("help.read.title")],
		["assistant", t("help.assistant.title")],
		["account", t("help.account.title")],
		["follow", t("help.follow.title")],
		["add", t("help.add.title")],
		["faq", t("help.faq.title")],
	] as const;
	const link = "text-link underline underline-offset-4";
</script>

{#snippet rich(s: string)}{#each s.split("`") as seg, i}{#if i % 2}<code>{seg}</code>{:else}{seg}{/if}{/each}{/snippet}

<svelte:head>
	<title>{t("help.title")} · Cortex</title>
	<meta name="description" content={t("help.lead")} />
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
	<header>
		<h1 class="text-3xl font-semibold tracking-tight">{t("help.title")}</h1>
		<p class="text-muted-foreground mt-2">{t("help.lead")}</p>
		<p class="border-border mt-4 border-l-2 pl-3 text-sm">{t("help.config")}</p>
	</header>

	<nav aria-label={t("help.toc")} class="border-border bg-card shadow-surface border p-4">
		<h2 class="mb-2 text-base font-semibold">{t("help.toc")}</h2>
		<ol class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
			{#each SECTIONS as [id, label] (id)}<li><a href="#{id}" class="{link} inline-block py-1 pointer-coarse:py-2">{label}</a></li>{/each}
		</ol>
	</nav>

	<div class="wiki">
		<h2 id="what">{t("help.what.title")}</h2>
		<p>{@render rich(t("help.what.p1"))}</p>
		<p>{@render rich(t("help.what.p2"))}</p>
		<p>{t("help.what.p3")}</p>
		<ul>
			<li><strong>{t("type.Source")}</strong>{t("common.colon")}{t("help.what.source")}</li>
			<li><strong>{t("type.Concept")}</strong>{t("common.colon")}{t("help.what.concept")}</li>
			<li><strong>{t("type.Entity")}</strong>{t("common.colon")}{t("help.what.entity")}</li>
			<li><strong>{t("type.Synthesis")}</strong>{t("common.colon")}{t("help.what.synthesis")}</li>
		</ul>
		<p>{t("help.what.p4")}</p>
		<p>{t("help.what.p5")}</p>

		<h2 id="find">{t("help.find.title")}</h2>
		<p>{t("help.find.intro")}</p>

		<h3 id="search">{t("help.find.search.title")}</h3>
		<p>{t("help.find.search.p1")}</p>
		<p>{t("help.find.search.p2")}</p>
		<p>{t("help.find.search.p3")}</p>
		<ul>
			<li>{@render rich(t("help.find.op.tag"))}</li>
			<li>{@render rich(t("help.find.op.type"))}</li>
			<li>{@render rich(t("help.find.op.status"))}</li>
			<li>{@render rich(t("help.find.op.is"))}</li>
			<li>{@render rich(t("help.find.op.phrase"))}</li>
			<li>{@render rich(t("help.find.op.exclude"))}</li>
			<li>{@render rich(t("help.find.op.or"))}</li>
		</ul>
		<p>{@render rich(t("help.find.search.note"))}</p>
		<p>{t("help.find.search.facets")}</p>
		<p>{t("help.find.search.hits")}</p>

		<h3 id="tags">{t("help.find.tags.title")}</h3>
		<p>{t("help.find.tags.p1")} <a href={toRoute("/tags")}>{t("nav.tags")}</a>.</p>

		<h3 id="graph">{t("help.find.graph.title")}</h3>
		<p>{t("help.find.graph.p1")} <a href={toRoute("/graph")}>{t("nav.graph")}</a>.</p>
		<p>{t("help.find.graph.p2")}</p>
		<p>{t("help.find.graph.p3")}</p>

		<h3 id="paths">{t("help.find.paths.title")}</h3>
		<p>{t("help.find.paths.p1")}</p>

		<h2 id="read">{t("help.read.title")}</h2>
		<p>{t("help.read.intro")}</p>
		<ul>
			<li>{t("help.read.head")}</li>
			<li>{t("help.read.toc")}</li>
			<li>{t("help.read.notes")}</li>
			<li>{t("help.read.sources")}</li>
			<li>{t("help.read.aside")}</li>
			<li>{t("help.read.note")}</li>
		</ul>
		<p>{t("help.read.comfort")}</p>

		<h3 id="status">{t("help.read.status.title")}</h3>
		<p>{t("help.read.status.p1")}</p>
		<ul>
			<li>{@render rich(t("help.read.status.deprecated"))}</li>
			<li>{@render rich(t("help.read.status.draft"))}</li>
			<li>{@render rich(t("help.read.status.partial"))}</li>
			<li>{@render rich(t("help.read.status.review"))}</li>
			<li>{@render rich(t("help.read.status.stale"))}</li>
		</ul>

		<h2 id="assistant">{t("help.assistant.title")}</h2>
		<p>{@render rich(t("help.assistant.p1"))}</p>
		<p>{t("help.assistant.p2")}</p>
		<p>{t("help.assistant.p3")}</p>
		<h3 id="assistant-limits">{t("help.assistant.limits.title")}</h3>
		<ul>
			<li>{t("help.assistant.wikiOnly")}</li>
			<li>{t("help.assistant.gaps")}</li>
			<li>{t("help.assistant.cites")}</li>
			<li>{t("help.assistant.ai")}</li>
			<li>{t("help.assistant.readOnly")}</li>
			<li>{t("help.assistant.spaces")}</li>
			<li>{t("help.assistant.memory")}</li>
			<li>{t("help.assistant.keep")}</li>
		</ul>

		<h2 id="account">{t("help.account.title")}</h2>
		<h3 id="favorites">{t("favs.title")}</h3>
		<p>{@render rich(t("help.account.favs"))}</p>
		<h3 id="preferences">{t("prefs.label")}</h3>
		<p>{t("help.account.prefs")}</p>
		<h3 id="sign-in">{t("account.label")}</h3>
		<p>{t("help.account.sign")}</p>
		<p>{t("help.account.none")}</p>

		<h2 id="follow">{t("help.follow.title")}</h2>
		<ul>
			<li><a href={toRoute("/log")}>{t("nav.log")}</a>{t("common.colon")}{t("help.follow.log")}</li>
			<li><a href={toRoute("/changes")}>{t("nav.changes")}</a>{t("common.colon")}{t("help.follow.changes")}</li>
			<li><a href={toMaintenance()}>{t("footer.maintenance")}</a>{t("common.colon")}{@render rich(t("help.follow.maintenance"))}</li>
			<li>{#if features.review}<a href={toRoute("/review")}>{t("nav.review")}</a>{:else}{t("nav.review")}{/if}{t("common.colon")}{@render rich(t("help.follow.review"))}</li>
		</ul>

		<h2 id="add">{t("help.add.title")}</h2>
		<p>{t("help.add.p1")}</p>
		<p>{@render rich(t("help.add.p2"))}</p>
		<p>{@render rich(t("help.add.p3"))}</p>
		<p>{t("help.add.p4")}</p>
		<p>{t("help.add.p5")}</p>

		<h2 id="faq">{t("help.faq.title")}</h2>
		<h3 id="faq-gap">{t("help.faq.gap.q")}</h3>
		<p>{t("help.faq.gap.a")}</p>
		<h3 id="faq-origin">{t("help.faq.origin.q")}</h3>
		<p>{t("help.faq.origin.a")}</p>
		<h3 id="faq-marks">{t("help.faq.marks.q")}</h3>
		<p>{t("help.faq.marks.a")} <a href="#status">{t("help.read.status.title")}</a>.</p>
		<h3 id="faq-missing">{t("help.faq.missing.q")}</h3>
		<p>{t("help.faq.missing.a")}</p>
		<h3 id="faq-add">{t("help.faq.add.q")}</h3>
		<p>{t("help.faq.add.a")} <a href="#add">{t("help.add.title")}</a>.</p>
		<h3 id="faq-memory">{t("help.faq.memory.q")}</h3>
		<p>{t("help.faq.memory.a")}</p>
		<h3 id="faq-favs">{t("help.faq.favs.q")}</h3>
		<p>{t("help.faq.favs.a")}</p>
	</div>
</div>
