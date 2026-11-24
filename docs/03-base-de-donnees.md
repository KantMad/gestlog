# 03 — Base de données

## Moteur & accès

- **PostgreSQL hébergé sur Supabase** (héritage Phase 1 ; la migration de la base hors
  Supabase est une « Phase 2 » non encore faite). Connexion via **`DATABASE_URL`** dans le
  `.env` du VPS.
- **Prisma 7.8** avec l'adaptateur **`@prisma/adapter-pg`**. Le client est généré dans
  **`src/generated/prisma`** (chemin custom). Singleton dans `src/lib/prisma.ts`.
- Beaucoup d'écritures/lectures lourdes passent en **SQL brut paramétré** via
  `prisma.$queryRawUnsafe(sql, $1, $2, …)` (perfs + upserts `ON CONFLICT`).

### Requêter la base de prod (ponctuel)
Pas de `psql` garanti. Le plus fiable : un petit script Node sur le VPS qui lit
`DATABASE_URL` et utilise `pg` (déjà installé) avec `ssl: { rejectUnauthorized: false }`.
Exemple de pattern dans `09-operations-et-gotchas.md`.

## Migrations : `prisma db push` (ADDITIF uniquement)

Le déploiement applique le schéma avec **`prisma db push`** (pas de migrations versionnées).
**Conséquence critique :**

- ✅ **Ajouts** (nouvelle colonne nullable, nouveau modèle, nouvel index) = sûrs, appliqués
  automatiquement au déploiement.
- ⛔ **Changements destructifs** (suppression/renommage de colonne, changement de type,
  passage NOT NULL sur colonne remplie) = **risque de perte de données**. Ne **jamais** les
  faire sans **autorisation explicite de l'utilisateur** et une stratégie (backup +
  migration manuelle). `backup-db.sh` tourne avant chaque déploiement, mais ça ne dispense
  pas de prudence.

Quand tu ajoutes un champ : édite `prisma/schema.prisma`, fais `npx prisma generate` en
local (pour que TypeScript voie le champ), code, et le `db push` du déploiement créera la
colonne.

## Catalogue des modèles (43)

### Référentiel produit
- **`Product`** — produit = couple **(reference, color)** unique. Champs clés : `reference`,
  `color`/`colorCode` (= **code** couleur, ex. "213"), **`colorLabel`** (= **nom**, ex.
  "Chocolat"), `label` (désignation), `description` (descriptif commercial TIO
  `description_fr`, **stocké brut avec son HTML léger** — les exports l'aplatissent),
  `originCountry` (pays d'origine TIO `country`, **code ISO-2 brut** — ⚠️ TIO y écrit
  « 000 » quand ce n'est pas renseigné, 280 produits : c'est la LECTURE qui le traite
  comme une absence),
  `salePrice` (prix vente public), `costPrice` (coût),
  `sizeScale` ("XS,S,M,L,XL"), `category`/`subCategory`, `externalId` (id TIO `produit_couleur`).
- **`ProductSizeEan`** — code-barres **EAN-13** par (reference, color, size). Clé d'unicité
  `reference_color_size`. C'est la table de résolution EAN (essentielle pour la caisse).
- **`SizeType`**, **`SizeTypeMapping`** — grilles de tailles et correspondances.
- **`SupplierProductRef`** — référence produit côté fournisseur.
- **`Catalog`** — catalogues (regroupement de produits par collection/diffusion).

### Saisons & clients
- **`Season`** — saison (ex. AH25, PE26) ; type AH/PE. Saison **Réassort** = sentinelle pour
  les commandes de réassort (voir `04`/`08`).
- **`Client`** — client B2B (boutique/grossiste). `surplusExcludedSizes` (CSV, ex. `"3XL,4XL"`) :
  tailles jamais servies **en surplus** à cette boutique — réglage **global** (toutes saisons),
  cf. `08`. `deliveryCity`/`deliveryPostcode` = adresse de **livraison** (source TIO
  `lng_shop.city`/`zipcode`, ⚠️ **pas** `billing_*`), synchronisée par n8n et utilisée pour
  nommer le **fichier d'intégration CC**.
- **`ClientSeason`** — paramétrage d'un client **pour une saison** (rang, seuils, rotation).
- **`ConditionalDeal` / `ConditionalMovement` / `ConditionalMovementLine`** — **vente en
  conditionnelle** (dépôt-vente). Une opération = **client + libellé libre** ; chaque import
  crée **un mouvement** (LIVRAISON / VENTE / RETOUR) avec ses lignes. Le stock déposé n'est
  **jamais matérialisé** : il se recalcule (`livré − vendu − rendu`), ce qui rend chaque
  import annulable sans reprise. `productId` peut être **null** (produit inconnu du
  référentiel) : la quantité est conservée et signalée. Cf. `10`.

### Fournisseurs, commandes fournisseur, réceptions
- **`ShipmentSample`** — pièces **prélevées sur une réception** pour le contrôle qualité du
  siège (« shipment sample »). Clé `(supplierReceptionId, productId, size)` + `quantity`.
  Elles ne sont **jamais livrées** : retirées du **disponible** à la répartition, sans
  modifier la réception (fait physique). Cascade sur la réception. Cf. `08`.
- **`Supplier`** — fournisseur.
- **`SupplierOrder`** / **`SupplierOrderLine`** — commandes fournisseur et lignes.
- **`SupplierReception`** / **`ReceptionLine`** — réceptions de marchandise et lignes.

### Commandes clients & stock
- **`ClientOrder`** / **`ClientOrderLine`** — commandes clients B2B. `ClientOrderLine.amount`
  = montant **B2B (prix de gros)** (⚠️ pas le prix de vente public).
- **`StockEntry`** — mouvements / état de stock.

### Répartition (allocation)
- **`AllocationSession`** — session de répartition (statut Simulation/Validé/Annulé).
- **`AllocationLine`** — lignes de répartition (qui reçoit quoi).

### Préparation & livraisons
- **`ShipmentGroup`** — regroupement de préparation.
- **`Delivery`** — livraison. Statuts : `PLANIFIEE` / `EN_PREPARATION` / `EXPEDIEE`. Champs de
  **suivi caisse** : `caisseSyncStatus` (SENT/ALREADY/FAILED/SKIPPED), `caisseSyncAt`,
  `caisseSyncMatched`, `caisseSyncInfo`. `Delivery.id` (cuid) = clé d'idempotence envoyée à
  la caisse.
- **`DeliveryLine`** — lignes de livraison ; quantités par taille dans `quantitiesBySize`
  (JSON), `totalQuantity` **NOT NULL**.
- **`EanExport`** — export de codes-barres.

### Documents dépôt (BL / Factures)
- **`WarehouseDocument`** — BL ou facture dépôt (importé depuis FTP). Clé
  `(source, docType, documentNumber)`. `tioOrderNumber` relie au n° de commande TIO.
- **`WarehouseDocumentLine`** — lignes ; contient `colorCode` **et** `colorLabel`
  ("Libellé Coloris"), `ean`, `quantity`, `unitPrice`/`amount` (renseignés pour les FAC).

### BtoC (voir `07-btoc-brevo.md`)
- **`BtocCustomer`**, **`BtocProduct`**, **`BtocOrder`**, **`BtocOrderLine`**,
  **`BtocRefundLine`**, **`BtocSyncLog`** — données WooCommerce + journaux de synchro.
  `BtocOrder.marketplace` / `marketplaceRef` : commandes arrivées via **Shopping Feed**
  (méta Woo `sf_marketplace`, ex. `laredoutemirakl`, et `sf_reference`, n° de commande
  marketplace) — vides pour une commande passée sur le site (GESTLOG-15).
- **`BtocNewsletterContact`** — miroir des contacts Brevo (inscrits newsletter, désinscrits,
  dates) ; jamais supprimé, voir [`07`](07-btoc-brevo.md#newsletter-btocnewslettercontact-onglet-newsletter).
- **`HistOrder`**, **`HistOrderLine`** — historique de commandes (import historique).
- **`SalesHistoryLine`** — historique des ventes **par ligne d'article** (produit, UGS, couleur, taille,
  quantité, prix) importé des exports « Commandes » WooCommerce, **sans donnée personnelle** ;
  unique sur `(channel, orderNumber, lineKey)`. Voir [`07`](07-btoc-brevo.md#historique-des-ventes-saleshistoryline).
- **`BtocStockOut`** — **périodes de rupture** du site par **variation** WooCommerce (couleur ×
  taille) : `startDay` (1er jour vu en rupture), `lastSeenDay` (dernier jour vu en rupture),
  `endDay` (1er jour revu en stock, null = en cours). **`BtocStockSnapshotRun`** — un jour par
  photo du stock reçue. Alimentés chaque nuit par n8n ; voir [`07`](07-btoc-brevo.md#ruptures-de-stock-btocstockout).
- **`MarketplaceOrder`** — commandes marketplaces (La Redoute…) lues dans l'**API Shopping Feed**
  (GESTLOG-15) : `sfId` (id Shopping Feed, texte), `reference` (n° marketplace =
  `BtocOrder.marketplaceRef`), `storeReference` (= `BtocOrder.wooId`), `channel`, `status`,
  montants, `itemCount`, `items` (JSON : référence, nom, quantité, prix, statut). **Aucune donnée
  personnelle** (ni nom, ni adresse, ni e-mail). Voir [`07`](07-btoc-brevo.md#contrôle-marketplaces-la-redoute--woocommerce).
- **`MarketplaceResolution`** — anomalies du contrôle marketplaces marquées « traitées » à la main :
  `reference` (n° marketplace, clé), `note`, `resolvedBy` (nom de l'utilisateur), `resolvedAt`.
- **`TioCatalog`**, **`TioCatalogItem`**, **`CatalogSnapshotRun`** — relevé quotidien des
  catalogues de vente TIO (`lng_catalog_product`) : un produit × coloris par catalogue, avec
  1er / dernier jour vu et jour de retrait. TIO ne date rien : dates = nos relevés
  (`presentAtStart` / `removedBeforeTracking` = déjà là / déjà retiré au 1er relevé). Voir
  [`08`](08-fonctionnalites.md#suivi-des-collections-suivi-collections-menu-analyse).

### Système & auth
- **`User`** — utilisateur. `name`, **`code`** (unique, 4 chiffres — sert d'identifiant ET
  de secret), `role` (ADMIN/USER), `isActive`, `screenAccess` (JSON des écrans autorisés ou
  null = tous). Voir [`05-authentification.md`](05-authentification.md).
- **`LoginAttempt`** — tentatives de connexion (anti-brute-force par IP).
- **`Setting`** — réglages clé/valeur (configuration applicative).
- **`ImportLog`** — journal des imports.

## Sauvegardes
`backup-db.sh` (VPS) dump la base avant chaque déploiement (logs `/var/backups/gestlog/`).
Avant toute opération destructive sur les données de prod : backup explicite +
**autorisation de l'utilisateur**.
