# 10 — Guide complet des écrans (fonctionnement, sources, impacts)

> Ce fichier décrit **chaque écran** de GestLog : à quoi il sert, **d'où viennent ses
> données**, ses fonctionnalités, ses **impacts sur le reste de l'outil**, et ses pièges.
> Objectif : qu'une personne qui reprend le projet comprenne tout sans relire le code.
> Le **centre d'aide utilisateur** (écran `/aide`) reprend ces infos en version grand public.


## Menu de navigation

Le menu (`src/lib/navigation.ts`, rendu par `components/layout/sidebar.tsx`) est **groupé
par étape du flux métier**, pas à plat : 26 entrées alignées devenaient illisibles.

| Groupe | Écrans |
|---|---|
| *(premier niveau)* | Tableau de bord |
| **Marchandise** | Import, Correction réception, Comparaison, Échantillons, Infos produits |
| **Commandes** | Commandes client, Lancement de commande, Contrôle commandes, Vente en conditionnelle |
| **Répartition & expédition** | Répartition, Répartition magasin, Préparation, Livraisons, Vue dépôt, Récap clients, À vendre |
| **Analyse** | Statistiques, Comparaison saisons / catalogues, Comparaison clients |
| **Fichiers & exports** | Fichier d'intégration CC, Exports |
| *(premier niveau)* | **BtoC** |
| **Réglages** | Configuration, Utilisateurs *(admin)* |
| *(bas de menu)* | Centre d'aide, Mon compte |

⚠️ **Tableau de bord et BtoC restent hors groupe** : consultés en permanence, ils ne doivent
jamais coûter un clic de plus. Le bas de menu (aide + compte) est séparé car accessible à
tout utilisateur connecté, quelles que soient ses permissions.

⚠️ **« À vendre » est dans Répartition & expédition**, pas dans Analyse : l'écran sert à
écouler du stock, il appartient au parcours de la marchandise, pas au reporting.

Comportement : groupes repliables mémorisés en `localStorage`, groupe de la page courante
toujours ouvert, pastille sur un groupe replié contenant l'écran actif.

**Le centre d'aide indique l'emplacement de chaque écran** : chaque fiche porte un
`screen` (le href), et `menuPath()` en déduit « Menu : Répartition & expédition › À vendre ».
La page `/aide` affiche aussi un **plan complet du menu**, filtré par les droits. Ces
libellés ne sont **jamais recopiés en dur** — déplacer une entrée de `NAV_TREE` met l'aide à
jour toute seule. Un test vérifie que `menuPath` répond pour **chaque** écran de
`APP_SCREENS` : sans emplacement, une fiche dirait quoi faire sans dire où. Les garanties de
filtrage par droits (groupe vide masqué, groupe à un seul écran aplati) sont décrites dans
[`05-authentification.md`](05-authentification.md) et verrouillées par `navigation.test.ts`.

## Contexte : les 3 systèmes externes

| Système | Éditeur | Rôle | Entrée dans GestLog |
|---|---|---|---|
| **TIO** | **Tech in Touch** | Prise de commande B2B + PIM produit | **Automatique** via un **n8n hébergé sur OVH** → `/api/sync/*`. Commandes taguées `source=TIO` (**archive**). |
| **Texas Win** | **Asti** | **ERP** — données de commande « vérité » après corrections | **Import manuel** (Import → Commandes clients (Texas)) → `source=TEXAS` (**source de vérité**). |
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
- **4 onglets → endpoints** : **Commandes clients (Texas)** (`/api/import/texas-orders`,
  parseur dédié `parseTexasClientOrders`, décodage par gamme, `source=TEXAS`), Commandes
  fournisseurs (`/api/import/supplier-orders`, StatGen + légende gammes), Réceptions
  (`/api/import/receptions`, Packing List, tailles par nom), Stock (`/api/import/stock`,
  Excel générique avec **mapping manuel**).
- ⚠️ **L'import manuel des commandes clients TIO a été retiré** : les commandes TIO
  n'arrivent plus que par la **synchro n8n automatique** (`/api/sync/orders`, `source=TIO`,
  archive). Déposer un StatGen client TIO affiche un message explicite (→ utiliser Texas).
  La route `/api/import/client-orders` + `client-order-mapper` / `importMcsClientOrders`
  existent encore mais **ne sont plus appelés par l'UI** (repli technique).
- **Fonctionnalités** : auto-détection de format MCS (`detectMcsFormat`) avec alerte si mauvais
  onglet ; aide contextuelle par onglet ; **bloc « Imports récents » supprimables**
  (`/api/import/logs`, chaque import tague ses entités via `importLogId` → suppression
  propre) ; **éditeur de correction de réception** (`/import/receptions`).
- **Impacts** : Texas devient la **vérité** de la saison (les écrans basculent) ; TIO passe en
  archive. Une commande = **une seule saison**. Les commandes fournisseurs **créent** un
  produit absent du référentiel (avec sa grille). Supprimer une commande fournisseur supprime
  aussi ses **réceptions** (cascade).
- **Pièges** : couleur = code avant le tiret (`208-Cognac`→208) ; réf réception tiret→underscore ;
  réceptions : importer la commande fournisseur **d'abord** (auto-rattachement). ⚠️ Un
  **« produit introuvable »** signifie que la ligne est **écartée** — à traiter, pas à ignorer :
  soit un **code couleur divergent** (→ **équivalence couleur**), soit un **produit non encore
  synchronisé** depuis TIO.

## Correction de réception (`/import/receptions`)
- **Rôle** : corriger une réception importée sans tout réimporter (ex. 2 couleurs échangées).
- **Source** : `SupplierReception` + `ReceptionLine` + `Product` ; couleurs disponibles par
  référence pour permuter. **Mêmes droits que l'écran Import**.
- **Fonctionnalités** : liste des réceptions (recherche fournisseur/n° commande), éditeur
  (changer la couleur d'une ligne, éditer les quantités par taille, ajouter/supprimer,
  **total dynamique** en pied), journalisé (`lastEditedBy`/`lastEditedAt`).
- **Impacts** : recalcule les écarts commande/réception **et** le stock disponible pour la
  répartition (lecture live des `ReceptionLine`). Deux lignes qui retombent sur le **même produit**
  (réf + code couleur) sont **fusionnées à l'enregistrement** (quantités additionnées par taille) —
  une réception ne stocke qu'une ligne par produit, et le fichier source peut légitimement porter
  un produit sur plusieurs colis (`api/import/receptions/[id]` PATCH).

## Répartition (`/allocation`)
- **Rôle** : répartir les quantités **reçues** entre boutiques quand le stock ne suffit pas,
  ajuster à la main, valider en session, exporter.
- **Écarter un produit à la main** (vue « Par produit ») : une case **« Exclure de la
  répartition »** à côté de la référence retire le couple **référence + couleur** de la
  répartition **et de la validation** (réception défectueuse, coloris douteux… — **aucun motif
  demandé**). La carte est grisée, la référence barrée, un rappel rouge **« N produits exclus »**
  s'affiche dans la barre d'outils et le bouton indique le nombre exact de lignes validées.
  Rien n'étant enregistré, **le stock n'est pas consommé** : les pièces restent disponibles pour
  une répartition ultérieure. L'état (`excludedProducts`) **survit à une relance de simulation**
  (c'est une décision métier, pas un filtre d'affichage) mais est réinitialisé au **changement de
  saison** ; il est persisté avec la simulation.
- ⚠️ **La colonne « Cmd. clients » = le RESTE À LIVRER**, pas la commande d'origine : ce qui a
  déjà été livré à la boutique dans une répartition **validée** en est déduit, et une ligne
  entièrement livrée **disparaît**. C'est ce qui permet de faire correspondre le reste dû au
  stock d'une **2ᵉ réception** (cf. `08`). Une réception partielle ne « re-demande » donc plus
  ce qui est déjà parti.
- ⚠️ **Le DISPONIBLE n'est pas le reçu** :
  `disponible = reçu − échantillons − déjà réparti dans les répartitions VALIDÉES de la saison`.
  Une pièce engagée dans une répartition validée n'est plus redistribuable : sans cette
  déduction, importer une 2ᵉ réception d'un fournisseur remettait en jeu le stock de la 1ʳᵉ,
  déjà réparti et validé. La déduction lit `AllocationLine.allocatedBySize` des sessions
  `status = "VALIDATED"`. **En REPRISE, la session rejouée est exclue** (`excludeSessionId`) —
  sinon elle se déduirait elle-même. Le serveur renvoie `availableByProduct` (et
  `allocatedElsewhereByProduct`) ; l'écran s'en sert pour **plafonner les ajustements manuels
  et le « Répartir surplus »** — les plafonner sur le reçu laisserait réattribuer des pièces
  déjà engagées. *Ordre de grandeur AH26 au moment de la mise en place : 8 sessions validées,
  16 976 pièces déjà engagées.*
  - **Produits entièrement engagés MASQUÉS** : un produit **reçu** mais dont il ne reste
    **rien** (échantillons + répartitions validées) n'affiche que des lignes à 0 / « Annulé »
    à −100 %, ce qui laisse croire à tort que les boutiques n'ont pas été servies (elles
    l'ont été, dans une répartition précédente). Ces produits sont donc **masqués par défaut**
    dans les deux vues, avec un lien **« Afficher les N produits entièrement engagés »** dans
    la barre d'outils (rien ne disparaît en silence). ⚠️ Un produit **jamais reçu** n'est pas
    concerné : c'est le filtre **« Non réceptionné »** qui le gère.
    *Mesuré sur AH26 : 134 produits masqués sur 709 (713 lignes) — **0 pièce allouée** dedans,
    donc rien de distribuable n'est caché.*
    Ils sont **aussi exclus de la VALIDATION** (`linesToValidate`) : sinon la session
    enregistrait pour eux des lignes à **0 en « Annulé »**, alors que ces boutiques ont bien
    été servies dans une répartition précédente — la confusion se serait déplacée dans les
    données. L'exclusion est **indépendante du bouton d'affichage** (réafficher ne revalide
    pas). Le bouton indique alors « Valider N ligne(s) ».
  - **Affichage (vue « Par produit »)** : sous « Reçu fourn. », mentions *« dont N éch. »*
    (échantillons) et *« dont N engagé »* (déjà réparti/validé, en violet), plus une tuile
    **« Dispo »** = reçu − échantillons − engagé (rouge à 0) → on voit d'un coup pourquoi un
    produit n'a plus de stock à répartir.
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
- **Réceptions séparées en BLOCS** : chaque fournisseur est découpé en **un bloc par réception**
  (`R1`, `R2`… + date), chaque bloc étant son **propre tableau** (Référence, Couleur, Commandé,
  Reçu, Écart, %, Statut) avec **son total** (ligne « Total R… » + en-tête « Total réception : N
  pcs »). Un bloc **« Non réceptionné »** regroupe les références commandées reçues nulle part.
  L'en-tête de bloc affiche le **total physique** de la réception ; s'il dépasse le reçu sur
  références commandées, un « **dont N hors commande** » signale les pièces livrées sur des
  références absentes de la commande. Le moteur renvoie `receptions[]` (par fournisseur, triées
  par date) et `receivedByReception` (par ligne) ; l'écart/statut d'une ligne dans un bloc se
  calcule **commandé vs reçu de cette réception** (`deriveGap`). L'export Excel ajoute une colonne
  **« Réceptions »** (`R1 date: qté | R2 date: qté`).
- **Pièges** : l'export Excel exporte **tout** (ignore recherche/filtre affichés) ; statut ligne :
  conforme (écart nul), mineur (≤10 %), majeur (>10 %).

## Contrôle commandes (`/controle-commandes`)
- **Rôle** : repérer les « **sélections** » — les lignes où un client n'a commandé qu'**une
  seule taille** pour un produit/couleur, afin de les faire supprimer dans **TIO**.
- **Source** : `ClientOrderLine` + `ClientOrder` (**source active** via `resolveOrderSource`)
  + `Product`. Détection en SQL : exactement **1 taille avec qté > 0** dans
  `quantitiesBySize` (`jsonb_each_text`) **ET** grille produit à **≥ 2 tailles DISTINCTES**.
- ⚠️ **Le `DISTINCT` est indispensable** : certaines grilles arrivent dupliquées (`"TU,TU"`) →
  sans lui, tous les produits taille unique (ex. `ZZZ_LOGO`) sortaient en faux positifs
  (185 → 65 lignes sur AH26 après correction).
- **Fonctionnalités** : compteurs (lignes / commandes / boutiques / pièces), recherche
  (boutique, n° commande, référence), **export Excel** de la liste filtrée.
- **Nuance métier** : en saison **Réassort**, une seule taille est **normal** (réassort à
  l'unité) — le contrôle vise les commandes de collection.

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

### ⚠️ Pièges de comptage corrigés (audit)
- **Pièces commandées et soldées : filtre `source` manquant** (`/api/statistics/season`).
  `totalPieces` et `cancelledPieces` interrogeaient `ClientOrderLine` sans filtrer la
  source, alors qu'une saison peut porter les mêmes commandes en TIO **et** en TEXAS.
  *Cas réel AH26 : **158 636 pièces affichées pour 69 925 réelles** (x2,27).* Les autres
  saisons n'ayant qu'une source, elles étaient justes — d'où un bug invisible jusqu'ici.
  ⚠️ Toute lecture de `ClientOrder`/`ClientOrderLine` doit passer par `resolveOrderSource`.
- **Livraisons expédiées non filtrées par saison** : la tuile comptait les livraisons de
  **toutes** les saisons. Corrigé via `allocationSession: { seasonId }`. (Impact nul
  aujourd'hui — 0 livraison expédiée en base — mais le compteur était faux par construction.)
- **Comparaison saisons : les commandes sans date disparaissent.** Poser une date de fin
  applique `orderDate IS NOT NULL`. *Les 282 commandes TEXAS d'AH26 ont toutes
  `orderDate` NULL* → l'élément 2 tombait à 0 sans explication. La route renvoie
  `season2.undatedOrders` et l'écran affiche un avertissement.
- **Récap clients : pièces soldées non déduites du reste à livrer.** `totalRemaining`
  valait `commandé − livré` : une pièce soldée, qui ne sera jamais livrée, restait
  éternellement « à livrer ». Corrigé en `commandé − soldé − livré`, avec `totalCancelled`
  exposé. *Impact nul aujourd'hui (aucune pièce soldée en base) — correctif préventif.*
- 🔴 **Taux de réception : 0 % structurel sur TOUTES les saisons.** Il était calculé sur le
  **statut** des commandes fournisseur — part des `COMPLET` ou `SOLDE`. Or **rien dans
  l'application ne pose jamais ces deux statuts** : l'import de réception force `PARTIEL`
  (`lib/import/mcs-mapper.ts`) et le défaut du modèle est `EN_ATTENTE`. La base ne contient
  donc que ces deux valeurs, et le numérateur était toujours nul quoi qu'on reçoive.
  *Cas réel AH26 : 24 commandes `EN_ATTENTE` + 20 `PARTIEL`, **42 167 pièces reçues sur
  84 851 commandées** → 0 % affiché au lieu de **50 %**.*
  - Le taux compte désormais des **PIÈCES** (`ReceptionLine` / `SupplierOrderLine`), comme
    l'écran Comparaison — les deux concordent. Non plafonné : au-delà de 100 % on a reçu
    plus que commandé, c'est une information.
  - Les tuiles **Réception / Livraison / Facturation** affichent maintenant le **détail en
    pièces** sous le pourcentage. C'est justement l'absence de détail qui a laissé passer
    un 0 % permanent.
  - ⚠️ `SupplierOrder.status` reste donc limité à `EN_ATTENTE`/`PARTIEL` en pratique :
    **ne pas s'en servir pour juger qu'une commande est soldée ou complète.**
- **Tableau de bord** : il n'effectue **aucun calcul propre**, il affiche les valeurs de
  `/api/statistics/season` et `/charts`. Le surcompte AH26 le touchait donc aussi
  (`deliveryRate` = livré / pièces effectives, dénominateur doublé → taux divisé par deux).
- **Audités et corrects** : `/api/statistics/charts` (source filtrée partout),
  `/api/statistics/client-comparison` et `/api/statistics/season-comparison` (source
  résolue par sous-select corrélé), `/api/recap`, `/api/reassort`.

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
  Fournisseur→Réf, base **EAN**, **Équivalences couleur**.
- **Équivalences couleur** : fait correspondre un code couleur des **fichiers** (ex. `SSS` de
  Texas, **celui qui sera affiché**) au code du **référentiel TIO** (ex. `000`, porteur des EAN
  et de la grille). À l'import, le produit est retrouvé sous `000` puis **re-clé** en `SSS`
  (produit + EAN) → affichage partout en `SSS`, données conservées. Bascule **paresseuse**,
  référence par référence. La synchro TIO remappe `000→SSS` pour les réfs déjà basculées.
  Détail : [`08-fonctionnalites.md`](08-fonctionnalites.md).
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

## Fichier d'intégration CC (`/integration-cc`)
- **Rôle** : transformer un export **EAN / BL** (format Texas, ~77 colonnes) en **fichier
  d'intégration client** (14 colonnes) — **un fichier par n° de document** (plusieurs → zip).
- **Source** : fichier `.xlsx` uploadé. Logique pure `src/lib/integration-cc.ts` (testée) ;
  colonnes repérées **par NOM** (l'ordre de l'export peut varier). Lignes à quantité ≤ 0 ignorées.
- ⚠️ **Un export Texas empile parfois PLUSIEURS BL** dans le même fichier (cas réel : *ean
  roubaix bl 140272* contenait le doc **143161** en lignes 2→73 et le **140272** en 74→207, avec
  **deux clients différents**). L'écran liste donc chaque document avec une **case à cocher**
  (toutes cochées par défaut) et un avertissement dès qu'il y en a plus d'un → on ne génère que
  les documents choisis. Ce n'est **pas** un reliquat de l'import précédent : l'état est
  entièrement réinitialisé à chaque dépôt de fichier.
- **Marque** : **toutes les marques sont reprises** (Country Classic **et** MCS) ; la colonne
  `fournisseur` porte le libellé de marque de **chaque ligne**.
  ⚠️ Un filtrage sur la seule marque MCS a été essayé puis **abandonné** : il amputait le
  fichier de l'essentiel (sur l'export *romans 143161/143162* : **413 pièces au lieu de 2653**,
  Country Classic pesant 2240 des 2653). `buildIntegrationDocuments(lines, brands)` sait encore
  filtrer (paramètre `brands`, vide = tout), mais l'écran ne filtre plus.
- **Équivalences** : `fournisseur`←*Libellé marque* · `Code Article`←*Code Produit Fini* ·
  `Désignation`←*Libellé 1 Produit Fini* · `taille`←*Taille* · `coloris`←*Libellé Coloris* ·
  `EAN`←*Code Barre* · **`prix de revient HT`←*Prix du Document*** (repli *Prix Unitaire* —
  ⚠️ **aucun prix recalculé**, mais **arrondi à 2 décimales** via `round2`, et la cellule Excel
  est formatée `0.00`) · `Prix de vente TTC`= vide · `secteur`=**PAP** (constante) ·
  `saison`←*Saison Document* · `code modele`= vide · `famille d'article`←*Libellé famille
  statistique* · `matiere`←*Composition* · `Quantité`←*Qté*.
- **Nom du fichier** : `Fichier intégration {VILLE} {N° Document} {JJ-MM-AA}.xlsx` — la **ville
  de livraison** vient de `Client.deliveryCity` (synchronisée depuis TIO `lng_shop.city`),
  résolue par le **Code Client** du fichier ; la date est la **date d'import du fichier
  d'origine**, figée au moment du dépôt (pas à la génération, pour qu'un même import donne
  toujours le même nom). Ville inconnue → nom sans ville + alerte à l'écran.

## Lancement de commande (`/lancement-commande`)
- **Rôle** : transformer l'export TIO **« commandes à la couleur »** (CSV) en **tableaux de
  lancement** pour le service achat : **un onglet par catégorie**, produits **triés par
  quantité décroissante**, couleurs détaillées dessous, avec les colonnes de travail.
- **Source** : fichier `.csv` déposé. Logique pure `src/lib/lancement-commande.ts` (parsing +
  structure) et `src/lib/lancement-commande-xlsx.ts` (classeur), toutes deux **testées**.
- ⚠️ **`T0..T11` sont des POSITIONS, pas des noms de tailles** : `T0` = **1ʳᵉ taille de la
  grille du PRODUIT** (`Product.sizeScale`, via `POST /api/lancement-commande`).
  **Ne PAS utiliser `SizeType`** : ses positions en base ne suivent pas l'ordre d'habillage
  (`HAU` y commence par **M**, pas par S), et une déclinaison peut avoir une grille **plus
  courte** que son type (`THSPT5P_201` = `29…44` alors que `PAN` = `28…44`) — le décalage
  ferait glisser toutes les tailles d'un cran. Une référence introuvable au référentiel est
  **signalée** et ses tailles restent nommées `T0, T1…` (aucune pièce perdue).
- 🔴 **…mais l'ORDRE de `Product.sizeScale` n'est pas fiable non plus** — audit du
  24/07/2026 : **893 produits sur 8 887 (10 %)** ont une grille abîmée, dont **846
  désordonnées** (`M,L,XL,S,2XL…` — le S en 4ᵉ position, l'ordre du `SizeType` ; ou
  `42,30,31,…,28,44,29`) et **47 avec doublons** (`TU,TU`, et jusqu'à
  `S,S,S,S,S,S,M,M,…` sur **42 entrées**). Sans garde-fou, cela produisait un onglet Jersey
  à **42 colonnes** (« S » répété 6 fois) et un « S » rangé après « XL » dans Chemise.
  → `sortSizeScale()` **dédoublonne et remet chaque grille dans l'ordre d'habillage
  canonique** (`sizeRank` : taille unique < lettres < numériques, `XXL`≡`2XL`), à la fois
  côté API (choix de la grille la plus complète **après** nettoyage) et côté construction
  des onglets. Testé sur les grilles réellement corrompues.
  ⚠️ **La cause est en amont (synchro TIO) et n'est pas corrigée** : d'autres écrans lisant
  `sizeScale` peuvent être affectés (notamment la **règle des trous de taille** en
  répartition, qui dépend de l'ordre de la grille).
- **Colonnes générées** (identiques au modèle du service achat) : `Étiquettes de lignes` ·
  *tailles* + `Somme de Quantity` · `site …` + total · `% réa …` · `rea …` + total ·
  `total …` + total.
- **Formules** (sur les lignes **couleur** uniquement — c'est là que le travail se fait) :
  `% réa` = taille ÷ total commandé · `rea` = `ARRONDI.SUP((total × 10 %) × % réa ; 0,5)` ·
  `total` = commandé + site + réa · les `Somme` sont des `SOMME()`.
- **Couleurs** : en-têtes **bleu** `4472C4` (commandé, % réa, réa), **jaune** `FFFF00` (site,
  à remplir à la main → cellules laissées **vides**), **orange** `FFC000` (total),
  **vert** `92D050` (total général) ; cellules `% réa` en **cyan** `00B0F0`.
- **Écrit avec `exceljs`** (et non `xlsx`) : c'est la seule des deux à écrire **couleurs ET
  formules**. Chargée en **import dynamique** pour ne pas alourdir le reste de l'app.

## À vendre (`/a-vendre`)
- **Rôle** : repérer le **stock à écouler en priorité** — quels produits-couleurs sont
  disponibles, en quelles tailles, ce qu'ils représentent en valeur, et simuler une remise.
- **Source** : **`StockEntry`** (stock physique entrepôt, synchronisé depuis TIO) + `Product`
  pour la grille, les catégories et les prix. Logique pure `src/lib/a-vendre.ts` (testée).
  ⚠️ Jusqu'ici `StockEntry` n'était **exploité par aucun écran**.
- 🔴 **« Disponible » ici ≠ « disponible » de la Répartition.** Ici c'est le **stock physique
  en entrepôt** ; là-bas c'est `reçu − échantillons − déjà réparti`, qui répond à « que
  puis-je encore distribuer aux boutiques ? ». Les deux chiffres n'ont pas à coïncider.
- **Critères** : trous de tailles autorisés (**toggle Oui/Non**, « Non » par défaut →
  `maxGaps=0` ; « Oui » → `maxGaps=-1`, aucune limite) · quantité min. **à la couleur** ·
  **collections** · catégories · sous-catégories · recherche libre · **% de remise**.
  *L'API accepte toujours un `maxGaps` numérique (0, 1, 2…) si un besoin plus fin réapparaît.*
- **Collections (PE/AH uniquement)** — `src/lib/a-vendre-season.ts`, testé.
  - 🔴 **Cet écran ne connaît AUCUNE saison sentinelle.** « Réassort » et « Hors-saison »
    n'apparaissent ni dans le filtre, ni comme rattachement : un stock à écouler appartient
    toujours à une collection. *Avant : **1 087 produits sur 1 570** s'affichaient à la fois
    sous leur vraie collection ET sous une sentinelle.*
  - Le lien produit→saison n'existant pas en base, il est reconstitué par une **cascade**,
    la règle la plus sûre d'abord :
    1. **commandes clients** du produit (saisons PE/AH seulement) → la **plus ANCIENNE**
       fait foi : c'est la collection de **lancement**, un produit recommandé plus tard ne
       change pas de collection ;
    2. **référence sœur** : un autre coloris de la même référence — une référence
       appartient à une collection, ses coloris ne se dispersent pas ;
    3. **lettre de la référence** (`SEASON_LETTERS`) ;
    4. sinon **indéterminée** — affichée « — », jamais rangée d'office quelque part.
  - Le **filtre** porte sur *toutes* les collections du produit (commandes + rattachement) :
    un produit lancé en PE25 et recommandé en AH26 ressort sur les deux. La **colonne
    Collection** montre, elle, la seule collection de lancement.
  - ⚠️ **Une collection déduite est signalée** : pastille ambre + « ? » à l'écran, suffixe
    `(déduit)` dans l'export. Sans ça une hypothèse se lirait comme un fait.
  - ⚠️ **`SEASON_LETTERS` est limité à K→S** (K=PE23 … S=PE27) et ne doit pas être étendu
    sans re-vérification : sur ces neuf lettres la règle retrouve la saison de lancement
    quasi parfaitement (P 153/153, Q 136/136, R 123/123, S 139/139, O 148/149), mais
    au-delà elle est **fausse** — `AM`, `CC`, `CM`, `TH`, `DM`, `ZZ`… désignent des **lignes
    de produits**, pas des saisons (`AM` prédirait PE18 pour des accessoires lancés en AH26).
  - **Résultat mesuré en production** : 1 570 produits en stock → 1 442 constatés sur
    commandes, 26 déduits par référence sœur, 66 par préfixe, **36 indéterminés**
    (974 pièces, dont **7 produits `DEMO_` totalisant 562 pièces**) = **97,7 % rattachés**.
  - ⚠️ **Rien n'est écrit en base** : c'est un calcul de lecture propre à cet écran. Les
    commandes et la synchro TIO gardent leurs saisons sentinelles, indispensables ailleurs
    (écran Commandes client, rapprochement BL/FAC).
- ⚠️ **Définition d'un « trou »** : une taille à **0 encadrée par des tailles en stock**.
  Les tailles absentes **en bout de gamme ne comptent pas** (`S:5 M:13 L:17 XL:14 3XL:0` = 0
  trou : la gamme s'arrête, elle n'est pas trouée ; `S:15 M:0 L:7` = 1 trou). C'est ce qui
  distingue un assortiment vendable d'un fond de série dépareillé.
  *Sur le stock actuel : 1 038 produits sans trou sur 1 560.*
- ⚠️ **Le lien produit → saison n'existe pas en base** (`Product` n'a pas de saison) : il est
  reconstitué via les **commandes clients** (1 500 des 1 560 produits en stock y sont
  rattachables ; 60 ne le sont pas). **1 118 produits appartiennent à plusieurs saisons**
  (produits permanents) → le filtre saison est **facultatif et multi-saisons**, un même
  produit peut ressortir sur plusieurs.
- **Valorisation** : la **remise s'applique au PRIX DE GROS** (`costPrice`) — c'est le prix
  facturé aux boutiques, donc celui qu'on brade pour déstocker. Le **prix public**
  (`salePrice`) est affiché **au plein tarif**, comme repère de positionnement, et n'est
  jamais remisé. Les pièces sans prix de gros ne sont pas valorisées et sont **signalées**
  (aujourd'hui : **0** — les 1 560 produits en stock ont tous un prix de gros, alors que 7
  n'ont pas de prix public).
  *Valeur du stock actuel : **1 412 856 €** au gros (4 209 138 € au public).*
- **Tri** : par **quantité décroissante** — ce qui encombre le plus l'entrepôt d'abord.
  Départage : valeur au prix de gros, puis référence.
- **Export Excel** : toute la liste filtrée (l'écran n'affiche que les 300 premières lignes),
  avec une **ligne TOTAL** pour retrouver les chiffres de l'écran.

## Vente en conditionnelle (`/conditionnelle`)
- **Création d'une opération** : le client se choisit dans un **champ de recherche à
  suggestions** (`<datalist>`, libellé « Nom (CODE) ») — il y a ~390 clients, un menu
  déroulant était impraticable. Tant qu'aucune suggestion n'est retenue, le champ reste
  neutre et un message le rappelle : seul un client **choisi dans la liste** est valide.
- **Rôle** : suivre un **dépôt-vente** — on livre du stock chez un client, il déclare ses
  ventes au fil des mois, puis nous **rend le reliquat**. À tout instant :
  **`solde = LIVRAISON − VENTE − RETOUR`**, par produit **et taille**.
- **Modèle** : `ConditionalDeal` (client + **libellé libre**, `@@unique([clientId, label])`,
  statut EN_COURS/CLOTUREE) → `ConditionalMovement` (un **par import** : LIVRAISON / VENTE /
  RETOUR, avec `fileName`, `importedBy`, `movementDate`) → `ConditionalMovementLine`.
  Logique pure `src/lib/conditional.ts` (**testée**, 13 tests).
- **Un import = un mouvement** → l'historique est **auditable** et chaque import est
  **annulable** à l'unité (le solde se recalcule seul). Aucun stock n'est stocké « en dur ».
- **Plusieurs livraisons possibles** : on peut recompléter le dépôt en cours de route ; les
  imports LIVRAISON **s'additionnent** (ils ne remplacent pas).
- **Résolution produit : EAN d'abord**, repli sur référence + couleur + taille (les fichiers
  clients sont hétérogènes). L'EAN fait autorité — il porte à lui seul les trois. Les clés
  sont normalisées comme ailleurs dans le projet : réf **tiret→underscore**, couleur = **code
  avant le tiret**, taille en majuscules.
  ⚠️ Une ligne **non résolue est CONSERVÉE** (`productId = null`) : on ne perd aucune
  quantité, mais elle est signalée et non valorisée.
- **Lecture des fichiers** : colonnes repérées **par nom** (EAN / Code barre / Gencod ·
  Référence / Code Produit Fini · Code couleur / Code Coloris · Taille · Quantité / Qté /
  Qty), en-tête cherché sur les **30 premières lignes**, `.xlsx` comme `.csv`. Lignes à
  quantité ≤ 0 et lignes `TOTAL` ignorées.
  ✅ **Format de livraison réel validé** : l'export **« EAN13CodesBarres_Livraison_… »**
  (Texas — mêmes en-têtes que l'export EAN/BL) passe **sans adaptation**. Vérifié sur le
  fichier du document *142426* : **270 lignes / 442 pièces** lues (= la somme du fichier),
  **270/270 EAN** et **42/42 couples référence+couleur** résolus au référentiel. Une fixture
  reprend ces en-têtes exacts dans les tests.
- **Alertes** (à l'import **et** en permanence sur l'écran) :
  1. **Produits jamais livrés** — présents en VENTE/RETOUR mais absents des LIVRAISON ;
  2. **Sur-déclaration** — plus vendu/rendu que livré (solde **négatif**) ;
  3. **Clôture non soldée** — reste ≠ 0 au moment de clôturer (confirmation demandée).
  Les lignes fautives sont **surlignées** dans le tableau et badgées.
- **Exports** : **« Ventes (EAN) »** = le fichier de facturation (EAN, réf, couleur, taille,
  quantité vendue, prix de gros, montant + ligne TOTAL) · **« Rapport d'écarts »** = tout ce
  qui n'est pas soldé, avec le motif de l'anomalie.
- **Montant à facturer** = ventes déclarées × **`Product.costPrice`** (prix de gros du
  référentiel). Les pièces sans prix sont comptées et **signalées**.

## BtoC (`/btoc`)
- **Rôle** : piloter la boutique en ligne (stats, exports, clients, VIP Brevo).
- **Source** : tables `Btoc*` (sync WooCommerce), `HistOrder` (historique autre Woo),
  référentiel `Product` pour catégories/couleurs. Marketing VIP via **Brevo**. Détails :
  [`07-btoc-brevo.md`](07-btoc-brevo.md).
- **Onglet Segmentation** : profil de la clientèle sur une période — nb de clients,
  commandes/client, panier moyen, **fréquence d'achat** (1/2/3/4/5+ achats), **achats en
  promo** (deux lectures : fenêtres commerciales *et* remise réellement appliquée — ⚠️ ne
  pas confondre), répartition des paniers, tailles commandées. Export Excel 5 onglets.
  ⚠️ Le **client = e-mail**, pas compte (moitié des commandes sont passées sans compte).
  **Export ciblé** : croiser montant dépensé / nb de commandes / promo / tailles (3 modes :
  au moins une, uniquement celles-ci, toutes) → fiche complète des clients retenus.
  **Drill-down** : chaque ligne chiffrée est cliquable → liste des clients du segment avec
  recherche e-mail/nom et export. ⚠️ Les blocs promo/panier comptent des **commandes**, le
  détail liste des **clients** : les totaux diffèrent légitimement.
- **Note** : hors périmètre du **menu Exports** (`/export`) qui regroupe les exports **B2B**.

## Exports (`/export`)
- **Rôle** : hub des exports **hors BtoC**. Direct : **Réceptions CSV EAN/quantité**
  (`[saison 3c][n° commande 11c][EAN 13c][quantité]`, agrégé par commande/EAN, quantités 0
  exclues ; **saison lue dans le fichier commande fournisseur** = `SupplierOrder.tioSeason`) +
  **Comparaison** xlsx. Sélecteur de réceptions (recherche fournisseur). Liens vers les exports
  contextuels (répartition, comparaison saisons, magasin, livraisons).
- **Quantités commandées — Excel** (`/api/export/quantites`,
  `components/export/quantites-card.tsx`, logique pure dans `lib/export-quantites.ts`) :
  tableau croisé des quantités commandées par les boutiques, **tailles en colonnes**.
  - Colonnes fixes : `Référence`, **`Libellé 1`** (= `Product.label`, la désignation
    produit), **`Catégorie`**, `Coloris`, `Libellé coloris` [, `Boutique`], puis les tailles
    et `Total`. Si une ligne a un libellé ou une catégorie vide, on reprend la première
    valeur connue du groupe.
  - ⚠️ La catégorie vient **toujours de `Product.category`**, jamais de
    `ClientOrderLine.category` : cette colonne existe dans le schéma mais n'est renseignée
    **sur aucune ligne** en base (0 sur 22 428 vérifiées) — s'en servir, même en repli,
    laisserait la colonne vide. *`Product.category` couvre 8 364/8 364 lignes AH26 et
    14 064/14 064 lignes Réassort ; le libellé couvre 709/709 et 1 740/1 740 produits.*
  - Filtres : saison, **catalogue**, **période** (dates de commande), **SKU/référence**
    (plusieurs, séparés par des virgules ; préfixe de référence ou `RÉF_COLORIS`),
    **boutiques** en deux modes exclusifs — *Aucune sauf…* (inclusion) / *Toutes sauf…*
    (exclusion).
  - Case **« Avec le détail boutique »** : décochée, une ligne par (référence, coloris) ;
    cochée, une ligne par boutique **regroupée par (référence, coloris)** avec un
    **sous-total par groupe**. Référence et coloris sont **répétés sur chaque ligne** (et
    non laissés vides sous un en-tête de groupe) : c'est ce qui rend le fichier filtrable
    et pivotable dans Excel.
  - Trois totaux : **somme par taille** (dernière ligne), **somme par coloris** (colonne
    `Total`), **somme totale**. ⚠️ En mode détail, la ligne TOTAL ne compte **pas** les
    sous-totaux (vérifié par test), sinon tout serait doublé.
  - 2e onglet **« Critères »** rappelant les filtres, la source et le périmètre.
  - ⚠️ **Source** : `resolveOrderSource` (TEXAS si la saison a des commandes Texas, sinon
    TIO). Sans ce filtre, AH26 — qui a **282 commandes TEXAS et 331 TIO** — sortirait des
    quantités **doublées**. *AH26 : 69 925 pièces en TEXAS contre 88 646 en TIO.*
  - ⚠️ **Commandes sans date** : les **282 commandes TEXAS d'AH26 ont `orderDate` NULL**.
    Un filtre de période les écarterait TOUTES en silence → l'API renvoie
    `meta.undatedOrders` et l'écran affiche un avertissement ambre.
  - Périmètre : `orderType = COMMANDE` (hors VSS) et quantités **commandées** — les pièces
    soldées (`cancelledBySize`) ne sont **pas** déduites. Écrit dans l'onglet Critères.
  - Contrôles sur données réelles : *inclusion + exclusion = total* (465 + 69 460 = 69 925
    sur AH26) ; Réassort = 14 064 lignes, 1 740 couples réf×coloris, 175 boutiques,
    76 108 pièces, somme par coloris égale au total général.

## Utilisateurs (`/users`, ADMIN) & Mon compte (`/account`)
- **Utilisateurs** : `User` (nom, code ≥4 chiffres, rôle, `isActive`, `screenAccess` JSON).
  Permissions **par écran** pour les USER ; un **ADMIN a toujours tout** (`screenAccess=null`).
  Sécurité réelle = l'API (403), double garde côté client.
- **Mon compte** : nom, code (4 chiffres), déconnexion. Auth : [`05-authentification.md`](05-authentification.md).

## Centre d'aide (`/aide`)
- **Rôle** : documentation **utilisateur** in-app (recherche + thématiques + sous-thèmes),
  accessible à **tous** les connectés (comme `/account`, hors permissions d'écran). Contenu
  dérivé de ce guide, en version grand public. Fichier `src/app/(app)/aide/page.tsx`.
