import { api } from "./api";
import { serializeRoute } from "./journey";

/** A saved graph journey (`route`: the page ids, in order; dates are ISO strings). */
export type Journey = { id: string; title: string; route: string[]; created_at: string; updated_at: string };

export const listJourneys = (signal?: AbortSignal) => api<{ journeys: Journey[] }>("/api/journeys", { signal }).then((r) => r.journeys);
export const renameJourney = (id: string, title: string) => api<Journey>(`/api/journeys/${encodeURIComponent(id)}`, { method: "PUT", body: { title } });
export const removeJourney = (id: string) => api(`/api/journeys/${encodeURIComponent(id)}`, { method: "DELETE" });

/** The query string that opens a journey on the graph page (`?view=journey&route=…`), built like the graph page itself writes it. */
export const journeyQuery = (route: readonly string[]): string => new URLSearchParams({ view: "journey", route: serializeRoute(route) }).toString();

/** Phase D plugs its export in here; while it is missing the account page keeps the button disabled. */
export const journeyActions: { export?: (id: string) => void | Promise<void> } = {};
// phase D: export a saved journey
export const exportJourney = (id: string) => journeyActions.export?.(id);
