# Documentation GestLog

> **Lis ce fichier en premier.** Il explique à quoi sert cette documentation, comment elle est organisée, et **la règle de mise à jour** à respecter.

## À quoi sert cette doc

GestLog est un SaaS logistique B2B + BtoC pour la marque de vêtements **MCS**. Cette
documentation contient **tout ce qu'une nouvelle conversation Claude (ou un nouveau dev)
doit savoir pour avancer** sans avoir à redécouvrir le projet : architecture, déploiement,
base de données, sources de données, intégrations, fonctionnalités, et pièges connus.

Elle est **versionnée dans le repo** (`gestlog/docs/`, poussée sur GitHub
`KantMad/gestlog`). C'est la **source de vérité partagée**. Quand le code change, la doc
doit changer avec lui (voir la règle ci-dessous).

## Comment c'est organisé

La doc est **modulaire** : un fichier par domaine, le plus d'information possible dans le
fichier spécifique concerné. Ce `README.md` est l'index et le mode d'emploi.

| Fichier | Contenu | À lire quand… |
|---|---|---|
| [`01-architecture.md`](01-architecture.md) | Stack, structure des dossiers, conventions, libs clés | tu démarres / tu codes une feature |
| [`02-deploiement.md`](02-deploiement.md) | VPS OVH, SSH, `deploy.sh`, pm2, variables d'env, coexistence avec la caisse | tu déploies ou débogues la prod |
| [`03-base-de-donnees.md`](03-base-de-donnees.md) | Prisma 7.8, catalogue des 35 modèles, `db push` additif, Supabase, sauvegardes | tu touches au schéma ou aux données |
| [`04-sources-et-n8n.md`](04-sources-et-n8n.md) | Source TIO MySQL, workflows n8n, endpoints `/api/sync/*`, webhooks | tu travailles sur la synchro de données |
| [`05-authentification.md`](05-authentification.md) | Login code 4 chiffres, sessions, `/account`, permissions par écran, middleware | tu touches à l'auth ou aux accès |
| [`06-integration-caisse.md`](06-integration-caisse.md) | Intégration sortante GestLog → CaissePro (réception de stock + création produits) | tu travailles sur l'envoi des livraisons à la caisse |
| [`07-btoc-brevo.md`](07-btoc-brevo.md) | BtoC (WooCommerce), VIP Brevo, synchro Woo | tu travailles sur le module BtoC |
| [`08-fonctionnalites.md`](08-fonctionnalites.md) | Notes fonctionnelles par feature (décisions, formats, gotchas) | tu cherches « où se passe quoi » |
| [`09-operations-et-gotchas.md`](09-operations-et-gotchas.md) | Crons, tâches courantes, dépannage, **pièges durement appris** | un truc casse / tu fais une opération sensible |
| [`10-guide-ecrans.md`](10-guide-ecrans.md) | **Guide complet écran par écran** : rôle, source de données, fonctionnalités, impacts, pièges (base du centre d'aide `/aide`) | tu veux comprendre un écran de bout en bout |

**Ordre de lecture conseillé pour une nouvelle conversation :** ce README →
`01-architecture` → `02-deploiement` → puis le(s) fichier(s) du domaine concerné.

## Conventions de la doc

- **Langue : français** (comme le produit et l'équipe).
- **Pas de secrets dans la doc.** On référence les **noms** de variables d'env et où elles
  vivent, **jamais leurs valeurs** (le repo est sur GitHub). Les secrets sont dans
  `/var/www/gestlog/.env` sur le VPS et dans les credentials n8n.
- Chemins de fichiers relatifs à la racine du repo (`gestlog/`).
- Quand une info est « non évidente » (un piège, une décision), elle va dans
  `09-operations-et-gotchas.md` ou dans le fichier de domaine, pas dans le code seul.

## ⚠️ RÈGLE DE MISE À JOUR DE LA DOC (obligatoire)

> **Quand tu fais un changement qui affecte le déploiement, le schéma de base, une
> intégration, l'authentification, un flux de données ou une fonctionnalité, tu DOIS
> mettre à jour le fichier de doc concerné dans `docs/` — localement ET dans le repo —
> dans le même lot de travail.**

Concrètement :
1. Tu modifies le code.
2. Tu mets à jour le(s) `.md` concerné(s) dans `docs/` (localement).
3. Tu commites la doc **avec** le code (ou juste après) et tu **push sur GitHub**
   (`git push origin main`). « Localement ET dans le repo » = le working copy à jour **et**
   le remote à jour.
4. Si le changement invalide une info ailleurs, corrige-la aussi (la doc ne doit pas se
   contredire).

Cette règle est aussi inscrite dans [`../AGENTS.md`](../AGENTS.md) pour qu'elle soit lue
automatiquement par Claude à chaque conversation.

### Lien avec la mémoire Claude

Claude dispose d'une **mémoire personnelle inter-conversations** (hors repo, dans
`~/.claude/projects/.../memory/`). Cette mémoire est un **index de rappel rapide** ; la
**doc du repo (`docs/`) est la source de vérité**. Les entrées de mémoire peuvent pointer
vers la doc. En cas de divergence, la doc versionnée prime (la mémoire reflète l'état au
moment où elle a été écrite — toujours vérifier dans le code/la doc à jour).
