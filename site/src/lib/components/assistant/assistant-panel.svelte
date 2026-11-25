<script lang="ts">
	import { onMount, tick } from "svelte";
	import { afterNavigate } from "$app/navigation";
	import Icon from "#lib/components/icon.svelte";
	import AssistantAvatar, { type AvatarState } from "./assistant-avatar.svelte";
	import AnswerBlock from "./answer-block.svelte";
	import { assistant, MAX_QUESTION, type Turn } from "#lib/assistant.svelte.js";
	import { loadEngine, type Engine } from "#lib/search-client.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { typeIcon } from "#lib/type-meta.js";
	import { t } from "#lib/i18n/index.js";

	// The assistant, a panel of the shell (it survives navigation). From 1280 px it is docked on the right and the page
	// shrinks beside it (a non-modal dialog: the page stays usable); below, a modal drawer over the page. One <dialog> for
	// both: focus trap, Escape and the top layer come from the browser.
	const PANEL_ID = "assistant-panel";
	const DOCK = "(min-width: 1280px)";
	const WIDTH = "28rem";

	let dialog = $state<HTMLDialogElement | null>(null);
	let area = $state<HTMLTextAreaElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	let docked = $state(false);
	let engine = $state<Engine>();
	onMount(() => {
		const mq = matchMedia(DOCK);
		const sync = () => (docked = mq.matches);
		sync();
		mq.addEventListener("change", sync);
		loadEngine().then((e) => (engine = e), () => {});
		return () => { mq.removeEventListener("change", sync); document.documentElement.style.removeProperty("--assistant-width"); };
	});

	// open state → the dialog, in the mode the width asks for; the page makes room for the docked panel
	$effect(() => {
		const d = dialog;
		if (!d) return;
		const want = assistant.open, modal = !docked;
		if (d.open && (!want || d.matches(":modal") !== modal)) d.close();
		if (want && !d.open) { if (modal) d.showModal(); else d.show(); void tick().then(() => area?.focus()); }
		document.documentElement.style.setProperty("--assistant-width", want && docked ? WIDTH : "0px");
	});
	// entry points outside the panel (search field, palette): focus the question, caret at the end of a prefilled text
	$effect(() => {
		if (!assistant.focusSeq) return;
		void tick().then(() => tick()).then(() => {
			if (!area) return;
			area.focus();
			area.setSelectionRange(area.value.length, area.value.length);
		});
	});
	const close = () => { assistant.setOpen(false); document.getElementById("assistant-toggle")?.focus(); };
	// a page opened from an answer: the drawer covered it, so it closes; the docked panel stays beside it
	afterNavigate((nav) => { if (nav.type !== "enter" && assistant.open && !docked) assistant.setOpen(false); });

	// the newest exchange comes into view as it is added and when its answer arrives
	$effect(() => {
		const last = assistant.turns.at(-1);
		void last?.answer; void last?.error;
		if (list && last) void tick().then(() => list?.querySelector(`[data-turn="${last.id}"]`)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
	});

	// links of an answer are relative to the site root (the server cannot know where the panel is open); footnote ids get the
	// turn's prefix, since several answers sit side by side
	const root = () => new URL(toRoute("/"), location.href);
	const fixFor = (turn: Turn) => (html: string) =>
		html.replace(/(href|id)="(#?)(fn(?:ref)?-[^"]*)"/g, `$1="$2t${turn.id}-$3"`)
			.replace(/href="(?![a-z][\w+.-]*:|#|\/)([^"]+)"/gi, (_, h: string) => `href="${new URL(h, root()).pathname}"`);

	const docOf = (id: string) => engine?.docs.find((d) => d.id === id);
	/** Pages under an answer, written by code: retained and related (the judge), then the others it cites. */
	const lists = (turn: Turn) => {
		const a = turn.answer!;
		const shown = new Set([...a.retained, ...a.related]);
		return [
			{ key: "retained", label: t("assistant.pages.retained"), ids: a.retained },
			{ key: "related", label: t("assistant.pages.related"), ids: a.related },
			{ key: "cited", label: a.retained.length || a.related.length ? t("assistant.pages.others") : t("assistant.pages.cited"), ids: a.cited.filter((id) => !shown.has(id)) },
		].map((l) => ({ ...l, docs: l.ids.map(docOf).filter((d) => !!d) })).filter((l) => l.docs.length);
	};

	// example questions from the wiki itself: a few concepts, entities and syntheses, chosen once per panel
	const examples = $derived.by(() => {
		if (!engine) return [];
		const pick = (type: string, key: string) => {
			const of = engine!.docs.filter((d) => d.type === type);
			const d = of[Math.floor(Math.random() * of.length)];
			return d ? t(key, { title: d.title }) : undefined;
		};
		return [pick("Concept", "assistant.example.concept"), pick("Entity", "assistant.example.entity"), pick("Synthesis", "assistant.example.synthesis")].filter((q): q is string => !!q);
	});

	const send = () => { if (assistant.ask(assistant.draft)) void tick().then(() => area?.focus()); };
	function onKey(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
	}
	const over = $derived(assistant.draft.trim().length > MAX_QUESTION);
	// the avatar follows the last turn: waiting, failed, answered, else at rest
	const avatar = $derived.by((): AvatarState => {
		const last = assistant.turns.at(-1);
		return !last ? "idle" : last.pending ? "pending" : last.error ? "error" : last.answer ? "answer" : "idle";
	});
	// announced outside the busy list: start, then ready or failure (the answer itself is not read out)
	const status = $derived.by(() => {
		const last = assistant.turns.at(-1);
		if (!last) return "";
		return last.pending ? t("assistant.status.pending") : last.error ? t(`assistant.error.${last.error}`, { max: MAX_QUESTION }) : t("assistant.status.ready");
	});
</script>

<dialog bind:this={dialog} id={PANEL_ID} aria-labelledby="assistant-title" class="assistant" oncancel={(e) => { e.preventDefault(); close(); }}
	onkeydown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !dialog?.matches(":modal")) { e.preventDefault(); close(); } }}>
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-2 border-b px-4 py-2">
			<AssistantAvatar state={avatar} size={32} />
			<h2 id="assistant-title" class="flex-1 text-base font-semibold">{t("assistant.title")}</h2>
			{#if assistant.turns.length}
				<button type="button" class="hover:bg-muted inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm disabled:opacity-50 pointer-coarse:min-h-11" disabled={assistant.pending} onclick={() => { assistant.clear(); area?.focus(); }}>
					<Icon name="kind-add" size={16} />{t("assistant.new")}
				</button>
			{/if}
			<button type="button" class="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md pointer-coarse:size-11" aria-label={t("assistant.close")} onclick={close}><Icon name="clear" size={20} /></button>
		</header>

		<div bind:this={list} class="min-h-0 flex-1 space-y-8 overflow-y-auto p-4" aria-busy={assistant.pending}>
			{#if !assistant.turns.length}
				<div class="text-sm">
					<p class="font-medium">{t("assistant.welcome")}</p>
					<p class="text-muted-foreground mt-1">{t("assistant.welcomeHint")}</p>
					{#if examples.length}
						<p class="mt-4 text-xs font-semibold tracking-wide uppercase">{t("assistant.examples")}</p>
						<ul class="mt-2 space-y-2">
							{#each examples as q (q)}
								<li><button type="button" class="hover:bg-muted w-full rounded-md border px-3 py-2 text-left pointer-coarse:min-h-11" onclick={() => assistant.ask(q)}>{q}</button></li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
			{#each assistant.turns as turn (turn.id)}
				{@const fix = fixFor(turn)}
				<article data-turn={turn.id} class="scroll-mt-4" aria-label={turn.q}>
					<p class="bg-muted ml-8 rounded-lg px-3 py-2 text-sm break-words">{turn.q}</p>
					{#if turn.pending}
						<div class="text-muted-foreground mt-4 flex items-center gap-3 text-sm"><AssistantAvatar state="pending" size={48} /><span>{t("assistant.waiting")}</span></div>
					{:else if turn.error}
						<div class="bg-warning-background text-warning-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm">
							<Icon name="error" size={20} />
							<span class="min-w-48 flex-1">{t(`assistant.error.${turn.error}`, { max: MAX_QUESTION })}</span>
							{#if turn.error !== "off" && turn.error !== "invalid"}
								<button type="button" class="inline-flex min-h-8 items-center gap-1 rounded-md border border-current px-2.5 pointer-coarse:min-h-11" onclick={() => assistant.retry(turn)}><Icon name="retry" size={16} />{t("common.retry")}</button>
							{/if}
						</div>
					{:else if turn.answer}
						<div class="mt-3 text-sm">
							{#each turn.answer.segments as s, i (i)}
								{#if "block" in s}<AnswerBlock block={s.block} {fix} />{:else}<div class="wiki">{@html fix(s.html)}</div>{/if}
							{/each}
						</div>
						{#each lists(turn) as l (l.key)}
							<h3 class="mt-4 text-sm font-semibold">{l.label}</h3>
							<ul class="mt-1 space-y-1 text-sm">
								{#each l.docs as d (d.id)}
									<li><a href={toPage(d.id)} class="inline-flex items-start gap-2 underline-offset-4 hover:underline"><Icon name={typeIcon(d.type)} size={16} class="text-muted-foreground mt-0.5 shrink-0" />{d.title}</a></li>
								{/each}
							</ul>
						{/each}
						<p class="text-muted-foreground mt-3 flex items-start gap-2 text-xs"><Icon name="generated" size={16} class="shrink-0" />{t("assistant.ai", { model: turn.answer.model ?? "IA" })}</p>
					{/if}
				</article>
			{/each}
		</div>
		<p class="sr-only" role="status">{status}</p>

		<form class="border-t p-3" onsubmit={(e) => { e.preventDefault(); send(); }}>
			<label for="assistant-q" class="sr-only">{t("assistant.label")}</label>
			<div class="focus-within:ring-ring/50 flex items-end gap-2 rounded-md border px-2 py-1.5 focus-within:ring-3">
				<textarea bind:this={area} id="assistant-q" rows="2" bind:value={assistant.draft} onkeydown={onKey} placeholder={t("assistant.placeholder")} aria-invalid={over} aria-describedby="assistant-hint"
					class="max-h-40 min-h-11 flex-1 resize-none bg-transparent text-sm outline-none field-sizing-content"></textarea>
				<button type="submit" class="bg-primary text-primary-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50 pointer-coarse:size-11" aria-label={t("assistant.send")} disabled={assistant.pending || !assistant.draft.trim() || over}>
					<Icon name="kind-query" size={20} />
				</button>
			</div>
			<p id="assistant-hint" class="text-muted-foreground mt-1 text-xs {over ? 'text-destructive' : ''}">{over ? t("assistant.error.invalid", { max: MAX_QUESTION }) : assistant.pending ? t("assistant.busy") : t("assistant.hint")}</p>
		</form>
	</div>
</dialog>

<style>
	.assistant {
		position: fixed;
		inset: 0 0 0 auto;
		margin: 0;
		width: min(100vw, 30rem);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		padding: 0;
		border: 0;
		border-left: 1px solid var(--border);
		background: var(--background);
		color: var(--foreground);
		z-index: 50;
	}
	.assistant:not(:modal) {
		width: var(--assistant-width, 28rem);
	}
	/* the modal drawer floats over the page: shadow and a stronger edge; the docked panel stays flat */
	.assistant:modal {
		border-left-color: var(--input);
		box-shadow: var(--shadow-overlay);
	}
	.assistant::backdrop {
		background: color-mix(in oklch, var(--foreground) 30%, transparent);
	}
	:global(html) {
		padding-right: var(--assistant-width, 0px);
	}
	@media print {
		.assistant {
			display: none;
		}
	}
</style>
