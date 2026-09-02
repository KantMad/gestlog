# 07 — BtoC (WooCommerce) & VIP Brevo

Module **BtoC** : données e-commerce **WooCommerce** importées dans GestLog (clients,
produits, commandes, stock, remboursements) + **gestion VIP via Brevo**.

## Données & synchro

- Modèles : `BtocCustomer`, `BtocProduct`, `BtocOrder`, `BtocOrderLine`, `BtocRefundLine`,
  `BtocSyncLog` (+ `HistOrder`/`HistOrderLine` pour l'historique importé).
- Synchro poussée via n8n vers **`/api/sync/btoc/*`** :
  `customers`, `orders`, `products`, `stock`, `refunds`, `order-countries`,
  `vip-recompute`. (Auth `x-api-key=SYNC_API_KEY` comme les autres `/api/sync`.)
- Écran : **`/btoc`** (onglets Statistiques, Export, **Segmentation**, Clients, Paramètres).
  API de lecture/exports sous `/api/btoc/*` : `customers`, `stats`, `size-distribution`,
  **`segmentation`**, `export/{orders,products,best-sellers,top-clients,sales-details,parents}`,
  `settings`.

## Stats BtoC — Top 15 produits

Le SKU BtocOrderLine = `RÉF-COULEUR-TAILLE` (ex. `QMVEST_L001-006-L`). Le **Top 15 produits**
(`/api/btoc/stats`) regroupe par **référence** (`SPLIT_PART(sku,'-',1)`) → **1 barre par
produit**, toutes couleurs/tailles confondues (avant : 1 barre par variante → un produit
occupait plusieurs barres). Une requête groupée par `(ref, color)` fournit aussi le **détail
par coloris** (code) affiché dans l'infobulle au survol. Bascule **CA / Quantité** (re-classe
le top + change l'axe) sur le Top 15 et le graphe par catégorie (`stats-tab.tsx`).

## Segmentation clientèle (`/api/btoc/segmentation`)

Onglet **Segmentation** de `/btoc` (`src/components/btoc/segmentation-tab.tsx`). Une seule
route GET renvoie les 5 blocs : `overview`, `frequency`, `promo`, `baskets`, `sizes`.
Filtres `dateFrom`/`dateTo` (bornes Paris via `parisRangeToUtc`) + `statuses` (CSV).

### ⚠️ Le client est identifié par l'E-MAIL, pas par `customerId`
**Une commande sur deux est passée sans compte** : la base compte **2 253 `BtocCustomer`
pour 3 176 e-mails distincts** dans les commandes. Grouper par `customerId` ferait
disparaître tous les acheteurs invités (et les fusionnerait sur le client « 0 »). Toutes les
agrégations groupent donc sur **`LOWER(o."customerEmail")`**, les commandes sans e-mail étant
écartées. C'est aussi ce qui rapproche le mieux du comportement réel : le même acheteur qui
repasse commande sans se connecter est bien compté comme **récurrent**.

### Deux lectures de la « promo », volontairement séparées
- **Fenêtres de dates** (la définition métier demandée) : Black Friday `mois = 11 ET jour
  20→30`, soldes `mois = 1 OU (mois = 6 ET jour ≥ 20) OU mois = 7`, fin de mois `jour ≥ 25`,
  plus un cumul « au moins une fenêtre ». Le jour/mois sont extraits de `parisDayExpr`.
- **Remise réelle** : `COALESCE("discountTotal",0) > 0 OR "couponCodes" IS NOT NULL`.

⚠️ **Ne jamais additionner ni confondre les deux.** Une commande en période de soldes peut
être au plein tarif, et une remise peut tomber hors période. *Mesure réelle sur 2026 :
**2 709 commandes dans au moins une fenêtre** mais seulement **1 036 réellement remisées** —
la lecture par fenêtre surestime d'un facteur 2,6.* Les deux sont affichées côte à côte,
jamais agrégées. `promoOnlyClients` (toutes les commandes remisées) et `neverPromoClients`
s'appuient sur la **remise réelle**, pas sur les fenêtres.

### Autres points
- CA = **`total − totalRefunded`** (encaissé). Statuts exclus par défaut :
  `cancelled`/`refunded`/`failed`.
- `frequency` : buckets `1`,`2`,`3`,`4`,`5+` (clients, commandes, CA).
- `baskets` : `<50`, `50–100`, `100–150`, `150–250`, `250+` (le préfixe `1.`…`5.` sert
  uniquement à l'`ORDER BY` SQL, il est retiré de la réponse).
- `sizes` : ⚠️ **WooCommerce stocke les tailles en minuscules** (`l`, `xl`) →
  `UPPER(TRIM(l.size))`, sinon `L` et `l` comptent pour deux tailles. Classées par pièces
  décroissantes ; l'écran n'en montre que 14, l'export Excel les contient toutes.
- ⚠️ **Black Friday affiche 0** tant que la base ne couvre pas un mois de novembre
  (l'historique commence au 01/01/2026) — ce n'est pas un bug de la requête.
- Export Excel client (xlsx) : 5 onglets, généré côté navigateur depuis la réponse JSON.

### Export ciblé (`/api/btoc/segmentation/clients`)
Bloc **Export ciblé** de l'onglet (`src/components/btoc/segmentation-export.tsx`) : on croise
des critères et on sort la **fiche complète** des clients retenus (coordonnées facturation ET
livraison, téléphone/société depuis `BtocCustomer`, nb de commandes, total dépensé, panier
moyen, remises, 1re/dernière commande, pièces, tailles achetées, VIP).

Filtres : `dateFrom`/`dateTo`/`statuses` (mêmes bornes que ci-dessus) + `minSpent`/`maxSpent`,
`minOrders`/`maxOrders`, `promo=all|discounted|only|never`, `sizes` (CSV) avec
**`sizeMode`** :

| mode | opérateur SQL | sens |
|---|---|---|
| `any` | `sizes_arr && $n` | a acheté **au moins une** des tailles |
| `only` | `sizes_arr <@ $n` | **n'a jamais acheté d'autre taille** que celles-ci |
| `all` | `sizes_arr @> $n` | a acheté **chacune** des tailles |

⚠️ **Les trois modes ne sont pas des variantes cosmétiques** : sur 2026, « au moins une taille
3XL/4XL » = **315 clients**, « uniquement du 3XL/4XL » = **218**, « 3XL *et* 4XL » = **19**.
Le `only` est celui qu'on veut pour cibler une morphologie ; le `any` ramène tous les foyers
qui ont acheté une pièce grande taille pour quelqu'un d'autre.

- **`?countOnly=1`** : ne renvoie que le décompte + **5 lignes** d'aperçu. L'écran l'appelle
  (débounce 500 ms) à chaque changement de critère ; la liste complète n'est chargée qu'au
  clic sur *Exporter*. ⚠️ Le `summary` est **toujours** calculé sur l'ensemble des clients
  retenus (CTE `matched`), jamais sur les 5 lignes d'aperçu.
- Les **coordonnées** viennent de la **dernière commande** du client (`DISTINCT ON (email)
  … ORDER BY "orderDate" DESC`) — pas de la première, ni de `BtocCustomer` (qui n'existe pas
  pour les commandes invité). `phone`/`company`/`isVip` sont récupérés en `LEFT JOIN LATERAL`
  sur `BtocCustomer` par e-mail, donc **vides pour un acheteur sans compte**.
- Couverture réelle des adresses : **4 163/4 185 commandes** ont un nom de facturation,
  **3 629** une adresse (le reste est vide dans WooCommerce aussi).
- Le classeur contient un 2e onglet **« Critères »** rappelant le filtre appliqué — sans lui
  un export retrouvé plus tard est illisible.
- Mapping Excel partagé : **`src/lib/btoc-clients.ts`** (`clientSheetRows`,
  `clientDisplayName`, type `SegmentedClient`) — l'export ciblé ET le détail d'un bloc
  doivent produire **les mêmes 26 colonnes**, sinon deux exports du même écran ne se
  comparent plus. Couvert par `btoc-clients.test.ts`.

### Détail d'un bloc (drill-down)
Chaque ligne chiffrée de l'écran est **cliquable** et ouvre
`segmentation-detail.tsx` (dialog) : liste des clients concernés, **recherche e-mail/nom**,
et export du sous-ensemble. Les blocs se traduisent en filtres de la même route :

| Bloc cliqué | Paramètres |
|---|---|
| Tuile « Clients » | *(aucun)* |
| Fréquence `n` / `5+` | `minOrders`/`maxOrders` |
| Fidélisés / achat unique | `minOrders=2` / `minOrders=1&maxOrders=1` |
| Commandes remisées | `promo=discounted` |
| Fenêtre commerciale | `window=bf\|soldes\|fin_mois\|any` |
| QUE en promo / jamais | `promo=only` / `promo=never` |
| Tranche de panier | `basket=1..5` |
| Taille | `sizes=<taille>&sizeMode=any` |

⚠️ **Fenêtres et tranches de panier sont des propriétés de la COMMANDE**, pas du client : au
niveau client le filtre signifie « **a au moins une commande** qui correspond ». D'où des
totaux différents de ceux du bloc, qui comptent des commandes. *Exemple : la fenêtre soldes
affiche **2 373 commandes** dans le bloc mais **1 892 clients** dans le détail — un client
peut avoir commandé plusieurs fois.* Ce n'est pas une incohérence.

- **`q`** (e-mail ou nom) est appliqué **en SQL**, donc la recherche porte sur **tout** le
  segment, pas seulement sur les lignes déjà chargées. Il compare aussi
  `billingFirstName || ' ' || billingLastName` pour retrouver un « Jean Martin » tapé en entier.
- **`limit`** (plafonné à 5 000) : le dialog charge 200 lignes puis 200 de plus à la demande ;
  l'export, lui, part **sans limite**. Le `summary` reste calculé sur l'ensemble du segment.

## Stats BtoC — filtres et pièges de comptage ⚠️

### Deux bugs corrigés (filtre catégorie)
Le filtre catégorie ajoute un `JOIN "BtocOrderLine"`, qui **multiplie la commande par son
nombre de lignes retenues**. Deux conséquences, corrigées :

1. **« Articles vendus » comptait la commande ENTIÈRE.** La tuile sommait
   `BtocOrder.itemCount`, qui est le total de la commande — donc les chemises et les
   ceintures d'une commande contenant un pantalon. Désormais, **dès qu'un filtre de ligne
   est actif** (`category`, `parentProduct`, `globalCategory`), les articles sont comptés
   **ligne à ligne**, remboursements de ces lignes déduits (`lineScopeSql` rejoue le filtre
   dans les sous-requêtes). *Cas réel — Pantalons du 16/03 au 31/08/2026 : **624 affichés
   pour 405 réels**, +54 %.*
2. **CA par jour et par mois surcomptés.** `SUM(o.total)` s'appliquait aux lignes
   dupliquées, sans `DISTINCT` (contrairement à la tuile CA et au Top villes, déjà
   protégés). Les deux graphes passent par une sous-requête `SELECT DISTINCT o.id, …`.
   *Même cas réel : **74 942,60 € affichés pour 46 002,20 € réels**, ×1,63 — en
   contradiction visible avec la tuile CA de la même page.*

3. **Top produits : les remboursements ignoraient le filtre produit.** La branche
   remboursement de l'`UNION ALL` n'appliquait que date/client, pas
   catégorie/parent/cat. globale — les lignes de remboursement joignent pourtant
   `BtocProduct` par leur `sku`. Résultat : avec un filtre « Pantalons », **118 références
   non-pantalon** (379 pièces) étaient injectées **en négatif** dans le classement.
   La branche joint désormais `BtocProduct rp` et porte les mêmes filtres.

⚠️ Toute nouvelle requête utilisant `${lineJoin}` doit **dédoublonner les commandes** avant
d'agréger un montant au niveau commande. `COUNT(DISTINCT o.id)` ne suffit pas : il protège
le comptage, pas les `SUM`.

⚠️ Et toute branche **remboursement** d'un `UNION ALL` doit porter **exactement** les mêmes
filtres que la branche ventes, sinon on soustrait des remboursements hors périmètre.

**Requêtes auditées et jugées correctes** : `topCategories` et `topCountries` (niveau ligne
ou sans jointure, filtres date/client seulement — volontairement insensibles aux filtres
BtoC), `topCities` (sous-requête `DISTINCT` déjà en place), `ordersByStatus`
(`COUNT(DISTINCT o.id)`), `sizeDistribution` (niveau ligne, filtres appliqués),
`/api/btoc/size-distribution` et `/api/btoc/segmentation`.

### Filtre « Cat. globale » (`src/lib/btoc-global-category.ts`, testé)
Les catégories WooCommerce ne servent pas à analyser : un produit en porte jusqu'à **onze**
(« Collection été 50%, FB FR, FR, Non soldés, Pantalon, Pantalon chino, Pantalons,
shoppingfeed, Ventes privées, Voir tout pantalon »), mêlant type d'article, opération
commerciale et canal de diffusion. Le filtre **Cat. globale** reclasse par le **titre du
produit**, insensible à la **casse**, aux **accents** et au **pluriel**.

- ⚠️ Balayage **de gauche à droite, premier mot reconnu gagnant** — les titres MCS
  commencent par le type d'article. *« Bermuda en jean » est un **bermuda**, « Veste en
  jean » une **veste** : un simple `contains('jean')` rangerait les deux dans Jean.*
- ⚠️ Les clés de `CATEGORY_KEYWORDS` s'écrivent **au singulier et sans accent** — le titre
  est normalisé ET dépluralisé avant la recherche, donc une clé au pluriel ne matche
  jamais (`bombers` ne marchait pas, corrigé en `bomber`).
- Expressions de deux mots gérées (`porte cartes`, `porte monnaie`, `t shirt`), fautes du
  catalogue incluses (`bemuda`, `panton`).
- **Couverture mesurée : 1 291 titres sur 1 295 (100 %)** ; les 4 restants ne sont pas des
  vêtements (carte cadeau, mug, enceinte, jeu de cartes) et tombent dans **« Autres »**.
- Le classement se fait **en TypeScript**, pas en SQL : la route classe les titres puis ne
  passe au SQL que la **liste des SKU parents** retenus. Rejouer la table de mots-clés en
  SQL divergerait de la version testée.
- Répartition du catalogue : Chemise 389, Jean 171, Pantalon 95, T-shirt 89, Polo 88,
  Pull 76, Veste 64, Maroquinerie 58, Écharpe 56, Blouson 50, Manteau 41, Ceinture 41,
  Gilet 36, Bermuda 32, Sweat 24, Surchemise 24, Chapellerie 23, Gants 9, Chaussettes 6,
  Sous-vêtements 2, Autres 3.
- ⚠️ **Surchemise n'est pas une chemise** (mot distinct, 24 produits) : le classement est
  par MOT, pas par sous-chaîne.

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
  - Les préfixes existants sont proposés sous le champ (cliquables) avec leur nombre,
    **par ordre alphabétique** et **sans troncature** (28 préfixes max — un classement par
    volume, ou une coupe, masquerait justement les plus utilisés : `PM`, `QM`, `RM`).
    Les compteurs suivent le **statut** sélectionné.
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
