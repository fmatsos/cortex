import { getServer, hostPattern, normalize } from "./lib.js";

const input = document.getElementById("server"), status = document.getElementById("status");
const say = (text, err) => { status.textContent = text; status.className = err ? "err" : ""; };
getServer().then((s) => { input.value = s; });

document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault();
  const server = normalize(input.value);
  if (!server) return say("Adresse invalide (http:// ou https://).", true);
  // asked here, in the click: the browser only shows the prompt for a user gesture
  if (!(await chrome.permissions.request({ origins: [hostPattern(server)] }))) return say("Accès refusé : l'extension ne pourra pas joindre le serveur.", true);
  await chrome.storage.sync.set({ server });
  input.value = server;
  say("Enregistré ✓");
};
