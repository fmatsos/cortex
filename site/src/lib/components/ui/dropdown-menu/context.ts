import { getContext, setContext } from "svelte";

/** State shared by the parts of one dropdown menu (the zero-dependency counterpart of Bits UI's menu context). */
export type MenuContext = {
	/** Stable id of the menu: names the popover, the anchor and the trigger. */
	readonly id: string;
	open: boolean;
	triggerEl: HTMLElement | null;
	contentEl: HTMLElement | null;
	/** The item that currently holds the roving tabindex. */
	active: HTMLElement | null;
	/** Which item receives focus when the menu opens. */
	focusTarget: "first" | "last";
	/** Closes the menu and gives the focus back to the trigger. */
	close(): void;
};

const MENU = Symbol("dropdown-menu");
export const setMenu = (c: MenuContext) => setContext(MENU, c);
export const useMenu = () => getContext<MenuContext>(MENU);

/** Radio group state: the selected value and how to change it. */
export type RadioContext = { readonly value: string | undefined; select(v: string): void };
const RADIO = Symbol("dropdown-menu-radio");
export const setRadio = (c: RadioContext) => setContext(RADIO, c);
export const useRadio = () => getContext<RadioContext>(RADIO);

/** Shared look of an interactive row: square, flat, the focus ring drawn inside the menu so its edge never clips it. */
export const itemClass =
	"relative flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-none px-2 py-1.5 text-left text-sm select-none pointer-coarse:min-h-11 hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
