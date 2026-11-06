import { capture, send } from "./lib.js";

const MENU = "cortex-selection";
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({ id: MENU, title: "Envoyer la sélection à Cortex", contexts: ["selection"] }));

/** Result on the toolbar icon: "OK" on success, "!" with the reason as tooltip on failure; cleared after a few seconds. */
async function badge(tabId, text, color, title) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setTitle({ title, tabId });
  setTimeout(() => { chrome.action.setBadgeText({ text: "", tabId }); chrome.action.setTitle({ title: "Envoyer la page à Cortex", tabId }); }, 6000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU || !tab?.id) return;
  try {
    const { title, url, text } = await capture(tab.id, "selection");
    await send({ title, url, text, note: "" });
    await badge(tab.id, "OK", "#2e7d32", "Sélection envoyée à Cortex.");
  } catch (e) { await badge(tab.id, "!", "#c62828", e.message); }
});
