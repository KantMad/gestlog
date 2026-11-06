# 11 — Lecture par l'assistant IA

L'assistant IA de Kant (Mac mini du bureau, n8n + Ollama locaux) lit GestLog pour le **récap
quotidien CentralWay**. Accès **en lecture seule**, par une route dédiée : il ne voit que ce
qu'elle renvoie, jamais la base.

## `GET /api/assistant/recap?jour=YYYY-MM-DD`

- **Auth** : en-tête `x-api-key` = **`ASSISTANT_READ_KEY`** (`.env` du VPS). Clé **distincte**
  de `SYNC_API_KEY` (qui, elle, permet d'écrire via `/api/sync/*`). Comparaison à temps
  constant. **Variable absente ou vide → 401 sur tout appel** : la route est fermée tant que
  la clé n'est pas posée.
- **Middleware** : `/api/assistant/` est dans `PUBLIC_PATHS` (pas de session), cf. `05`.
- `jour` obligatoire = jour calendaire **de Paris** (bornes via `parisRangeToUtc`).
- Code : route `src/app/api/assistant/recap/route.ts` ; calculs purs et testés dans
  `src/lib/assistant-recap.ts`.

### Réponse

```json
{
  "jour": "2026-10-25",
  "commandes": [
    { "numero": "…", "client": "…", "date": "2026-10-25T08:12:00.000Z",
      "montant": 4820, "statut": "EN_COURS", "type": "COMMANDE", "source": "TIO" }
  ],
  "stock": [
    { "categorie": "Cuirs", "pieces": 410, "valeurCout": 98400, "valeurPublic": 262000,
      "piecesSansPrixCout": 0, "piecesSansPrixPublic": 12 }
  ]
}
```

### Règles (décidées par Kant le 26/10/2026)

- **Commandes** : `ClientOrder` de source **TIO uniquement**, dont `orderDate` (date de
  commande TIO `date_crea`) tombe dans le jour demandé. `montant` = `totalAmount`, au **prix
  de gros** (pas le prix public).
  ⚠️ `orderDate` est parsé par `new Date("YYYY-MM-DD HH:mm:ss")` dans `/api/sync/orders`,
  donc dans le fuseau du serveur : une commande saisie tard le soir peut tomber sur le
  lendemain si le VPS n'est pas à l'heure de Paris.
- **Stock** : `StockEntry` (stock physique entrepôt, synchro TIO en remplacement) sommé par
  produit, puis regroupé par `Product.category` (vide → « Sans catégorie »).
  Valorisé **au coût** (`costPrice`) **et au prix public** (`salePrice`).
- **Prix absent ou à 0 : jamais valorisé à 0 en silence.** Les pièces concernées sont
  comptées dans `piecesSansPrixCout` / `piecesSansPrixPublic` — 14 % des EAN n'avaient pas de
  prix public au 29/09/2026 (cf. `06`).

## `GET /api/assistant/produits?debut=YYYY-MM-DD&fin=YYYY-MM-DD`

Même clé (`x-api-key` = `ASSISTANT_READ_KEY`, `src/lib/assistant-cle.ts`). Sert à Friday pour
dire quels produits pousser sur le site : ceux qui se vendent ET dont il reste beaucoup.

- `debut`, `fin` : jours de Paris inclus, 92 jours au plus.
- Par **référence** (1re partie du SKU WooCommerce `RÉF-COULEUR-TAILLE`, = `Product.reference`) :
  - `vendusSite`, `caSite` : `BtocOrderLine` moins `BtocRefundLine` des commandes de la période,
    statuts `cancelled`, `refunded`, `failed` exclus (règles de l'export « Best sellers », sans
    l'historique importé) ;
  - `stock` : `StockEntry` actuel, toutes couleurs et tailles de la référence.
- Une référence ni vendue ni en stock n'apparaît pas. Tri : ventes décroissantes.
- Code : route `src/app/api/assistant/produits/route.ts` ; fusion pure et testée dans
  `src/lib/assistant-produits.ts`.

```json
{ "debut": "2026-10-06", "fin": "2026-11-05",
  "produits": [ { "reference": "…", "nom": "…", "categorie": "Pantalon",
                  "vendusSite": 7, "caSite": 419.3, "stock": 12 } ] }
```

## `GET /api/assistant/produit?reference=RÉF&jours=30`

Même clé. Fiche d'**une** référence (casse ignorée), pour répondre à « la répartition de taille
du RMPULL_W001 en bleu marine » :

- `fiche.couleurs[]` : par `Product` (couleur) de la référence, `libelle` (`colorLabel`), stock
  par taille (somme des `StockEntry.quantitiesBySize`, dans l'ordre de `sizeScale`, tailles hors
  grille à la fin) et total ; triées par stock décroissant.
- `fiche.prixPublic`, `fiche.prixGros` (`salePrice`, `costPrice`), catégorie, sous-catégorie.
- `fiche.ventesSite[]` : pièces vendues sur le site les `jours` derniers jours (1 à 92), par
  couleur et taille telles que WooCommerce les nomme (`BtocOrderLine.color`, `.size`), mêmes
  statuts exclus que les best sellers.
- Référence inconnue : `{ "trouve": false, "candidats": [{ "reference", "nom" }] }` (10 au plus,
  recherche dans la référence et la désignation).
- Code : `src/app/api/assistant/produit/route.ts`, `src/lib/assistant-fiche.ts` (testé).

## `GET /api/assistant/clients?recherche=texte`

Même clé. **Données personnelles** : réservé à l'assistant de Kant, jamais à celui de l'équipe
(le Mac mini ne branche cette route que pour Kant). Mots de 3 lettres ou plus, cherchés dans :

- `b2b[]` : `Client` (nom, code, email, ville et CP de livraison) ; commandes **TIO** hors
  `ANNULEE`, total, détail par saison et 5 dernières commandes.
- `site[]` : commandes `BtocOrder` et `HistOrder` (ancien site) regroupées par email, fiche
  `BtocCustomer` en complément (téléphone, VIP) ; dépense TTC remboursements déduits, statuts
  `cancelled`, `refunded`, `failed` exclus ; 5 dernières commandes (toutes, avec leur statut).
- Seuls les clients qui contiennent le **plus** de mots de la recherche, 5 au plus de chaque.

## `GET /api/assistant/commandes?numero=N` ou `?jour=YYYY-MM-DD`

Même clé. `numero` : la commande B2B (`orderNumber` ou `tioOrderNumber`), du site (`orderNumber`
ou id WooCommerce) ou de l'ancien site, avec ses lignes. `jour` : les commandes du site de ce jour
de Paris (50 au plus), `compte: false` pour celles exclues du CA.

## `GET /api/assistant/statistiques?debut=YYYY-MM-DD&fin=YYYY-MM-DD`

Même clé, 366 jours au plus, avec les mêmes totaux sur la même période de l'an dernier :

- `site` : commandes, CA TTC net, CA HT (estimé : remboursement retiré au prorata du TTC de la
  commande), panier moyen, articles, clients distincts, nouveaux clients (première commande, site
  ou ancien site, dans la période), 5 premiers pays (livraison), catégories globales (titre du
  produit, remboursements par ligne déduits), 5 meilleurs clients.
- `b2b` : commandes TIO hors annulées (par date de commande TIO), montant au prix de gros,
  clients distincts, commandes sans montant, 5 meilleurs clients.
- Code : `src/app/api/assistant/{clients,commandes,statistiques}/route.ts`,
  `src/lib/assistant-clients.ts` (testé).
