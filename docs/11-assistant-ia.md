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
