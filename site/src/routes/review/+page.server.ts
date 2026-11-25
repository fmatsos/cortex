import { reviewQueue } from "#lib/review-queue.js";
import { site } from "#lib/server/data.js";

/** The route always exists (a prerendered site has no way to omit it), but with `review` off it carries no data and is linked from nowhere. */
export const load = () => {
	const { pages, features } = site();
	return { enabled: features.review, items: features.review ? reviewQueue(pages) : [] };
};
