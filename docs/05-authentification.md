# 05 — Authentification, sessions & permissions

## Modèle de connexion

- Login par **code à 4 chiffres** (PIN). Le `User.code` (unique) sert **à la fois
  d'identifiant et de secret** — il n'y a pas de mot de passe séparé.
- Page : `src/app/login/page.tsx`. Saisie en 4 cases. **Menu déroulant des utilisateurs**
  (pour choisir son profil) + **cache local** (`localStorage` clé `gestlog_last_user_id`)
  qui pré-sélectionne le dernier utilisateur de la machine. Le code reste l'authentifiant.
- **Changer de compte** : la page de login **n'auto-redirige PAS** quand une session existe
  (sinon une session résiduelle « piège » l'utilisateur sur le compte précédent). Le
  formulaire est toujours accessible ; entrer un code remplace la session (note « Connecté
  en tant que X » + lien « se déconnecter »). Après connexion, redirection vers
  `firstAllowedScreen()` (PAS forcément `/dashboard` — cf. [`09`](09-operations-et-gotchas.md)).

## Routes `/api/auth/*`

- **`POST /api/auth/login`** : vérifie le `code` (user actif), pose le cookie de session.
  **Le code doit correspondre à l'utilisateur SÉLECTIONNÉ** : le body inclut `userId` (profil
  choisi dans le menu) ; si le code appartient à un autre utilisateur → **401** « Ce code ne
  correspond pas à l'utilisateur sélectionné » (pas de connexion au mauvais compte). La
  sélection est obligatoire côté UI quand la liste est disponible.
  **Anti-brute-force** : `LoginAttempt` compte les échecs par IP, **max 10 / 5 min** → 429.
- **`POST /api/auth/logout`** : efface le cookie.
- **`GET /api/auth/me`** : renvoie l'utilisateur courant (`id, name, role, screenAccess`) —
  **jamais le code**.
- **`GET /api/auth/users`** : **public** — liste des utilisateurs actifs `{id, name}`
  (noms uniquement, **pas de code ni rôle**) pour alimenter le menu déroulant du login.
- **`POST /api/auth/seed`** : amorçage initial d'utilisateurs.

## Sessions (jeton signé)

- `src/lib/session.ts` : jeton = `base64url(JSON{uid,role,scr,exp})` + `.` + HMAC
  (`SESSION_SECRET`). `verifySession` rejette un jeton non authentique **ou expiré**.
- **Durée absolue : 24 h** (`DEFAULT_TTL_MS` dans `session.ts`, et `maxAge` du cookie dans
  `src/lib/auth.ts` — **garder les deux cohérents**).
- Cookie `gestlog_session` : `httpOnly`, `secure` en prod, `sameSite=lax`, `path=/`.
- **Déconnexion sur inactivité : 4 h** côté client (`src/lib/auth-context.tsx`,
  constante `INACTIVITY_MS`). Le minuteur se réarme à chaque activité (souris/clavier/
  tactile/scroll) et est revérifié au retour d'onglet (capte la veille). À l'expiration →
  `logout({reason:"inactivity"})` → `/login?expired=1` (bannière « déconnecté pour
  inactivité »).
- Pour changer les durées : `INACTIVITY_MS` (auth-context) et `DEFAULT_TTL_MS` (session) +
  `maxAge` (auth). Une session active n'est **pas** renouvelée : à 24 h, reconnexion.

## Compte self-service `/account`

- Page `src/app/(app)/account/page.tsx` : changer **son nom**, changer **son code**
  (4 chiffres + confirmation), **se déconnecter**. Accessible à **tout utilisateur
  connecté**.
- API **`PATCH /api/account`** : met à jour le **nom/code de l'utilisateur courant**
  (`getSession`), avec contrôle d'**unicité du code**. **Distinct de `/api/users`** (réservé
  aux ADMIN pour gérer les autres comptes).
- Le bouton « se déconnecter » existe **aussi** en bas de la sidebar.

## Permissions par écran

- Source : `src/lib/screens.ts`. `APP_SCREENS` = liste des écrans restreignables
  (clé = href). `User.screenAccess` = JSON des clés autorisées, ou **null = tous les écrans**.
- **`canAccessScreen(role, screenAccess, pathname)`** :
  - `ADMIN` → tout.
  - écran `/users` → **ADMIN seulement**.
  - **`/account` → toujours autorisé** (whitelisté, jamais filtré par les permissions).
  - sinon : autorisé si `screenAccess` null, ou si le chemin est dans la liste.
- **Sidebar** (`components/layout/sidebar.tsx`) filtre les liens via `canAccessScreen`.
  `ADMIN_NAV_ITEMS` (ex. `/users`) n'apparaît qu'aux admins.
- **`AccessGuard`** (`components/layout/access-guard.tsx`) : garde **client** qui redirige un
  utilisateur hors d'un écran interdit (atteint par URL directe).

## Middleware (Edge) — `src/middleware.ts`

Défense en profondeur, exécutée avant les pages/API :
- **`PUBLIC_PATHS`** = `["/login", "/api/auth/", "/api/sync/"]` (passent sans session ;
  `/api/sync/*` s'authentifie par `x-api-key`).
- Jeton vérifié (signé + non expiré) sinon → redirection `/login` (page) ou **401** (API).
- **Chemins ADMIN** (`/users`, `/api/users`) → **403/redirection** si non-admin.
- **Autorisation par écran** : `screensForPath(pathname)` mappe pages **et** API spécifiques
  vers **un ou plusieurs** écrans ; en avoir **UN seul suffit**. Si l'utilisateur n'en a
  aucun → **403** (API) / redirection (page). Les routes transverses renvoient `null` (pas
  d'enforcement) — c'est le cas de `/account` et `/api/account`.
- ⚠️ **Une API consommée par plusieurs écrans doit les lister TOUS.** Sinon elle casse pour
  qui n'a que l'autre écran. *Cas réel* : le **Dashboard** se nourrit de
  `/api/statistics/{season,charts}`, rattachées au seul écran `/statistics` → une
  utilisatrice ayant « Tableau de bord » **sans** « Statistiques » recevait **403 sur ses
  propres données** et la page plantait (« page couldn't be loaded »). D'où
  `["/api/statistics", ["/statistics", "/dashboard"]]`. Couvert par `screens.test.ts`.

## Quand tu ajoutes un écran
1. Crée la page sous `(app)/` et son `/api/...`.
2. Ajoute la clé dans `APP_SCREENS` (`screens.ts`) **et** le mapping API dans
   `API_SCREEN_MAP` si l'API doit être gardée par écran. **Liste tous les écrans qui
   consomment cette API**, pas seulement celui du même nom (cf. avertissement ci-dessus).
3. Ajoute l'item de nav dans la sidebar.
4. Si l'écran doit être **accessible à tous** (comme `/account`), whiteliste-le dans
   `canAccessScreen` au lieu de l'ajouter à `APP_SCREENS`.
