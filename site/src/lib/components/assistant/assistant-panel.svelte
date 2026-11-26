<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { afterNavigate } from "$app/navigation";
	import Icon from "#lib/components/icon.svelte";
	import ActivityIndicator from "./activity-indicator.svelte";
	import AnswerBlock from "./answer-block.svelte";
	import AssistantDialogs from "./assistant-dialogs.svelte";
	import { AssistantFlow } from "./assistant-flow.svelte.js";
	import AssistantHeader from "./assistant-header.svelte";
	import StepLine from "./step-line.svelte";
	import { assistant, MAX_QUESTION, type Step, type Turn } from "#lib/assistant.svelte.js";
	import { loadEngine, type Engine } from "#lib/search-client.js";
	import { toPage, toRoute } from "#lib/links.js";
	import { typeIcon } from "#lib/type-meta.js";
	import { contentLang, t } from "#lib/i18n/index.js";

	// The assistant, a panel of the shell (it survives navigation). From 1280 px it is docked on the right and the page
	// shrinks beside it (a non-modal dialog: the page stays usable); below, a modal drawer over the page. One <dialog> for
	// both: focus trap, Escape and the top layer come from the browser.
	const PANEL_ID = "assistant-panel";
	const DOCK = "(min-width: 1280px)";
	// docked width: 28 rem by default, then the reader's own, between MIN and half the window (720 px at most); kept in this browser
	const DEFAULT = 448, MIN = 320, MAX = 720, KEY = "cortex-assistant-width";
	const STEP = 16, BIG_STEP = 64;

	let dialog = $state<HTMLDialogElement | null>(null);
	let area = $state<HTMLTextAreaElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	let docked = $state(false);
	let vw = $state(0);
	let pref = $state(DEFAULT);
	let dragging = $state(false);
	const max = $derived(Math.max(MIN, Math.min(MAX, Math.floor(vw / 2))));
	// the chosen width, held within the bounds of the window as it is now (the choice itself survives a narrower window)
	const width = $derived(Math.min(max, Math.max(MIN, pref)));
	let engine = $state<Engine>();
	onMount(() => {
		const mq = matchMedia(DOCK);
		const sync = () => (docked = mq.matches);
		sync();
		mq.addEventListener("change", sync);
		try {
			const saved = Number(localStorage.getItem(KEY));
			if (Number.isFinite(saved) && saved >= MIN) pref = Math.round(saved);
		} catch { /* storage blocked: the default width */ }
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
		document.documentElement.style.setProperty("--assistant-width", want && docked ? `${width}px` : "0px");
	});

	// resizing: the handle on the left edge, by pointer or keyboard; the page follows through --assistant-width
	const clamp = (px: number) => Math.min(max, Math.max(MIN, Math.round(px)));
	const keep = () => { try { pref === DEFAULT ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(pref)); } catch { /* per-viewer convenience only */ } };
	const set = (px: number) => { pref = clamp(px); keep(); };
	function onDown(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		e.preventDefault();
	}
	function onMove(e: PointerEvent) {
		if (dragging && dialog) pref = clamp(dialog.getBoundingClientRect().right - e.clientX);
	}
	function onUp() { if (dragging) { dragging = false; keep(); } }
	function onHandleKey(e: KeyboardEvent) {
		const step = e.shiftKey ? BIG_STEP : STEP;
		const next = e.key === "ArrowLeft" ? width + step : e.key === "ArrowRight" ? width - step : e.key === "Home" ? MIN : e.key === "End" ? max : e.key === "Enter" ? DEFAULT : undefined;
		if (next === undefined) return;
		e.preventDefault();
		set(next);
	}
	$effect(() => {
		document.documentElement.toggleAttribute("data-assistant-resizing", dragging);
		return () => document.documentElement.removeAttribute("data-assistant-resizing");
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
	// save, export, new conversation, resume: what the header's buttons do (assistant-flow.svelte.ts)
	const flow = new AssistantFlow(() => void tick().then(() => area?.focus()));
	// a conversation chosen on the account page: read it here, ask before replacing an unsaved one
	$effect(() => {
		const id = assistant.resumeRequest;
		if (!id) return;
		assistant.resumeRequest = null;
		untrack(() => void flow.resume(id));
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

	// what the agent is doing now: one line, changed in place, not announced (the status line below says start and end only)
	const stepText = (s: Step) => t(`assistant.step.${s.kind}`, { title: s.title ?? s.path ?? "", query: s.query ?? "" });

	const send = () => { if (assistant.ask(assistant.draft)) void tick().then(() => area?.focus()); };
	function onKey(e: KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
	}
	const over = $derived(assistant.draft.trim().length > MAX_QUESTION);
	// announced outside the busy list: start, then ready or failure (the answer itself is not read out)
	const status = $derived.by(() => {
		const last = assistant.turns.at(-1);
		if (!last) return "";
		return last.pending ? t("assistant.status.pending") : last.error ? t(`assistant.error.${last.error}`, { max: MAX_QUESTION }) : t("assistant.status.ready");
	});
</script>

<svelte:window bind:innerWidth={vw} />

<dialog bind:this={dialog} id={PANEL_ID} aria-labelledby="assistant-title" class="assistant" oncancel={(e) => { e.preventDefault(); close(); }}
	onkeydown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !dialog?.matches(":modal")) { e.preventDefault(); close(); } }}>
	{#if docked}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div class="resize" class:active={dragging} role="separator" aria-orientation="vertical" aria-label={t("assistant.resize")} aria-controls={PANEL_ID}
			aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={max} tabindex="0"
			onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} onlostpointercapture={onUp} ondblclick={() => set(DEFAULT)} onkeydown={onHandleKey}></div>
	{/if}
	<div class="flex h-full flex-col">
		<AssistantHeader {flow} onclose={close} />

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
						{#if turn.partial}
							<!-- provisional text, as written (raw Markdown): the finished answer replaces it; not announced -->
							<div class="bg-card shadow-surface mt-3 border p-3">
								<p class="text-sm break-words whitespace-pre-wrap" lang={contentLang}>{turn.partial}</p>
								<div class="text-muted-foreground mt-3 flex items-center gap-3 text-sm"><ActivityIndicator />{#if turn.step}<StepLine text={stepText(turn.step)} />{/if}</div>
							</div>
						{:else}
							<div class="text-muted-foreground mt-4 flex items-center gap-3 text-sm"><ActivityIndicator /><StepLine text={turn.step ? stepText(turn.step) : t("assistant.waiting")} /></div>
						{/if}
					{:else if turn.error}
						<div class="bg-warning-background text-warning-foreground mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm">
							<Icon name="error" size={20} />
							<span class="min-w-48 flex-1">{t(`assistant.error.${turn.error}`, { max: MAX_QUESTION })}</span>
							{#if turn.error !== "off" && turn.error !== "invalid"}
								<button type="button" class="inline-flex min-h-8 items-center gap-1 rounded-md border border-current px-2.5 pointer-coarse:min-h-11" onclick={() => assistant.retry(turn)}><Icon name="retry" size={16} />{t("common.retry")}</button>
							{/if}
						</div>
					{:else if turn.answer}
						<!-- the answer sits on a card (surface, border, light relief) so that it reads apart from the question's muted bubble -->
						<div class="bg-card shadow-surface mt-3 border p-3">
							<div class="text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0" lang={contentLang}>
								{#each turn.answer.segments as s, i (i)}
									{#if "block" in s}<AnswerBlock block={s.block} {fix} />{:else}<div class="wiki">{@html fix(s.html)}</div>{/if}
								{/each}
							</div>
							{#each lists(turn) as l (l.key)}
								<h3 class="mt-4 text-sm font-semibold">{l.label}</h3>
								<ul class="mt-1 space-y-1 text-sm">
									{#each l.docs as d (d.id)}
										<li><a href={toPage(d.id)} class="inline-flex items-start gap-2 underline-offset-4 hover:underline"><Icon name={typeIcon(d.type)} size={16} class="text-muted-foreground mt-0.5 shrink-0" /><span lang={contentLang}>{d.title}</span></a></li>
									{/each}
								</ul>
							{/each}
							<p class="text-muted-foreground mt-3 flex items-start gap-2 text-xs"><Icon name="generated" size={16} class="shrink-0" />{turn.answer.model ? t("assistant.ai", { model: turn.answer.model }) : t("assistant.ai.unknown")}</p>
						</div>
					{/if}
				</article>
			{/each}
		</div>
		<p class="sr-only" role="status">{status}</p>
		<!-- the region stays, its content comes once: announced politely when the conversation reaches the server's history depth -->
		<div role="status">
			{#if assistant.historyFull}
				<p class="bg-warning-background text-warning-foreground mx-3 mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"><Icon name="error" size={20} class="mt-0.5 shrink-0" />{t("assistant.history.limit", { n: assistant.historyTurns })}</p>
			{/if}
		</div>

		<form class="border-t p-3" onsubmit={(e) => { e.preventDefault(); send(); }}>
			<label for="assistant-q" class="sr-only">{t("assistant.label")}</label>
			<!-- the field sits in a frame: the frame carries the design system's opaque 2 px outline (a translucent ring is under 3:1) -->
			<div class="focus-within:outline-ring flex items-end gap-2 rounded-md border px-2 py-1.5 focus-within:outline-2 focus-within:outline-offset-2">
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

<AssistantDialogs {flow} />

<style>
	/* owner: the answer prose reads at the size of the question (text-sm, 14 px), headings scaled to it */
	.assistant :global(.wiki) {
		font-size: 0.875rem;
		line-height: 1.65;
	}
	/* "Comfortable text" (header preferences menu, local): a larger body for the answers, same fonts and format */
	:global(html[data-assistant-comfort]) .assistant :global(.wiki) {
		font-size: 1.0625rem;
		line-height: 1.75;
	}
	.assistant :global(.wiki h2) {
		font-size: 1.15em;
	}
	.assistant :global(.wiki h3),
	.assistant :global(.wiki h4) {
		font-size: 1em;
	}
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
	/* the docked panel is not floating but is split from the page by an edge shadow (owner exception to "flat"); the modal drawer
	   floats over the page: the overlay shadow */
	.assistant:not(:modal) {
		width: var(--assistant-width, 28rem);
		border-left-color: var(--input);
		box-shadow: var(--shadow-edge);
	}
	.assistant:modal {
		border-left-color: var(--input);
		box-shadow: var(--shadow-overlay);
	}
	/* drag handle: a wide hit area on the left edge, a 2 px line on hover, focus and drag */
	.resize {
		position: absolute;
		inset: 0 auto 0 0;
		width: 8px;
		z-index: 1;
		cursor: col-resize;
		touch-action: none;
	}
	.resize::after {
		content: "";
		position: absolute;
		inset: 0 auto 0 0;
		width: 2px;
		background: transparent;
	}
	.resize:hover::after,
	.resize:focus-visible::after,
	.resize.active::after {
		background: var(--primary);
	}
	.resize:focus-visible {
		outline-offset: -2px;
	}
	:global(html[data-assistant-resizing]) {
		cursor: col-resize;
		user-select: none;
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
