# 01 — Architecture

## Vue d'ensemble

GestLog est l'outil de **gestion logistique** de la marque **MCS** (vêtements). Il couvre
deux mondes :

- **B2B** : commandes clients (boutiques/grossistes), commandes fournisseurs, réceptions,
  stock, répartition (allocation), préparation de livraisons, bons de livraison / factures
  dépôt, statistiques et comparaisons.
- **BtoC** : données e-commerce WooCommerce (clients, commandes, produits, stock) + gestion
  VIP via Brevo. Voir [`07-btoc-brevo.md`](07-btoc-brevo.md).

La donnée **produit/commande** vient de **systèmes externes** :
- **TIO** (éditeur **Tech in Touch**) — outil de prise de commande B2B, synchronisé
  automatiquement via un **n8n hébergé sur OVH**.
- **Texas Win** (éditeur **Asti**) — l'**ERP** ; import manuel des commandes « vérité ».
- **WooCommerce** — e-commerce BtoC.

Voir [`04-sources-et-n8n.md`](04-sources-et-n8n.md). Un **centre d'aide utilisateur** est
intégré dans l'app (écran **`/aide`**) ; le tour fonctionnel écran par écran est dans
[`08-fonctionnalites.md`](08-fonctionnalites.md).


## Nommer un fichier exporté

Tout export passe par **`fileStamp()`** (`src/lib/file-stamp.ts`) : `2026-09-04_14h32`.

⚠️ **L'heure et la minute font partie du nom.** Avec une date seule, deux exports du même
jour portent le MÊME nom : le second écrase le premier dans le dossier de téléchargement,
ou se retrouve suffixé « (1) » sans qu'on sache lequel est lequel. C'est de l'heure
**locale**, pas UTC : le nom doit correspondre à l'horloge de l'utilisateur.

## Stack technique

- **Next.js 15** (App Router) + **React 19** + **TypeScript**.
  - ⚠️ Cette version de Next a des **breaking changes** par rapport à ce que tu connais
    peut-être. En cas de doute sur une API Next, lire `node_modules/next/dist/docs/`
    (cf. `AGENTS.md`).
- **Prisma 7.8** — client généré dans **`src/generated/prisma`** (pas le chemin par
  défaut), avec l'adaptateur **`@prisma/adapter-pg`** (driver `pg`). Beaucoup de requêtes
  passent en **SQL brut** via `prisma.$queryRawUnsafe`. Détails : [`03-base-de-donnees.md`](03-base-de-donnees.md).
- **Tailwind CSS v4** + composants **shadcn**-style (dans `src/components/ui/`), icônes
  **lucide-react**, toasts **sonner**, graphes **recharts**, tables **@tanstack/react-table**.
- **mysql2** : utilisé côté n8n pour lire TIO (pas directement par l'app en prod ; l'app
  reçoit la donnée déjà transformée via les endpoints `/api/sync/*`).
- **xlsx** : exports Excel (répartition magasin, BtoC, etc.). **pdfjs-dist** : lecture de PDF
  (BL/FAC). **zod** : validation des payloads d'API. **date-fns** : dates.
- **Tests : Vitest** (`npm test`). Les tests sont **bloquants au déploiement**.

## Structure du repo (`gestlog/`)

```
src/
  app/
    (app)/            ← pages authentifiées (layout commun sidebar + topbar)
      dashboard/ import/ product-info/ comparison/ reassort/ allocation/
      deliveries/ depot/ shipments/ recap/ configuration/ statistics/
      season-comparison/ client-comparison/ repartition/ btoc/ users/ account/
    api/              ← routes serveur (voir liste ci-dessous)
    login/            ← page de connexion (hors layout app)
    globals.css       ← styles globaux (dont garde-fou overflow-x)
    layout.tsx        ← root layout (viewport, metadata, providers, manifest PWA)
  components/
    layout/           ← sidebar, topbar, access-guard, page-header, season-selector…
                        (l'arborescence du menu vit dans `src/lib/navigation.ts`)
    ui/               ← primitives shadcn (button, input, card, dialog, table, sonner…)
    btoc/ configuration/ …  ← composants par feature
  lib/
    prisma.ts         ← singleton PrismaClient (adapter-pg)
    auth.ts auth-context.tsx session.ts screens.ts   ← auth & permissions
    caisse/           ← intégration CaissePro (delivery-sync.ts)
    brevo.ts          ← intégration Brevo (VIP)
    allocation/ delivery/ import/ comparison/ reconciliation.ts repartition.ts
    constants.ts types.ts utils.ts validators.ts
    *.test.ts         ← tests Vitest (session, screens, reconciliation, repartition, utils)
  generated/prisma/   ← client Prisma généré (NE PAS éditer à la main)
  middleware.ts       ← auth + permissions au niveau Edge
prisma/schema.prisma  ← schéma (35 modèles)
docs/                 ← CETTE documentation
deploy.sh             ← (présent sur le VPS) script de déploiement
```

### Groupes de routes
- **`src/app/(app)/`** : tout ce qui est derrière la connexion. Layout commun
  (`(app)/layout.tsx`) : `SeasonProvider` → `MobileNavProvider` → sidebar fixe + `<main>`
  avec `AccessGuard`. Chaque page rend son propre `<Topbar title=… />`.
- **`src/app/api/`** : handlers. Convention : `route.ts` exportant `GET/POST/PATCH/…`.
  Helpers communs dans `src/lib/api.ts` (`handleApiError`, `parseBody`).

## Conventions de code

- **Composants client** : `"use client"` en tête (pages interactives, providers).
- **Validation** : `zod` + `parseBody(request, Schema)` (renvoie `{ error }` ou `{ data }`).
- **Erreurs API** : `handleApiError(e, "api/xxx")`.
- **SQL brut** : `prisma.$queryRawUnsafe(sql, ...params)` avec des `$1,$2…` paramétrés
  (jamais d'interpolation de valeurs utilisateur dans la chaîne).
- **Saison active** : portée par `SeasonProvider` (`src/lib/season-context.tsx`) ; la
  plupart des écrans filtrent par saison. Sélecteur dans la topbar.
- **Permissions d'écran** : `canAccessScreen()` (`src/lib/screens.ts`) — voir
  [`05-authentification.md`](05-authentification.md).
- **Langue** : UI et messages en français.
- **Le code doit ressembler au code autour** (même style, même densité de commentaires).

## PWA / mobile

L'app est installable (manifest + `viewport` dans `app/layout.tsx`,
`width=device-width, viewport-fit=cover`). Un garde-fou `html { overflow-x: clip }` dans
`globals.css` empêche tout défilement horizontal de page sur mobile (les tableaux larges
défilent dans leur propre conteneur). La topbar est responsive (sélecteur de saison réduit
sur mobile, bouton « Nouvelle saison » en icône seule).
