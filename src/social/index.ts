import type { FetchOpts } from "../add";
import type { Social } from "./social";
import { JsonApi, type Transport } from "./transport";
import { X } from "./x";
import { Bluesky } from "./bluesky";
import { Mastodon } from "./mastodon";

/** The networks, each bound to its transport; tried in order, the ambiguous ones (fallback) last. */
export const socials = (opts: FetchOpts = {}, api: Transport = new JsonApi(opts)): Social[] => [new X(api), new Bluesky(api), new Mastodon(api)];

/** The network for this URL and its request, or undefined (the page is read normally). */
export function socialFor(url: string, opts: FetchOpts = {}): { social: Social; request: string } | undefined {
  const u = new URL(url);
  for (const social of socials(opts)) {
    const request = social.request(u);
    if (request) return { social, request };
  }
}
