<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Documentation du projet — À LIRE

Toute la connaissance du projet (architecture, déploiement, base de données, sources de
données/n8n, authentification, intégration caisse, BtoC, fonctionnalités, pièges) est dans
**`docs/`**. **Commence par [`docs/README.md`](docs/README.md)** : c'est l'index et le mode
d'emploi de la documentation.

## ⚠️ RÈGLE : tiens la doc à jour (local + repo)

Quand tu fais un changement qui affecte le **déploiement, le schéma de base, une
intégration, l'authentification, un flux de données ou une fonctionnalité**, tu **DOIS**
mettre à jour le fichier de `docs/` concerné **dans le même lot de travail**, puis le
**commiter et le pousser** (`git push origin main`) — la doc doit être à jour **localement
ET dans le repo**. Si un changement invalide une info ailleurs dans la doc, corrige-la aussi.
