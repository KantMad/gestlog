# 12 — Schéma TIO, tel que les synchros le lisent

> **À lire quand** tu dois savoir *d'où vient* une donnée B2B dans GestLog, ou quand tu
> construis un outil externe (assistant vocal, reporting) qui doit parler le même langage
> que la synchro.

Ce fichier décrit **uniquement ce que les synchros lisent réellement** dans TIO, avec les
noms exacts des tables et des colonnes, les extraits SQL, et les règles de décodage. Ce
n'est **pas** un inventaire du schéma TIO complet : si une table existe dans TIO sans être
listée ici, c'est que GestLog ne s'en sert pas.

**Rappel d'architecture** (cf. [`04-sources-et-n8n.md`](04-sources-et-n8n.md)) : GestLog **ne
lit jamais TIO directement en production**. Un **n8n hébergé sur un serveur OVH distinct**
lit la base MySQL TIO, transforme, et **pousse** en `POST /api/sync/*` avec un en-tête
`x-api-key`. **Le SQL n'est donc pas dans le dépôt** — il vit dans les nœuds n8n.

---

## 1. Les deux synchros

| | Produits | Commandes clients |
|---|---|---|
| Workflow n8n | `GestLog — Sync produits + EAN` (`NvAbzIgKKw5OvTk1`) | `GestLog — Sync commandes clients` (`16sDefOysHJJstHE`) |
| Déclencheur | Schedule **quotidien 05 h 05** + webhook `GET /webhook/gestlog-test-products` | Schedule **quotidien 05 h 00** + webhook de test |
| Nœuds | *Lire produits MySQL* → *Transformer en batches* → *Envoyer a GestLog* | *Lire tailles* → *Agréger tailles* → *Lire commandes* → *Transformer en batches* → *Envoyer a GestLog* |
| Portée | **Instantané complet** : aucune fenêtre de date, aucun `LIMIT` | **Incrémentale** : fenêtre glissante **30 jours** sur `date_update`, `LIMIT 1000` |
| Route GestLog | [`src/app/api/sync/products/route.ts`](../src/app/api/sync/products/route.ts) | [`src/app/api/sync/orders/route.ts`](../src/app/api/sync/orders/route.ts) |
| Lots | 10 produits par POST | 10 commandes par POST |
| Robustesse | `timeout 300 s`, 3 tentatives / 2 s, `onError: continueRegularOutput` — un lot en échec n'arrête pas le reste | idem |

🔴 **La synchro commandes ne voit pas tout.** Une commande non modifiée depuis plus de
30 jours ne repasse jamais, et au-delà de 1 000 commandes modifiées le reste est coupé. Ce
n'est pas un miroir de TIO : c'est un rattrapage glissant. Pour un recalcul complet, il faut
élargir la fenêtre à la main.

---

## 2. Tables TIO lues

Toutes préfixées `lng_`.

| Table | Lue par | Rôle |
|---|---|---|
| `lng_product` | produits | fiche produit (PIM) |
| `lng_product_variation` | produits | déclinaisons couleur × taille, **porteuses des EAN et du stock** |
| `lng_product_item` | produits | rattachement produit ↔ catégories |
| `lng_content` | produits + commandes | **table de libellés multi-usages**, filtrée par `page` |
| `lng_order` | commandes | commande **et ses lignes** (voir §4) |
| `lng_shop` | commandes | boutique / client |
| `lng_catalog` | commandes | catalogue de vente → **d'où vient la saison** |

### `lng_content` : une table, cinq usages

C'est le pivot du schéma TIO. Une seule table de libellés, qu'on **discrimine par `page`** :

| `page` | Clé jointe sur `content_id` | `slug` | `text2` |
|---|---|---|---|
| `color_product` | `lng_product_variation.color_id` | **code** couleur (`213`) | **nom** (`Chocolat`) |
| `size_product` | `lng_product_variation.size_id` / `product_data[].variations[].size.id` | **nom de taille** (`XL`) | — |
| `size_type_product` | `lng_product.size_type_id` | **code du type de taille** (`HAU`) | — |
| `subcat_product` | `lng_product_item.content_id` | sous-catégorie (repli) | nom de sous-catégorie |
| `cat_product` | **`lng_content.label`** de la sous-catégorie | catégorie (repli) | nom de catégorie |

Colonne `default_order` (page `size_product`) = **ordre déclaré par TIO** pour les tailles.
Voir §6 — il n'est pas toujours l'ordre d'habillage.

🔴 **Le chaînage des catégories est à deux niveaux**, et pas évident : la **sous-catégorie**
porte dans sa colonne **`label`** le `content_id` de **sa catégorie parente**. Nom retenu des
deux côtés : `COALESCE(NULLIF(text2,''), slug)`.

🔴 **`lng_product_color` n'est PAS utilisée**, et c'est délibéré : elle est **incomplète**,
environ **2 000 produits publiés n'y figurent pas**. Piloter la requête depuis elle en
jointure interne les excluait tous. La couleur vient donc de
`lng_product_variation.color_id`.

---

## 3. Synchro produits

### SQL (nœud *Lire produits MySQL*)

```sql
SELECT p.product_id, p.sku AS reference, p.label_fr AS label,
       p.description_fr AS description, p.country AS origin_country,
       p.prices AS prices_json,
       (SELECT COALESCE(NULLIF(ct.text2,''),ct.slug)
          FROM lng_product_item pi
          JOIN lng_content sc ON sc.content_id=pi.content_id AND sc.page='subcat_product'
          JOIN lng_content ct ON ct.content_id=sc.label        AND ct.page='cat_product'
         WHERE pi.product_id=p.product_id AND pi.type_item='subcats'
         ORDER BY pi.item_id LIMIT 1)                        AS category,
       (SELECT COALESCE(NULLIF(sc.text2,''),sc.slug)
          FROM lng_product_item pi
          JOIN lng_content sc ON sc.content_id=pi.content_id AND sc.page='subcat_product'
         WHERE pi.product_id=p.product_id AND pi.type_item='subcats'
         ORDER BY pi.item_id LIMIT 1)                        AS sub_category,
       p.size_type_id, st.slug AS size_type_code,
       v.color_id, cc.slug AS color_code,
       COALESCE(NULLIF(cc.text2,''), cc.slug) AS color_label,
       v.sku AS var_sku, v.ean, v.size_id,
       sz.slug AS size_name, sz.default_order AS size_order, v.stock
  FROM lng_product p
  JOIN lng_product_variation v ON v.product_id = p.product_id
  LEFT JOIN lng_content cc ON cc.content_id = v.color_id     AND cc.page = 'color_product'
  LEFT JOIN lng_content sz ON sz.content_id = v.size_id      AND sz.page = 'size_product'
  LEFT JOIN lng_content st ON st.content_id = p.size_type_id AND st.page = 'size_type_product'
 WHERE p.fl_deleted = 0 AND p.status = 'published'
 ORDER BY p.product_id, v.color_id, sz.default_order, v.size_id
```

### Correspondance colonne → champ GestLog

| TIO | Payload n8n | Colonne `Product` |
|---|---|---|
| `lng_product.sku` | `reference` | `reference` |
| `lng_product.label_fr` | `label` | `label` |
| `lng_product.description_fr` | `description` | `description` (**HTML léger, stocké BRUT**) |
| `lng_product.country` | `originCountry` | `originCountry` (**ISO-2 brut, `000` compris**) |
| `lng_content[color_product].slug` | `color` **et** `colorCode` | `color`, `colorCode` |
| `lng_content[color_product].text2` | `colorLabel` | `colorLabel` |
| `lng_content[size_type_product].slug` | `sizeTypeCode` | — (sert à `SizeType`) |
| sous-requête `cat_product` | `category` | `category` |
| sous-requête `subcat_product` | `subCategory` | `subCategory` |
| `lng_product.prices` (§3.1) | `salePrice`, `costPrice` | `salePrice`, `costPrice` |
| `lng_content[size_product].slug` | `variations[].size` | `sizeScale` (assainie, §6) |
| `lng_product_variation.ean` | `variations[].ean` | `ProductSizeEan.ean` |
| `lng_product_variation.stock` | `variations[].stock` | `StockEntry.quantitiesBySize` |

⚠️ `color` **et** `colorCode` reçoivent la **même valeur** (`cc.slug`, ou `String(color_id)`
à défaut). Ce n'est pas une erreur, c'est l'état des lieux.

⚠️ `v.sku` (SKU de variation) est sélectionné mais **jamais utilisé** en aval.

⚠️ Les deux sous-requêtes catégories font `ORDER BY pi.item_id LIMIT 1` : **seul le premier
rattachement est gardé**. Un produit multi-catégories perd les autres.

### 3.1 Les prix

`lng_product.prices` est un **tableau JSON** d'entrées par catalogue de prix :

```json
{ "id": 209, "min_price": 0, "max_price": 0, "min_retail_price": 0, "max_retail_price": 0 }
```

- **catalogue `id = 209`** = tarif public de référence
- `min_retail_price` → **`salePrice`** (prix de vente conseillé)
- `min_price` → **`costPrice`** (tarif de gros)
- repli : **première entrée de valeur non nulle**, calculé **séparément pour chacun des deux
  prix** — `salePrice` et `costPrice` peuvent donc venir de deux catalogues différents
- `0` → `null`

🔴 **Conséquence connue** : les références hors catalogue 209 (toutes les `CCPE27_*`)
n'ont **pas de `salePrice`**, alors qu'elles ont un `costPrice`. Mesuré sur l'export
commandes : **6 262 lignes sur 39 102 en PE27** (57 références) et **3 584 sur 34 689 en
AH26** (68 références) sans prix de vente conseillé. Ce n'est pas une panne de synchro,
c'est l'absence de la donnée dans TIO.

### 3.2 Identité et regroupement

Clé de regroupement = **`${product_id}_${color_id}`**, envoyée comme **`externalId`**.

🔴 **C'est la même clé que la synchro commandes émet pour ses lignes.** C'est l'unique
chemin par lequel une ligne de commande retrouve son produit. Casser cette clé d'un côté
casse la résolution de l'autre.

### 3.3 Exclusions

**En SQL** — c'est tout :
```sql
WHERE p.fl_deleted = 0 AND p.status = 'published'
```
Plus l'effet du `JOIN` : **un produit sans aucune variation ne sort jamais**. Une ligne sans
`size_id` ne produit **aucune variation** (mais le produit existe quand même).

**Côté route** :
- `reference` manquante → produit ignoré
- 🔴 **rien n'écrase jamais une valeur connue par du vide** :
  `COALESCE(NULLIF($x,''), existing)` sur `colorCode`, `colorLabel`, `sizeScale`,
  `externalId`, `category`, `subCategory`, `label`, `description`, `originCountry` ;
  `COALESCE($x, existing)` sur les deux prix. Une synchro partielle ne peut rien détruire.
- **équivalences de code couleur** ([`color-equivalence.ts`](../src/lib/import/color-equivalence.ts)) :
  si une référence a déjà basculé vers le code des fichiers (ex. `SSS`), la synchro écrit
  sous **ce** code plutôt que de recréer un `000` en doublon
- **EAN** : dédoublonnés **par EAN** avant l'`INSERT` multi-lignes (sinon Postgres refuse :
  `ON CONFLICT cannot affect row a second time`), puis
  `ON CONFLICT (ean) DO UPDATE SET reference, color, size`. **L'EAN est l'identité** :
  déplacé vers une autre taille ou couleur, il suit.
- **Stock** : `DELETE` puis `INSERT` dans `StockEntry` (remplacement), **seulement** si au
  moins une variation porte une valeur de stock
- **`SizeType` / `SizeTypeMapping`** : `position` = index dans le tableau des variations
  (1-based). Les erreurs y sont **avalées** (`catch {}` non bloquant).

---

## 4. Synchro commandes clients

### 🔴 Il n'y a pas de table de lignes de commande

Les lignes sont **dans la commande**, colonne **`lng_order.product_data`** (JSON) :

```json
[ { "productId": 0, "variations": [ { "color": { "id": 0 }, "size": { "id": 0 }, "qty": 0, "price": 0 } ] } ]
```

| Ce que tu cherches | Où c'est |
|---|---|
| Lien commande | `lng_order.order_id` (clé technique) ; **`lng_order.order_number`** est l'identifiant utilisé par GestLog |
| Référence produit | **absente de `product_data`** : il n'y a que `productId`. La clé transmise est `externalId = "<productId>_<colorId>"`, rapprochée de `Product.externalId` que remplit la synchro **produits** |
| Couleur | `variations[].color.id` → `lng_content[color_product]`. Absente → `'UNIQUE'` |
| Taille | `variations[].size.id` → `lng_content[size_product]` : `slug` = nom, `default_order` = ordre |
| Quantité | `variations[].qty` |
| Prix | `variations[].price` (unitaire, brut) |
| Montant de ligne | **calculé**, voir §4.2 |
| Annulation d'une ligne | **aucun champ** — une ligne retirée disparaît de `product_data` ou tombe à `qty ≤ 0` |

### SQL (nœuds *Lire tailles* puis *Lire commandes*)

```sql
-- Lire tailles
SELECT content_id, slug, default_order FROM lng_content WHERE page = 'size_product'
```

```sql
-- Lire commandes
SELECT o.order_id, o.order_number, o.status, o.fl_deleted, o.total_qty, o.total_price,
       o.date_crea, o.order_type, o.delivery_date_start, o.delivery_date_end, o.product_data,
       s.reference AS client_code, s.label AS client_name, o.client_email,
       c.label_fr AS catalog_label
  FROM lng_order o
  JOIN lng_shop s    ON s.shop_id    = o.marketplace_id
  JOIN lng_catalog c ON c.catalog_id = o.catalog_id
 WHERE o.date_update >= DATE_SUB(NOW(), INTERVAL 30 DAY)
 ORDER BY o.order_id
 LIMIT 1000
```

⚠️ **Jointure boutique contre-intuitive** : `o.marketplace_id` → `s.shop_id`. Les noms ne se
correspondent pas.

⚠️ `o.total_qty` est sélectionné mais **jamais utilisé** en aval.

### 4.1 La saison : nulle part dans `lng_order`

Elle est **déduite du libellé du catalogue** — `lng_catalog.label_fr`, joint par
`lng_order.catalog_id`, envoyé comme `seasonName`. Puis, dans l'ordre :

1. `/d[ée]mo|\btest\b/i` → la commande est **supprimée** de GestLog et non importée
2. `/r[ée]assort/i` → saison sentinelle **« Réassort »** (`year = 0`, `type = REASSORT`)
3. `parseSeasonFromCatalog` ([`src/lib/utils.ts`](../src/lib/utils.ts)) :
   ```
   /([WSH])(\d{2})(?:\s|$|[^a-z])/i   →  S = PE, W ou H = AH, année = 2000 + 2 chiffres
   ```
4. aucun code reconnu (promos, déstockage, stock, offres…) → sentinelle
   **« Hors-saison »** (`year = 0`, `type = DIVERS`)

La saison et le `Catalog` sont **créés à la volée** s'ils n'existent pas. Une commande qui
change de saison voit ses **autres exemplaires supprimés** (la clé unique est
`(orderNumber, seasonId)`, sans ça on obtiendrait un doublon).

### 4.2 Le montant de ligne est une répartition, pas une donnée TIO

Par couple `(productId, colorId)` :

```
brut   = Σ (price × qty)
ratio  = lng_order.total_price / Σ brut de la commande
amount = brut × ratio                     (arrondi au centime)
```

🔴 **Si TIO ne porte plus les prix** (cas des commandes antérieures à 2026), `Σ brut = 0`,
donc `ratio = 0`, donc **toutes les lignes passeraient à 0 €** à chaque resynchro. *C'est
arrivé : 299 commandes de 2025 vidées, 3 276 978 € effacés, et cela progressait.* La route
refuse donc d'écraser un montant connu par un zéro (`...(lineAmount > 0 ? { amount } : {})`).

⚠️ **Conséquence assumée** : une ligne dont le montant tomberait *légitimement* à 0 garde son
ancienne valeur. Une ligne réellement annulée, elle, voit sa quantité tomber à 0 et est
supprimée par le nettoyage des lignes périmées.

🔴 **Le prix unitaire reconstruit (`amount / totalQuantity`) n'est exploitable que côté TIO.**
Mesuré sur les commandes de plus de deux lignes : côté **TIO**, 8,91 prix unitaires distincts
par commande en moyenne (3 235 des 3 349 commandes en ont plusieurs) et la médiane du rapport
au `costPrice` vaut exactement **1,000** sur neuf saisons. Côté **TEXAS**, **225 des
269 commandes n'ont qu'UN SEUL prix pour toutes leurs lignes** : l'import y répartit le total
au prorata des pièces, si bien qu'un blouson cuir à 109,06 € de tarif et un pull à 24,97 €
ressortent tous deux à 37,75 €. Cf. `prixCommandeExploitable()` dans
[`export-commandes-produits.ts`](../src/lib/export-commandes-produits.ts).

### 4.3 Exclusions

**Côté n8n** (nœud *Transformer en batches*) :
```js
if (parseInt(o.fl_deleted) === 1 || ['cancel','Cancelled','Annuler'].includes(String(o.status)))
  orders.push({ orderNumber: String(o.order_number), deleted: true });
```
puis, par variation : `if (qty <= 0 || !sizeId) continue;`

**Côté route** :
- `deleted: true` → `deleteMany({ orderNumber, source: "TIO" })`, **restreint à `source = TIO`**
  pour ne jamais supprimer une commande Texas portant le même numéro
- catalogue démo/test → suppression + saut
- `orderNumber` ou `seasonName` manquant → erreur, commande ignorée
- statuts traduits par `mapOrderStatus` ([`src/lib/order-status.ts`](../src/lib/order-status.ts)) :
  `Confirmer`/`Confirmed` → `VALIDEE`, `En cours`/`Pending` → `EN_COURS`, `Solder` → `SOLDEE`,
  `Annuler`/`Cancelled` → `ANNULEE`. 🔴 Un libellé **non reconnu n'écrit rien** (il ne
  rétrograde pas en `EN_COURS`) et est **signalé**.
- lignes périmées supprimées (`productId notIn keptProductIds`), avec garde-fou : **si aucune
  ligne n'a résolu, on ne touche à rien** (un sync incomplet ne doit pas effacer)

⚠️ **Les deux couches ne normalisent pas pareil.** Le filtre n8n est **sensible à la casse**
(`includes` sur la chaîne brute), `mapOrderStatus` ne l'est pas : un `annuler` minuscule passe
le filtre n8n puis devient `ANNULEE` côté GestLog.

⚠️ **`ClientOrderLine.sizeTypeCode` est toujours `NULL`** depuis cette synchro : le transform
n8n n'envoie que `{ externalId, quantities, amount }` par ligne. *Vérifié : 0 ligne de
commande porte un `sizeTypeCode`.*

⚠️ Les pièces **soldées** (`ClientOrderLine.cancelledBySize`) sont un champ **GestLog**, pas
TIO — elles n'arrivent pas par la synchro.

---

## 5. Ce que TIO ne donne pas

| Donnée | Réalité |
|---|---|
| TVA | **absente de TIO** → 0,20 appliqué par défaut (choix métier) |
| Catégorie sur `lng_product` | **pas de colonne** : tout passe par `lng_product_item` + `lng_content` |
| Fichier d'expédition `BL_*.csv` | **pas dans MySQL** (`lng_file` vide) : il vit sur un **FTP** séparé. Lien BL ↔ commande via le **nom de fichier** (`IS-xxx`) |
| Lignes de commande | **pas de table** : JSON dans `lng_order.product_data` (§4) |
| Prix unitaire de ligne | **pas stocké** : reconstruit (§4.2) |

---

## 6. 🔴 Les deux ordres de tailles — mesure du 10/11/2026

Il existe **deux ordres de tailles** dans GestLog, et ils ne viennent pas du même endroit :

| | Source | Écrit par | Lu par |
|---|---|---|---|
| **`Product.sizeScale`** | variations TIO, **puis assainies** par `sortSizeScale` (dédoublonnage + **ordre d'habillage**) | synchro produits | ordre des colonnes de tailles, décodage des quantités par position à l'import |
| **`SizeTypeMapping.position`** | index dans les variations, donc **l'ordre déclaré par TIO** (`lng_content.default_order`) | synchro produits | **export BtoC** ([`/api/btoc/export/orders`](../src/app/api/btoc/export/orders/route.ts)), colonnes `Q1…Q12` |

### Ce que la mesure donne

Sur la base de production, **19 types de taille / 101 mappings / 108 grilles distinctes /
9 195 produits** :

| Constat | Chiffre |
|---|---|
| **Grilles `Product.sizeScale` mal ordonnées** | **0 / 108** — soit **0 / 9 195 produits** |
| **Grilles avec doublons** | **0** |
| **Tailles que `sizeRank` ne sait pas classer** | **0** |
| **Types de taille dont l'ordre TIO ≠ ordre d'habillage** | **2 / 19** |

✅ **L'assainissement à l'écriture fonctionne parfaitement.** L'audit du 24/07/2026 comptait
893 grilles abîmées sur 8 887 produits ; il n'en reste **aucune**.

❌ **Les deux types qui divergent**, et c'est le même motif — TIO place le `S` après les
autres lettres :

| Code | Ordre TIO (`position`) | Ordre d'habillage (`sizeScale`) |
|---|---|---|
| `CHA` | `M,L,S,XL` | `S,M,L,XL` |
| `HAU` | `M,L,XL,S,2XL,3XL,4XL,5XL,6XL` | `S,M,L,XL,2XL,3XL,4XL,5XL,6XL` |

### La conséquence réelle : la résolution du type dans l'export BtoC

`findSizeType` (export BtoC) fait **deux passes**. La **passe 1 exige que l'ordre de
`sizeScale` suive l'ordre des positions** — exactement ce que l'assainissement a cassé pour
ces deux types. Simulation sur les 108 grilles réelles :

| Résolution | Grilles | Produits |
|---|---|---|
| passe 1 (ordre strict) | 104 | 8 972 |
| **passe 2 (repli par score)** | **1** | **219** |
| **aucun type trouvé** | **3** | **4** |

- `S,M,L,XL,2XL,3XL,4XL,5XL,6XL` (**219 produits**) échoue en passe 1 et retombe en passe 2
  sur **`HAU`** — le **bon** type. Pas de sortie fausse, juste le chemin de secours.
- 🔴 `S,M,L,XL` (**48 produits**, type attendu `CHA`) est résolu **en passe 1 vers `CEI`**
  (`S,M,L,XL,2XL,3XL,4XL`, dont les positions `1,2,3,4` sont croissantes). La passe 1
  **retourne le premier type qui colle, sans préférer le plus spécifique** — alors que la
  passe 2, elle, tranche les égalités en faveur du type le plus petit. Ces 48 produits
  **portent donc `CEI` au lieu de `CHA`** dans la colonne « type de taille » de l'export BtoC.
  (Le placement des quantités, lui, reste visuellement correct : `CEI` met S,M,L,XL en
  `Q1…Q4`.)
- **3 grilles / 4 produits n'ont aucun type** : `44,46,48,50,52,54,56`, `1,2,3` et `1,2`.

### Le défaut à corriger, si on y touche

La passe 1 devrait, comme la passe 2, **préférer le type le plus spécifique** plutôt que de
retourner le premier qui colle. Un `break` au premier match suffisant est ce qui fait
gagner `CEI` contre `CHA`. **Non corrigé à ce jour** — l'impact mesuré est de 48 produits sur
un libellé d'export, pas sur des quantités.

⚠️ **Ne pas « corriger » TIO en réordonnant les positions** : `SizeTypeMapping.position` est
censée refléter l'ordre TIO, et c'est elle qui donne les colonnes `Q1…Q12`. Les réordonner
décalerait l'export BtoC de tous les produits.

---

## 7. Chemins

| Quoi | Où |
|---|---|
| Synchro produits | [`src/app/api/sync/products/route.ts`](../src/app/api/sync/products/route.ts) |
| Synchro commandes | [`src/app/api/sync/orders/route.ts`](../src/app/api/sync/orders/route.ts) |
| Déduction de saison | `parseSeasonFromCatalog` dans [`src/lib/utils.ts`](../src/lib/utils.ts) |
| Traduction des statuts | [`src/lib/order-status.ts`](../src/lib/order-status.ts) |
| Choix TIO / Texas à la lecture | [`src/lib/order-source.ts`](../src/lib/order-source.ts) |
| Ordre d'habillage des tailles | [`src/lib/size-order.ts`](../src/lib/size-order.ts) |
| Équivalences couleur | [`src/lib/import/color-equivalence.ts`](../src/lib/import/color-equivalence.ts) |
| Résolution du type de taille (BtoC) | [`src/app/api/btoc/export/orders/route.ts`](../src/app/api/btoc/export/orders/route.ts) |
| Modèles remplis | `Product`, `ProductSizeEan`, `StockEntry`, `SizeType`, `SizeTypeMapping`, `ClientOrder`, `ClientOrderLine`, `Client`, `Season`, `Catalog` |

---

## 8. Sécurité — à traiter

🔴 **La `SYNC_API_KEY` est en clair dans l'en-tête HTTP du nœud n8n** (workflow produits, et
vraisemblablement les autres), lisible par quiconque ouvre l'interface n8n. Elle devrait
passer en **credential n8n** ou en variable d'environnement. **Non corrigé.**

> **Règle de mise à jour** (cf. [`README.md`](README.md)) : si tu modifies une requête n8n, un
> transform, une route `/api/sync/*` ou un modèle Prisma concerné, **mets ce fichier à jour
> dans le même commit**. Les deux côtés doivent rester cohérents, et c'est ici qu'on vient
> lire la vérité.
