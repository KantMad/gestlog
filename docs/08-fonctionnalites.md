# 08 — Tour des fonctionnalités (écrans)

Toutes les pages sont sous `src/app/(app)/<nom>/page.tsx`, leurs API sous
`src/app/api/<nom>/`. La plupart filtrent par **saison active** (sélecteur topbar). Les accès
sont gérés par écran (cf. [`05-authentification.md`](05-authentification.md)).

| Écran (href) | Rôle métier | API principales |
|---|---|---|
| **`/dashboard`** | Tableau de bord : KPIs et vue d'ensemble. | `/api/statistics/*` |
| **`/import`** | Import **manuel** de fichiers : commandes clients, commandes fournisseurs, réceptions, stock. | `/api/import/{client-orders,supplier-orders,receptions,stock}` |
| **`/product-info`** | Référentiel produit : EANs, types de tailles, références fournisseurs. | `/api/product-info/{eans,size-types,supplier-refs}` |
| **`/comparison`** | Comparaison (commandé/livré/stock selon contexte). | `/api/comparison` |
| **`/reassort`** | **Commandes client** (réassort) : lignes, annulation. Saison **Réassort** dédiée. | `/api/reassort`, `/api/reassort/{lines,cancel}` |
| **`/allocation`** | **Répartition** : sessions de simulation → validation (qui reçoit quoi). | `/api/allocation/{simulate,validate,sessions}` |
| **`/deliveries`** | **Préparation** des livraisons : génération, résolution EAN, déclenche l'envoi caisse à l'expédition. | `/api/deliveries`, `/api/deliveries/[id]`, `/api/deliveries/generate` |
| **`/depot`** | **Vue dépôt** : BL/Factures importés (FTP), récap des livraisons. | `/api/depot/deliveries` |
| **`/shipments`** | **Livraisons** : groupes d'expédition, lignes, génération **PDF**. | `/api/shipments`, `/api/shipments/{lines,pdf}`, `/api/shipment-groups` |
| **`/recap`** | **Récap clients** (vue globale + détail par client `/recap/[clientId]`). | `/api/recap` |
| **`/configuration`** | Paramétrage : clients, saisons clients, réglages. | `/api/{clients,client-seasons,seasons,suppliers,catalogs}` |
| **`/statistics`** | Statistiques détaillées (graphes, par saison). | `/api/statistics/{charts,season}` |
| **`/season-comparison`** | Comparaison **saisons / catalogues**. | `/api/statistics/season-comparison` |
| **`/client-comparison`** | Comparaison **clients**. | `/api/statistics/client-comparison` |
| **`/repartition`** | **Répartition magasin** : export du split d'une commande TIO en **1 onglet xlsx par fournisseur** (grille via `Product.sizeScale`). | `/api/repartition` |
| **`/btoc`** | Module **BtoC** (WooCommerce + VIP). Voir [`07`](07-btoc-brevo.md). | `/api/btoc/*` |
| **`/users`** | **(ADMIN)** Gestion des utilisateurs et de leurs accès écran. | `/api/users`, `/api/users/[userId]` |
| **`/account`** | **Mon compte** : changer nom/code, se déconnecter. Accessible à tous. | `/api/account` |

## Notions transverses

- **Répartition magasin — 2 dispositions d'export TIO** : l'export commande client existe en
  format **« court »** (réf en col 1 « Fiche produit fini », ~38 col) et **« long »** (mêmes
  en-têtes + bloc répété en fin de ligne, réf aussi en col 41, ~45 col). `src/lib/repartition.ts`
  résout les colonnes **par NOM d'en-tête** (`resolveColumns`, repli sur positions par défaut)
  → les deux marchent. Les colonnes de quantité sont `Q. 1`…`Q. 16` (s'arrêtent à `Total CA`).
  Si « Aucune ligne détectée » : vérifier que les en-têtes attendus sont présents.
- **Répartition (`/allocation`) — filtre fournisseur** : sélectionner un/des fournisseur(s)
  restreint le **disponible** (réceptions de ce fournisseur) **ET la demande** (produits
  qu'il a commandés ou livrés). Le périmètre fournisseur→produits vient de `SupplierOrderLine`
  + `ReceptionLine` ; il faut donc que la **commande fournisseur (et/ou la réception) soit
  importée dans la même saison** que les commandes clients. Sinon : 0 produit pour ce
  fournisseur. (`src/app/api/allocation/simulate/route.ts`, `supplierProductFilter`.)
- **Saison Réassort (sentinelle)** : les commandes de réassort sont routées vers une saison
  dédiée par `/api/sync/orders` (cf. [`04`](04-sources-et-n8n.md)).
- **Lien BL/FAC ↔ commande TIO** : via le **nom de fichier** (`IS-xxx`) →
  `WarehouseDocument.tioOrderNumber`.
- **Réconciliation commandé vs livré** : `src/lib/reconciliation.ts` (testé) — alimente les
  écrans de comparaison/récap.
- **Répartition magasin** : `src/lib/repartition.ts` (testé) — génère la grille tailles +
  légende et un classeur xlsx multi-onglets.
- **Logique d'allocation** : `src/lib/allocation/`. **Préparation/livraison** :
  `src/lib/delivery/`. **Imports** : `src/lib/import/`.

### Import — saison cible explicite

L'écran `/import` a un **sélecteur de saison cible** (en haut, encadré) : chaque import
(commandes clients, commandes fournisseurs, réceptions, stock) est rattaché à **une seule
saison choisie explicitement** — par défaut la saison active, mais modifiable. Le `seasonId`
envoyé aux routes `/api/import/*` est celui-ci (plus la saison active globale). Le bouton
d'import affiche la cible (« Importer N lignes dans **AH26** ») et changer de saison
réinitialise le formulaire (`key` sur la saison). But : éviter d'importer par erreur dans la
mauvaise saison (cf. incident PE27/AH26 du 24/06/2026).

### Cloisonnement par saison (commandes & réceptions fournisseur)

**Invariant : une commande fournisseur et une réception appartiennent à UNE seule saison.**
- `SupplierOrder.seasonId` (season-scoped) ; `SupplierReception` n'a pas de `seasonId` mais
  est liée à **une** `SupplierOrder` → hérite de sa saison. Toutes les requêtes
  (`statistics/charts`, `statistics/season`, `comparison/engine`, `allocation/simulate`)
  filtrent par `seasonId` (ou via l'`include` de la commande) — **vérifié, pas de fuite
  inter-saison**.
- **Garde-fou import** : importer une commande (fournisseur **ou client**) dont le n° existe
  déjà dans une AUTRE saison est **refusé** (message « déjà présente en saison X »). Présent
  dans les 4 mappers d'import (`mcs-mapper` × 2, `supplier-order-mapper`, `client-order-mapper`).
  Évite les doublons inter-saison comme IMDER 100739 (AH26 + PE27) ou StatGen 4 (PE27/AH26) —
  nettoyés le 30/06/2026, backups `pe27-*-misplaced-*.json`. Même principe pour les commandes
  **clients**.

### Formats d'import MCS (auto-détectés)

Les fichiers réels MCS ne sont pas des tableaux plats → l'import les **auto-détecte**
(`src/lib/import/mcs-format.ts`) et les parse sans mapping manuel (`mcs-mapper.ts`) :
- **« StatGen » (commande fournisseur)** : détecté par les en-têtes `Fiche fournisseur` +
  `Fiche produit fini` (l'**ordre des colonnes** et le **libellé du n° de commande** varient
  selon l'export — `Numéro de commande` OU `N° commande PF fournisseur` ; repérage par nom,
  pas par position).
  Les colonnes `Q.N` sont des **positions** décodées en tailles **via la grille du produit**
  (`Product.sizeScale`, car elle varie : 7 tailles `S..4XL` ou 2 tailles `L,3XL`). Couleur =
  **code avant le `-`** (`208-Cognac` → `208`). **N° de commande** : pris dans le fichier
  s'il existe, sinon **saisi à l'import** (`orderNumber`). Un fichier **multi-fournisseurs**
  (sans colonne n° commande) → **une commande par fournisseur**, numérotée `<n° saisi> -
  <fournisseur>` (le n° saisi sert de n° de lot).
- **« Packing List » (réception)** : format **tolérant** — colonne référence reconnue par
  plusieurs libellés (`FULL MCS PRODUCT REF`, `REFERENCE`, `REF`, `CODE PRODUIT FINI`…),
  couleur par `COLOR CODE`/`COLOR`/`COULEUR`/`COLORIS`, **tailles repérées par leur nom**
  (`S,M,L,XL,2XL…` OU numériques `36,38,40…`, **ordre indifférent**). En-tête pas forcément
  en ligne 0 (un titre peut être au-dessus). Réf **tiret→underscore** (`EPOMC-C001` →
  `EPOMC_C001`), **somme des lignes de colis** (hors `TOTAL`/récap). Ancien format MCS
  (tailles en lettres sur la ligne **au-dessus** de l'en-tête) toujours supporté.
  **N° de commande fournisseur facultatif** : laissé vide → **rattachement automatique** à
  la commande fournisseur de la même saison qui contient le plus de produits reçus ; sinon
  le n° saisi force une commande précise.
- **« StatGen » (commande client)** : détecté par `Fiche client` + `Fiche produit fini` (et
  PAS `Fiche fournisseur`). `N° commande client` + nom client (`Raison sociale`), couleur par
  code, `Q.N` décodé par produit. **Optimisé gros volume** (8000+ lignes / 200+ commandes) :
  produits préchargés en 1 requête, clients dédupliqués, écriture par commande
  (`deleteMany`+`createMany` en transaction), **annulations/soldes préservées au ré-import**.
  Erreurs « introuvable » **dédupliquées** (ex. `ZZZ_LOGO` = produit fictif, normal).
- Matching sur le **référentiel existant** (par réf + **code** couleur, tolérance zéro
  initial) — **pas de création de produit** (évite les doublons). Les lignes sans produit
  correspondant sont remontées en erreurs.
- Seul l'onglet **Stock** reste en **mapping manuel** de colonnes
  (`src/lib/import/parser.ts` + `*-mapper.ts`).

> Cette table est un index. Pour les détails d'un écran, lire la page + ses API + le module
> `lib/` associé. Si tu ajoutes/déplaces un écran, **mets à jour cette table** et
> [`05-authentification.md`](05-authentification.md).
