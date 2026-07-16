# 04 — Sources de données & n8n

GestLog **ne lit pas TIO directement en prod**. Un orchestrateur **n8n** lit la source,
transforme, et **pousse** vers les endpoints `/api/sync/*` de GestLog.

## Les 3 systèmes externes (qui édite quoi)

| Système | Éditeur | Rôle | Comment il arrive dans GestLog |
|---|---|---|---|
| **TIO** | société **Tech in Touch** | Outil de **prise de commande B2B** (les commerciaux/agents saisissent les commandes) + PIM produit | **Flux automatique** : un **n8n hébergé sur un serveur OVH** lit la base MySQL TIO et pousse vers `/api/sync/*`. Les commandes clients issues de TIO sont taguées `source = TIO`. |
| **Texas Win** | société **Asti** | **ERP** : après validations/corrections, produit les **vraies** données de commande | **Import manuel** (écran Import → onglet « Commandes Texas ») → taguées `source = TEXAS`. C'est la **source de vérité** pour la répartition et les stats (cf. [`08-fonctionnalites.md`](08-fonctionnalites.md), section double-source). |
| **WooCommerce** (+ Brevo) | site e-commerce MCS | Ventes **BtoC** | Synchro Woo → module BtoC (cf. [`07-btoc-brevo.md`](07-btoc-brevo.md)). |

> **Double-source B2B (essentiel) :** une même saison peut contenir des commandes **TIO**
> (archive, prise de commande) **et Texas** (vérité ERP). Tous les écrans B2B lisent
> **Texas si la saison en a, sinon TIO** (repli), via `resolveOrderSource(seasonId)`
> (`src/lib/order-source.ts`). Détails : [`08-fonctionnalites.md`](08-fonctionnalites.md).

## Source TIO (MySQL)

**TIO** (éditeur **Tech in Touch**) est le système source B2B (prise de commande + PIM).
Base MySQL, tables préfixées **`lng_`**. Accès via les credentials MySQL configurés **dans
n8n** (credential « MySQL account »). Le **n8n est hébergé sur un serveur OVH** (distinct du
VPS GestLog) ; ses workflows lisent TIO, transforment, et poussent vers `/api/sync/*`.

Tables/clés utiles :
- **`lng_product`** : produit. `sku` (= `reference`), `label_fr` (désignation), **`prices`**
  (JSON, tableau par **catalogue de prix**), `size_type_id`, `status`, `fl_deleted`.
- **`lng_product_variation`** : variations `color_id` / `size_id` / `ean` / `stock`.
- **`lng_content`** : table de libellés multi-usages, filtrée par `page`. `slug` = code,
  **`text2`** = libellé affichable. Exemples de `page` : `color_product` (couleurs),
  `size_product` (tailles), `cat_product` / `subcat_product` (catégories),
  `size_type_product`.
- **`lng_product_item`** : rattachements produit↔catégories (`type_item='subcats'`).

### Décodages importants (durement établis)
- **Prix** : `lng_product.prices` est un tableau d'entrées par catalogue
  `{id, min_price, max_price, min_retail_price, max_retail_price}`. Le **catalogue id=209**
  est le **tarif public de référence** → `min_retail_price` = **prix de vente public**,
  `min_price` = **coût/prix de gros**. Repli sur la 1ʳᵉ entrée non nulle si 209 absent.
- **Couleur** : pour une variation, `lng_content` (page `color_product`) donne
  `slug` = **code** ("213") et `text2` = **nom** ("Chocolat"). Même mécanique pour tailles
  et catégories.
- **TVA** : **absente de TIO** → on applique **0.20** par défaut (choix métier).

## Instance n8n

- URL : **`centralway.pro`**. Webhooks sous `https://centralway.pro/webhook/<path>`.
- Outillage : MCP **`n8n-mcp`** (lecture/écriture des workflows depuis Claude :
  `n8n_get_workflow`, `n8n_update_partial_workflow`, etc.).
- Chaque workflow « push » envoie vers GestLog en **HTTP POST** avec l'en-tête
  **`x-api-key: <SYNC_API_KEY>`** (la même clé que dans le `.env` GestLog).

### Workflows connus

| Workflow | ID | Rôle | Déclencheurs |
|---|---|---|---|
| **GestLog — Sync produits + EAN** | `NvAbzIgKKw5OvTk1` | Lit `lng_product` + variations, transforme (prix cat. 209, couleur code+nom, catégories, tailles) → POST `/api/sync/products`. Remplit `Product` + `ProductSizeEan`. | Schedule **toutes les 6h** + webhook **GET `/webhook/gestlog-test-products`** (test manuel) |
| **Sync commandes** | `16sDefOysHJJstHE` | Commandes TIO → `/api/sync/orders`. Routage saison **Réassort** inclus. | (schedule/webhook) |
| **Sync BL/FAC (FTP)** | — | Récupère BL & factures dépôt depuis un **FTP**, parse, POST `/api/sync/shipments`. Remplit `WarehouseDocument(+Line)`. Lien BL↔commande TIO via le **nom de fichier** (`IS-xxx`). | (schedule) |
| **Explore** | `rph8qNuSGm7k2iWv` | Sonde TIO (debug). `curl https://centralway.pro/webhook/gestlog-explore` renvoie 1 ligne du dernier nœud. | webhook |
| **BtoC (WooCommerce)** | — | Voir [`07-btoc-brevo.md`](07-btoc-brevo.md). | — |

Le workflow produits a deux nœuds clés : **« Lire produits MySQL »** (la requête SQL) et
**« Transformer en batches »** (le code JS qui construit les objets produit par lots de 10).
Pour ajouter un champ depuis TIO : modifier la requête (SELECT) **et** le transform, puis
côté GestLog la route `/api/sync/products` **et** le modèle `Product`.

## Endpoints `/api/sync/*` (côté GestLog)

Tous protégés par **`x-api-key === SYNC_API_KEY`** et **publics au sens session** (le
middleware laisse passer `/api/sync/` sans cookie — cf. `PUBLIC_PATHS`). Principaux :

- `/api/sync/products` — référentiel produit + EAN (depuis TIO).
- `/api/sync/orders` — commandes clients (routage saison Réassort).
- `/api/sync/stock` — stock.
- `/api/sync/shipments`, `/api/sync/shipment-pdfs`, `/api/sync/bl-order-numbers` — BL/FAC dépôt.
- `/api/sync/btoc/*` — BtoC (customers, orders, products, stock, refunds, order-countries,
  vip-recompute). Voir [`07`](07-btoc-brevo.md).
- `/api/sync/caisse-retry` — relance des envois caisse en échec (voir [`06`](06-integration-caisse.md)).

## Règle quand tu modifies un flux
Si tu changes un payload de synchro, **les deux côtés doivent rester cohérents** : le
workflow n8n (requête + transform + mapping) **et** la route `/api/sync/*` (+ le modèle
Prisma). Et tu mets à jour **cette doc** (la règle du `README.md`).
