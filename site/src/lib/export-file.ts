import { toRoute } from "./links";

// What the exports to a Markdown file need from the browser (conversations: assistant-session.ts, journeys: journey-session.ts).

/** The site's root as a URL with a trailing slash, wherever the site is served from (a sub-path included). */
export const siteUrl = () => { const u = new URL(toRoute("/"), location.href); return `${u.origin}${u.pathname.replace(/\/?$/, "/")}`; };

/** Offers `text` as a file download (Blob and a link: no server involved). */
export function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
	const a = document.createElement("a");
	a.href = url; a.download = name; a.hidden = true;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
