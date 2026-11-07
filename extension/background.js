import { capture, permalink, pick, send } from "./lib.js";

const MENU = "cortex-selection", PICK = "cortex-pick";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU, title: "Envoyer la sélection à Cortex", contexts: ["selection"] });
  chrome.contextMenus.create({ id: PICK, title: "Choisir un bloc à envoyer", contexts: ["page", "frame", "selection", "link", "image"] });
});

/** Result on the toolbar icon: "OK" on success, "!" with the reason as tooltip on failure; cleared after a few seconds. */
async function badge(tabId, text, color, title) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setTitle({ title, tabId });
  setTimeout(() => { chrome.action.setBadgeText({ text: "", tabId }); chrome.action.setTitle({ title: "Envoyer la page à Cortex", tabId }); }, 6000);
}

/** Starts the block picker; its panel shows the outcome, the icon badge only a failure to start. */
async function startPicker(tab) {
  try { await pick(tab.id); } catch (e) { await badge(tab.id, "!", "#c62828", e.message); }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === PICK) return startPicker(tab);
  if (info.menuItemId !== MENU) return;
  try {
    const { title, url, text } = await capture(tab.id, "selection");
    await send({ title, url, text, note: "" });
    await badge(tab.id, "OK", "#2e7d32", "Sélection envoyée à Cortex.");
  } catch (e) { await badge(tab.id, "!", "#c62828", e.message); }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "pick-block") return;
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id) await startPicker(tab);
});

// the picked block, sent from the page's panel: the permalink is looked for here (lib.js), the page cannot import it
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== "cortex-send" || sender.id !== chrome.runtime.id) return;
  send({ title: msg.title, url: permalink(msg.links, msg.url), text: msg.text, note: msg.note || "" }).then(() => reply({ ok: true }), (e) => reply({ error: e.message }));
  return true; // the answer is asynchronous
});
