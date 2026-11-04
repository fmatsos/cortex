<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Journal · Second cerveau</title></svelte:head>

<h1 class="text-3xl font-semibold tracking-tight">Journal</h1>
<div class="wiki mt-6 max-w-3xl">{@html data.html}</div>
