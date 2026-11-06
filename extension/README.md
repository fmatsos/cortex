# Extension Chrome Cortex

Envoie dans l'inbox du wiki ce que le navigateur affiche : un article derrière un paywall, un post LinkedIn, une newsletter. Le texte est lu dans la page rendue, donc connecté : Cortex n'a pas à retélécharger l'URL (qui lui serait refusée). L'URL reste l'origine de la source (`url` du front-matter, dédoublonnage).

## Installation

1. `bun extension/build.ts` (copie Readability, Turndown et les icônes ; déjà fait dans le dépôt, à refaire après une mise à jour des dépendances).
2. `chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée** → choisir le dossier `extension/`.
3. Clic droit sur l'icône → **Options** : saisir l'adresse de l'appli de partage (ex. `http://cortex.lan:8080`) puis **Enregistrer**. Chrome demande l'accès à ce serveur : l'accepter.

## Utilisation

- **Page entière** : icône de la barre d'outils, note facultative (pourquoi tu la gardes), **Envoyer la page**. Le contenu principal est extrait avec Readability (sur une copie du DOM) puis converti en Markdown ; si la page n'est pas un article (fil, application), tout le corps de la page est envoyé.
- **Sélection** : sélectionner du texte, clic droit → **Envoyer la sélection à Cortex**. Le HTML sélectionné est converti en Markdown, liens et images en URL absolues, avec l'URL de la page. Pas de note dans ce cas.
- **Bloc** : pour un seul post, commentaire ou section de newsletter dans une page qui en contient plusieurs (fil LinkedIn, X, Reddit…). Lancer le mode avec le bouton **Choisir un bloc** de la fenêtre, le clic droit → **Choisir un bloc à envoyer**, ou le raccourci **Alt+Maj+C** (modifiable dans `chrome://extensions/shortcuts`). Le bloc sous la souris est entouré (il s'ajuste sur le conteneur de post le plus proche : `article`, `[role=article]`, `[data-urn]`, `shreddit-post`, `li` ou `section` assez fournis…) ; **↑ / ↓** (ou **Alt + molette**) l'élargit ou le réduit au parent ou à l'enfant ; **Entrée** ou **clic** le choisit, **Échap** annule. Un petit panneau permet alors d'ajouter une note puis d'**Envoyer** (**Ctrl+Entrée**) ; le résultat s'y affiche. Le bloc est converti en Markdown (boutons et icônes retirés, liens et images absolus, images « data: » retirées).
  - **URL du bloc** : si le bloc contient le lien permanent de son post (LinkedIn `/feed/update/urn:li:activity:…` ou `data-urn`, X `/utilisateur/status/…` autour d'une date, Bluesky, Mastodon `/@utilisateur/123`, commentaire Reddit), c'est cette URL qui est envoyée : Cortex le classe en `social` (X, Bluesky, Mastodon, LinkedIn) et dédoublonne par post. Sinon, c'est l'URL de la page. Les motifs sont dans `PERMALINKS` (`lib.js`) ; un lien vers un autre site que la page (un tweet intégré dans un article) est ignoré.
- **Résultat** : message dans la fenêtre pour la page ; pour la sélection (et l'échec du démarrage du mode bloc), pastille « OK » (ou « ! » avec la raison en info-bulle) sur l'icône pendant quelques secondes.

Ensuite `cortex inbox` (ou la CI du dépôt de notes) ingère le fichier.

## Bookmarklet (Chrome Android, sans appli)

Même capture fine d'un bloc que l'extension, depuis le téléphone, sans rien installer : un favori `javascript:` qui porte tout son code (Turndown, `capture.js`, les motifs de permalien de `lib.js`, `snap` de `picker.js`, plus `mobile.js` pour l'interface tactile). Rien n'est chargé depuis le serveur : une page https comme LinkedIn ne peut pas joindre un serveur http du LAN (contenu mixte, CSP).

1. Ouvrir `<serveur de partage>/share/bookmarklet` sur le téléphone (lien depuis la page de partage) : la page donne le code, avec l'adresse du serveur déduite de la requête (`Host`, `X-Forwarded-Proto`, ou `SHARE_PUBLIC_URL` pour la forcer derrière un proxy).
2. **Copier le bookmarklet**, créer un favori quelconque, le modifier : nom **cortex**, URL = le code collé.
3. Sur la page à capturer : taper **cortex** dans la barre d'adresse, toucher la suggestion du favori. Toucher un bloc (les liens ne sont plus suivis), **Agrandir** / **Réduire** pour ajuster, **Envoyer** : un nouvel onglet ouvre l'appli de partage avec texte, titre et URL (permalien du post) préremplis ; ajouter la note, envoyer.

Le bloc voyage dans le fragment (`#`) de l'URL de l'appli de partage, qui n'arrive jamais au serveur (pas de limite de longueur de requête côté proxy). Au-delà de 60 000 caractères, le texte est tronqué avec une mention visible. Le bundle est construit au premier appel du serveur (`scripts/bookmarklet.ts`, `Bun.build` depuis `node_modules`), sans étape de build.

## Limites

- **Pas d'authentification** : le serveur accepte toute requête, l'extension doit rester limitée au LAN ou au VPN. Le serveur répond aux origines `chrome-extension://…` (CORS), à aucune autre.
- Si le serveur est derrière un SSO (redirection), l'envoi échoue : l'extension ne suit pas les redirections.
- Les liens contenus dans le texte envoyé ne sont pas suivis (contrairement aux posts reconnus par `cortex add`).
- Une URL déjà présente dans le wiki n'est pas ajoutée une deuxième fois (ni son nouveau texte).
- Mode bloc : le sélecteur ne couvre que la page principale (pas les iframes) ; une page qui double son texte pour l'accessibilité (texte masqué) peut l'envoyer en double.
- Les images « data: » sont retirées ; pas de Firefox (Manifest V3 de Chrome).
