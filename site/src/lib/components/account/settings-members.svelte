<script lang="ts">
	import { onMount } from "svelte";
	import { account } from "#lib/account.svelte.js";
	import { ApiError } from "#lib/api.js";
	import ConfirmDialog from "#lib/components/account/confirm-dialog.svelte";
	import SettingsPanel from "#lib/components/account/settings-panel.svelte";
	import Icon from "#lib/components/icon.svelte";
	import { Badge } from "#lib/components/ui/badge/index.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import * as NativeSelect from "#lib/components/ui/native-select/index.js";
	import { intlLocale, t } from "#lib/i18n/index.js";
	import { spaces, type Invite, type Member, type Role, type SpaceDetail } from "#lib/spaces.svelte.js";

	// Who is in a space (their role, removal: the last owner stays) and the single-use invitation links (valid 7 days: the link
	// is the secret, nothing is e-mailed). An open space keeps its members and roles too.
	let { detail, onrefresh }: { detail: SpaceDetail; onrefresh: () => Promise<void> } = $props();
	const uid = $props.id();
	const owners = $derived(detail.members.filter((m) => m.role === "owner").length);
	const isOpen = $derived(detail.visibility === "open");
	let invites = $state<Invite[]>([]), role = $state<Role>("member");
	let created = $state<{ id: string; url: string; expires_at: string; role: Role } | null>(null);
	let pending = $state(false), error = $state(""), copyStatus = $state(""), memberError = $state(""), removing = $state<Member | null>(null), confirmOpen = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	const day = (iso: string) => { const at = new Date(iso); return Number.isNaN(+at) ? "" : at.toLocaleDateString(intlLocale(), { day: "numeric", month: "long", year: "numeric" }) + " " + at.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" }); };
	const roleLabel = (r: Role) => t(r === "owner" ? "spaces.role.owner" : "spaces.role.member");
	const fail = (e: unknown, fallback: string) => { if (e instanceof ApiError && e.status === 401) account.expire(); return (e instanceof ApiError && e.detail) || fallback; };

	async function loadInvites() { try { invites = await spaces.invites(detail.name); } catch (e) { error = fail(e, t("spaces.invite.failed")); } }
	onMount(() => { void loadInvites(); });

	async function setRole(m: Member, next: Role) {
		memberError = "";
		try { await spaces.setRole(detail.name, m.id, next); await onrefresh(); }
		catch (e) { memberError = fail(e, t("spaces.members.failed")); await onrefresh(); }
	}
	async function remove() {
		if (!removing) return;
		await spaces.removeMember(detail.name, removing.id);
		await onrefresh();
	}

	async function invite(e: SubmitEvent) {
		e.preventDefault();
		if (pending) return;
		pending = true; error = ""; copyStatus = "";
		try { created = { ...(await spaces.invite(detail.name, role)), role }; await loadInvites(); }
		catch (err) { error = fail(err, t("spaces.invite.failed")); }
		finally { pending = false; }
	}
	async function copy() {
		if (!created) return;
		try { await navigator.clipboard.writeText(created.url); copyStatus = t("spaces.invite.copied"); }
		catch { field?.focus(); field?.select(); copyStatus = t("spaces.invite.selected"); }
	}
	async function revoke(i: Invite) {
		error = "";
		try { await spaces.revokeInvite(detail.name, i.id); if (created?.id === i.id) created = null; await loadInvites(); }
		catch (e) { error = fail(e, t("spaces.invite.failed")); }
	}
</script>

<SettingsPanel title={t("spaces.members.title")}>
	<p class="text-muted-foreground text-sm">{isOpen ? t("spaces.members.open") : t("spaces.members.private")}</p>
		<ul class="mt-4">
			{#each detail.members as m (m.id)}
				{@const last = m.role === "owner" && owners === 1}
				<li class="border-border flex flex-wrap items-center gap-3 border-b py-3 text-sm">
					<span class="bg-secondary border-border text-muted-foreground flex size-9 shrink-0 items-center justify-center border"><Icon name="account" size={18} /></span>
					<div class="min-w-0 flex-1"><strong class="[overflow-wrap:anywhere]">{m.name}</strong></div>
					<label class="sr-only" for="{uid}-role-{m.id}">{t("spaces.members.role", { name: m.name })}</label>
					<NativeSelect.Root id="{uid}-role-{m.id}" value={m.role} disabled={last} aria-describedby={last ? "{uid}-last" : undefined} onchange={(e) => void setRole(m, (e.currentTarget as HTMLSelectElement).value as Role)}>
						<NativeSelect.Option value="owner">{roleLabel("owner")}</NativeSelect.Option>
						<NativeSelect.Option value="member">{roleLabel("member")}</NativeSelect.Option>
					</NativeSelect.Root>
					<Button variant="outline" disabled={last} aria-describedby={last ? "{uid}-last" : undefined} title={last ? t("spaces.members.lastOwner") : undefined} aria-label={t("spaces.members.remove.of", { name: m.name })} onclick={() => { removing = m; confirmOpen = true; }}>{t("spaces.members.remove")}</Button>
				</li>
			{/each}
		</ul>
		<p id="{uid}-last" class="text-muted-foreground mt-3 text-xs">{t("spaces.members.lastOwner")} {t("spaces.members.lastOwner.hint")}</p>
		<p role="alert" class="text-destructive mt-2 text-sm empty:hidden">{memberError}</p>

	<form onsubmit={invite} class="mt-6 flex flex-col gap-2">
		<label for="{uid}-role" class="text-sm font-semibold">{t("spaces.invite.role")}</label>
		<div class="flex flex-wrap items-center gap-2">
			<NativeSelect.Root id="{uid}-role" bind:value={role}>
				<NativeSelect.Option value="member">{roleLabel("member")}</NativeSelect.Option>
				<NativeSelect.Option value="owner">{roleLabel("owner")}</NativeSelect.Option>
			</NativeSelect.Root>
			<Button type="submit" variant="outline" disabled={pending}><Icon name="copy-link" size={16} />{t("spaces.invite.create")}</Button>
		</div>
		<p class="text-muted-foreground text-xs">{t("spaces.invite.hint")}</p>
	</form>

	{#if created}
		<div class="bg-secondary border-border mt-4 flex flex-col gap-2 border p-3 sm:p-4">
			<label for="{uid}-url" class="text-sm">{t("spaces.invite.created", { role: roleLabel(created.role), date: day(created.expires_at) })}</label>
			<div class="flex flex-wrap items-center gap-2">
				<Input id="{uid}-url" bind:ref={field} value={created.url} readonly class="min-w-0 flex-1" />
				<Button variant="outline" onclick={copy}><Icon name="copy-link" size={16} />{t("spaces.invite.copy")}</Button>
			</div>
			<p role="status" class="text-muted-foreground text-xs">{copyStatus || t("spaces.invite.once")}</p>
		</div>
	{/if}

		<h3 class="mt-6 mb-2 font-semibold">{t("spaces.invite.pending")}</h3>
		{#if invites.length}
			<ul>
				{#each invites as i (i.id)}
					<li class="border-border flex flex-wrap items-center gap-3 border-b py-3 text-sm">
						<div class="min-w-0 flex-1"><strong>{roleLabel(i.role)}</strong><span class="text-muted-foreground block text-xs">{t("spaces.invite.expires", { date: day(i.expires_at) })} · {t("spaces.invite.single")}</span></div>
						<Button variant="outline" aria-label={t("spaces.invite.revoke.of", { role: roleLabel(i.role), date: day(i.expires_at) })} onclick={() => void revoke(i)}>{t("spaces.invite.revoke")}</Button>
					</li>
				{/each}
			</ul>
		{:else}<p class="text-muted-foreground text-sm">{t("spaces.invite.none")}</p>{/if}
	<p role="alert" class="text-destructive mt-2 text-sm empty:hidden">{error}</p>
</SettingsPanel>

<ConfirmDialog bind:open={confirmOpen} heading={t("spaces.members.remove.title", { name: removing?.name ?? "" })} text={t("spaces.members.remove.text")} confirm={t("spaces.members.remove")} failure={t("spaces.members.failed")} onconfirm={remove} />
