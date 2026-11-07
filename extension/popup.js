import { capture, pick, send } from "./lib.js";

const $ = (id) => document.getElementById(id), status = $("status");
const say = (text, err) => { status.textContent = text; status.className = err ? "err" : ""; };

$("send").onclick = async () => {
  $("send").disabled = true;
  say("Envoi…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { title, url, text } = await capture(tab.id, "page");
    await send({ title, url, text, note: $("note").value });
    say("Envoyé ✓");
    $("note").value = "";
  } catch (e) { say(e.message, true); }
  $("send").disabled = false;
};

$("pick").onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await pick(tab.id);
    window.close(); // the picker works in the page
  } catch (e) { say(e.message, true); }
};
