/**
 * Browser storage keys of the site: `cortex:<name>`. Before the rename the project was called "brain": `storageKey`
 * moves a value still stored under `brain:<name>` to the new key once, so nobody loses favorites, theme or searches.
 * Pure (the storage is passed in) and never throws: storage may be unavailable (private mode, quota).
 */
export function storageKey(name: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalThis.localStorage): string {
	const key = `cortex:${name}`, old = `brain:${name}`;
	try {
		const v = storage?.getItem(old);
		if (v != null) {
			if (storage!.getItem(key) == null) storage!.setItem(key, v);
			storage!.removeItem(old);
		}
	} catch { /* storage unavailable: nothing to migrate */ }
	return key;
}
