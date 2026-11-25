import { getContext, setContext } from "svelte";

/** State shared by the parts of one set of tabs. */
export type TabsContext = {
	/** Stable id of the set: prefixes the tab and panel ids. */
	readonly id: string;
	value: string | undefined;
};

const TABS = Symbol("tabs");
export const setTabs = (c: TabsContext) => setContext(TABS, c);
export const useTabs = () => getContext<TabsContext>(TABS);

/** A tab value as an id fragment (values may contain spaces). */
export const slug = (v: string) => v.replace(/[^\w-]+/g, "-");
