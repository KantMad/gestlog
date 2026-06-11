# GestLog — Document de passation (contexte pour nouvelle conversation)

> Colle ce document au début d'une nouvelle conversation pour donner tout le contexte.
> Dernière mise à jour : 11 juin 2026.

---

## 1. Le projet

**GestLog** — outil SaaS logistique pour Géraldine (directrice logistique). Gère :
réception fournisseur, comparaison commande/réception, **répartition des manquants entre clients**,
préparation des livraisons, export EAN, et un module **BtoC** (WooCommerce) avec exports.

- **Utilisateur** : Quentin (directeur IT), quenmadi@gmail.com. Interface en **français**, code en anglais.
- **Repo local** : `/Users/quentinmadi/Desktop/App géraldine Claude code/gestlog`
- **GitHub** : `https://github.com/KantMad/gestlog` (branche `main`)
- **Prod** : `https://gestlog-beta.vercel.app` (Vercel, projet `mrkants-projects/gestlog`, auto-deploy sur push `main`)

## 2. Stack & accès

- **Next.js 15** (App Router, `src/`), **TypeScript**, **Tailwind + shadcn/ui**.
- **Prisma 7.8** → client généré dans `src/generated/prisma` (importé `@/generated/prisma/client`).
- **DB** : PostgreSQL **Supabase** (`db.olcjkihzpexmnjefvlyc.supabase.co`). Connexion via `DATABASE_URL` dans `.env` (ne pas committer).
- **n8n** : `https://centralway.pro/` — piloté via MCP `n8n-mcp`. Clé API JWT dans `~/Library/Application Support/Claude/claude_desktop_config.json` (env `N8N_API_KEY`), **sans expiration** (régénérée le 10/06/2026).
- **TIO** = base **MySQL** source B2B (tables `lng_*`), credential n8n "MySQL account" (`tjD3JQMe9yPqIxGd`).
- **Auth app** : cookie `gestlog_session` = userId ; auth côté client via `/api/auth/me` + `AuthContext`.

## 3. Gotchas critiques (NE PAS réintroduire)

- **Prisma adapter-pg** : `upsert` peut silencieusement ne pas committer → utiliser du **SQL brut** (`$executeRawUnsafe`) avec `INSERT ... ON CONFLICT`.
- **base-ui Select cassé** : `SelectValue` ne résout pas les labels → rendre le label manuellement dans un `<span>` dans `SelectTrigger`. (`@base-ui/react`, PAS Radix.)
- **`<label>` est inline par défaut** : ajouter la classe `block` pour forcer le label au-dessus du champ.
- **n8n clé API JWT** : `n8n_health_check` peut dire "connected" alors que les appels renvoient 401 si le JWT est **expiré** (vérifier le claim `exp`). Régénérer dans n8n → Settings → n8n API.
- **Auth `x-api-key`** sur les endpoints `/api/sync/*` : header comparé à `process.env.SYNC_API_KEY`.

## 4. Modèle de données TIO (MySQL) — clé pour les syncs

- `lng_product` (product_id, sku=reference, label_fr, size_type_id, status, fl_deleted). **Pas de colonne catégorie.**
- `lng_product_variation` (product_id, color_id, size_id, sku, ean, stock) — **source des variantes**.
- `lng_product_color` (product_id, color_id) — **INCOMPLÈTE** : ~2000 produits publiés n'y sont pas.
- `lng_content` (content_id, slug, page, label, text, text2) — libellés multi-usage selon `page`.
  - pages : `color_product`, `size_product`, `size_type_product`, `cat_product`, `subcat_product`.
- **Catégorie produit** (chaîne non évidente) :
  ```
  lng_product → lng_product_item (type_item='subcats').content_id
    → lng_content[subcat_product] : nom sous-cat = COALESCE(NULLIF(text2,''),slug), label = ID cat parente
      → lng_content[cat_product] (content_id = subcat.label) : nom catégorie
  ```
- Le fichier d'expédition `BL_*.csv` **n'est PAS dans MySQL** (table `lng_file` vide, aucune colonne expédition). Il vit sur un **FTP** séparé.

## 5. Workflows n8n GestLog (actifs)

- `NvAbzIgKKw5OvTk1` — **Sync produits + EAN** : MySQL TIO → batches de 10 → POST `/api/sync/products`. Cron 6h + webhook test `GET https://centralway.pro/webhook/gestlog-test-products`. Nœud HTTP a `onError=continueRegularOutput` + retry.
- `rph8qNuSGm7k2iWv` — **Explorer tables MySQL** : outil debug, webhook `GET https://centralway.pro/webhook/gestlog-explore` (modifier la query via `n8n_update_partial_workflow` puis curl). `responseMode: lastNode` → renvoie 1 ligne, agréger avec `GROUP_CONCAT`.
- Autres : Sync stocks B2B, Sync commandes clients, Sync BtoC WooCommerce.

## 6. Logique métier clé — Export Ventes BtoC

L'export (`/api/btoc/export/orders` + `src/components/btoc/export-tab.tsx`) croise les ventes BtoC avec les produits BtoB :
- **Référence** : préfixe du SKU BtoC avant le 1er tiret (`CCPE26_PT02-740-M` → `CCPE26_PT02`) = `Product.reference`.
- **1er caractère de la référence = code SAISON**. Le même article existe sur plusieurs saisons → matching **exact PUIS par "corps"** (référence sans le 1er caractère) via `bodyOf()` / `resolveSizeType` / `resolveColor` / `resolveCategory`.
- **Couleur** : `SPLIT_PART(sku,'-',2)` = colorNum ; mappé au `Product.colorCode`.
- **Tailles en colonnes** : via `SizeType` + `SizeTypeMapping` (position + sizeName). Colonnes ordonnées par position.
- **Ordre des colonnes XLSX forcé** par un tableau `header` passé à `XLSX.utils.json_to_sheet` (sinon JS trie les clés numériques type "40","42" en premier).

## 7. Ce qui a été fait dans cette session

1. **Catégories BtoB dans l'export** :
   - Ajout `Product.category` + `Product.subCategory` (Prisma + DB push).
   - Sync produits enrichi : requête TIO résout cat/sous-cat ; endpoint `/api/sync/products` accepte ces champs.
   - **Fix majeur** : la requête sync pilotait depuis `lng_product_color` (JOIN interne) → ~2000 produits exclus. Changé pour piloter depuis `lng_product_variation` (couleur = `v.color_id`).
   - Nœud HTTP rendu résilient (`continueOnFail` + retry) — l'endpoint est lent (504 sur certains batches) ; les re-runs accumulent.
   - **Résultat** : relancé ~8 fois → **100% des références vendues** (381/381) ont une catégorie BtoB. ~729 réfs restantes = anciennes saisons hors catalogue TIO actuel (jamais vendues).
2. **Équivalences BtoC→BtoB** : matching par corps de référence (saison-agnostique) → couverture 72% → 89% puis 100% des ventes.
3. **Colonnes export** : ordre forcé ; ajout colonnes Catégorie BtoB, Sous-catégorie BtoB, Type BtoB ; defaults settings complétés (`/api/btoc/settings`).
4. **Taille TU / sizeType 000** : les lignes BtoC TU ont `ol.size` NULL mais SKU contient TU → taille dérivée du SKU (`SPLIT_PART(sku,'-',3)`), placée en position 1. Placement rendu robuste (fallback tous sizeTypes).
5. **Cellules tailles vides** → affichent `0` au lieu de blanc.
6. **Configuration** : champ Rotation rendu éditable (`InlineEditCell` + validateur Zod `rotationScore`).
7. **Permissions d'écran par utilisateur** :
   - `User.screenAccess` (JSON ; null = tous). Liste partagée `src/lib/screens.ts`.
   - UI : sélecteur d'écrans à la création + dialogue d'édition par utilisateur (page `/users`).
   - Application : filtrage du sidebar + garde de route `AccessGuard` (côté client). Admins = accès total.
   - ⚠️ Application **côté client uniquement** (cohérent avec l'archi). Verrouillage API par écran = à faire si besoin.

## 8. Module Livraisons entrepôt + Réassort (FAIT — 11/06/2026)

**But** : récupérer les confirmations de livraison déposées par l'entrepôt (ERP TexasWin) sur un **FTP**, les rattacher aux commandes B2B de **TIO**, et suivre **ce qui est livré vs commandé**.

- **Fichiers FTP** : ce sont des **`.xlsx`** (PAS des CSV), dans **`/in/EAN/`** : `BL_*` (bons de livraison) + `FAC_*` (factures), **mêmes 78 colonnes**. Credential n8n `FTP account` (`DSt8C8LL9bopUU6R`).
- **⭐ Lien clé BL/FAC ↔ commande TIO = le NOM DE FICHIER** : `BL_IS-041940245113_137391.xlsx` → `IS-041940245113` est le **n° de commande TIO** (= `ClientOrder.orderNumber`). La colonne "Référence Commande" dans le contenu est **toujours vide**. Stocké dans `WarehouseDocument.tioOrderNumber` (regex `IS-\d+` sur le nom).
- **Modèles** : `WarehouseDocument` (docType BL/FAC, documentNumber, tioOrderNumber, clientCode, documentDate, `rawData` JSON) + `WarehouseDocumentLine` (reference, colorCode, size, ean, quantity).
- **Endpoint** `/api/sync/shipments` : reçoit le xlsx en **base64**, parse server-side (lib `xlsx`), upsert idempotent par (source, docType, documentNumber). Clés de matching outil : `reference`→`Product.reference`, `ean`→`ProductSizeEan.ean`, `clientCode`→`Client.code` (~99,9% pour réf/EAN).
- **Workflows n8n** :
  - `GestLog — Sync BL/FAC FTP` (`GrFsVpOcwlOcrWlB`) : FTP List `/in/EAN` → filtre BL/FAC → download → base64 (`this.helpers.getBinaryDataBuffer`) → POST. Cron 6h. ⚠️ **binaire n8n en mode filesystem** : `item.binary.data.data` = pointeur, utiliser `getBinaryDataBuffer`.
  - `GestLog — Backfill commandes liées BL` (`SHlEVVWYZZNQQQ6D`) : GET `/api/sync/bl-order-numbers` (codes IS) → requête TIO `lng_order` par IN-list → POST `/api/sync/orders`. Cron quotidien.
- **Commandes TIO Réassort** : catalogues TIO réassort = **15 Réassort / 22 Réassort hiver / 38 Réassort femme**. `/api/sync/orders` route les catalogues dont le label matche `/réassort/i` vers une **saison sentinelle "Réassort"** (`year=0, type=REASSORT`, une seule saison permanente). Le sync commandes existant (`16sDefOysHJJstHE`, 6h) les alimente.
  - ⚠️ **Gotcha doublons** : avant le fix, le sync mettait le réassort en `AH26`. Nettoyage fait (repointer catalogue Réassort, supprimer doublons inter-saisons, consolider). Si re-régression : `DELETE` les copies hors-REASSORT d'un orderNumber ayant une copie REASSORT.
- **Réconciliation (à la volée, pas de matérialisation)** : `/api/reassort` compare `ClientOrderLine` (commandé) vs `WarehouseDocumentLine` (livré, joint par `tioOrderNumber`) → statut **NON_LIVREE / PARTIELLE / LIVREE**. Détail par (réf, **colorCode**, taille) dans `/api/reassort/lines`. Résultat réassort : 370 commandes → 202 livrées / 25 partielles / 143 non livrées.
- **Écrans** (voir nav restructurée §11) : **Commandes client** (`/reassort`, filtre saison) + **Livraisons** (`/shipments`, filtre saison de commande) + **Vue dépôt** existant (`/depot`, inchangé).
- **Reste** : 3 commandes (sur 251 liées aux BL) non importées (anomalies TIO, négligeable).

## 8bis. Exports BtoC ajoutés (10/06)

- **Top Clients** (`/api/btoc/export/top-clients`) : >2 commandes OU panier moyen >150 €. Agrège **2 sources** : `BtocOrder` (live) + `HistOrder` (historique importé d'un autre Woo). Colonnes Email, Tél, Nom, Prénom, CP, Ville, Nb commandes, Total dépensé, Panier moyen. Filtre date.
- **Best Sellers** (`/api/btoc/export/best-sellers`) : top 10 réf par quantité + CA, live + historique, filtre date.
- ⚠️ **Gotchas BtoC** : `BtocCustomer.totalSpent`/`ordersCount` = **0 partout** (l'API REST Woo ne calcule pas ces agrégats) → recalculer depuis `BtocOrder`. Fichier historique : ~107 commandes à 0 € *vraies* (vides dans la source) ; le reste récupéré via repli `Sous-total` quand `Montant total` vide (`HistOrder.total`).

## 9. Conventions & vérif

- **UI filtres** : conteneur `flex flex-wrap items-end gap-3`, champ dans `<div className="space-y-1">`, label `<label className="block text-xs font-medium text-muted-foreground">`, inputs/boutons en `h-9`.
- **Pages** : `src/app/(app)/[section]/page.tsx`, `"use client"`, `<Topbar/>` + `<PageHeader/>` dans `<div className="p-8 space-y-8">`.
- **Build** : `npm run build` (vérifier avant push). Deploy auto Vercel sur push `main`.
- **Vérifier coverage catégories** (exemple de requête utile, via `pg`) :
  ```sql
  SELECT COUNT(*) total, COUNT(category) avec_cat FROM "Product";
  ```
- **Relancer le sync produits** : `curl https://centralway.pro/webhook/gestlog-test-products` (idempotent, à répéter pour combler les batches 504).

## 10. Navigation (restructurée 11/06) & flux B2B

Ordre du menu (`src/lib/screens.ts` + `src/components/layout/sidebar.tsx`, garder les deux synchros) :
Tableau de bord · Import · Infos produits · Comparaison · **Commandes client** (`/reassort`) · Répartition (`/allocation`) · **Préparation** (`/deliveries`, ex-"Livraisons") · Vue dépôt (`/depot`) · **Livraisons** (`/shipments`, ex-"BL/Factures") · Récap clients · Configuration · Statistiques · BtoC.
⚠️ Les **routes internes n'ont pas été renommées** (`/reassort` = écran "Commandes client", `/shipments` = écran "Livraisons") — seuls les labels ont changé.

## 11. TODO / améliorations possibles

- [ ] Importer les ~107 commandes BtoC historiques vraiment à 0 € (re-export source avec montants) si besoin.
- [ ] Optimiser `/api/sync/products` en **bulk multi-row upserts** (504 sur gros batches ; cron 6h + re-runs compensent).
- [ ] Verrouillage des permissions d'écran **côté serveur/API** (actuellement client only).
- [ ] Rationaliser à terme les écrans logistiques (Préparation / Vue dépôt / Livraisons) si recoupements.
- [ ] **Fix VIP Brevo** : `BtocCustomer.totalSpent` toujours 0 → la détection VIP ne se déclenche jamais (recalculer depuis `BtocOrder`). Voir `/api/sync/btoc/vip-recompute` (travail en cours non committé).
