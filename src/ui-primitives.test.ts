import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { parseHTML } from "linkedom";

// Markup contract of the zero-dependency Dropdown Menu and Tabs (site/src/lib/components/ui/{dropdown-menu,tabs}):
// roles, ARIA wiring and ids, rendered on the server from a small composition. The keyboard and popover behaviour needs a
// real browser and was checked there (see the task report); this pins what is visible in the prerendered HTML.
const UI = join(import.meta.dir, "../site/src/lib/components/ui");

async function render(markup: string): Promise<Document> {
  Bun.plugin({
    name: "svelte-ssr-ui",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, ({ path }) => ({
        contents: compile(readFileSync(path, "utf8"), { generate: "server", filename: path, css: "external" }).js.code,
        loader: "js",
      }));
    },
  });
  // the composition lives under node_modules so that `svelte/internal/server` resolves from it
  const cache = join(import.meta.dir, "../node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "ui-prim-"));
  const file = join(dir, "page.svelte");
  writeFileSync(file, `<script>
  import * as DropdownMenu from "${UI}/dropdown-menu/index.ts";
  import * as Tabs from "${UI}/tabs/index.ts";
</script>\n${markup}`);
  const { render } = await import("svelte/server");
  try {
    const { default: Page } = await import(file);
    return parseHTML(`<!doctype html><body>${render(Page, { props: {} }).body}</body>`).document;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("dropdown menu: trigger and popover menu are wired by id, items carry their roles", async () => {
  const doc = await render(`<DropdownMenu.Root>
    <DropdownMenu.Trigger>Theme</DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      <DropdownMenu.Label>Appearance</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value="dark">
        <DropdownMenu.RadioItem value="light">Light</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="dark">Dark</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <DropdownMenu.Separator />
      <DropdownMenu.Item>Copy</DropdownMenu.Item>
      <DropdownMenu.Item href="/x/" disabled>Link</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>`);
  const trigger = doc.querySelector("button[aria-haspopup]")!, menu = doc.querySelector("[role=menu]")!;
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("popovertarget")).toBe(menu.id);
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
  expect(menu.getAttribute("popover")).toBe("auto");
  expect(trigger.getAttribute("style")).toContain(`anchor-name: --${menu.id.replace(/-menu$/, "")}`);
  expect(menu.getAttribute("style")).toContain(`position-anchor:--${menu.id.replace(/-menu$/, "")}`);
  expect(menu.getAttribute("style")).toContain("right:anchor(right)");
  const radios = [...menu.querySelectorAll("[role=menuitemradio]")];
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  expect(radios.every((r) => r.getAttribute("tabindex") === "-1")).toBe(true);
  expect(menu.querySelector("[role=separator]")).not.toBeNull();
  expect(menu.querySelector("button[role=menuitem]")?.textContent).toBe("Copy");
  const link = menu.querySelector("a[role=menuitem]")!;
  expect(link.getAttribute("aria-disabled")).toBe("true");
  expect(link.hasAttribute("href")).toBe(false);
});

test("dropdown menu: square, flat, no dependency (no radius or shadow utility, no bits-ui)", () => {
  const files = ["dropdown-menu-content", "dropdown-menu-item", "dropdown-menu-radio-item", "dropdown-menu-label"].map((f) => readFileSync(join(UI, "dropdown-menu", `${f}.svelte`), "utf8"));
  const ctx = readFileSync(join(UI, "dropdown-menu/context.ts"), "utf8");
  for (const src of [...files, ctx]) {
    expect(src).not.toMatch(/\brounded-(?!none)\S*|\bshadow-\S+|bits-ui/);
  }
  expect(files[0]).toContain("rounded-none");
});

test("tabs: tablist, tabs and panels reference each other; only the selected tab is tabbable", async () => {
  const doc = await render(`<Tabs.Root value="b">
    <Tabs.List variant="line" aria-label="Blocks">
      <Tabs.Trigger value="a">A</Tabs.Trigger>
      <Tabs.Trigger value="b">B</Tabs.Trigger>
      <Tabs.Trigger value="c c" disabled>C</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="a">panel a</Tabs.Content>
    <Tabs.Content value="b">panel b</Tabs.Content>
    <Tabs.Content value="c c">panel c</Tabs.Content>
  </Tabs.Root>`);
  const list = doc.querySelector("[role=tablist]")!;
  expect(list.getAttribute("data-variant")).toBe("line");
  expect(list.getAttribute("aria-label")).toBe("Blocks");
  const tabs = [...doc.querySelectorAll("[role=tab]")], panels = [...doc.querySelectorAll("[role=tabpanel]")];
  expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  expect(tabs[2].hasAttribute("disabled")).toBe(true);
  tabs.forEach((t, i) => {
    expect(panels[i].id).toBe(t.getAttribute("aria-controls") ?? "");
    expect(panels[i].getAttribute("aria-labelledby")).toBe(t.id);
    expect(/\s/.test(t.id)).toBe(false);
  });
  expect(panels.map((p) => p.hasAttribute("hidden"))).toEqual([true, false, true]);
});
