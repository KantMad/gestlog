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
  `export/{orders,products,best-sellers,top-clients}`, `settings`.

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

## Quand tu travailles sur le BtoC
- Vérifie d'abord par quel(s) workflow(s) n8n la donnée arrive (`/api/sync/btoc/*`).
- Si tu touches au calcul VIP, garde cohérents : le recompute, le seuil (`BREVO_VIP_THRESHOLD`)
  et la synchro liste Brevo.
- Mets à jour cette doc si le mapping Woo→GestLog ou la logique VIP change.
