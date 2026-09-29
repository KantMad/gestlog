# 06 — Intégration CaissePro (sortante)

GestLog **envoie** ses livraisons validées à la caisse **CaissePro**, qui les transforme en
**réception de stock** (et, à terme, **crée les produits manquants**). Intégration **à sens
unique** : GestLog est client, la caisse est serveur. **On ne touche jamais à la caisse**
(cf. [`02-deploiement.md`](02-deploiement.md)).

## Endpoint & sécurité

- **`POST https://api.techincash.app/api/integrations/gestlog/delivery`**
  (code caisse : `/var/www/caissepro-api/src/routes/integrations.js`).
- En-têtes : `Content-Type: application/json` + **`X-Gestlog-Secret: <secret>`** (PAS de JWT).
- **Secret partagé** : la caisse le lit dans **`GESTLOG_WEBHOOK_SECRET`** (son `.env`, 64
  car.). Côté GestLog il est dans **`GESTLOG_CAISSE_SECRET`** (même valeur). ⚠️ Extraire le
  secret **en Node**, jamais avec `cut`/`tr` (corruption — cf. `09`).
- **Idempotent par `deliveryId`** (= `Delivery.id`, cuid stable) : la caisse n'applique
  jamais deux fois la même livraison.

## Code côté GestLog

- **`src/lib/caisse/delivery-sync.ts`** :
  - `buildCaissePayload(deliveryId)` : parcourt `Delivery.lines` × tailles
    (`quantitiesBySize`), résout l'**EAN-13** via `ProductSizeEan(reference,color,size)`,
    agrège par EAN, et joint un objet **`product`** par ligne. Les (réf/couleur/taille)
    sans EAN vont dans `missing` (loggé).
  - `sendDeliveryToCaisse(deliveryId)` : POST + secret, **3 tentatives** avec backoff sur
    5xx/réseau, puis **enregistre le résultat** sur la `Delivery` (`caisseSyncStatus/At/
    Matched/Info`).
- **Déclencheur** : `PATCH src/app/api/deliveries/[deliveryId]/route.ts` — quand
  `status === CAISSE_TRIGGER_STATUS` (env, **défaut `EXPEDIEE`**).
- **Relance** : `POST /api/sync/caisse-retry` (auth `x-api-key=SYNC_API_KEY`) renvoie les
  livraisons `FAILED`. Cron VPS **`caisse-retry.sh` toutes les 15 min**.

## Payload envoyé

```json
{
  "deliveryId": "<Delivery.id cuid>",
  "supplier": "MCS",
  "storeId": "<optionnel, env CAISSE_STORE_ID>",
  "lines": [
    {
      "ean": "3665249426003",
      "quantity": 12,
      "product": {
        "name": "Blouson aviateur en cuir col sherpa",
        "price": 639,            // prix de vente public TTC (TIO cat. 209)
        "sku": "NMCUIR_P001",
        "color": "Chocolat",     // NOM de couleur (Product.colorLabel, repli code)
        "size": "M",
        "colorCode": "213",      // CODE de couleur
        "category": "Cuirs",
        "taxRate": 0.20,         // TVA non dispo dans TIO → 0.20 par défaut
        "costPrice": 213
      }
    }
  ]
}
```

- `product.color` = **nom** (`Product.colorLabel`, ex. "Chocolat"), avec **repli sur le
  code** si le nom est inconnu. `product.colorCode` = **code** ("213"). (Champ `colorLabel`
  rempli depuis TIO `lng_content.text2` — cf. [`04`](04-sources-et-n8n.md).)
- Prix : `Product.salePrice` (vente) / `Product.costPrice` (coût), issus du **catalogue
  TIO 209**.
- `clean()` retire les champs `null`/`undefined`/`""`.

## Réponses gérées (deux contrats)

`sendDeliveryToCaisse` gère **l'ancien ET le nouveau** contrat caisse :
- **201** succès : `{ok, matched, unmatchedEans}` (ancien) **ou**
  `{ok, applied, createdProducts, needsData}` (nouveau, avec **création de produits**).
- **200** `{alreadyProcessed:true}` : déjà traité → statut `ALREADY`.
- **401** secret invalide → `FAILED` (pas de retry).
- **5xx** → retry (3 essais) puis `FAILED`.

`caisseSyncInfo` stocke soit l'erreur, soit `JSON{createdProducts, needsData}`.

## État connu / à vérifier
- L'intégration **fonctionne** pour l'application du stock (matching EAN).
- La **création de produits vendables** (nom + prix dans `product`) ne se fait que si la
  **caisse a été mise à jour** vers le nouveau contrat (`applied/createdProducts/needsData`).
  C'est **côté dev caisse**, pas GestLog. GestLog envoie déjà tout le nécessaire (objet
  `product` complet, nom de couleur inclus). **Vérifier l'état du contrat caisse** avant de
  conclure sur la création de produits.
- ⚠️ Les tests de connectivité écrivent dans la table caisse `gestlog_deliveries` et un
  EAN **réel** peut réellement ajouter du stock en caisse. Tester avec un **EAN bidon** pour
  zéro impact.

## Catalogue (fiches produits) — `POST /api/integrations/gestlog/catalog`

Deuxième flux sortant, **indépendant des livraisons** : il aligne les **fiches produits** de
la caisse (libellé, référence, couleur, code coloris, taille, EAN, prix conseillé) sur le
référentiel GestLog. Comme pour les livraisons, **on ne touche à rien côté caisse**.

- **Code GestLog** : `src/lib/caisse/catalog-sync.ts` (`buildCatalogItems` pur et testé,
  `sendCatalogBatch`, `syncCatalogToCaisse`), route `POST /api/sync/caisse-catalog`
  (auth `x-api-key = SYNC_API_KEY`), script `ops/caisse-catalog.sh`.
- **Même secret partagé** que les livraisons (`GESTLOG_CAISSE_SECRET` côté GestLog,
  `GESTLOG_WEBHOOK_SECRET` côté caisse), même en-tête `X-Gestlog-Secret`.
- **Source** : `ProductSizeEan` **jointe** à `Product` — une ligne par code-barres, donc par
  (référence, coloris, **taille**). *55 971 EAN-13 valides au 29/09/2026, 3 267 références.*

### Ce qui n'est PAS envoyé

- 🔴 **Aucune quantité, aucun stock.** La caisse ignore le stock sur cet endpoint ; seul le
  **webhook livraisons** fait entrer des pièces. Un test interdit toute clé `quantity`/`stock`.
- 🔴 **`updatePrices` reste à `false`.** Le prix envoyé est **conseillé** : la boutique fixe
  ses prix, la caisse ne les écrase jamais et renvoie les différences dans `ecartsPrix`.
  **Ne pas passer à `true` sans accord explicite du métier.**

### Règles de construction

- 🔴 **`color` = le NOM de la couleur, `colorCode` = le CODE.** Historiquement GestLog
  envoyait le code dans les deux et la caisse affichait « 213 » comme nom de couleur.
  Repli sur le code quand le nom manque (mieux qu'une couleur vide), et c'est testé.
- 🔴 **Un prix absent est OMIS, jamais envoyé à 0** : un article à 0 € serait vendu
  gratuitement. La caisse refusera alors de **créer** le produit — comportement voulu — et
  GestLog compte ces lignes (`sansPrix`) pour qu'on corrige le prix dans TIO.
  *⚠️ 7 986 des 55 971 lignes (14 %) n'ont pas de prix de vente au 29/09/2026.*
- **EAN-13 obligatoire** (13 chiffres) : les autres sont comptés (`eanInvalide`) et écartés
  — *12 lignes seulement*. Un produit **sans désignation** est écarté aussi (`sansNom`,
  *9 lignes*) : il n'a aucune identité à envoyer.
- **`collection`** est déduite de la **lettre de la référence** (table vérifiée de
  `a-vendre-season.ts`, K→S) et **omise** quand la lettre n'est pas fiable : les préfixes
  `CC`, `TH`, `CM`… désignent des LIGNES de produits, pas des saisons.

### Pagination et reprise

🔴 **Le catalogue complet fait ~56 000 codes-barres** : un seul appel pèserait des dizaines
de Mo et serait coupé par le proxy. `syncCatalogToCaisse` envoie donc par **lots de 500**,
rend la main au bout de **40 s** en renvoyant `nextOffset`, et `caisse-catalog.sh` rappelle
jusqu'à ce qu'il vaille `null` (garde-fou à 200 passes). La pagination est ordonnée
`(reference, color, size)` — sans `ORDER BY` complet, deux pages pourraient se recouvrir.
**L'import étant rejouable à l'identique, une reprise ne crée aucun doublon.**

Sur une erreur de lot, on **s'arrête** en renvoyant l'offset courant : continuer sur une
caisse en panne ne ferait qu'empiler les échecs.

### Exécution

```bash
# simulation (la caisse n'écrit rien)
/var/www/gestlog/caisse-catalog.sh --dry-run
# envoi réel
/var/www/gestlog/caisse-catalog.sh
```

- **Cron nocturne** : `30 2 * * * /var/www/gestlog/caisse-catalog.sh >> /var/backups/gestlog/caisse-catalog.log 2>&1`
- 🔴 **La route est en `dryRun` par DÉFAUT** : un appel déclenché par erreur n'écrit rien
  chez le commerçant. Le cron passe explicitement `dryRun:false`.
- ⚠️ **`CAISSE_STORE_ID` n'est pas renseigné** dans le `.env` du VPS : le `storeId` est donc
  omis, comme pour les livraisons. À ajouter si la caisse en a besoin pour ce flux.
