# 07 — BtoC (WooCommerce) & VIP Brevo

Module **BtoC** : données e-commerce **WooCommerce** importées dans GestLog (clients,
produits, commandes, stock, remboursements) + **gestion VIP via Brevo**.

## Données & synchro

- Modèles : `BtocCustomer`, `BtocProduct`, `BtocOrder`, `BtocOrderLine`, `BtocRefundLine`,
  `BtocSyncLog` (+ `HistOrder`/`HistOrderLine` pour l'historique importé).
- Synchro poussée via n8n vers **`/api/sync/btoc/*`** :
  `customers`, `orders`, `products`, `stock`, `refunds`, `order-countries`,
  `vip-recompute`. (Auth `x-api-key=SYNC_API_KEY` comme les autres `/api/sync`.)
- Écran : **`/btoc`** (onglets clients, produits, commandes, stats…). API de lecture/exports
  sous `/api/btoc/*` : `customers`, `stats`, `size-distribution`,
  `export/{orders,products,best-sellers,top-clients,sales-details,parents}`, `settings`.

## Stats BtoC — Top 15 produits

Le SKU BtocOrderLine = `RÉF-COULEUR-TAILLE` (ex. `QMVEST_L001-006-L`). Le **Top 15 produits**
(`/api/btoc/stats`) regroupe par **référence** (`SPLIT_PART(sku,'-',1)`) → **1 barre par
produit**, toutes couleurs/tailles confondues (avant : 1 barre par variante → un produit
occupait plusieurs barres). Une requête groupée par `(ref, color)` fournit aussi le **détail
par coloris** (code) affiché dans l'infobulle au survol. Bascule **CA / Quantité** (re-classe
le top + change l'axe) sur le Top 15 et le graphe par catégorie (`stats-tab.tsx`).

## VIP Brevo

- `src/lib/brevo.ts` + `/api/brevo/health`. Réglages via env : `BREVO_API_KEY`,
  `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, **`BREVO_VIP_LIST_ID`**,
  **`BREVO_VIP_THRESHOLD`** (seuil de dépense en € pour être VIP).
- Logique : un client dont le **total dépensé** dépasse le seuil est poussé dans la **liste
  VIP Brevo**.

### ⚠️ Piège majeur : `total_spent` WooCommerce = 0
Le champ `total_spent` renvoyé par la **REST API WooCommerce vaut 0** (non calculé par Woo
sur cet endpoint). Le total réel est **recalculé côté GestLog** à partir des commandes :
- endpoint **`POST /api/sync/btoc/vip-recompute`** (recalcule les totaux et le statut VIP),
- avec un **backfill silencieux** (rattrapage des clients existants).

Donc : **ne pas se fier à `total_spent` de Woo** ; utiliser le total recalculé par GestLog.

## Doublons de lignes de commande ⚠️

- **Bug historique** : n8n peut pousser, dans **un même payload**, des `line_items` **en double**
  (même variation répétée — jusqu'à 23×). GestLog les insérait tels quels → **quantités vendues
  gonflées** (best-sellers, size-distribution, export produits, « produits vendus »). ⚠️ Le **CA
  n'était PAS touché** (il vient de `BtocOrder.total`, niveau commande). *Cas réel QMVEST_L001 :
  137 vendus affichés pour 34 réels ; globalement **14 051 lignes en double sur 21 341**
  (2 717 groupes, TOUS créés dans le même envoi — jamais étalés dans le temps).*
- **Correctif** (`src/app/api/sync/btoc/orders/route.ts`) : les `line_items` sont **dédoublonnés
  par `(variation_id/product_id + sku)`** (on garde la 1re occurrence) **avant** l'insert ET le
  calcul d'`itemCount`. WooCommerce n'ayant qu'**une ligne par variation**, c'est sans risque.
  **Validé** : après dédup, la somme des quantités = `itemCount` WooCommerce sur **4055/4056**
  commandes. ⚠️ Ne PAS sommer les doublons (ce serait la quantité gonflée) — on en garde UN.
- **Garde-fou base** : contrainte **`@@unique([orderId, wooProductId, sku])`** sur
  `BtocOrderLine` + insert en **`ON CONFLICT DO NOTHING`** → un doublon devient physiquement
  impossible (le second est ignoré, la synchro ne plante pas). (sku `NULL` non contraint —
  Postgres traite les NULL comme distincts — couvert par le dédoublonnage applicatif.)
- **Nettoyage ponctuel effectué** (21/07/2026) : **14 238 lignes en double supprimées**
  (`BtocOrderLine` 21 550 → 7 312), en gardant une ligne par `(commande, variation, sku)`.
  Backup préalable `AVANT-DEDUP-BTOC-*.dump`. *QMVEST_L001 : 137 → 34.*

## Dates & montants (rapprochement WooCommerce) ⚠️

- **Fuseau des périodes = Europe/Paris** (comme WooCommerce Analytics). `BtocOrder.orderDate`
  est stocké en **UTC** ; les filtres et regroupements par jour/mois passent par
  `src/lib/btoc-dates.ts` (`parisRangeToUtc`, borne haute **exclusive** = jour de fin INCLUS ;
  `parisDayExpr` pour grouper en heure de Paris). Toutes les routes `/api/btoc/*` filtrées par
  date l'utilisent (stats, exports, size-distribution).
  - ⚠️ **Bug historique corrigé** : `orderDate <= new Date(dateTo)` bornait à **minuit UTC** du
    jour de fin → **quasi toute la journée `dateTo` manquait** (+ décalage de 2 h). *Cas réel
    17-18/07 : GestLog affichait 44 commandes / 3 987 € au lieu de 71 / 7 363 € ; après
    correction, le nombre de commandes tombe pile sur les 71 de WooCommerce.* Ne JAMAIS
    reborner en `new Date("YYYY-MM-DD")` (minuit UTC) : repasser par `parisRangeToUtc`.
- **Filtre de statuts dans les exports** (onglet Export) : un multi-sélecteur **partagé**
  (Ventes / Top Clients / Best Sellers) liste les statuts **réellement présents** en base avec
  leur nombre (`/api/btoc/export/orders` renvoie `availableStatuses`), y compris les statuts
  **personnalisés** WooCommerce (`lpc_transit`, `mp-warning`…). Défaut = **Ventes** (tous sauf
  `cancelled`/`refunded`/`failed`). Param `statuses=` (CSV) → `o.status = ANY($n)` dans les 3
  routes ; absent = comportement d'origine de chaque route.
- **Export « Ventes détaillées »** (`/api/btoc/export/sales-details`) : **une ligne par
  commande** avec les coordonnées de **facturation** ET de **livraison** (prénom, nom, adresse,
  code postal, ville, pays) + le **moyen de paiement** (`paymentTitle` : PayPal, Monetico… avec
  repli sur `paymentMethod`). Filtre plage de dates (bornes Paris) + statuts (multi-sélecteur
  partagé). Si la livraison est vide (Woo « expédier à l'adresse de facturation »), les colonnes
  livraison **retombent sur la facturation** (colonne « Livraison = facturation » = Oui).
  - ⚠️ **Nouvelles colonnes `BtocOrder`** : `billingFirstName/LastName/Address1/Postcode` et
    `shippingFirstName/LastName/Address1/Postcode/Country` (billing/shipping `City`+`Country`
    existaient déjà). Alimentées par la synchro n8n (`/api/sync/btoc/orders`, upsert) depuis les
    objets `billing`/`shipping` du payload WooCommerce. **Les commandes déjà en base sont NULL
    tant qu'elles ne sont pas re-synchronisées** (le `COALESCE` de l'upsert remplit les vides).
  - **Backfill de l'historique** : `POST /api/sync/btoc/order-addresses` (clé `x-api-key`)
    — body `{ orders: [{ wooId, billing:{…}, shipping:{…} }] }`. Met à jour **uniquement les
    colonnes d'adresse**, **sans toucher aux lignes ni aux montants** (contrairement à la sync
    complète qui supprime/réinsère les `BtocOrderLine`). Idempotent : une valeur vide n'écrase
    jamais une valeur existante (`COALESCE(NULLIF(…,''), …)`). Même principe que le backfill
    pays (`order-countries`), alimenté par un workflow n8n **ponctuel**.
- **Export « Produits parents »** (`/api/btoc/export/parents`) : liste des **SKU parents**
  WooCommerce (`type = 'variable'` — le produit qui porte les déclinaisons ; les variations
  ne sont pas listées), pour un **fichier de ré-import**.
  - Filtre **par préfixe de référence**, en mode **Inclure** (ex. `RM` → tous les parents
    commençant par RM) ou **Exclure** (tous SAUF ceux-là). Plusieurs préfixes séparés par des
    virgules. Sans préfixe : la liste complète, quel que soit le mode.
  - Filtre **statut** : Publiés (défaut) / Brouillons / Tous — le stock Woo compte **1 106
    parents publiés et 272 brouillons** ; le défaut évite d'embarquer les brouillons sans le
    vouloir.
  - Les préfixes existants sont proposés sous le champ (cliquables) avec leur nombre.
  - ⚠️ **Seule la colonne `SKU` est remplie.** Les 4 autres — `SKU produits liés`,
    `SKU ventes croisées`, `ranking`, `slug de catégories` — n'ont que leur **en-tête**,
    volontairement vides : elles sont complétées dans Excel avant ré-import.
  - Un SKU parent en double côté Woo ne sort **qu'une fois**.
- **Deux montants affichés** (tuile CA de l'onglet Stats) :
  - **CA TTC encaissé** = `SUM(total − totalRefunded)` — TVA et frais de port **inclus**
    (montant réellement encaissé).
  - **Net HT** = `SUM(total − totalRefunded − totalTax − shippingTotal)` — rapproche la
    « Ventes nettes » WooCommerce. ⚠️ **Ne matche pas au centime** : la synchro n8n **n'envoie
    pas le `subtotal`** (avant remise) ni le détail coupons que WooCommerce utilise pour son
    net (`BtocOrder.subtotal` = 0 en base). Écart résiduel attendu (~quelques %).

## Quand tu travailles sur le BtoC
- Vérifie d'abord par quel(s) workflow(s) n8n la donnée arrive (`/api/sync/btoc/*`).
- Si tu touches au calcul VIP, garde cohérents : le recompute, le seuil (`BREVO_VIP_THRESHOLD`)
  et la synchro liste Brevo.
- Mets à jour cette doc si le mapping Woo→GestLog ou la logique VIP change.
