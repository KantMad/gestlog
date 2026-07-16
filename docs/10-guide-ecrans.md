# 10 — Guide complet des écrans (fonctionnement, sources, impacts)

> Ce fichier décrit **chaque écran** de GestLog : à quoi il sert, **d'où viennent ses
> données**, ses fonctionnalités, ses **impacts sur le reste de l'outil**, et ses pièges.
> Objectif : qu'une personne qui reprend le projet comprenne tout sans relire le code.
> Le **centre d'aide utilisateur** (écran `/aide`) reprend ces infos en version grand public.

## Contexte : les 3 systèmes externes

| Système | Éditeur | Rôle | Entrée dans GestLog |
|---|---|---|---|
| **TIO** | **Tech in Touch** | Prise de commande B2B + PIM produit | **Automatique** via un **n8n hébergé sur OVH** → `/api/sync/*`. Commandes taguées `source=TIO` (**archive**). |
| **Texas Win** | **Asti** | **ERP** — données de commande « vérité » après corrections | **Import manuel** (Import → Commandes Texas) → `source=TEXAS` (**source de vérité**). |
| **WooCommerce** (+ **Brevo**) | site MCS | Ventes **BtoC** + marketing VIP | Sync Woo (n8n) → tables `Btoc*` ; VIP poussés vers Brevo. |

**Règle de lecture B2B (essentielle) :** une saison peut contenir des commandes TIO **et**
Texas. Tous les écrans B2B agrégés lisent **Texas si la saison en a, sinon TIO** (repli),
via `resolveOrderSource(seasonId)` / `resolveOrderSourceBySeasonName` (`src/lib/order-source.ts`).
Détail : [`08-fonctionnalites.md`](08-fonctionnalites.md).

## Le flux B2B de bout en bout

```
Commande client (TIO auto / Texas manuel)  ─┐
                                            ├─►  Répartition (allocation)  ─►  Préparation
Commande fournisseur (import) ─► Réception ─┘        (stock reçu réparti)      (livraisons)
                                                                                    │
        Comparaison commande/réception (contrôle écarts)                            ▼
        Dashboard / Statistiques / Comparaisons (analyse)              Dépôt → Livraisons → Caisse
```

- **Import** alimente commandes clients, commandes fournisseurs, réceptions, stock.
- **Réception** = ce que le fournisseur a réellement livré → devient le **stock disponible**.
- **Répartition** partage ce stock entre boutiques selon la config (rang, plafonds).
- **Préparation** transforme une répartition **validée** en livraisons, puis **Dépôt**,
  **Livraisons** (BL/FAC entrepôt) et **Caisse** (réception de stock magasin).

## Comment c'est codé (résumé)

Next.js 15 (App Router) + React 19 + TypeScript ; Prisma 7.8 (client `src/generated/prisma`,
adaptateur `@prisma/adapter-pg`, beaucoup de SQL brut) ; PostgreSQL (Supabase) ; Tailwind v4 +
composants shadcn ; graphes recharts ; Excel via `xlsx` ; PDF via `pdfjs-dist`. Détails :
[`01-architecture.md`](01-architecture.md). Déploiement VPS OVH + pm2 + `deploy.sh` :
[`02-deploiement.md`](02-deploiement.md). Schéma : [`03-base-de-donnees.md`](03-base-de-donnees.md).

---

# Écrans — référence détaillée

## Import (`/import`)
- **Rôle** : alimenter le système B2B depuis des fichiers Excel, **rattachés à une saison
  cible choisie explicitement** (distincte de la saison active), avec suivi et annulation.
- **5 onglets → endpoints** : Commandes clients TIO (`/api/import/client-orders`, StatGen
  détecté auto), **Commandes Texas ERP** (`/api/import/texas-orders`, parseur dédié
  `parseTexasClientOrders`, décodage par gamme, `source=TEXAS`), Commandes fournisseurs
  (`/api/import/supplier-orders`, StatGen + légende gammes), Réceptions
  (`/api/import/receptions`, Packing List, tailles par nom), Stock (`/api/import/stock`,
  Excel générique avec **mapping manuel**).
- **Fonctionnalités** : auto-détection de format MCS (`detectMcsFormat`) avec alerte si mauvais
  onglet ; aide contextuelle par onglet ; **bloc « Imports récents » supprimables**
  (`/api/import/logs`, chaque import tague ses entités via `importLogId` → suppression
  propre) ; **éditeur de correction de réception** (`/import/receptions`).
- **Impacts** : Texas devient la **vérité** de la saison (les écrans basculent) ; TIO passe en
  archive. Une commande = **une seule saison**. Les commandes fournisseurs **créent** un
  produit absent du référentiel (avec sa grille). Supprimer une commande fournisseur supprime
  aussi ses **réceptions** (cascade).
- **Pièges** : couleur = code avant le tiret (`208-Cognac`→208) ; réf réception tiret→underscore ;
  réceptions : importer la commande fournisseur **d'abord** (auto-rattachement) ; produits
  inconnus (`ZZZ_LOGO`) listés en erreurs = normal.

## Correction de réception (`/import/receptions`)
- **Rôle** : corriger une réception importée sans tout réimporter (ex. 2 couleurs échangées).
- **Source** : `SupplierReception` + `ReceptionLine` + `Product` ; couleurs disponibles par
  référence pour permuter. **Mêmes droits que l'écran Import**.
- **Fonctionnalités** : liste des réceptions (recherche fournisseur/n° commande), éditeur
  (changer la couleur d'une ligne, éditer les quantités par taille, ajouter/supprimer,
  **total dynamique** en pied), journalisé (`lastEditedBy`/`lastEditedAt`).
- **Impacts** : recalcule les écarts commande/réception **et** le stock disponible pour la
  répartition (lecture live des `ReceptionLine`). Refuse deux lignes sur le même produit.

## Répartition (`/allocation`)
- **Rôle** : répartir les quantités **reçues** entre boutiques quand le stock ne suffit pas,
  ajuster à la main, valider en session, exporter.
- **Sources** : demande = `ClientOrder`/`ClientOrderLine` (**source active** via
  `resolveOrderSource`) ; **stock = réceptions live** (`SupplierOrder.receptions.lines`
  agrégées par produit) ; config = `ClientSeason` (rang, plafonds, seuil, rotation) ;
  EAN = `ProductSizeEan`. Validation → `AllocationSession` + lignes.
- **Moteur** (`src/lib/allocation/engine.ts`, 8 règles) : si reçu ≥ demande → tout alloué ;
  sinon pro-rata par taille + arrondis aux mieux classés, **cap réduction ligne/commande borné
  au stock réellement reçu** (pas de pièce « fantôme »), pas de trous de taille, chacun reçoit
  quelque chose, tri par rang puis rotation, seuil mini → statut EN_ATTENTE.
- **Fonctionnalités** : vues **par boutique / par produit** (en-tête produit : Cmd. clients /
  Reçu fourn. / **Écart = Reçu−Commande** / Alloué) ; édition cellule ; **filtre réception**
  (Tout / Réceptionné / Non) ; **bouton « Répartir surplus »** (pièces livrées en plus,
  prorata des commandes, ranking pour arrondis) ; **persistance de la simulation**
  (sessionStorage, restaurée en changeant de page) ; exports **Excel** + **EAN/quantité**.
- **Impacts** : nécessite commandes + **réceptions** + config `ClientSeason` active. En aval,
  la **validation** alimente la Préparation. Corriger une réception puis **Relancer** recompute
  la répartition (la simulation lit les réceptions live).
- **Pièges** : sans `ClientSeason` pour un client, aucune règle ne s'applique ; le surplus ne se
  répartit que sur des tailles commandées ; une session **validée** est un instantané figé.

## Configuration (`/configuration`)
- **Rôle** : régler **par client et par saison** les paramètres de la répartition.
- **Source** : `ClientSeason` via `GET /api/clients?seasonId=`, écriture
  `PATCH /api/client-seasons/[id]`.
- **Champs** : `ranking` (rang, plus petit = servi en premier), `maxReductionOrder` (% max
  commande), `maxReductionLine` (% max ligne), `minDeliveryThreshold` (seuil min. livraison),
  `rotationScore` (départage à rang égal), `isActive`. Édition inline, popover d'aide.
- **Impacts** : consommé directement par le moteur de répartition. **Sans saison active, rien
  ne s'affiche.** Le PATCH prend l'id du `ClientSeason` (exposé en `season.id`), pas l'id client.

## Préparation (`/deliveries`)
- **Rôle** : transformer une répartition **validée** en livraisons boutique et piloter leur
  statut jusqu'à l'expédition.
- **Source** : `Delivery`/`DeliveryLine` (liés à `AllocationSession`), `ShipmentGroup`,
  `EanExport`, `ProductSizeEan`.
- **Fonctionnalités** : `generate` (lit une session **VALIDATED**, ne garde que les lignes
  **LIVRABLE** > 0, une livraison par client, statut PLANIFIEE) ; cycle de statut
  PLANIFIEE→EN_PREPARATION→ENVOYEE_DEPOT→VALIDEE_DEPOT→**EXPEDIEE** avec horodatages ; export
  **EAN CSV** (`ean;quantité`) requis avant envoi dépôt ; **intégration caisse** automatique
  au statut `EXPEDIEE` (`sendDeliveryToCaisse`, non bloquante).
- **Impacts** : nécessite une **session d'allocation validée**. Déclenche la caisse en aval.
  Numérotation `deliveryNumber` **globale** (toutes saisons).
- **Pièges** : EAN manquants → `MISSING_ref_color_size` ; seules les lignes LIVRABLE génèrent
  des livraisons ; un échec caisse est tracé (`caisseSyncStatus=FAILED`) sans bloquer.

## Vue dépôt (`/depot`)
- **Rôle** : côté entrepôt, valider la **réception physique** des livraisons envoyées, saisir
  le nb de colis, signaler des anomalies.
- **Source** : `Delivery` filtrées `status ∈ {ENVOYEE_DEPOT, VALIDEE_DEPOT}` (**pas de filtre
  saison**, vue globale). Actions via `PATCH /api/deliveries/[deliveryId]`.
- **Pièges** : ne pas confondre avec **Livraisons** (`/shipments`) qui ingère les BL/FAC FTP —
  la Vue dépôt travaille sur les `Delivery` **internes** issues de la répartition.

## Livraisons (`/shipments`)
- **Rôle** : consulter les **BL et factures importés de l'entrepôt** (FTP), regroupés par
  commande TIO ; ouvrir le PDF, voir le détail des lignes.
- **Source** : `WarehouseDocument` (`source='warehouse_ftp'`) + `WarehouseDocumentLine` ;
  rattachement client/saison par `orderNumber = tioOrderNumber`. PDF via `/api/shipments/pdf`.
- **Pièges** : un doc sans commande TIO correspondante est exclu quand une saison est active ;
  jointure fragile sur `tioOrderNumber` (chaîne).

## Commandes client / Réassort (`/reassort`)
- **Rôle** : suivre les commandes B2B confrontées aux **livraisons réelles** (BL/FAC entrepôt)
  et **solder** les pièces qui ne seront jamais livrées.
- **Source** : `ClientOrder`/`ClientOrderLine` (**source active** par saison) ; livré/facturé =
  `WarehouseDocument`/`Line` (BL/FAC) par `tioOrderNumber`. Soldage :
  `POST /api/reassort/cancel` écrit `cancelledBySize`/`cancelledTotal` + trace qui/quand.
- **Pièges** : réconciliation dépendante des clés `reference|colorCode|size` ; « livré » ici =
  BL entrepôt (≠ `Delivery` internes du Récap).

## Récap clients (`/recap`)
- **Rôle** : vue par client d'une saison (commandé / livré / reste / taux) + détail par commande.
- **Source** : `ClientSeason`, `ClientOrder` (source active), `Delivery`/`DeliveryLine` (via
  `allocationSession.seasonId`). Détail via `/api/orders/[orderId]`.
- **Piège clé** : ici « livré » = **Delivery internes** (statut EXPEDIEE/VALIDEE_DEPOT), tandis
  que Réassort utilise les **BL entrepôt** — les deux notions peuvent diverger.

## Comparaison commande / réception (`/comparison`)
- **Rôle** : contrôler les **écarts commande fournisseur vs réception réelle**, par fournisseur
  puis par référence/couleur (conforme / écart mineur / majeur).
- **Source** : `SupplierOrder` (lignes commandées + `receptions.lines`), joints par `productId`.
  **Indépendant de TIO/Texas et du CA.**
- **Fonctionnalités** : recherche fournisseur + **filtre réception** (Tout/Réceptionné/Non) ;
  fournisseurs triés **alphabétiquement** ; export Excel ; lien « Corriger une réception ».
- **Pièges** : l'export Excel exporte **tout** (ignore recherche/filtre affichés) ; statut ligne :
  conforme (écart nul), mineur (≤10 %), majeur (>10 %).

## Dashboard (`/dashboard`)
- **Rôle** : vue d'ensemble d'une saison (7 KPI + graphes).
- **Source** : `/api/statistics/season` + `/api/statistics/charts`. `ClientOrder` **source
  active** ; livré = BL, facturé = FAC (`WarehouseDocument`), réception = statuts
  `SupplierOrder`, répartitions en attente = `AllocationSession` SIMULATION, clients actifs =
  `ClientSeason.isActive`.
- **Pièges** : taux de livraison = livré / (commandé − **soldé**) ; taux de facturation =
  facturé / **livré** (pas / commandé).

## Statistiques (`/statistics`)
- **Rôle** : analyses graphiques détaillées d'une saison, filtrables par référence produit.
- **Source** : `/api/statistics/charts`. Attention : **CA ici = montant HT des FAC**
  (`WarehouseDocumentLine.amount`), différent des écrans de comparaison.
- **Pièges** : deux notions de « livré » (BL réels vs `Delivery` allocation) ; top 15 clients
  pour le détail mais montant facturé global.

## Comparaison saisons / catalogues (`/season-comparison`)
- **Rôle** : comparer deux **saisons** OU deux **catalogues** par catégorie produit (CA,
  quantité, poids, évolution). Item 2 filtrable jusqu'à une date de commande.
- **Source** : `/api/statistics/season-comparison`. **CA = `ClientOrderLine.amount`** (≠
  Statistiques). Filtre source **en SQL corrélé** (Texas si la saison de la commande en a).
  Filtre boutique inclusion/exclusion **côté API**. **Export Excel**. PLV exclu.

## Comparaison clients (`/client-comparison`)
- **Rôle** : comparer deux saisons/catalogues **client par client** (CA + quantité + détail
  catégorie).
- **Source** : `/api/statistics/client-comparison`. **CA = `ClientOrderLine.amount`**. Filtre
  boutique **côté front** (l'API renvoie tout, recalcul JS). PLV exclu.

## Infos produits (`/product-info`)
- **Rôle** : gérer le **référentiel trans-saison** : Types de taille, Correspondances
  Fournisseur→Réf, base **EAN**.
- **Source** : `SizeType`/`SizeTypeMapping`, `Supplier`/`SupplierProductRef`, `ProductSizeEan`
  (jointe à `Product` pour l'ordre des tailles et à `StockEntry` pour le stock affiché).
  Alimentée par imports Excel/CSV.
- **Impacts** : sert d'appariement produit dans **tous** les imports et exports (EAN, tailles).
- **Piège** : ces imports ne sont **pas tracés** en `ImportLog` (pas de saison envoyée).

## Répartition magasin (`/repartition`)
- **Rôle** : transformer un export commande client TIO (mono-onglet) en Excel **1 onglet par
  fournisseur**, quantités replacées sous les bons libellés de taille.
- **Source** : fichier `.xlsx` uploadé + `Product.sizeScale`. Logique pure
  `src/lib/repartition.ts` (testée). ⚠️ distinct de la **Répartition (allocation)**.
- **Pièges** : réfs hors catalogue → `missingRefs` ; pièces hors grille → `totalDropped`.

## BtoC (`/btoc`)
- **Rôle** : piloter la boutique en ligne (stats, exports, clients, VIP Brevo).
- **Source** : tables `Btoc*` (sync WooCommerce), `HistOrder` (historique autre Woo),
  référentiel `Product` pour catégories/couleurs. Marketing VIP via **Brevo**. Détails :
  [`07-btoc-brevo.md`](07-btoc-brevo.md).
- **Note** : hors périmètre du **menu Exports** (`/export`) qui regroupe les exports **B2B**.

## Exports (`/export`)
- **Rôle** : hub des exports **hors BtoC**. Direct : **Réceptions CSV EAN/quantité**
  (`[saison 3c][n° commande 11c][EAN 13c][quantité]`, agrégé par commande/EAN, quantités 0
  exclues ; **saison lue dans le fichier commande fournisseur** = `SupplierOrder.tioSeason`) +
  **Comparaison** xlsx. Sélecteur de réceptions (recherche fournisseur). Liens vers les exports
  contextuels (répartition, comparaison saisons, magasin, livraisons).

## Utilisateurs (`/users`, ADMIN) & Mon compte (`/account`)
- **Utilisateurs** : `User` (nom, code ≥4 chiffres, rôle, `isActive`, `screenAccess` JSON).
  Permissions **par écran** pour les USER ; un **ADMIN a toujours tout** (`screenAccess=null`).
  Sécurité réelle = l'API (403), double garde côté client.
- **Mon compte** : nom, code (4 chiffres), déconnexion. Auth : [`05-authentification.md`](05-authentification.md).

## Centre d'aide (`/aide`)
- **Rôle** : documentation **utilisateur** in-app (recherche + thématiques + sous-thèmes),
  accessible à **tous** les connectés (comme `/account`, hors permissions d'écran). Contenu
  dérivé de ce guide, en version grand public. Fichier `src/app/(app)/aide/page.tsx`.
