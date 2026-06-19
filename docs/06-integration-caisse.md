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
