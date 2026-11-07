import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { socialPost, type Extract } from "../add";
import { Social, post, urlsIn } from "./social";
import type { Transport } from "./transport";

/**
 * What LinkedIn is read with outside its JSON-LD. Page layout changes: each one can be replaced in cortex.json
 * (`parser.social.linkedin`), without touching the code.
 */
export const LINKEDIN_SELECTORS = {
  /** The link card under a post (an article, an outside page). */
  card: 'a[data-tracking-control-name$="feed-article-content"]',
  /** Activity page (someone relayed a post; no JSON-LD): the post's text, its author, its images. */
  activity_text: '[data-test-id="main-feed-activity-card__commentary"]',
  activity_author: 'a[data-tracking-control-name$="feed-actor-name"]',
  activity_images: ".feed-images-content img",
  /** The lnkd.in interstitial ("this link leads outside LinkedIn"): the link to the destination. */
  shortlink: 'a[data-tracking-control-name="external_url_click"]',
  /** Attribute holding the carousel's JSON (title, page manifest). */
  carousel: "data-native-document-config",
};
export type LinkedInSelectors = typeof LINKEDIN_SELECTORS;

type Found = { body: string; author?: string; published?: string; media: string[] };

/** A video post: LinkedIn declares it as a VideoObject whose description is the post's text (no SocialMediaPosting). */
function videoPost(html: string): Found | undefined {
  for (const [, raw] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let n: any;
    try { n = JSON.parse(raw); } catch { continue; }
    if (n?.["@type"] !== "VideoObject" || !String(n.description ?? "").trim()) continue;
    return { body: n.description.trim(), author: n.creator?.name, published: n.datePublished || n.uploadDate, media: n.thumbnailUrl ? [n.thumbnailUrl] : [] };
  }
}

/** The `text` of the page's SocialMediaPosting (on a post with a link card: the card's title), not a comment's. */
function postText(html: string): string | undefined {
  for (const [, raw] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const n = JSON.parse(raw); if (n?.["@type"] === "SocialMediaPosting" && typeof n.text === "string") return n.text.trim(); } catch { /* not JSON */ }
  }
}

const untrack = (href: string) => href.replace(/[?&]trk=[^&#]*/, "").replace(/\?$/, "");

/**
 * LinkedIn: JSON-LD first (SocialMediaPosting, VideoObject for a video post). What JSON-LD lacks (link card URL,
 * activity page, carousel) is read with LINKEDIN_SELECTORS, overridable from cortex.json. A carousel's pages are
 * downloaded next to the source: their URLs expire within weeks. Its transcript and PDF need a login: not used.
 */
export class LinkedIn extends Social {
  readonly name = "linkedin-jsonld";
  readonly network = "linkedin";
  private sel: LinkedInSelectors;
  constructor(transport: Transport, private files: Transport, selectors: Record<string, unknown> = {}) {
    super(transport);
    this.sel = { ...LINKEDIN_SELECTORS };
    for (const [k, v] of Object.entries(selectors)) if (typeof v === "string" && v && k in LINKEDIN_SELECTORS) (this.sel as Record<string, string>)[k] = v; // external_link: not a selector
  }

  request(u: URL) {
    const isPost = /^([a-z]{2,3}\.|www\.)?linkedin\.com$/.test(u.hostname) && /^\/(posts\/|feed\/update\/)/.test(u.pathname);
    return isPost || (u.hostname === "lnkd.in" && u.pathname.startsWith("/p/")) ? u.href : undefined; // other lnkd.in links lead out of LinkedIn
  }

  /** Activity page: the post sits in the page's HTML only. */
  private activity(doc: any): Found | undefined {
    const text = doc.querySelector(this.sel.activity_text);
    if (!text?.textContent?.trim()) return;
    for (const a of text.querySelectorAll("a[href]")) a.setAttribute("href", untrack(a.getAttribute("href")));
    const author = doc.querySelector(this.sel.activity_author)?.textContent?.trim();
    const media = [...doc.querySelectorAll(this.sel.activity_images)].map((i: any) => i.getAttribute("src") || i.getAttribute("data-delayed-url")).filter(Boolean);
    return { body: new TurndownService().turndown(text.innerHTML).trim(), author: author || undefined, media };
  }

  /** The link card: its URL (HTML only); its title, from JSON-LD `text` when there, else the card's own text. */
  private card(doc: any, html: string): { md: string; url: string } | undefined {
    const a = doc.querySelector(this.sel.card), href = a?.getAttribute("href");
    if (!href) return;
    const title = postText(html) || a.textContent.trim().replace(/\s+/g, " "), url = untrack(href);
    return { md: `[${title}](${url})`, url };
  }

  protected parse(html: string, url: string): Extract {
    const doc = parseHTML(html).document;
    const p = socialPost(html);
    const f: Found | undefined = p ? { ...p, media: [] } : videoPost(html) ?? this.activity(doc);
    if (!f) throw new Error("no post data in the page (the login wall, or LinkedIn changed its page: see `parser.social.linkedin` in cortex.json). Nothing written.");
    const card = this.card(doc, html);
    // links: those in the text (not LinkedIn's own profile, company or hashtag pages), then the link card
    const links = [...urlsIn(f.body).filter((l) => !/linkedin\.com\/(in|company|feed\/hashtag|school)\/|licdn\.com/.test(l)), ...(card ? [card.url] : [])];
    if (card) f.body += `\n\n${card.md}`;
    return post(this.name, url, f.body, f.author, f.published, f.media, undefined, links);
  }

  /** The carousel: its title and the manifest listing its page images, from the JSON in the `carousel` attribute. */
  private carousel(html: string): { title?: string; manifest: string } | undefined {
    const raw = parseHTML(html).document.querySelector(`[${this.sel.carousel}]`)?.getAttribute(this.sel.carousel);
    if (!raw) return;
    try {
      const d = JSON.parse(raw).doc;
      return d?.manifestUrl ? { title: d.title, manifest: d.manifestUrl } : undefined;
    } catch { return; }
  }

  /** An lnkd.in link out of LinkedIn → its destination (read on the interstitial page); unchanged if that fails. */
  private async unfold(link: string): Promise<string> {
    if (!/^https:\/\/lnkd\.in\/(?!p\/)/.test(link)) return link;
    try {
      const href = parseHTML(await this.transport.get(link)).document.querySelector(this.sel.shortlink)?.getAttribute("href");
      return href && /^https?:\/\//.test(href) ? href : link;
    } catch { return link; }
  }

  override async read(url: string, request: string): Promise<Extract> {
    const html: string = await this.transport.get(request);
    let ex = this.parse(html, url);
    if (ex.links?.length) { // the source keeps the real destinations: lnkd.in only works while LinkedIn runs it
      const real = await Promise.all(ex.links.map((l) => this.unfold(l)));
      let content = ex.content;
      ex.links.forEach((l, i) => { if (real[i] !== l) content = content.split(l).join(real[i]); });
      ex = { ...ex, content, links: [...new Set(real)] };
    }
    const doc = this.carousel(html);
    if (!doc) return ex;
    const sizes: any[] = JSON.parse(await this.transport.get(doc.manifest)).perResolutions ?? [];
    const best = sizes.reduce((a, b) => (b.width > (a?.width ?? 0) ? b : a), undefined);
    const pages: string[] = best ? JSON.parse(await this.transport.get(best.imageManifestUrl)).pages ?? [] : [];
    const files = await Promise.all(pages.map(async (src, i) => ({ name: `page-${String(i + 1).padStart(2, "0")}.jpg`, bytes: await this.files.get(src) as Uint8Array })));
    const list = files.map((f, i) => `![Page ${i + 1}](${f.name})`).join("\n\n");
    return { ...ex, content: `${ex.content}\n\n## ${doc.title ?? "Document"}\n\n${list}`.trim(), files };
  }
}
