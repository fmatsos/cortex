# Extension Chrome Cortex

Envoie dans l'inbox du wiki ce que le navigateur affiche : un article derrière un paywall, un post LinkedIn, une newsletter. Le texte est lu dans la page rendue, donc connecté : Cortex n'a pas à retélécharger l'URL (qui lui serait refusée). L'URL reste l'origine de la source (`url` du front-matter, dédoublonnage).

## Installation

1. `bun extension/build.ts` (copie Readability, Turndown et les icônes ; déjà fait dans le dépôt, à refaire après une mise à jour des dépendances).
2. `chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → choisir le dossier `extension/`.
3. Clic droit sur l'icône → **Options** : saisir l'adresse de l'appli de partage (ex. `http://cortex.lan:8080`) puis **Enregistrer**. Chrome demande l'accès à ce serveur : l'accepter.

## Utilisation

- **Page entière** : icône de la barre d'outils, note facultative (pourquoi tu la gardes), **Envoyer la page**. Le contenu principal est extrait avec Readability (sur une copie du DOM) puis converti en Markdown ; si la page n'est pas un article (fil, application), tout le corps de la page est envoyé.
- **Sélection** : sélectionner du texte, clic droit → **Envoyer la sélection à Cortex**. Le HTML sélectionné est converti en Markdown, liens et images en URL absolues, avec l'URL de la page. Pas de note dans ce cas.
- **Résultat** : message dans la fenêtre pour la page ; pour la sélection, pastille « OK » (ou « ! » avec la raison en info-bulle) sur l'icône pendant quelques secondes.

Ensuite `cortex inbox` (ou la CI du dépôt de notes) ingère le fichier.

## Limites

- **Pas d'authentification** : le serveur accepte toute requête, l'extension doit rester limitée au LAN ou au VPN. Le serveur répond aux origines `chrome-extension://…` (CORS), à aucune autre.
- Si le serveur est derrière un SSO (redirection), l'envoi échoue : l'extension ne suit pas les redirections.
- Les liens contenus dans le texte envoyé ne sont pas suivis (contrairement aux posts reconnus par `cortex add`).
- Une URL déjà présente dans le wiki n'est pas ajoutée une deuxième fois (ni son nouveau texte).
- Les images « data: » sont retirées ; pas de sélecteur d'élément, pas de Firefox (Manifest V3 de Chrome).
