# 08 — Tour des fonctionnalités (écrans)

Toutes les pages sont sous `src/app/(app)/<nom>/page.tsx`, leurs API sous
`src/app/api/<nom>/`. La plupart filtrent par **saison active** (sélecteur topbar). Les accès
sont gérés par écran (cf. [`05-authentification.md`](05-authentification.md)).

| Écran (href) | Rôle métier | API principales |
|---|---|---|
| **`/dashboard`** | Tableau de bord : KPIs et vue d'ensemble. | `/api/statistics/*` |
| **`/import`** | Import **manuel** de fichiers : commandes clients **Texas**, commandes fournisseurs, réceptions, stock. (L'import manuel des commandes clients **TIO** a été retiré — TIO arrive par la synchro n8n.) | `/api/import/{texas-orders,supplier-orders,receptions,stock}` |
| **`/product-info`** | Référentiel produit : EANs, types de tailles, références fournisseurs. | `/api/product-info/{eans,size-types,supplier-refs}` |
| **`/comparison`** | Comparaison (commandé/livré/stock selon contexte). | `/api/comparison` |
| **`/reassort`** | **Commandes client** (réassort) : lignes, annulation. Saison **Réassort** dédiée. | `/api/reassort`, `/api/reassort/{lines,cancel}` |
| **`/allocation`** | **Répartition** : sessions de simulation → validation (qui reçoit quoi). Détail d'une session validée : `/allocation/sessions/[sessionId]`. | `/api/allocation/{simulate,validate,sessions}` |
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

- **Répartition magasin — 2 dispositions d'export TIO** : l'export commande client existe en
  format **« court »** (réf en col 1 « Fiche produit fini », ~38 col) et **« long »** (mêmes
  en-têtes + bloc répété en fin de ligne, réf aussi en col 41, ~45 col). `src/lib/repartition.ts`
  résout les colonnes **par NOM d'en-tête** (`resolveColumns`, repli sur positions par défaut)
  → les deux marchent. Les colonnes de quantité sont `Q. 1`…`Q. 16` (s'arrêtent à `Total CA`).
  Si « Aucune ligne détectée » : vérifier que les en-têtes attendus sont présents.
- **Répartition (`/allocation`) — filtre fournisseur** : sélectionner un/des fournisseur(s)
  restreint le **disponible** (réceptions de ce fournisseur) **ET la demande** (produits
  qu'il a commandés ou livrés). Le périmètre fournisseur→produits vient de `SupplierOrderLine`
  + `ReceptionLine` ; il faut donc que la **commande fournisseur (et/ou la réception) soit
  importée dans la même saison** que les commandes clients. Sinon : 0 produit pour ce
  fournisseur. (`src/app/api/allocation/simulate/route.ts`, `supplierProductFilter`.)
- **Répartition — règle « à rang égal, on égalise le % de coupe »** : sous pénurie, la
  répartition se fait **pièce par pièce** (`engine.ts`, Step 1) : à chaque tour on sert la
  boutique la **plus coupée en relatif** (déficit = 1 − servi/commandé sur ce produit+couleur),
  départage par **rang** puis **rotation**, dans la taille où il lui manque le plus. Deux
  boutiques de même rang convergent vers le **même pourcentage** de coupe, quelle que soit la
  taille de leur commande. Remplace l'ancien **pro-rata par taille + rattrapage d'arrondis**,
  qui donnait des % très inégaux selon le mix de tailles (-6 % à -17 % observés).
- **Répartition — le raccourci « stock suffisant » se juge PAR TAILLE** : ⚠️ bug historique —
  `engine.ts` comparait les **totaux** (`totalAvailable >= totalDemand`) pour servir tout le
  monde en plein. Un **surplus sur une taille masquait le manque d'une autre** : cas réel
  CCAH26_PU02/811, reçu **144** ≥ demandé **142**, mais **M à 31 pour 32 demandés** → on
  allouait une 32ᵉ pièce de M **inexistante**, et le `-1` n'apparaissait sur aucune boutique
  (toutes à « — », alloué = commandé). La condition est désormais **`enoughEverySize`** :
  chaque taille demandée doit être couverte, sinon on passe par la répartition pièce par
  pièce (qui respecte le disponible **par taille**). Testé.
- **Répartition — invariant « alloué ≤ commande »** : ⚠️ bug historique — le pro-rata
  n'était pas plafonné à la quantité commandée. Dès qu'une **taille** était sur-livrée alors
  que le produit était globalement en manque, les boutiques étaient servies **au-dessus de leur
  commande**, sans action utilisateur (cas réel CCAH26_PU02/005 : XL 53 demandé / 56 reçu,
  3XL 10/11 → +4 pièces distribuées d'office). Le moteur ne dépasse plus jamais la commande ;
  le reliquat d'une taille excédentaire reste **non alloué** → « Répartir surplus ». Testé.
- **Répartition — invariant « alloué ≤ reçu »** : sous pénurie, les **caps de réduction**
  (`maxReductionLine`) ne peuvent restaurer des pièces que dans le **disponible restant** de la
  taille (`remainingBySize` dans `engine.ts`). Sinon le moteur allouait des pièces *fantômes*
  pour tenir le plafond même sans réception (ex. 0 reçu → 50 % alloué). Corrigé + testé
  (`src/lib/allocation/engine.test.ts`).
- **Répartition — recalcul après correction d'une réception** : la simulation lit les
  réceptions **en direct** (`receivedByProduct` construit depuis `SupplierReception.lines`).
  Corriger une réception (cf. éditeur) puis **Relancer** la simulation recompute la
  répartition à partir des nouvelles quantités reçues. ⚠️ Une session déjà **validée** est un
  instantané : il faut re-simuler puis re-valider pour la mettre à jour.
- **Répartition — vue « par produit »** : l'en-tête de chaque produit affiche **Cmd. clients**
  (demande), **Reçu fourn.** (réceptions), **Écart** (= **Reçu − Commande** : négatif = manque,
  positif = surplus) et **Alloué**. Les lignes boutique affichent l'écart **avec %**.
  `receivedByProduct` vient de la réponse `simulate`.
- **Répartition — sessions validées et leur détail** : « Valider » crée une `AllocationSession`
  (`status=VALIDATED`) + une `AllocationLine` par ligne (boutique × produit) avec les quantités
  commandées / allouées / retirées. C'est **persisté en base** (à ne pas confondre avec la
  simulation, qui vit en `sessionStorage`). Le bouton **Historique** liste les sessions de la
  saison ; chaque carte ouvre **`/allocation/sessions/[sessionId]`** (totaux, recherche
  boutique/référence/couleur, détail taille par taille, ajustements manuels marqués).
  - **Accès** : les sessions sont rattachées à la **saison**, pas à l'utilisateur — tout le monde
    voit celles de tout le monde. Le middleware mappe `/allocation/*` **et** `/api/allocation/*`
    sur l'écran **Répartition** (`screenForPath` matche par préfixe → la sous-route est protégée
    sans rien déclarer).
  - **Export EAN — mêmes règles en simulation et sur une session validée** : mêmes colonnes
    (boutique, code, référence, couleur, taille, EAN, quantité), lignes `ANNULE` et quantités
    ≤ 0 exclues, EAN absent → `MANQUANT_<réf>_<couleur>_<taille>`, et **même périmètre
    d'export** : **fournisseur** + **boutique** (multi-sélection, vide = tout).
    - Sur l'écran de simulation, ce périmètre est un bloc **distinct** de celui de la
      *validation* (fournisseurs + catalogues) : les deux actions ne se filtrent pas pareil,
      les mélanger ferait valider un périmètre qu'on croyait n'exporter que. ⚠️ Ne **jamais** utiliser
    les filtres de la *simulation* pour restreindre un export : la route `simulate` filtre la
    **demande** (`clientId in [...]`) → simuler sur 3 boutiques répartit le stock entre 3
    boutiques seulement et fausse les quantités. Sur une session **validée** (instantané figé),
    filtrer à l'export est sans risque. `GET /api/allocation/sessions/[sessionId]` renvoie donc
    aussi `eansByProduct`, `supplierIdsByProduct` et `suppliers`.
  - La session validée alimente ensuite la **Préparation** (`generateDeliveries` part de
    l'`allocationSessionId`), le récap client, les stats et le détail d'une commande.
- **Répartition — persistance de la simulation** : les résultats + filtres sont conservés en
  `sessionStorage` (`gestlog:allocation:sim:v1`) → en changeant de page puis en revenant, la
  simulation (y compris ajustements manuels) est **restaurée** sans relancer. Vidée à la
  validation et au **changement de saison** (données d'une autre saison).
- **Répartition — reprise d'un fichier EAN** (bouton « Importer une répartition ») : rejoue une
  répartition à partir de son **fichier EAN exporté** (colonnes `Code boutique`, `Référence`,
  `Couleur`, `Taille`, `Quantité` — repérées **par nom**, ordre libre). Sert de filet quand la
  simulation a été perdue (rafraîchissement, session expirée) alors que le fichier avait été
  exporté. **Le fichier fait autorité : aucun recalcul** (`applyImportedAllocation`, pur +
  testé). L'alloué vient du fichier ; le **commandé** est relu en base pour recomputer écarts /
  statuts / totaux → la réponse a la **même forme** qu'une simulation (l'écran ne fait aucune
  différence). Boutique résolue par **code**, produit par **référence + couleur** (avec repli
  couleur zéro-paddée `0`→`000` et équivalences). ⚠️ Les **filtres de l'écran ne sont pas
  appliqués** en mode import (ils écarteraient des lignes du fichier). Lignes du fichier sans
  commande correspondante → **ignorées + averties** (jamais inventées). Passe par
  `/api/allocation/simulate` avec `importedAllocation` (borné à 50 000 lignes).
- **Répartition — périmètre de validation** (fournisseurs **et** catalogues, multi-sélection) :
  la simulation est **toujours calculée sur toute la demande** (la restreindre fausserait les
  coupes : le stock reçu serait réparti sur un sous-ensemble de boutiques), mais on ne **valide**
  que les fournisseurs / catalogues choisis — utile quand une réception fournisseur couvre
  plusieurs catalogues. Vide = tout.
  - Données nécessaires renvoyées par `simulate` : `supplierIdsByProduct` (un produit peut venir
    de **plusieurs** fournisseurs → tableau) et `catalogIdByOrder` (`null` hors catalogue).
  - Filtre appliqué **côté écran** (`linesToValidate`) : `/api/allocation/validate` reçoit
    simplement la liste de lignes à enregistrer — l'endpoint est inchangé.
  - Une commande **sans catalogue** (réassort, ou jumelle TIO introuvable — cf. section
    double-source) est **exclue dès qu'un catalogue est filtré**.
  - **Validation partielle** : les lignes non validées **restent à l'écran** (et le périmètre est
    réinitialisé) pour enchaîner sur un autre fournisseur / catalogue. Si tout a été validé,
    la simulation est vidée comme avant.
- **Répartition — filtre réception** : bouton 3 états *Tout / Réceptionné / Non réceptionné*
  (comme Comparaison) filtrant les produits selon `reçu > 0`, dans les deux vues (par produit /
  par boutique).
- **Répartition — bouton « Répartir surplus »** : logique **pure et testée** dans
  `src/lib/allocation/surplus.ts` (`distributeSurplus`) + `surplus.test.ts` ; la page ne fait
  que brancher l'état. Objectif : **minimiser l'écart entre les pourcentages d'écart** des
  boutiques. L'écart se mesure **au niveau de la ligne** (produit+couleur, en pièces totales) —
  c'est ce qu'affiche la colonne « Écart ». Deux phases :
  1. **Combler les écarts** : pièce par pièce, à la boutique **la plus coupée en relatif**
     (rang pour départager), jusqu'à ramener chacune à sa commande → les % convergent.
  2. **Au-delà des commandes** — **UNIQUEMENT si plus aucune boutique n'a d'écart**.
     Sinon le reliquat **reste en stock** (servir une commande déjà complète pendant qu'une
     autre est à -11 % n'a pas de sens). **Même logique que la phase 1** : pièce par pièce, à
     la boutique au **taux de service le plus bas** (alloué/commandé), rang pour départager.
     - ⚠️ **Ne pas revenir à un prorata par taille** : il ne distribuait en réalité **jamais
       rien**. La part était arrondie à l'entier **inférieur**, or le surplus d'une taille
       (1 à 3 pièces) est toujours minuscule devant le total commandé sur cette taille
       (13 à 31) → `floor(3 × 2/13) = 0`, **toutes** les parts tombaient à 0. 100 % du surplus
       basculait donc dans le départage, qui servait **dans l'ordre du rang** : avec 3 pièces
       et 5 boutiques, seules les 3 premières étaient atteintes — **les mêmes à chaque taille**,
       donc ça s'empilait. *Cas réel CCAH26_CH07/752* (109 commandées / 117 reçues) :
       **+22 % / +9 % / +6 % / 0 % / 0 %**, la **plus petite** commande raflant le plus de
       pièces — l'inverse exact de l'objectif. Après correction : +11 % / +6 % / +6 % / +10 %
       / +6 %, les 9 pièces toujours toutes placées. Couvert par `surplus.test.ts`.
  - **Exceptions de taille par boutique** (`Client.surplusExcludedSizes`, CSV — réglage
    **GLOBAL**, pas par saison ; colonne « Tailles hors surplus » de l'écran Configuration,
    `PATCH /api/clients/[id]`) : une boutique peut être exclue du surplus sur certaines tailles
    (« Roubaix ne prend jamais de 4XL en trop »). Deux garde-fous **indispensables** :
    - l'exception ne bloque que le surplus **au-delà de la quantité commandée** : si la boutique
      a commandé 2 × 4XL et n'en a reçu qu'1, la phase 1 lui rend bien le 2e — on ne prive jamais
      une boutique de ce qu'elle a commandé ;
    - l'exception est **levée si aucune AUTRE boutique n'a commandé cette taille** — sinon les
      pièces resteraient bloquées en stock alors qu'un magasin peut les vendre.

    Le calcul se fait **côté écran** → `simulate` renvoie `excludedSizesByClient`.
  - ⚠️ **Contrainte exacte** : une pièce ne peut aller que sur une taille que la boutique a
    **commandée** (`original[size] > 0`) — mais elle **peut dépasser la quantité commandée sur
    cette taille**. C'est indispensable : *cas réel CCAH26_PU02/005*, le manque est sur M/L et
    le surplus sur XL/3XL, or toutes les boutiques ont déjà leur XL complet. Exiger
    `alloc[size] < original[size]` bloquait tout (« tailles déjà complètes ») alors qu'un XL de
    plus fait bien passer une boutique coupée de **-11 % à -6 %**.
  - Jamais plus que le reçu d'une taille. Action **client-side** (lignes marquées ajustées),
    incluse à la validation.
- **Répartition — ajout manuel du surplus** : la saisie d'une cellule n'est plus plafonnée à la
  commande mais à **quantité actuelle + reliquat reçu non alloué** sur cette taille
  (`remainingByProduct`, recalculé à chaque changement des lignes). On peut donc **ajouter** du
  surplus à la main comme on retire — sans jamais allouer plus que le reçu.
- **Répartition — lecture des écarts (vue par produit)** : pied de tableau avec, **par taille**,
  `Cmd. clients` / `Reçu fourn.` / `Écart` (rouge = manque, vert = sur-livré) → identifie
  immédiatement la taille en cause. Les **ajouts** (alloué > commandé) s'affichent en **vert avec
  un `+`** et la commande rappelée en dessous (avant, seules les réductions étaient marquées).
- **Répartition — export « EAN / quantité »** : bouton *Export EAN* → xlsx avec colonnes
  Boutique, Code boutique, Référence, Couleur, Libellé couleur, Taille, **EAN**, Quantité (une
  ligne par boutique × produit/couleur × taille allouée, quantités hand-éditées incluses).
  Les EAN viennent de `ProductSizeEan` (`eansByProduct` dans la réponse `simulate`) ; une taille
  sans EAN sort en `MANQUANT_…` avec un avertissement. L'export xlsx classique reste dispo.
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

### Import — saison cible explicite

L'écran `/import` a un **sélecteur de saison cible** (en haut, encadré) : chaque import
(commandes clients, commandes fournisseurs, réceptions, stock) est rattaché à **une seule
saison choisie explicitement** — par défaut la saison active, mais modifiable. Le `seasonId`
envoyé aux routes `/api/import/*` est celui-ci (plus la saison active globale). Le bouton
d'import affiche la cible (« Importer N lignes dans **AH26** ») et changer de saison
réinitialise le formulaire (`key` sur la saison). But : éviter d'importer par erreur dans la
mauvaise saison (cf. incident PE27/AH26 du 24/06/2026).

### Suppression d'un import (annuler un import raté)

Chaque import est **tagué** : les entités créées portent `importLogId` (colonne nullable sur
`SupplierOrder`, `SupplierReception`, `ClientOrder`, `StockEntry`). Les routes `/api/import/*`
**créent d'abord le `ImportLog`** (rowCount 0), passent son id aux mappers (qui taguent les
entités), puis mettent à jour les compteurs. Sur upsert (ré-import), `importLogId` est
**réécrit** → l'import le plus récent « possède » l'entité.

- **Écran `/import`** : bloc « Imports récents (supprimables) » (liste `ImportLog` de la saison,
  via `GET /api/import/logs?seasonId=`). Chaque ligne affiche le nombre d'entités encore en base
  (`liveCount`) et un bouton **Supprimer** (confirmation en 2 temps).
- **`DELETE /api/import/logs/[id]`** supprime les entités taguées puis le log :
  - `RECEPTION` → supprime la/les réception(s) (cascade lignes) + **recalcule le statut** de la
    commande fournisseur (`PARTIEL`/`EN_ATTENTE`).
  - `SUPPLIER_ORDER` → supprime la/les commande(s) (cascade lignes **et réceptions** rattachées).
  - `CLIENT_ORDER` → supprime la/les commande(s) client (cascade lignes).
  - `STOCK` → supprime les entrées de stock de l'import.
- **Limite** : les entités importées **avant** ce suivi ont `importLogId` nul → non retrouvées
  (affichées « non supprimable »). Suppression manuelle ponctuelle en base si besoin (avec
  sauvegarde préalable dans `/var/backups/gestlog/`).

### Correction d'une réception (éditeur)

Une réception importée peut être **corrigée manuellement** (ex. 2 couleurs échangées) sans
tout réimporter.
- **Écran** : `/import/receptions` (liste des réceptions de la **saison active**) →
  `/import/receptions/[id]` (éditeur). Accessible depuis **Comparaison** (bouton « Corriger une
  réception ») et le bloc « Imports récents » de `/import`. **Droits = ceux de l'écran Import**
  (routes sous `/import` et `/api/import`, gardées par le mapping `/api/import → /import`).
- **API** : `GET /api/import/receptions?seasonId=` (liste), `GET /api/import/receptions/[id]`
  (détail : lignes + `colorsByReference` pour permuter la couleur), `PATCH .../[id]` (remplace
  les lignes : résout chaque `réf + code couleur` vers un produit, refuse les inconnus et les
  **doublons de produit**, recalcule les totaux). Journalise `lastEditedBy`/`lastEditedAt`
  (colonnes ajoutées sur `SupplierReception`) via la session (`uid → User.name`).
- **Échanger 2 couleurs** : sur chaque ligne, changer la couleur via le menu (les quantités
  restent), puis enregistrer. La comparaison et le stock disponible se recalculent (lecture live
  des `ReceptionLine`).

### Comparaison commande / réception — tri, recherche, filtre réception

- Fournisseurs **toujours triés par ordre alphabétique** (nom, insensible casse/accents), tri
  fait dans `computeComparison` → s'applique à l'écran ET à l'export Excel.
- **Recherche fournisseur** (nom ou code) + **filtre réception** à 3 états : *Tout* /
  *Réceptionné* (lignes `totalReceived > 0`) / *Non réceptionné* (`totalReceived === 0`).
  Filtrage **client-side** sur les lignes ; les compteurs (fournisseurs, références, anomalies)
  et badges par fournisseur sont recalculés sur les lignes affichées.

### Cloisonnement par saison (commandes & réceptions fournisseur)

**Invariant : une commande fournisseur et une réception appartiennent à UNE seule saison.**
- `SupplierOrder.seasonId` (season-scoped) ; `SupplierReception` n'a pas de `seasonId` mais
  est liée à **une** `SupplierOrder` → hérite de sa saison. Toutes les requêtes
  (`statistics/charts`, `statistics/season`, `comparison/engine`, `allocation/simulate`)
  filtrent par `seasonId` (ou via l'`include` de la commande) — **vérifié, pas de fuite
  inter-saison**.
- **Garde-fou import** : importer une commande (fournisseur **ou client**) dont le n° existe
  déjà dans une AUTRE saison est **refusé** (message « déjà présente en saison X »). Présent
  dans les 4 mappers d'import (`mcs-mapper` × 2, `supplier-order-mapper`, `client-order-mapper`).
  Évite les doublons inter-saison comme IMDER 100739 (AH26 + PE27) ou StatGen 4 (PE27/AH26) —
  nettoyés le 30/06/2026, backups `pe27-*-misplaced-*.json`. Même principe pour les commandes
  **clients**.

### Double-source commandes clients : TIO (archive) vs Texas (ERP, vérité)

Les commandes B2B ont un champ **`ClientOrder.source`** (`TIO` par défaut | `TEXAS`).
- **TIO** : prise de commande — **uniquement** via la synchro n8n `/api/sync/orders` (l'import
  StatGen manuel a été retiré de l'UI ; la route `client-orders` subsiste en repli) → tagués
  `TIO`. Deviennent l'**archive**.
- **TEXAS** : import ERP (`/api/import/texas-orders`, onglet « Commandes clients (Texas) ») → tagués
  `TEXAS`. **Source de vérité**. Parseur `parseTexasClientOrders` : StatGen client avec colonne
  Saison, client par **code** (« Code client(Commande client) », nom existant non écrasé),
  décodage `Q.N` **absolu par gamme**, montant net réparti au prorata des quantités.
- **Lecture** : `resolveOrderSource(seasonId)` (`src/lib/order-source.ts`) → **TEXAS si la saison a
  des commandes Texas, sinon TIO** (repli). Appliqué à TOUS les écrans B2B agrégés (répartition,
  `statistics/*`, comparaisons saison/client, recap, deliveries, reassort). Les comparaisons
  2-saisons filtrent **par commande** via une sous-requête corrélée (correct aussi en dimension
  catalogue). Les endpoints par n° de commande (shipments, orders/[id], reassort/lines|cancel) ne
  sont pas filtrés (Texas a des n° différents → pas de collision avec les BL/FAC dépôt).
- **Transition douce** : tant qu'une saison n'a pas de Texas, elle affiche TIO. Dès l'import Texas,
  elle bascule. Suppression possible via « Imports récents » (type `CLIENT_ORDER_TEXAS`).
- **Clé unique** `(orderNumber, seasonId)` conservée (Texas utilise des n° différents de TIO).
- **Lien TIO ↔ Texas** : les n° de commande des deux sources sont **totalement disjoints**
  (mesuré : **0 recoupement sur 282 commandes AH26**, y compris toutes saisons confondues et
  après normalisation — les plages se ressemblent pourtant, 110387+ côté TIO et 110328→111140
  côté Texas : piège classique). Le **seul** lien est la colonne Texas **« Référence commande
  client(Commande client) »**, qui porte le **n° de commande TIO** : `PO-…` pour une commande de
  catalogue, `IS-…` pour un réassort. Elle est stockée dans `ClientOrder.tioOrderNumber` à
  l'import Texas.
- **Catalogue de vente** : il n'existe **que côté TIO** (renseigné par le sync n8n ; l'export
  Texas n'a **aucune** colonne catalogue — sa colonne `Saison` ne vaut que `W26`/`TDH`, trop
  grossière : elle isole Territoire d'homme mais ne sépare pas *MCS Homme W26* de *MCS Country
  classic W26*). À l'import Texas, le `catalogId` est donc **repris de la commande TIO jumelle**
  (même saison, `orderNumber` = la référence lue). Résultat mesuré sur AH26 : **266/282 (94 %)**
  rattachées — 175 *MCS Homme W26*, 78 *Territoire d'homme W26*, 13 *MCS Country classic W26* ;
  les 15 restantes sont des **réassorts** (réf `IS-…`, sans jumelle TIO) et restent sans
  catalogue, ce qui est correct. Le filtre catalogue de la répartition (et tout écran lisant
  `catalogId`) fonctionne dès lors sur la source Texas, **sans code spécifique**.
  Au **ré-import**, un catalogue déjà rattaché n'est **jamais effacé** si la jumelle TIO est
  introuvable (synchro TIO en retard) — le champ n'est écrit que si la jumelle existe.

### Écran Exports (`/export`)

Hub regroupant les exports GestLog **hors BtoC** (gardé par l'écran `/export`, mapping
`/api/export → /export`) :
- **Téléchargement direct** (saison choisie) : **Réceptions CSV** (ci-dessous) et **Comparaison
  commande/réception** xlsx.
- **Liens** vers les exports contextuels : Répartition (simulation), Comparaison
  saisons/catalogues, Répartition magasin, Livraisons (EAN).

**Export Réceptions — CSV EAN/quantité** (`/api/export/receptions?seasonId=`) : une valeur par
ligne, **concaténée sans espace** :
`[saison 3c][n° commande 11c padded-0][EAN 13c][quantité]` — ex. `W2600000110023<ean13>12`.
- **Saison** = `SupplierOrder.tioSeason` = code **lu dans le fichier commande fournisseur**
  (colonne « Saison » : W26/S27…), **capté au parse** (`parseMcsStatgen`, champ `season`) et
  stocké à l'import. **≠ saison GestLog** (qui ne fait que cadrer la sélection). ⚠️ Les commandes
  importées **avant** cet ajout ont `tioSeason` nul → **réimporter la commande fournisseur** pour
  le peupler (upsert). Lignes sans saison/EAN écartées (comptées en en-têtes `X-Skipped-*`).
- Quantités **agrégées par (commande, EAN)**, sommées sur toutes les réceptions ; **toute
  quantité 0 est retirée**. N° commande padé à 11 (0 à gauche), EAN sur 13.
- **Découpage des fichiers** (sélecteur de l'écran Export) : par défaut **un seul CSV** ;
  avec **`&groupBy=supplier`**, **un CSV par fournisseur** livrés dans un **`.zip`**
  (`jszip`). Le zip est nécessaire : un navigateur **bloque les téléchargements en rafale**,
  on ne peut donc pas servir N fichiers d'affilée. Le **contenu total est identique** dans
  les deux modes — seul le nombre de fichiers change. Nom de fichier assaini (le code
  fournisseur vient de l'import) et dédoublonné. En-tête `X-Files` = nombre de fichiers.

### Équivalences de code couleur (fichiers ↔ référentiel TIO)

Certains codes couleur diffèrent entre les **fichiers** (Texas/commandes/réceptions) et le
**référentiel TIO**. Ex. : le coloris « sans couleur » est **`SSS`** dans Texas et **`000`**
dans TIO → produit « introuvable » à l'import.

- **Modèle** `ColorEquivalence { sourceCode, targetCode, label }` — `sourceCode` = code des
  fichiers (**celui qui sera affiché**, ex. `SSS`) ; `targetCode` = code du référentiel où
  trouver EAN + grille (ex. `000`). Écran : **Infos produits → Équivalences couleur**
  (`/api/product-info/color-equivalences`).
- **Résolution à l'import** (`src/lib/import/color-equivalence.ts`,
  `resolveProductWithEquivalence`) : 1) recherche directe (tolérance zéro initial) ; 2) sinon,
  recherche sous `targetCode` ; si trouvé → le produit est **RE-CLÉ** vers `sourceCode`
  (`Product.color`/`colorCode` + **`ProductSizeEan.color`**, `colorLabel` = `label` si fourni).
  Les lignes pointent l'**id produit** → EAN, grille et **historique** sont conservés, et tout
  s'affiche désormais sous le code des fichiers **sans toucher aux écrans**.
- **Portée volontairement prudente** : la bascule est **paresseuse**, référence par référence,
  déclenchée par un import réel. Les références jamais vues sous `sourceCode` ne bougent pas
  (important : 84 références ont `000` **et** de vrais coloris).
- **Appliqué à** : import **Texas** (`importTexasClientOrders`), **commandes fournisseurs** et
  **réceptions** (via `findProduct`).
- ⚠️ **Synchro TIO** (`/api/sync/products`) : elle renvoie toujours `000`. Elle **remappe** vers
  `sourceCode` pour les références **déjà basculées** (préchargement `converted`), sinon elle
  recréerait un `000` en doublon à côté du `SSS` (produit **et** EAN).
- Supprimer une équivalence **n'annule pas** les bascules déjà faites (créer l'équivalence
  inverse pour revenir en arrière).

### Formats d'import MCS (auto-détectés)

Les fichiers réels MCS ne sont pas des tableaux plats → l'import les **auto-détecte**
(`src/lib/import/mcs-format.ts`) et les parse sans mapping manuel (`mcs-mapper.ts`) :
- **« StatGen » (commande fournisseur)** : détecté par `Fiche produit fini` + une mention
  **fournisseur**, et **pas** `Fiche client`. Repérage **par nom** (ordre des colonnes
  indifférent) : n° de commande = colonne contenant `Commande` (`N° commande PF fournisseur`),
  **fournisseur** = `Fiche fournisseur` (ancien export) **ou** `Code fournisseur` (nouvel
  export — attention à ne pas confondre avec « N° commande PF **fournisseur** »).
  Les colonnes `Q.N` sont des **positions ABSOLUES** dans la **gamme** (barème de tailles).
  La grille est reconstruite depuis le fichier : la **légende** en tête (lignes réf. vide, code
  gamme dans la colonne `Total Q`, tailles dans les `Q.N`) + `Clé Langue+Gamme` (code gamme,
  préfixe `FRA`) + `Taille début`/`Taille fin` (sous-plage du coloris). `sizeScale =
  légende[gamme][début-1 … fin]`, et chaque `Q.p` alimente la taille `légende[gamme][p-1]` —
  **correct même quand un coloris démarre à une taille > 1** (ex. blazer VES commençant à la
  position 3). Couleur = **code avant le `-`** (`208-Cognac` → `208`). **N° de commande et
  fournisseur obligatoires** (lus dans le fichier). Un fichier peut regrouper **plusieurs
  commandes / fournisseurs** → **une commande par n° de commande**.
  **Produits absents créés** : si un couple (référence, code couleur) n'existe pas au
  référentiel, le produit est **créé** depuis la commande (référence, couleur, `colorLabel`,
  `sizeScale` déduit de la gamme). La synchro TIO (`ON CONFLICT (reference,color)`) l'enrichit
  ensuite (catégorie, prix, EAN…). La réponse d'import remonte le nombre de produits créés.
- **« Packing List » (réception)** : format **tolérant** — colonne référence reconnue par
  plusieurs libellés (`FULL MCS PRODUCT REF`, `REFERENCE`, `REF`, `CODE PRODUIT FINI`…),
  couleur par `COLOR CODE`/`COLOR`/`COULEUR`/`COLORIS`. **Deux dispositions** reconnues :
  - **large** : **une colonne par taille**, repérée par son nom (`S,M,L,XL,2XL…` OU numériques
    `36,38,40…`, **ordre indifférent**) ;
  - **longue** : **une ligne par taille** — la taille et la quantité sont des *valeurs*, dans
    les colonnes `Taille` et `Quantité`/`Qté`/`Qty` (cas `FW26 TDH ARETEX PL`).

  En-tête pas forcément en ligne 0 (un titre peut être au-dessus). Réf **tiret→underscore**
  (`EPOMC-C001` → `EPOMC_C001`), **somme des lignes de colis** (hors `TOTAL`/récap), quantités
  ≤ 0 ignorées. Ancien format MCS
  (tailles en lettres sur la ligne **au-dessus** de l'en-tête) toujours supporté.
  Les libellés de tailles sont cherchés **sur l'en-tête ET sur la ligne au-dessus** — le
  template CITIME porte sa seule taille (`TU`) dans l'en-tête, l'ancien format MCS les porte
  au-dessus.
  **Fichiers à double grille (template RASEN)** : les **mêmes colonnes** sont libellées en
  lettres (ligne du dessus) **et** en numérique (en-tête) — la colonne vaut `L` pour une
  maille et `31` pour un jean. Le fichier seul ne tranche pas : le parseur remonte les **deux
  lectures** (`sizes` + `sizesAlt`, la principale étant celle qui capte le plus de pièces) et
  `pickReceptionSizes` **choisit via la grille du produit au référentiel** (`Product.sizeScale`),
  produit par produit — un fichier mixant jeans et mailles est donc correctement lu.
  **N° de commande fournisseur facultatif** : laissé vide → **rattachement automatique** à
  la commande fournisseur de la même saison qui contient le plus de produits reçus ; sinon
  le n° saisi force une commande précise.
- **« StatGen » (commande client)** : détecté par `Fiche client` + `Fiche produit fini` (et
  PAS `Fiche fournisseur`). `N° commande client` + nom client (`Raison sociale`), couleur par
  code, `Q.N` décodé par produit. **Optimisé gros volume** (8000+ lignes / 200+ commandes) :
  produits préchargés en 1 requête, clients dédupliqués, écriture par commande
  (`deleteMany`+`createMany` en transaction), **annulations/soldes préservées au ré-import**.
  Erreurs « introuvable » **dédupliquées** (réf + code couleur absents du référentiel). ⚠️ Ce
  ne sont **pas** des lignes à ignorer : la ligne est **écartée de l'import**. Causes usuelles :
  **code couleur divergent** entre le fichier et le référentiel (→ créer une **équivalence
  couleur**, cf. section dédiée) ou **produit pas encore synchronisé** depuis TIO.
- Matching sur le **référentiel existant** (par réf + **code** couleur, tolérance zéro
  initial) — **pas de création de produit** (évite les doublons). Les lignes sans produit
  correspondant sont remontées en erreurs.
- Seul l'onglet **Stock** reste en **mapping manuel** de colonnes
  (`src/lib/import/parser.ts` + `*-mapper.ts`).

> Cette table est un index. Pour les détails d'un écran, lire la page + ses API + le module
> `lib/` associé. Si tu ajoutes/déplaces un écran, **mets à jour cette table** et
> [`05-authentification.md`](05-authentification.md).
