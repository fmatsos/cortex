# Refonte UI/UX de Cortex : revue et plan

Revue Codex (gpt-6.1-sol, 2026-11-25), deux passes sur le même fil : la revue complète, puis la révision « design carré » demandée ensuite. **Quand les deux se contredisent, la révision carrée (partie II) l’emporte** : rayons à 0, folio indexé au lieu du folio relié, icônes en terminaisons droites (tâches C30a/C30b), croix pour les Concepts dans le graphe.

## Décisions du propriétaire (2026-11-25)

- **Design carré** : partie II.
- **Graphe : Sigma 4 + Graphology**, placement ForceAtlas2 et communautés précalculés à l’export ; aucune physique active dans le navigateur.
- **Polices** : Hauora Sans (OFL 1.1, quatre graisses statiques, non modifiée) pour l'interface ; Source Serif 4 reste la police des articles et des réponses de l'assistant.
- **Code** : Cascadia Code (OFL 1.1, variable avec ligatures) pour tout le code : code en ligne et blocs des articles, réponses de l'assistant, `kbd`, tokens du design system.
- **Icônes** : Phosphor Light (MIT, `@phosphor-icons/core`) via `design/icons.json` + `scripts/build-icons.ts`, noms inchangés (`<Icon name>`, `iconUse`, ids `cx-<nom>`) ; le jeu dessiné à la main est retiré.
- **Pas de maquettes statiques** : C00 est remplacée par une page `/design-system/` construite tôt (tokens, polices, sprite, avatar, composants, clair et sombre). Le propriétaire valide sur cette page avant la refonte des pages (phase 2 et suivantes). C28 ne fait plus que la compléter.
- **Playwright** accepté en dépendance de développement (C01).
- **Wiki de recette** : une copie locale de `thoughts`, jamais l'original.
- **Pas de bits-ui** (+41 Ko gzip mesurés) : Dropdown Menu en `popover` natif et Tabs écrits à la main, au style shadcn carré, dans `ui/`.
- **Sprite par page** : chaque page prérendue n'embarque que les symboles qu'elle référence (hook `transformPageChunk`), le client complète les manquants.
- **Marque : le graphe-cerveau** (concept 5), un cerveau de profil dessiné comme un graphe de connaissances (nœuds carrés, liens droits, groupe préfrontal en vert), remplace le folio indexé comme marque et comme avatar (C08b).
- **Exception ronde pour la marque** : les nœuds du graphe-cerveau sont de petits disques pleins (plus de carrés) dans toutes ses variantes ; ce n'est une exception qu'à la marque. Sous 40 px, un glyphe dessiné à la main (silhouette en une polyligne fermée, trois nœuds préfrontaux) remplace le graphe, et les points d'entrée de l'assistant (en-tête, champ de recherche, palette) prennent l'icône `assistant` (trois étincelles) ; l'avatar reste dans le panneau (C08c).
- **Ombre et relief** : les couches flottantes (menus, fenêtres contextuelles, palette, notification, tiroir modal de l'assistant) prennent `--shadow-overlay` et un contour `--input` ; les surfaces de la page (cartes, sections de l'accueil, encarts latéraux des articles) et le panneau assistant ancré peuvent porter un léger relief (`--shadow-surface`, ombre de bord `--shadow-edge`), discret et sobre : à plat ne veut pas dire absolument plat (T03, T07). La largeur du panneau ancré se règle à la poignée (320 px à la moitié de la fenêtre, 720 px au plus) et se retient.
- **Favicon du site** : l'icône `brain` de Phosphor (graisse Bold, lisible à 16 px), verte, clair/sombre selon `prefers-color-scheme` ; seul le favicon (`site/static/favicon.svg`, `favicon-32.png`) l'utilise, la marque reste le graphe-cerveau.
- **Graphe : sens des liens, Divers, mode Carte** : des points parcourent les liens de la page sélectionnée ou survolée, de la page qui cite vers la page citée (jamais en vue d'ensemble, pendant un geste ni en mouvement réduit). Les groupes de moins de quatre pages et les pages sans lien forment l'île « Divers ». Le mode Carte (`?view=map`) pose une terre sous chaque île (`--map-sea`, `--map-land`, `--map-coast`), garde les deux routes maritimes les plus fortes de chaque île et masque les liens page à page hors du contexte.
- **Icônes de marque** : `assets/logo/cortex-favicon.svg` est le maître 16 unités du graphe-cerveau ; les PNG (favicons, apple-touch, 192, 512, 512 sombre, logo 912x256) sont rendus à la main depuis `design/brand/cortex-mark.svg` avec Chrome headless (Playwright, `channel: 'chrome'`), marque à 70 % du côté sur fond opaque pour les icônes carrées, et committés ; à refaire si la marque change (C09).
- **Pleine largeur pour la prose** : le texte des articles occupe toute la largeur de la colonne `article` (plus de mesure à 70ch) ; les actions d'une page tiennent sur une ligne, la source originale passe en `title` du bouton.
- **Tags vers la recherche** : un tag est toujours un lien vers `/search/?q=#tag` (articles, accueil, index `/tags/`) ; les pages `/tags/<tag>/` sont supprimées.

# Partie I : revue complète

## 1. État des lieux

Cortex possède déjà un socle fonctionnel riche. La refonte doit surtout organiser l’attention : retrouver une connaissance, la lire, vérifier ses sources, puis explorer ses relations. Le principal problème visuel vient de l’application presque uniforme du même traitement aux contenus, commandes et métadonnées.

La direction recommandée est **« Cabinet de recherche »** : papier chaud, encre sombre, vert de reliure, typographie éditoriale et composants discrets. Le graphe et toutes les fonctions restent présents.

### Périmètre et niveau de preuve

- Code actuel, configuration, tests et audit `REVIEW-UI-UX.md` examinés. Aucun diff suivi n’est présent ; `.claude/` est déjà non suivi.
- Captures fournies examinées, complétées notamment par `graph-mob-light.png`, `search-mob-light.png`, `source-mob-dark.png`, `log-mob-light.png` et `tags-mob-light.png`.
- Site accessible hors sandbox. La 404 vide a été reproduite dans Chrome et son exception relevée. L’ouverture et la fermeture de l’assistant ont été vérifiées, sans envoyer de question.
- Aucun fichier modifié. Pas de certification d’accessibilité ni de recette complète des interactions.

Les appréciations de composition ci-dessous sont des recommandations de design. Les défauts fonctionnels confirmés sont isolés dans `findings`.

### Revue transversale

| Sujet | Constat et preuve | Conséquence et recommandation |
|---|---|---|
| Hiérarchie | Cartes, petits boutons, badges et filtres emploient beaucoup de contours et de capsules similaires. `home-desk-light.png`, `tags-desk-light.png`, `log-desk-light.png`. | L’interface fait lire les commandes avant de faire comprendre les priorités. Réserver les surfaces encadrées aux vrais groupes ; utiliser davantage titre, alignement et espace. |
| Densité | L’accueil combine une grande réserve d’espace dans la carte à la une et une actualité très compacte. `site/src/routes/+page.svelte:105`. | Donner aux blocs une hauteur liée à leur contenu. Conserver une grille commune sans étirer systématiquement chaque carte. |
| Typographie | L’interface utilise les polices système ; le corps wiki fait 17 px avec interligne 1,75. `site/src/app.css:162`, `:253`. | Les bases de lecture sont bonnes, mais l’identité reste générique. Introduire une paire typographique maîtrisée, sans multiplier les familles. |
| Mesure de lecture | Le commentaire annonce environ 72 caractères, mais la colonne d’article reste un `1fr` sans limite en `ch`. `site/src/routes/wiki/[...path]/+page.svelte:84`. | À 1440 px, certaines lignes sont longues. Limiter la prose à 68–72ch ; conserver des débordements contrôlés pour tableaux et code. |
| En-tête | Navigation, recherche, assistant, thème et langue se disputent la même zone. La recherche devient presque vide sur ordinateur et le sélecteur de langue dépasse sur mobile. `site/src/routes/+layout.svelte:95`, `page-mob-light.png`. | Séparer navigation principale et préférences. Sur mobile : marque, recherche, assistant et menu ; les destinations restent accessibles avec leurs libellés. |
| Cohérence | Les quatre composants shadcn copiés coexistent avec beaucoup de classes et comportements locaux. `site/components.json`, `site/src/lib/components/ui/`. | Définir des composants Cortex pour les usages récurrents plutôt que recopier les mêmes recettes dans les pages. |
| Couleur | Le pétrole et le fond bleu gris actuels sont cohérents, mais évoquent davantage un outil technique qu’un espace d’étude. `site/src/app.css:23`. | Réchauffer les neutres, diminuer la présence du cyan et réserver les couleurs sémantiques aux données. |
| Mode sombre | Les captures restent lisibles ; certaines grandes surfaces sombres sont proches et le cyan attire beaucoup l’œil. `home-desk-dark.png`, `source-desk-dark.png`. | Préserver trois niveaux de surface et des accents moins lumineux. Ne pas obtenir le sombre par simple inversion. |
| Accessibilité | Lien d’évitement, noms accessibles, focus, zones de statut et mouvement réduit existent. `site/src/routes/+layout.svelte:80`, `site/src/app.css:231`. | Préserver ces acquis. Vérifier réellement clavier, zoom, lecteur d’écran et absence de focus masqué après chaque changement de structure. |
| Confiance | Certains avertissements importants sont réduits à une icône, avec explication dans `title` et texte invisible. `site/src/lib/components/trust-icon.svelte:9`. | Afficher un libellé court pour « Partiel », « À relire », « Déprécié ». Une explication importante doit fonctionner au toucher et au clavier. |
| Mouvement | Marque et mot-symbole ont des animations répétées ; le graphe dispose d’une pause. `cortex-mark.svelte:67`, `cortex-wordmark.svelte:27`, `graph-view.svelte:406`. | Marque et mot-symbole statiques dans le cadre général. Mouvement réservé au travail en cours de l’assistant et aux interactions utiles du graphe. |
| Éléments flottants | Statut hors ligne en bas à gauche, sommaire en bas à droite, même sur ordinateur. `offline-status.svelte`, `toc-sheet.svelte:23`. | Regrouper les informations globales dans les préférences. Garder le sommaire flottant seulement quand le sommaire latéral n’est pas disponible. |

Pour WCAG 2.2 AA, les critères de recette doivent couvrir notamment contraste, redistribution à 320 px, clavier, focus non masqué et taille minimale des cibles. Une cible tactile de 44 px est un choix Cortex plus confortable, pas une confusion avec le seuil général de 24 px de WCAG 2.2 AA. [Référence W3C](https://www.w3.org/WAI/WCAG22/quickref/).

### Page par page

### Accueil

**À conserver :** recherche centrale, exemples cliquables, accès par type, favoris, découverte quotidienne, actualité, pages centrales et portails.

La recherche est correctement mise en avant sur ordinateur. En revanche, l’ensemble souris, titre et signature se désorganise à 390 px : signature très étroite, retours à la ligne courts et grande illustration à gauche. `home-mob-light.png`, `site/src/routes/+page.svelte:43`.

La carte à la une est étirée par la hauteur de la colonne voisine. L’actualité juxtapose des titres sans séparation visuelle suffisante ; plusieurs « Ajout » n’apportent aucun contexte de page visible. `home-desk-light.png`, `site/src/routes/+page.svelte:127`.

**Composition proposée :** petit signe de marque, titre et signature sur une largeur naturelle ; recherche immédiatement dessous ; exemples et recherches récentes ; accès par type ; bloc éditorial à la une ; actualité en liste ; découverte et pages centrales ; portails. Les sections restent présentes et dans un ordre stable sur mobile.

### Articles Concept, Entité et Synthèse

La hiérarchie titre, description et texte est compréhensible. Fil d’Ariane, liens vers le graphe, références et provenance constituent de vrais atouts. `page-desk-light.png`.

La barre d’actions a presque autant de poids que le titre. La colonne latérale juxtapose plusieurs encadrés et le sommaire flottant double le sommaire visible sur ordinateur. `page-desk-dark.png`, `site/src/routes/wiki/[...path]/+page.svelte:195`.

**Composition proposée :** type et éventuels avertissements ; titre ; description ; barre d’actions compacte ; tags secondaires ; prose limitée à 70ch. À droite : sommaire, relations puis provenance, avec moins de cadres. Sur mobile, les relations et la provenance restent accessibles après l’article.

La mise en favori reste visible ; copie du lien, copie Markdown et ouverture dans le graphe sont regroupées sous « Actions » lorsque l’espace manque.

### Pages Source

Le lien vers l’original est déjà placé près du titre, amélioration importante par rapport à l’ancien audit. `source-desk-dark.png`, `page-actions.svelte:86`.

Sur mobile, titre long, description, actions et tags occupent l’essentiel du premier écran. Le bouton de source contient aussi le domaine, ce qui exige une gestion explicite des domaines longs. `source-mob-dark.png`.

**Recommandation :** conserver l’action « Lire la source originale » comme action principale, présenter le domaine en métadonnée pouvant revenir à la ligne, puis compacter les actions secondaires. Ne modifier ni titre ni résumé.

### Recherche et favoris

La recherche possède déjà facettes, opérateurs, historique, diagnostic des filtres et conservation de la requête dans l’URL. `site/src/routes/search/+page.svelte:28`.

Les résultats cumulent titre, badge, description et extrait. Sur mobile, le premier résultat consomme une grande hauteur ; sur ordinateur, les lignes textuelles sont longues. `search-mob-light.png`, `search-desk-light.png`, `result-row.svelte:71`.

**Recommandation :** titre nettement identifiable, métadonnées sur une ligne secondaire, description compacte et extrait pertinent distinct. Limiter la colonne à environ 80ch. Les textes complets restent disponibles par développement lorsque nécessaire.

Conserver les favoris comme vue de recherche, l’annulation de suppression et le signalement d’un échec de persistance. Ne créer aucune seconde logique de favoris.

La palette doit garder ses commandes et son moteur actuel. Son calcul de hauteur impose encore un minimum de 180 px, même lorsque l’espace disponible est inférieur : cas à tester avec clavier virtuel et faible hauteur. `search-box.svelte:57`.

### Graphe

Le graphe est une fonction centrale à préserver. Formes par type, recherche de nœud, sélection, voisins, vue liste, zoom, pause et centrage existent déjà. `graph-view.svelte:380`, `:512`.

La vue d’ensemble reste difficile à lire : beaucoup d’arêtes et de libellés se concentrent au centre. Sur mobile, les commandes occupent plusieurs lignes et repoussent le canvas. `graph-desk-dark.png`, `graph-mob-light.png`.

**Recommandation :** distinguer une vue d’ensemble calme et une sélection de voisinage précise. Conserver tous les nœuds et toutes les relations ; afficher moins de libellés simultanément selon le zoom, renforcer le voisinage sélectionné et stabiliser le panneau de détail. La recherche de page et le passage Graphe/Liste doivent être immédiatement repérables.

Les libellés du canvas utilisent actuellement une police système codée dans le composant. Ils doivent suivre le contrat typographique et être remesurés après chargement de la police. `graph-view.svelte:233`.

### Tags et pages de tag

Filtrage, tri par fréquence ou alphabet et compteurs sont présents. `site/src/routes/tags/+page.svelte:44`.

Le nuage de capsules est compact mais difficile à balayer, particulièrement avec les noms longs. `tags-desk-light.png`, `tags-mob-light.png`.

**Recommandation :** présenter un index de lignes avec nom et compteur aligné, en colonnes sur ordinateur et sur une colonne mobile. Le tri existant reste inchangé. Aucune fusion, correction orthographique ou suppression de tag : ce serait une modification du contenu.

### Journal

Recherche, période, jour, catégories, URL partageable et affichage par tranches existent. `site/src/routes/log/+page.svelte:15`.

Sur mobile, les filtres prennent une grande partie de l’écran avant la première entrée. Le texte technique brut, notamment les identifiants et « missing note », domine certaines entrées. `log-mob-light.png`.

**Recommandation :** recherche visible ; autres filtres regroupés dans un panneau avec résumé des choix actifs ; chronologie lisible ; texte d’entrée conservé intégralement sous un résumé dépliable. Les liens directs doivent ouvrir et positionner l’entrée concernée.

Les messages anglais appartiennent ici au contenu du journal. La refonte ne doit pas les réécrire silencieusement.

### Assistant

Le panneau natif possède déjà deux comportements utiles : ancré à droite sur grand écran, modal sur petit écran. Conversation conservée pendant la navigation, erreurs différenciées, nouvelle conversation et reprise sont prévues. `assistant-panel.svelte:13`, `assistant.svelte.ts:20`.

L’ouverture vérifiée fonctionne et place le focus dans la saisie. Les exemples et l’explication initiale sont présents. Les états réponse et erreur ont été examinés dans le code, sans appel au modèle.

**Recommandation :** une zone de lecture sobre, une saisie persistante, des citations faciles à inspecter et un statut textuel toujours compréhensible. Le nouvel avatar accompagne ce statut ; il ne le remplace pas. Préserver le brouillon, la conversation, les références, les six types de blocs de réponse et le comportement Entrée/Maj+Entrée.

### 404 et erreurs

**Défaut prioritaire confirmé.** Une ouverture directe de `/page-inexistante-audit/` produit une page vide. La console indique une lecture de `generatedAt` sur une valeur absente. Le layout utilise `data.footer` sans garde, alors que le document de secours peut démarrer sans les données du chargement serveur. `site/src/routes/+layout.svelte:25`, `:117`.

Le composant d’erreur existe et propose déjà recherche et sorties utiles. Le problème est son cadre de rendu, pas l’absence de maquette. `site/src/routes/+error.svelte:20`, `site/vite.config.ts:20`.

Corriger d’abord cette dépendance, puis vérifier ouverture directe, navigation cliente et hébergement sous un préfixe.

### Extension, capture, partage et terminal

Les surfaces périphériques ne partagent pas encore l’identité du site : styles propres dans popup/options, bleu Google dans les sélecteurs de bloc, pages de partage presque natives. `extension/popup.html:3`, `extension/options.html:3`, `extension/picker.js:21`, `extension/mobile.js:13`, `scripts/share-server.ts:63`.

Elles doivent consommer les mêmes tokens, avec une adaptation à leur contexte. Le sélecteur injecté doit garder son isolation Shadow DOM et le bookmarklet rester autonome, sans téléchargement de CSS depuis le serveur LAN.

Le terminal conserve ses conventions ANSI et `NO_COLOR` ; il ne peut pas consommer utilement une palette CSS ou des SVG. Harmoniser les rôles de succès, avertissement et erreur, sans imposer des couleurs hexadécimales au thème du terminal. `src/style.ts:3`.

### Ce qui reste de l’audit précédent

Le document précédent contient des chemins historiques préfixés par `cli/`. Ils ne correspondent plus directement à l’arborescence actuelle.

| Références anciennes | État actuel vérifié |
|---|---|
| D07, lignes de résultats trop longues | Toujours pertinent. `result-row.svelte:71`, `search-desk-light.png`. |
| D09, surfaces fonctionnelles peu différenciées | Partiellement traité par la palette ; hiérarchie encore faible sur l’accueil. `home-desk-light.png`. |
| D06, petites métadonnées | Partiellement traité ; provenance et plusieurs détails restent en `text-xs`. `wiki/[...path]/+page.svelte:178`. |
| UI02, 404 sans issue | Toujours présent dans le parcours direct, désormais avec une cause identifiée dans le layout. |
| UI07, repli de l’en-tête | Toujours problématique sur les captures mobiles actuelles. `page-mob-light.png`. |
| UX23, raison des recommandations cachée | Toujours pertinent : certaines raisons ne sont visibles que dans `title` ou pour le lecteur d’écran. `related-pages.svelte:24`. |
| UX42, couverture des interactions | Toujours pertinent : les tests de modèles purs ne prouvent pas le fonctionnement du navigateur. Prévoir quelques parcours ciblés, pas une vaste duplication des tests unitaires. |
| D01–D04, contraste et distinction des types | Corrections présentes : tokens dédiés, contrôles de contraste, formes et marqueur de favori. `theme.test.ts:104`, `graph-view.svelte:202`. À revalider sur les pixels composés. |
| D08, D11–D13 | Corrections présentes pour note/avertissement, liens visités, tableaux et impression. `src/export.ts:66`, `app.css:43`, `:395`, `:519`. |
| UI01, boucle après filtrage du graphe | Correction explicite avec `untrack`. `graph-view.svelte:69`. Je ne réouvre pas ce défaut sans reproduction. |
| UI03, UI12–UI13 | Reprise de recherche et retours de copie présents. `search-box.svelte:285`, `page-actions.svelte:42`, `:129`. |
| UX01, HTML non assaini | Assainissement présent. `src/export.ts:42`. Les chaînes d’icônes constantes ne constituent pas, à elles seules, une injection utilisateur. |
| UX03–UX05, UX07–UX09 | Recherche centrale, navigation explicite, état vide, historique et état partagé présents. `+page.svelte:53`, `search/+page.svelte:164`, `search-box.svelte:40`. |
| UX18–UX20, UX25–UX26 | Source originale, aperçu de citation, notes/sources dans le sommaire, fil d’Ariane et passage recherché pris en charge. `page-actions.svelte:86`, `citation-preview.svelte:9`, `wiki/[...path]/+page.svelte:117`. |
| UX27–UX31, UX44 | Journal traduit dans son interface, filtrable et borné ; tri des tags disponible. `log/+page.svelte:15`, `log-entry.svelte:89`, `tags/+page.svelte:49`. |
| UX32–UX34, UX45–UX46 | Recherche, vue liste, annulation des recadrages et représentation des relations ont évolué. `graph-view.svelte:76`, `:111`, `:268`, `:512`. |
| UX02, UX35–UX39, UX43, UX49 | Cache par portée, téléchargement volontaire, délai réseau, repli temporaire et statut consultable présents. `service-worker.ts:13`, `:99`, `:139`, `offline-status.svelte:11`. Reste l’omission des assets statiques dans l’empreinte, signalée dans `findings`. |

Ce rapprochement est ciblé : les autres anciens points ne sont ni reconduits automatiquement ni déclarés tous résolus.

## 2. Direction artistique : Cabinet de recherche

### Palette

Le papier doit rester presque neutre : pas de texture, pas d’effet parchemin. L’encre apporte la structure ; le vert de reliure identifie les actions ; les autres couleurs servent les types, les états et les relations.

Les valeurs sRGB ci-dessous sont les références exactes utilisées pour les calculs. Le générateur peut émettre leur équivalent OKLCH ; il ne faut pas maintenir deux palettes à la main. Cette organisation reste conforme au modèle de variables sémantiques de shadcn-svelte. [Documentation du thème](https://www.shadcn-svelte.com/docs/theming).

| Variable shadcn | Clair | Sombre |
|---|---|---|
| `--background` | `#f5f2eb` | `#171c1b` |
| `--foreground` | `#252b2a` | `#e9e7df` |
| `--card`, `--popover` | `#fffcf6` | `#202725` |
| `--card-foreground`, `--popover-foreground` | `#252b2a` | `#e9e7df` |
| `--primary` | `#245849` | `#a3cbb9` |
| `--primary-foreground` | `#ffffff` | `#162a22` |
| `--secondary`, `--muted` | `#e7e4dc` | `#2b3430` |
| `--secondary-foreground` | `#252b2a` | `#e9e7df` |
| `--muted-foreground` | `#525b57` | `#b8c1b7` |
| `--accent` | `#dce9e3` | `#2d4439` |
| `--accent-foreground` | `#22483d` | `#dbece2` |
| `--destructive` | `#9b3033` | `#f1aaa0` |
| `--border` | `#cfcec3` | `#46534b` |
| `--input` | `#7c8276` | `#7e9385` |
| `--ring`, `--link` | `#245849` | `#a3cbb9` |
| `--link-visited` | `#71517f` | `#d4bde1` |
| `--mark` | `#ecdfa7` | `#51482a` |

Exemples OKLCH correspondants :

```css
/* Clair */
--background: oklch(0.96153 0.00984 87.47);
--foreground: oklch(0.28281 0.00867 184.63);
--primary: oklch(0.42017 0.06146 171.68);

/* Sombre */
--background: oklch(0.22087 0.00773 182.20);
--foreground: oklch(0.92731 0.01091 95.17);
--primary: oklch(0.80813 0.04942 166.00);
```

### Tokens sémantiques Cortex

| Variable | Clair | Sombre |
|---|---|---|
| `--type-concept` | `#3f5f8a` | `#aec5ec` |
| `--type-entity` | `#815b31` | `#d9bd93` |
| `--type-synthesis` | `#42694a` | `#afd1b0` |
| `--type-source` | `#52645f` | `#b8c8c0` |
| `--type-other` | `#625e6b` | `#c7bfd3` |
| `--kind-add` | `#42694a` | `#afd1b0` |
| `--kind-ingest` | `#3f5f8a` | `#aec5ec` |
| `--kind-query` | `#71517f` | `#d4bde1` |
| `--kind-lint` | `#7c5a22` | `#e4c58d` |
| `--kind-update` | `#2c6664` | `#9accc7` |
| `--graph-background` | `#fffcf6` | `#202725` |
| `--graph-edge` | `#7c8276` | `#7e9385` |
| `--graph-edge-active` | `#245849` | `#a3cbb9` |
| `--graph-label` | `#252b2a` | `#e9e7df` |
| `--favorite` | `#7c5a22` | `#e4c58d` |
| `--note-background` | `#efe7d4` | `#332f23` |
| `--note-foreground` | `#645128` | `#e8d7ac` |
| `--warning-background` | `#f6e7de` | `#3c2921` |
| `--warning-foreground` | `#863e25` | `#f2bf9d` |

Aliases de confiance : `--trust-verified = --kind-add`, `--trust-unverified = --muted-foreground`, `--trust-review = --kind-lint`, `--trust-stale = --kind-lint`, `--trust-partial = --warning-foreground`, `--trust-draft = --kind-query`, `--trust-deprecated = --destructive`.

La confiance ne repose jamais uniquement sur ces couleurs. Les états qui demandent une action ont un libellé visible.

**Contrastes calculés indépendamment, sur les couleurs opaques proposées :**

| Paire | Clair | Sombre |
|---|---:|---:|
| Texte principal / fond | 12,89:1 | 13,92:1 |
| Texte secondaire / surface atténuée | 5,52:1 | 6,94:1 |
| Texte de bouton primaire / primaire | 8,18:1 | 8,50:1 |
| Bordure de champ / carte | 3,86:1 | 4,64:1 |
| Arête / fond du graphe | 3,86:1 | 4,64:1 |

Les paires textuelles de base examinées ont un minimum de 4,76:1 en clair et 5,11:1 en sombre. Cela ne valide pas encore les transparences, survols, focus composites et états désactivés du thème implémenté.

`src/theme.test.ts` attend actuellement des couleurs hexadécimales, des blocs CSS précis et un rayon de `0.75rem`. Il faudra adapter son contrat, sans supprimer ses exigences de contraste. `src/theme.test.ts:27`, `:47`, `:57`.

### Typographie

Je recommande **Source Sans 3 pour l’interface** et **Source Serif 4 pour la prose longue**. Les deux familles sont distribuées sous SIL Open Font License 1.1 ; conserver les notices avec les fichiers livrés. [Source Sans](https://github.com/adobe-fonts/source-sans/blob/release/LICENSE.md), [Source Serif](https://github.com/adobe-fonts/source-serif/blob/release/LICENSE.md).

La serif vaut ici son coût : Cortex est un outil de lecture et de recherche. Elle doit distinguer la connaissance de son interface, sans envahir menus, badges et tableaux.

| Usage | Règle |
|---|---|
| Navigation, commandes, formulaires | Source Sans 3, 14–16 px, graisses 400 et 600 |
| Prose d’article | Source Serif 4, 18 px ordinateur, 17 px mobile, interligne 1,7 |
| Titres | Source Sans 3, 28/36/44 px selon niveau et largeur |
| Métadonnées | 14 px ; 12 px seulement pour les détails non essentiels |
| Code et identifiants | Monospace système, sans téléchargement supplémentaire |
| Mesure | Prose 68–72ch ; résultats environ 80ch |

WOFF2 auto-hébergés, `font-display: swap`, caractères français et anglais couverts. Charger la serif sur les surfaces de lecture ; ne pas l’embarquer dans le bookmarklet. Contrôler les changements de métriques après chargement, particulièrement le graphe et le mot-symbole.

### Formes, espace et mouvement

- Rayons : 4 px petits éléments, 6 px champs et boutons, 10 px panneaux. Capsules réservées aux tags et filtres sélectionnés.
- Échelle d’espacement : 4, 8, 12, 16, 24, 32, 48, 64 px. Pas de valeurs isolées sans raison documentée.
- Contrôles : 36–40 px sur ordinateur ; surface tactile de 44 px au moins.
- Élévation : aucune ombre sur les contenus ordinaires ; une ombre légère pour menus et aperçus ; une seconde pour les panneaux superposés.
- Transitions : 120–180 ms pour couleur et ouverture, 200 ms maximum pour déplacement d’interface. Aucun mouvement décoratif perpétuel dans l’en-tête ou l’accueil.
- `prefers-reduced-motion` : transformations et déplacements supprimés ; statut textuel et état final conservés. Le graphe conserve sa commande Pause.

## 3. Design system Cortex

### Source commune et génération

Proposition volontairement légère, sans monorepo de composants ni paquet publié :

```text
design/tokens.json                 valeurs et aliases partagés
design/README.md                   règles de génération
scripts/build-design.ts           génération déterministe
site/src/lib/design/tokens.css     sortie pour Svelte/Tailwind
extension/generated/cortex.css    sortie pour popup/options
extension/generated/theme.js      chaîne autonome pour injection
scripts/generated/cortex-css.ts   chaîne pour pages de partage
```

Les sorties sont générées, identifiées comme telles et vérifiées par un mode `--check`. Aucune correction manuelle dans ces fichiers.

Le générateur produit les sélecteurs nécessaires à chaque hôte : `:root` pour les pages, `:host` pour les interfaces injectées. Il génère le même sombre pour le mode système et le choix explicite. `app.css` conserve le raccord Tailwind, la typographie et les règles de contenu.

Pour `picker.js`, qui est injecté comme script classique, charger la sortie autonome avant le sélecteur via `extension/lib.js`. Pour `mobile.js`, importer cette même sortie dans le bundle du bookmarklet. Ne pas introduire un import ESM non compatible dans le script injecté.

Pour le partage, importer la chaîne générée dans le serveur et l’insérer au rendu, sans dépendance réseau supplémentaire.

**Packaging à traiter explicitement :** le payload de distribution énumère ses fichiers. Ajouter une source dans `design/` ou `scripts/generated/` ne suffit pas à la distribuer. `scripts/build.sh:13`.

### Composants shadcn-svelte

La documentation actuelle confirme le modèle de composants copiés et les primitives Bits UI pour les interactions concernées. La recommandation est d’ajouter seulement ce qui remplace réellement une réimplémentation. [Composants officiels](https://www.shadcn-svelte.com/docs/components).

| Décision | Composants et justification |
|---|---|
| Conserver et harmoniser | Button, Badge, Input, Card déjà copiés. Utiliser Card quand une vraie carte existe ; ne pas envelopper chaque section. |
| Ajouter sans moteur interactif lourd | Textarea, Native Select, Separator, Alert, Empty. Évite de réécrire les recettes visuelles. [Native Select](https://www.shadcn-svelte.com/docs/components/native-select). |
| Ajouter avec Bits UI | Dropdown Menu pour préférences/actions ; Tabs pour les blocs de réponse. Ces comportements justifient une dépendance commune. [Dropdown Menu](https://www.shadcn-svelte.com/docs/components/dropdown-menu), [Tabs](https://www.shadcn-svelte.com/docs/components/tabs). |
| Conserver en natif | Assistant en `dialog`, citations et sommaire en `popover`, sections simples en `details`. Les comportements existants doivent être testés et habillés, pas remplacés automatiquement. |
| Ne pas ajouter à ce stade | Command, Dialog, Sheet, Select personnalisé, bibliothèque de notifications et Scroll Area. Leur ajout global augmenterait la migration sans nécessité démontrée. |

**Dépendances proposées :** `bits-ui` pour Dropdown Menu et Tabs ; `@playwright/test` en développement pour les parcours que Bun ne vérifie pas. Pas de Lucide, de bibliothèque d’animation ni de framework de tokens. Relever le poids compressé avant/après ; aucun chiffre de coût supposé.

`site/components.json` déclare actuellement Lucide alors que le paquet n’est pas installé. Chaque composant importé du registre doit utiliser `Icon`, pas introduire son propre pack. Garder les aliases `#lib` du projet et le mécanisme `data-theme` existant.

### Composants Cortex

| Composant | Responsabilité |
|---|---|
| `CortexShell` / `site-header.svelte` | Cadre, navigation, recherche et accès à l’assistant |
| `preferences-panel.svelte` | Thème, langue et état hors ligne avec libellés visibles |
| `page-heading.svelte` | Type, titre, description et métadonnées communes |
| `article-actions.svelte` | Présentation des actions existantes, sans logique de copie dupliquée |
| `trust-badge.svelte` | État de confiance lisible, complément explicatif accessible |
| `section-panel.svelte` | Titre et contenu d’un groupe ; variantes sobre, carte, latéral |
| `result-row.svelte` | Résultat unique partagé entre listes concernées |
| `filter-bar.svelte` | Résumé, compteurs et effacement des filtres |
| `citation-preview.svelte` | Aperçu conservant les liens de notes comme repli |
| `graph-toolbar.svelte` | Présentation des commandes du graphe |
| `assistant-avatar.svelte` | SVG et état visuel, sans logique réseau |
| `assistant-status.svelte` | Statut textuel et annonce accessible |

Ne créer un composant que si son contrat ou ses réemplois le justifient. Conserver les noms actuels lorsqu’ils conviennent ; éviter une campagne de renommage indépendante.

Créer `docs/UI-DESIGN-SYSTEM.md` et une page de référence `/design-system/`, explicitement pré-rendue mais absente de la navigation principale. Elle montre les deux thèmes, états clavier, erreurs, textes longs, badges, citations, icônes et quatre états de l’avatar. `docs/DESIGN.md` reste le document d’architecture existant.

## 4. Icônes

### Choix recommandé

**Conserver le pack dessiné actuel**, cohérent et sans dépendance, avec retouches optiques ponctuelles. La nouvelle direction ne justifie pas de redessiner 63 fonctions reconnues. Garder grille 24, trait 1,75 et variante optique à 16 px.

La source reste `site/src/lib/icons.ts` pour cette migration. Un générateur produit à la construction un composant contenant un unique sprite de `<symbol>`. Le layout l’insère une seule fois par document, hors du bloc récréé lors d’un changement de langue.

```svelte
<svg aria-hidden="true" width="0" height="0" class="icon-sprite">
  <symbol id="cx-search" viewBox="0 0 24 24">
    <!-- tracés produits à la construction -->
  </symbol>
</svg>
```

`Icon` garde son API et ses attributs accessibles, mais son contenu devient :

```svelte
<use href={`#cx-${name}`} />
```

Pas de `{@html}` par occurrence ; pas de géométrie complète dans chaque instance. Les valeurs de trait et remplissage restent sur le SVG d’instance pour préserver `filled` et les tailles.

### Sprite intégré ou fichier externe

Je recommande le **sprite intégré au document** : aucun chargement additionnel, fonctionnement immédiat hors ligne et absence de calcul de chemin sur les pages profondes. Le coût est de répéter le sprite dans chaque document HTML exporté. Mesurer ce coût après compression avant de chercher plus loin.

Un sprite externe économiserait cette répétition, mais demanderait un chemin résolu avec la base SvelteKit, un précache explicite et une recette Safari/hors ligne. Ne pas utiliser un chemin relatif brut tel que `icons.svg#search` depuis une page wiki profonde.

Le sprite intégré doit aussi fonctionner dans la page 404. Ne pas le masquer avec une méthode pouvant rendre les références indisponibles selon le navigateur ; utiliser une boîte de taille nulle, positionnée hors du flux.

### Masques CSS et autres surfaces

Les deux masques d’encart sont actuellement dupliqués dans `app.css`. Un `<symbol>` n’est pas un remplacement portable direct d’un masque CSS.

Pour respecter une source et un sprite uniques, faire émettre par les renderers d’encart un petit SVG contenant `<use>`, puis supprimer les deux data-URL et leurs pseudo-éléments. Les blocs assistant utilisent la même règle. Cette transformation concerne le chrome d’interface généré ; l’assainissement du contenu utilisateur reste inchangé.

Les interfaces injectées utilisent, si elles ont besoin d’icônes, le sprite produit par le même générateur, installé une fois dans leur ShadowRoot. Aucun chargement de sprite distant depuis une page capturée.

Les formes du graphe restent des données dessinées sur canvas. Les commandes et symboles de légende SVG utilisent le pack commun ; convertir tout le graphe en SVG serait une régression de portée et de performance.

### Tests à préserver

Adapter `src/icons.test.ts`, plutôt que le réduire à une photographie du nouveau fichier :

- noms requis, unicité et validité des tracés ;
- identifiants de symboles uniques et références résolues ;
- héritage de `currentColor`, du trait et du remplissage ;
- accessibilité décorative et étiquetée de `Icon` ;
- génération déterministe et absence de sorties périmées ;
- aucun tracé complet répété par utilisation ;
- affichage des encarts, pages profondes, 404 et consultation hors ligne.

## 5. Nouvel avatar

### Concept : le folio relié

Un signe abstrait formé de deux feuillets ouverts et d’un point d’encre à leur jonction. Il évoque la lecture et la mise en relation, sans personnage animal, visage ni cerveau littéral.

Construction SVG native, sans vectorisation d’image : `viewBox` de 48 unités, deux tracés de feuillet, une liaison centrale et un petit point. Géométrie simple, groupes nommés et couleurs héritées des tokens. Version optique simplifiée à 16–24 px.

| État assistant | Présentation | Mouvement |
|---|---|---|
| `idle` | Feuillets ouverts, point stable | Aucun |
| `pending` / réflexion | Point parcourant la liaison, légère variation du feuillet | Boucle lente et discrète, uniquement pendant l’attente |
| `answer` | Point fixé au centre, feuillets stabilisés | Une transition courte, puis arrêt |
| `error` | Petit repère d’interruption et état textuel explicite | Aucun tremblement ni clignotement |

En mouvement réduit, les quatre silhouettes restent différenciées mais statiques. L’erreur et l’attente restent expliquées par du texte ; l’avatar décoratif est ignoré du lecteur d’écran.

Les états se déduisent de la conversation existante : attente, erreur du dernier tour, réponse disponible ou repos. Il n’est pas nécessaire de réinventer le store ou le protocole de `assistant.svelte.ts`.

**Emplacements :** signe statique dans l’en-tête, signe légèrement plus grand sur l’accueil, variante animable dans l’assistant. Le mot « Cortex » redevient du texte stable, sans balayage lumineux.

Retirer `site/src/lib/assets/cortex-mascot.svg`, le masque de clignement et les parcours aléatoires. Régénérer depuis le même dessin maître les SVG de marque, favicon, PNG 32/192/512, icône Apple et icônes d’extension. Les PNG restent nécessaires pour les consommateurs qui les demandent ; ils ne deviennent pas des sources de dessin concurrentes.

Faire produire les PNG une seule fois par un outil SVG déterministe et versionné dans le processus de livraison. Éviter d’ajouter une bibliothèque de rasterisation au code exécuté par Cortex.

## 6. Plan d’implémentation

### Contrat d’exécution

Le plan ci-dessous décrit du travail futur. Aucune tâche n’a été exécutée ici.

Une tâche correspond à un lancement d’agent et un diff autonome. L’agent n’écrit que dans son périmètre, préserve les modifications des autres et s’arrête si une dépendance impose d’élargir ce périmètre.

**Validations communes à chaque tâche de code :**

- **U** : tests Bun ciblés indiqués, puis `bun test` avant validation de la phase.
- **B** : export du site sur un wiki de recette avec `CORTEX_ROOT`, puis inspection de la sortie. Le wiki de recette est une copie, car l’export écrit aussi `.cortex/site-data`.
- **V** : contrôle visuel des surfaces touchées en français et anglais, clair et sombre, à 390 et 1440 px. En-tête et overlays également à 320, 768 et 1280 px ; zoom 200 %, clavier et mouvement réduit.
- **T** : `bunx tsc --noEmit -p tsconfig.json`, plus compilation Svelte via l’export.

```sh
bun test
bunx tsc --noEmit -p tsconfig.json
CORTEX_ROOT=/chemin/vers/wiki-recette bun src/cortex.ts export --out /tmp/cortex-ui-recette
```

Choisir un dossier de sortie dédié : l’export peut vider un ancien export. Exécuter les builds séquentiellement, car ils partagent les fichiers de construction SvelteKit.

Les chemins nouveaux sont indiqués comme tels. Les périmètres `ui/<composant>/*` désignent exclusivement les fichiers du composant copié et son `index.ts`, pas les autres composants.

### Phase 0 : fixer les preuves et le contrat visuel

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C00 | Contrat et maquettes, **sonnet**, aucune | Nouveau `docs/UI-REDESIGN.md` | Inventaire des fonctions ; maquettes accueil, article, recherche et assistant en clair/sombre et mobile ; décisions de ce rapport retranscrites sans modifier le produit. Validation visuelle propriétaire avant habillage généralisé. |
| C01 | Socle de recette navigateur, **sonnet**, C00 | `package.json`, `bun.lock` ; nouveaux `playwright.config.ts`, `tests/ui/helpers.ts`, `tests/ui/smoke.spec.ts` | Une fixture de wiki isolée ; accueil, article et recherche testés sur un export réel ; capture des exceptions navigateur ; dépendance de test seulement. U/B/V/T. |
| C02 | Réparer la 404, **sonnet**, C01 | `site/src/routes/+layout.svelte`, `site/src/routes/+error.svelte` ; nouveau `tests/ui/errors.spec.ts` | Aucun accès obligatoire à `footer` absent ; page utile en ouverture directe et navigation cliente ; code HTTP et ressources corrects à la racine et sous préfixe. U/B/V/T. |

### Phase 1 : fondations partagées

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C03 | Tokens et générateur, **sonnet**, C00 | Nouveaux `design/tokens.json`, `design/README.md`, `scripts/build-design.ts`, `src/design-tokens.test.ts`, `site/src/lib/design/tokens.css`, `extension/generated/cortex.css`, `extension/generated/theme.js`, `scripts/generated/cortex-css.ts` ; `site/src/app.css`, `src/theme.test.ts` | Une seule source ; sorties déterministes ; mode `--check` ; parité sombre ; impression ; toutes les paires existantes et nouveaux états de confiance testés. U/B/V/T. |
| C04 | Primitives shadcn, **sonnet**, C03 | `package.json`, `bun.lock`, `site/components.json`, `ui/button/button.svelte`, `ui/badge/badge.svelte`, `ui/input/input.svelte`, `ui/card/*` ; nouveaux `ui/{textarea,native-select,separator,alert,empty,dropdown-menu,tabs}/*` sous `site/src/lib/components/` | Seulement les composants décidés ; imports `#lib` ; icônes Cortex ; aucun Lucide ajouté ; dimensions, focus et états communs ; poids avant/après relevé. U/B/V/T. |
| C05 | Polices et échelle, **haiku**, C03 | `site/src/app.css` ; nouveaux `site/static/fonts/*`, `site/static/fonts/LICENSE-source-sans.md`, `site/static/fonts/LICENSE-source-serif.md` | Fichiers WOFF2 et licences ; aucun appel externe ; accents présents ; pas de texte invisible ; changement de métriques vérifié. U/B/V/T. |
| C06 | Sprite et renderers d’encart, **sonnet**, C03 | `site/src/lib/icons.ts`, `site/src/lib/components/icon.svelte`, `site/src/app.css`, `src/export.ts`, `src/icons.test.ts` ; nouveaux `scripts/build-icons.ts`, `site/src/lib/components/generated/icon-sprite.svelte` | API Icon conservée ; `<use>` par instance ; aucun masque dupliqué ; encarts exportés accessibles ; générateur contrôlable sans écrire. U/B/V/T. |
| C07 | Distribution et empreinte des assets, **sonnet**, C03/C05/C06 | `src/export.ts`, `scripts/build.sh`, `extension/build.ts` ; nouveau `src/design-distribution.test.ts` | Génération avant construction ; sources et sorties nécessaires incluses dans le payload ; changement de police/favicon/token change l’empreinte ; export depuis une distribution vérifié. U/B/V/T. |
| C08 | Dessin maître et avatar, **sonnet**, C00/C03 | `site/src/lib/components/cortex-mark.svelte`, `site/src/lib/components/cortex-wordmark.svelte`, `site/src/lib/assets/cortex-mascot.svg` ; nouveaux `design/brand/folio.svg`, `site/src/lib/components/assistant/assistant-avatar.svelte`, `tests/ui/avatar.spec.ts` | Souris et clignement retirés ; quatre états ; rendu net à 16/24/48/96 px ; mouvement réduit statique ; pas de modification réseau. U/B/V/T. |
| C09 | Déclinaisons de marque, **haiku**, C08 | `assets/logo/cortex-{logo,mark,mark-light,mark-dark,favicon}.svg`, `assets/logo/cortex-{logo,32,192,512,512-dark}.png`, `site/static/{favicon.svg,favicon-32.png,apple-touch-icon.png}`, `extension/icons/{icon-32.png,icon-192.png}` | Chaque fichier provient du dessin validé ; tailles exactes ; lisibilité clair/sombre ; aucune référence active à l’ancienne souris. U/B/V/T. |

C06 et C07 touchent `src/export.ts` : exécution obligatoirement séquentielle. C05 suit C03 et précède C06, car ils partagent `app.css`.

### Phase 2 : cadre et lecture

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C10 | Cadre et navigation, **sonnet**, C02/C04/C06/C08 | `site/src/routes/+layout.svelte` ; nouveaux `site/src/lib/components/site-header.svelte`, `tests/ui/navigation.spec.ts` | Sprite monté une fois ; aucune commande hors écran ; recherche utilisable ; toutes les destinations atteignables avec libellés ; assistant ancré sans casser le cadre. U/B/V/T. |
| C11 | Préférences et statut global, **sonnet**, C10 | `site-header.svelte`, `theme-switch.svelte`, `lang-switch.svelte`, `offline-status.svelte` sous `site/src/lib/components/` ; nouveau `preferences-panel.svelte` | Thème et langue sortis de la rangée saturée ; options système/explicites conservées ; statut hors ligne, téléchargement, reprise et progression accessibles ; focus restauré. U/B/V/T. |
| C12 | Accueil, **sonnet**, C10/C05 | `site/src/routes/+page.svelte` ; nouveau `site/src/lib/components/section-panel.svelte` | Toutes les sections conservées ; recherche première ; titre mobile naturel ; carte à hauteur de contenu ; actualité lisible sans changer les titres. U/B/V/T. |
| C13 | Confiance et métadonnées, **sonnet**, C04 | `trust-icon.svelte`, `status-badge.svelte`, `type-badge.svelte` sous `site/src/lib/components/` ; nouveau `trust-badge.svelte`, `tests/ui/trust.spec.ts` | Partiel, brouillon, déprécié, obsolète et à relire compréhensibles sans survol ; stable discret ; scénarios avec options review/drafts activées et désactivées. U/B/V/T. |
| C14 | Gabarit article, **sonnet**, C05/C10/C13 | `site/src/routes/wiki/[...path]/+page.svelte`, `site/src/lib/components/breadcrumb.svelte`, `site/src/lib/components/related-pages.svelte` ; nouveau `site/src/lib/components/page-heading.svelte` | Prose 68–72ch ; titres longs ; relations et provenance conservées ; raisons de recommandation consultables au toucher ; tableaux et impression préservés. U/B/V/T. |
| C15 | Actions d’article, **sonnet**, C04/C14 | `site/src/lib/components/page-actions.svelte`, `site/src/lib/components/fav-button.svelte` ; nouveau `tests/ui/article-actions.spec.ts` | Favoris, copie lien/Markdown, copie manuelle, original, graphe et validation humaine conservés ; domaine long sans débordement ; confirmations annoncées. U/B/V/T. |
| C16 | Citations et sommaire, **sonnet**, C14 | `site/src/lib/components/citation-preview.svelte`, `toc-sheet.svelte`, `toc.svelte` ; nouveau `tests/ui/citations.spec.ts` | Aperçu clavier/toucher ; fermeture et retour au bon appel ; Notes/Sources présents ; pas de double sommaire flottant sur ordinateur ; repli sans popover. U/B/V/T. |

### Phase 3 : recherche, assistant et graphe

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C17 | Résultats et facettes, **sonnet**, C04/C10/C13 | `site/src/routes/search/+page.svelte`, `site/src/lib/components/result-row.svelte`, `search-facets.svelte`, `filter-chips.svelte` ; nouveau `tests/ui/search.spec.ts` | Titres/extraits distincts ; mesure bornée ; compteurs exacts ; URL et retour navigateur ; favoris avec annulation ; opérateurs existants inchangés. U avec `src/search-ui.test.ts`, B/V/T. |
| C18 | Palette de recherche, **sonnet**, C10/C17 | `site/src/lib/components/search-box.svelte` ; nouveau `tests/ui/search-palette.spec.ts` | Suggestions et commandes conservées ; clavier complet ; erreur/reprise ; aucun minimum de hauteur dépassant l’espace visible ; petite hauteur et clavier mobile vérifiés. U/B/V/T. |
| C19 | Présentation du panneau assistant, **sonnet**, C08/C10/C13 | `site/src/lib/components/assistant/assistant-panel.svelte` ; nouveau `assistant-status.svelte` dans le même dossier, `tests/ui/assistant.spec.ts` | Quatre états alimentés par le store actuel ; modal et ancré ; focus et navigation ; brouillon/conversation préservés ; réponses simulées, sans modèle réel. U avec `src/ask-site.test.ts`, B/V/T. |
| C20 | Blocs de réponse, **sonnet**, C04/C19 | `site/src/lib/components/assistant/answer-block.svelte` ; nouveau `tests/ui/answer-blocks.spec.ts` | Six types de blocs ; Tabs shadcn ; tableaux étroits et longs ; liens/citations valides ; HTML toujours assaini en amont. U avec `src/answer-blocks.test.ts`, B/V/T. |
| C21 | Commandes et panneau du graphe, **sonnet**, C04/C10 | `site/src/lib/components/graph-view.svelte` ; nouveau `graph-toolbar.svelte` dans le même dossier, `tests/ui/graph.spec.ts` | Tous les contrôles présents ; sélection après filtre ; liste et voisinage clavier ; erreur/reprise ; aucune exception après sortie rapide ; mobile sans commandes perdues. U avec `src/graph.test.ts`, B/V/T. |
| C22 | Lisibilité du graphe, **sonnet**, C05/C21 | `site/src/lib/components/graph-view.svelte`, `site/src/lib/graph-labels.ts`, `src/graph-labels.test.ts` | Budget de libellés adapté au zoom ; police chargée avant mesure ; contraste sur fond réel ; sélection nette ; tous les nœuds/arêtes conservés ; pause et mouvement réduit respectés. U/B/V/T. |

### Phase 4 : index et surfaces périphériques

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C23 | Index des tags, **haiku**, C04/C17 | `site/src/routes/tags/+page.svelte`, `site/src/routes/tags/[tag]/+page.svelte`, `site/src/lib/components/page-list.svelte` ; nouveau `tests/ui/tags.spec.ts` | Lignes lisibles ; compteur aligné ; filtre/tri/URL conservés ; tag long ; états vide et retour de navigation ; aucune modification de vocabulaire. U/B/V/T. |
| C24 | Journal, **sonnet**, C04/C10 | `site/src/routes/log/+page.svelte`, `site/src/lib/components/log-entry.svelte` ; nouveau `tests/ui/log.spec.ts` | Filtres compacts ; résumé des choix ; entrée liée toujours visible ; contenu brut récupérable intégralement ; pagination et références conservées. U avec `src/log-view.test.ts`, B/V/T. |
| C25 | Popup et options d’extension, **haiku**, C03/C09 | `extension/popup.html`, `extension/options.html`, `extension/popup.js`, `extension/options.js` | CSS généré chargé localement ; clair/sombre ; labels explicites ; état succès/erreur ; stockage et envoi identiques ; test dans l’extension chargée. U/B/V/T. |
| C26 | Capture et bookmarklet, **sonnet**, C03/C07/C25 | `extension/picker.js`, `extension/mobile.js`, `extension/lib.js`, `extension/build.ts`, `scripts/bookmarklet.ts`, `extension/capture.test.ts` | Tokens disponibles dans Shadow DOM ; script classique valide ; bookmarklet autonome ; sélection et note intactes ; aucune requête de police/sprite/CSS vers le LAN ; taille du bookmarklet mesurée. U/B/V/T. |
| C27 | Partage et installation, **sonnet**, C03/C07/C09 | `scripts/share-server.ts`, `scripts/share-server.test.ts` | CSS commun ; formulaires étroits ; focus/erreurs ; manifeste et icônes à jour ; mêmes données envoyées ; capture mobile et parcours d’installation vérifiés. U/B/V/T. |

### Phase 5 : référence et réception

| ID | Tâche, exécutant et dépendances | Fichiers autorisés | Acceptation |
|---|---|---|---|
| C28 | Guide vivant et contrat terminal, **sonnet**, C11–C27 | Nouveau `docs/UI-DESIGN-SYSTEM.md`, `site/src/routes/design-system/+page.svelte` ; `site/vite.config.ts` | Tokens, composants, états et contre-exemples visibles ; route explicitement pré-rendue ; règles ANSI/NO_COLOR documentées ; aucune nouvelle fonction métier. U/B/V/T. |
| C29 | Réception et CI, **sonnet**, toutes | `.github/workflows/test.yml`, `tests/ui/*.spec.ts`, `docs/UI-REDESIGN.md` | Suite complète verte ; export réel ; recette racine/préfixe ; cache mis à jour puis hors ligne ; captures comparées ; aucune fonction supprimée ; bilan des poids et limites consigné. U/B/V/T. |

### Parallélisme autorisé

Les groupes suivants ont des périmètres disjoints, une fois leurs dépendances satisfaites :

- C04 et C08.
- C11, C12 et C13 après disponibilité de leurs prérequis.
- C15 et C16.
- C17, C19 et C21.
- C20 et C22.
- C23, C24, C25 et C27.

C26 suit C25 ; C28 et C29 sont séquentiels. Aucun agent ne lance un export pendant celui d’un autre. Les modifications de `package.json`, `bun.lock`, `app.css`, `+layout.svelte` et `src/export.ts` ont un propriétaire unique à chaque étape.

## 7. Risques, décisions ouvertes et limites

- **Valider la direction et les maquettes C00**, particulièrement l’usage de Source Serif 4 pour la lecture longue.
- **Choisir le wiki de recette et la base de déploiement cible** : racine, préfixe, ou les deux. La recette doit aussi couvrir review/drafts.
- **Définir les navigateurs supportés**, notamment Safari/iOS pour dialog, popover, SVG `<use>` et clavier virtuel.
- Les risques principaux sont la perte de focus pendant la migration des menus, le cache d’anciens assets, le packaging de la distribution et l’augmentation du bookmarklet. Ils ont chacun une tâche et une vérification explicites.

Le lancement de `bun test src/theme.test.ts` n’a exécuté aucun test : le préchargement commun tente de créer `/tmp/cortex-xdg-*` et échoue en lecture seule. Aucun export n’a été lancé, puisqu’il écrit des données et des fichiers de construction. Les contrastes proposés ont été calculés séparément, sans écrire de fichier. Aucun nouveau défaut de sécurité n’est établi dans le périmètre examiné ; l’assainissement HTML et les protections des API doivent rester hors du chantier visuel.


# Partie II : révision « design carré »

### 1. Formes, espace et mouvement

**Verdict : adopter un système carré, sans transformer tous les symboles en carrés.** Les composants et surfaces ont des angles droits ; les symboles conservent la géométrie nécessaire à leur reconnaissance. Aucune exception à 2 px n’est justifiée à ce stade.

### Rayons

```css
:root {
  --radius: 0px;
}

@theme inline {
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-xl: 0px;
  --radius-2xl: 0px;
  --radius-3xl: 0px;
  --radius-4xl: 0px;
}
```

Mettre seulement `--radius` à zéro ne suffit pas : `--radius-md` vaut actuellement `0.5rem` indépendamment du token principal, et plusieurs composants utilisent `rounded-full`, des rayons numériques ou `9999px`. Preuves : `site/src/app.css:191`, `site/src/lib/components/chip-button.svelte:16`, `site/src/lib/components/toc-sheet.svelte:23`.

Supprimer ces contournements dans les composants concernés. Éviter un correctif global `* { border-radius: 0 !important }`, qui masquerait les incohérences sans corriger leurs sources.

### Distinguer les éléments sans capsules

| Élément | Traitement carré |
|---|---|
| Tag | Lien textuel précédé de `#`, fond neutre facultatif ; pas de contour systématique |
| Badge informatif | Petit rectangle compact, libellé et éventuel symbole ; aspect non interactif |
| Filtre activable | Bouton rectangulaire, contour de 1 px ; état sélectionné par fond, graisse et repère intérieur |
| Filtre appliqué supprimable | Rectangle avec libellé et commande de retrait explicitement accessible |
| Bouton principal | Aplat primaire ; boutons secondaires avec contour ou texte selon importance |
| Groupe de commandes | Cellules alignées, séparateurs partagés ; éviter les doubles bordures |

La distinction repose sur les états et la composition, pas seulement sur la couleur. Garder les sémantiques existantes : lien, bouton, `aria-pressed`, état désactivé.

### Traits, grille et focus

- Bordures et séparateurs ordinaires : **1 px CSS**, jamais `0.5px` dépendant du rendu de l’écran.
- Repère actif : **2 px**, placé à l’intérieur de l’emplacement réservé pour éviter tout déplacement.
- Grille d’espacement inchangée : 4, 8, 12, 16, 24, 32, 48, 64 px. Titres, champs et contenus partagent des axes explicites.
- Focus : **contour rectangulaire continu de 2 px**, couleur `--ring`, décalage de 2 px. Aucun halo diffus, aucune animation, aucun arrondi. Préserver son contraste et vérifier qu’aucun parent ne le découpe.
- Les traits décoratifs peuvent rester discrets ; une bordure indispensable à l’identification d’un contrôle utilise `--input`, pas le séparateur atténué.

### Élévation et mouvement

**Pas d’ombres par défaut, ni d’ombres décalées systématiques.** Ces dernières introduiraient un langage brutaliste plus démonstratif que le cabinet de recherche recherché.

Cartes, menus, palette et panneaux utilisent fond opaque, contour et ordre de superposition. Un panneau modal peut ajouter un voile uniforme, sans flou. Le dock assistant est séparé par une règle verticale ; aucun arrondi sur ses angles.

Transitions de couleur de 120–180 ms conservées. Ouvertures sobres, sans rebond ni effet de matière souple. Pas de transformation à échelle fractionnaire des traits fins. Mouvement réduit : transitions spatiales supprimées et état final immédiatement visible.

### 2. Palette et typographie

**Palette : inchangée. Typographie : inchangée.**

Source Sans 3 pour l’interface et Source Serif 4 pour la lecture longue restent pertinentes, auto-hébergées sous OFL comme prévu. Une sans plus géométrique n’est pas nécessaire pour obtenir des angles droits ; une monospace généralisée ferait perdre du confort de lecture.

Le caractère carré vient des cadres, alignements et terminaisons. La serif maintient l’identité éditoriale et évite une interface entièrement administrative.

### 3. Avatar : le folio indexé

Le « folio relié » devient un **folio indexé**, plus architectural : deux feuilles rectangulaires décalées, une marge verticale et trois lignes d’index. Le point d’encre circulaire est remplacé par un petit carré.

**Construction SVG :** `viewBox="0 0 48 48"`, grille de 4 unités, feuilles sans `rx`, segments horizontaux et verticaux, terminaisons droites, jointures nettes. Aucun tracé organique, pli courbe, cercle ou masque arrondi. Les groupes animables sont séparés : feuilles, lignes et curseur carré.

| État | Dessin et animation |
|---|---|
| `idle` | Feuilles et index immobiles ; carré sur le premier repère |
| `pending` / réflexion | Carré parcourant les trois positions d’index, par déplacements orthogonaux ; aucune déformation des feuilles |
| `answer` | Carré fixé au dernier repère ; apparition unique d’une règle de conclusion, puis immobilité |
| `error` | Index interrompu, petit repère angulaire distinct ; message d’erreur textuel conservé |

Avec mouvement réduit, chaque état devient une composition statique distincte. L’animation ne porte jamais seule l’information.

En-tête et accueil : version statique. Assistant : version à quatre états. À 16–24 px, réduire le nombre de lignes pour préserver les espaces entre traits. Les favicon, PNG et icônes d’extension suivent ce nouveau dessin ; aucun contenant circulaire n’est ajouté.

### 4. Icônes

**Décision : conserver les noms et les métaphores, mais réviser le dessin. Un simple changement d’attributs serait insuffisant.**

Le pack impose actuellement `round` aux terminaisons et jointures, contient des rectangles avec `rx`, des angles arrondis directement dessinés par des arcs et des points simulés par `h.01`. `site/src/lib/icons.ts:4`, `:23`, `:30`, `:37`, `:115`.

Nouveau contrat :

```svg
stroke-linecap="butt"
stroke-linejoin="miter"
stroke-miterlimit="2"
```

Je préfère `butt` à la valeur SVG `square` : les deux donnent une terminaison droite, mais `square` prolonge le trait d’une demi-épaisseur. `butt` conserve mieux les alignements existants. La limite de jointure évite les pointes excessives ; contrôler particulièrement étoiles, chevrons et avertissements.

Travail nécessaire :

- Remplacer les points `h.01` par de vrais petits carrés : avec une terminaison `butt`, ces segments deviennent presque invisibles.
- Retirer les `rx` et redessiner les arrondis de cadres, documents, écrans et encarts.
- Conserver les courbes qui définissent un symbole reconnaissable : lentille de recherche, lune, globe ou liaison. Ce sont des géométries de symboles, pas des exceptions de rayon de composant.
- Garder les poids optiques existants comme point de départ ; vérifier les limites visibles du trait, pas seulement les coordonnées des chemins.

**Dimensionnement : deux passes sur les 63 noms**, une mécanique avec Haiku, puis une revue et des retouches optiques avec Sonnet. Pas de remplacement de bibliothèque ni de redessin intégral automatique. Le sprite prévu reste la stratégie retenue.

### 5. Graphe

**Retirer le cercle visible pour Concept ; conserver quatre silhouettes distinctes.**

| Type | Forme retenue |
|---|---|
| Concept | Cercle plein (décision du propriétaire, 2026-11-25 : les Concepts restent en cercles, la croix est abandonnée) |
| Entité | Carré plein |
| Synthèse | Losange plein, angles nets |
| Source | Triangle plein, angles nets |

Le triangle et le losange restent des symboles de données. Exiger quatre carrés identiques supprimerait une information aujourd’hui lisible sans couleur. Le contrat actuel l’explicite et le teste : `site/src/lib/graph-shapes.ts:3`, `src/graph.test.ts:189`.

La croix doit être normalisée en surface et en poids visuel : reprendre le facteur du cercle sans mesure la rendrait trop petite ou trop lourde. Vérifier la distinction aux tailles minimales, en niveaux de gris et sur écran mobile. Conserver le budget actuel de taille des nœuds comme contrainte.

Mettre à jour les légendes, suggestions, marqueurs sélectionnés et libellés français/anglais. Le dessin des nœuds et des polygones de légende utilise des jointures nettes ; les halos de texte peuvent garder leur traitement propre pour rester lisibles.

**La zone de détection invisible peut rester circulaire et généreuse.** Elle ne participe pas au langage visuel ; la réduire au contour de la croix dégraderait le toucher. Preuve : `graph-view.svelte:223`.

### 6. Deltas du plan

Les dépendances et validations U/B/V/T restent applicables. Les tâches non citées ne changent pas.

| ID | Modification de périmètre ou d’acceptation | Exécutant |
|---|---|---|
| C00 | Maquettes avec angles droits, règles et grille ; remplacer le folio relié par le folio indexé. Aucun rayon exceptionnel prévu. | sonnet, inchangé |
| C03 | Tous les tokens de rayon à `0px`. Retirer aussi les valeurs numériques résiduelles de `app.css`, notamment code et surlignages. Adapter les tests de thème sans affaiblir les contrastes. | sonnet, inchangé |
| C04 | Tous les composants copiés : contours carrés, aucun `rounded-full`, focus sans halo, surfaces sans ombre. Contrôler aussi les variantes et sous-composants importés. | sonnet, inchangé |
| C06 | Générer le sprite seulement après C30b ; conserver les nouvelles terminaisons, jointures et géométries dans tous les renderers. | sonnet, inchangé |
| C08 | Construire le folio indexé orthogonal et ses quatre états ; remplacer aussi le nom du dessin maître `design/brand/folio.svg` si nécessaire, sans multiplier les sources. | sonnet, inchangé |
| C09 | Décliner le folio indexé sans fond circulaire ni carré arrondi. | haiku, inchangé |
| C10–C12 | Cadre, préférences et accueil : zéro arrondi, menus sans ombre, alignements de groupes et séparateurs communs. | sonnet, inchangé |
| C13 | Badges rectangulaires ; confiance distinguée par texte et repère, sans capsule. | sonnet, inchangé |
| C14–C16 | Articles, actions, aperçus et sommaire : tableaux et panneaux carrés ; suppression des coins arrondis du panneau mobile. | sonnet, inchangé |
| C17 | Ajouter `site/src/lib/components/chip-button.svelte` au périmètre. Supprimer les capsules des filtres et collections ; garder les états sélectionnés et les cibles tactiles. | sonnet, inchangé |
| C18–C20 | Palette, assistant et blocs : focus rectangulaire ; dock sans arrondi ; numéros d’étapes dans des carrés plutôt que dans des disques. | sonnet, inchangé |
| C21 | Commandes et boutons de voisinage rectangulaires ; contour de sélection conforme à la silhouette du nœud. | sonnet, inchangé |
| C22 | Ajouter `site/src/lib/graph-shapes.ts`, `src/graph.test.ts` et `site/src/lib/i18n/{fr,en}.json`. Implémenter la croix, son échelle optique et la légende ; vérifier les quatre silhouettes sans couleur. | sonnet, inchangé |
| C23 | Tags et filtres de listes rectilignes ; aucune capsule résiduelle dans `page-list.svelte`. | haiku, inchangé |
| C24 | Remplacer les pastilles rondes de la chronologie par des carrés ; conserver une zone de focus rectangulaire sans déplacer la règle verticale. | sonnet, inchangé |
| C25–C27 | Supprimer aussi les rayons codés dans popup, options, capture, mobile et bookmarklet ; aucun style périphérique ne doit conserver l’ancien langage. | Exécutants inchangés |
| C28 | Guide vivant : matrice des formes, focus et séparateurs ; aucune exception de rayon admise sans justification explicite. | sonnet, inchangé |
| C29 | Ajouter le contrôle des rayons calculés et des ombres sur les composants réellement rendus, y compris portails et Shadow DOM. Une simple recherche textuelle ne suffit pas. | sonnet, inchangé |

### Nouvelles tâches pour les icônes

| ID | Périmètre exact | Dépendances et acceptation | Exécutant |
|---|---|---|---|
| C30a | `site/src/lib/icons.ts`, `site/src/lib/components/icon.svelte`, `src/icons.test.ts` | Après C03. Terminaisons droites, jointures et limite explicites ; points transformés en carrés visibles ; tests de rendu et d’accessibilité préservés. | haiku |
| C30b | `site/src/lib/icons.ts`, `src/icons.test.ts`, nouveau `tests/ui/icons.spec.ts` | Après C30a, C01 et C04, avant C06. Revue des 63 noms à 16/20/24 px ; cadres rectilignes ; courbes sémantiques conservées ; aucun trait coupé ni pointe débordante. | sonnet |

C30a, C30b et C06 sont strictement séquentielles : elles partagent les sources et les tests des icônes. C22 reste après C21. Aucun nouveau parallélisme n’est introduit sur ces fichiers.

### Contrat de `src/theme.test.ts`

Remplacer l’attente de `0.75rem` à la ligne 57 par `0px` et vérifier les tokens dérivés `sm/md/lg/xl/2xl/3xl/4xl`. Ajouter dans la recette navigateur des assertions sur les **quatre rayons calculés** des composants représentatifs, leurs états et leurs overlays.

Ne pas interdire globalement les cercles SVG : cela rejetterait les courbes sémantiques conservées. Tester séparément les contours des composants, les icônes et les formes du graphe.

Vérification effectuée en lecture seule. Aucun fichier modifié et aucun test exécuté pour cette révision.

