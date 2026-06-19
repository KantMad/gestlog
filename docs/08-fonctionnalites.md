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

> Cette table est un index. Pour les détails d'un écran, lire la page + ses API + le module
> `lib/` associé. Si tu ajoutes/déplaces un écran, **mets à jour cette table** et
> [`05-authentification.md`](05-authentification.md).
