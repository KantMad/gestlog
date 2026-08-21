// Contenu du centre d'aide (`/aide`). Version GRAND PUBLIC du guide écrans
// (docs/10-guide-ecrans.md). À tenir en cohérence avec ce guide.

export interface HelpSection {
  h?: string;
  lines: string[];
  tip?: string;
}
export interface HelpArticle {
  id: string;
  icon: string;
  title: string;
  keywords: string;
  sections: HelpSection[];
}
export interface HelpTheme {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  articles: HelpArticle[];
}

export const HELP_THEMES: HelpTheme[] = [
  // ─────────────────────────────────────────── Bien démarrer
  {
    id: "demarrer",
    emoji: "🧭",
    title: "Bien démarrer",
    blurb: "Comprendre l'outil et se repérer en 5 minutes.",
    articles: [
      {
        id: "cest-quoi",
        icon: "👋",
        title: "C'est quoi GestLog ?",
        keywords: "gestlog présentation vue ensemble mcs logistique",
        sections: [
          {
            lines: [
              "GestLog est l'outil qui **suit tes commandes B2B de A à Z** : de la commande passée par une boutique jusqu'à la livraison, en passant par la réception des fournisseurs et la **répartition** du stock.",
              "Il gère aussi le **BtoC** (la boutique en ligne) dans un espace séparé.",
            ],
          },
          {
            h: "En une phrase",
            lines: [
              "Les commandes arrivent, les fournisseurs livrent, tu **répartis** ce qui est reçu entre les boutiques selon des priorités, puis tu **prépares et expédies** les livraisons.",
            ],
            tip: "Perdu ? Reviens toujours à la logique : **Commande → Réception → Répartition → Livraison.**",
          },
        ],
      },
      {
        id: "sources",
        icon: "🔌",
        title: "D'où viennent les données ? (TIO, Texas, Woo)",
        keywords: "source données tio texas woocommerce asti tech in touch n8n erp",
        sections: [
          {
            h: "Trois systèmes alimentent GestLog",
            lines: [
              "**TIO** (éditeur *Tech in Touch*) : l'outil où sont **saisies les commandes B2B**. Il se synchronise **tout seul** avec GestLog (via un automate n8n).",
              "**Texas Win** (éditeur *Asti*) : l'**ERP**. Après validations et corrections, il sort les **vraies** données de commande. Elles s'importent **à la main** (Import → Commandes clients (Texas)).",
              "**WooCommerce** : la **boutique en ligne** (BtoC), dans son propre espace.",
            ],
          },
          {
            h: "Le point important",
            lines: [
              "Pour une saison, GestLog affiche **Texas si tu l'as importé**, sinon **TIO** en repli. Texas est la **source de vérité**, TIO reste en **archive**.",
            ],
            tip: "Tant que tu n'importes pas de Texas pour une saison, **rien ne change** : tu continues à voir les données TIO comme avant. 👌",
          },
        ],
      },
      {
        id: "parcours",
        icon: "🛤️",
        title: "Le parcours d'une commande (bout en bout)",
        keywords: "flux parcours étapes commande réception répartition livraison workflow",
        sections: [
          {
            h: "Les grandes étapes",
            lines: [
              "1. **Commandes** : les boutiques commandent (TIO auto, ou import Texas).",
              "2. **Commande fournisseur** : tu importes ce qui a été commandé aux fournisseurs.",
              "3. **Réception** : tu importes ce que le fournisseur a **réellement livré** → ça devient ton **stock disponible**.",
              "4. **Répartition** : tu partages ce stock entre les boutiques selon leurs priorités.",
              "5. **Préparation → Dépôt → Livraisons → Caisse** : tu prépares, expédies, et le stock arrive en magasin.",
            ],
          },
          {
            lines: [
              "À côté, la **Comparaison commande/réception** te montre les écarts, et le **Dashboard / Statistiques** analysent tout ça.",
            ],
          },
        ],
      },
      {
        id: "saisons",
        icon: "📅",
        title: "Les saisons",
        keywords: "saison sélecteur active cible ah26 fw26 catalogue",
        sections: [
          {
            lines: [
              "Presque tout dans GestLog est **rangé par saison** (ex. AH26, PE27…). Le **sélecteur de saison** en haut choisit la saison que tu regardes.",
              "À l'**import**, il y a un sélecteur séparé : la **saison cible**, pour être sûr de ranger le fichier au bon endroit.",
            ],
            tip: "Une commande ne peut exister que dans **une seule saison**. Si un numéro existe déjà ailleurs, l'import le refuse — c'est voulu.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Importer & corriger
  {
    id: "import",
    emoji: "📥",
    title: "Importer & corriger",
    blurb: "Faire entrer les données, et réparer une erreur sans tout refaire.",
    articles: [
      {
        id: "import-commandes",
        icon: "🧾",
        title: "Importer les commandes clients (Texas)",
        keywords: "import commandes clients texas erp source vérité onglet tio synchro",
        sections: [
          {
            h: "Un seul onglet : Commandes clients (Texas)",
            lines: [
              "Les commandes clients s'importent **uniquement depuis le fichier Texas (l'ERP)** : ce sont les données de référence.",
              "Dès que tu l'importes, **cette saison bascule sur Texas** (la vérité) et tous les écrans B2B s'appuient dessus.",
            ],
          },
          {
            h: "Et les commandes TIO ?",
            lines: [
              "Elles **arrivent toutes seules** par la synchro automatique — il n'y a **rien à importer à la main**.",
              "Elles restent visibles en **archive** tant qu'aucun fichier Texas n'a été importé pour la saison.",
            ],
            tip: "Si tu déposes un ancien export « commande client » TIO, l'outil te le dira : ce format n'est plus importé manuellement. 🙂",
          },
          {
            h: "Comment faire",
            lines: [
              "Choisis la **saison cible** en haut, va sur l'onglet **Commandes clients (Texas)**, dépose le fichier, vérifie le nombre de lignes, puis **Importer**.",
              "Le résultat indique les lignes importées et les éventuelles erreurs.",
            ],
            tip: "Un **« produit introuvable »** n'est jamais anodin : la ligne est **ignorée**. Le plus souvent c'est un **code couleur différent** entre le fichier et le référentiel (→ crée une **équivalence couleur**), ou un **produit pas encore synchronisé** depuis TIO. Voir la fiche « Équivalences de code couleur ».",
          },
        ],
      },
      {
        id: "import-fournisseur",
        icon: "🏭",
        title: "Importer les commandes fournisseurs",
        keywords: "import commande fournisseur statgen gamme saison code produit créé",
        sections: [
          {
            lines: [
              "Dépose l'export « commande fournisseur ». Le n° de commande et le fournisseur sont **lus dans le fichier**. Un fichier peut contenir **plusieurs commandes**.",
              "Si un produit n'existe pas encore au référentiel, il est **créé automatiquement** avec sa grille de tailles.",
            ],
            tip: "L'import fournisseur porte aussi le **code saison** (W26, S27…) utilisé par l'**export réceptions**. Si cet export est vide, c'est souvent qu'il faut **réimporter la commande fournisseur**.",
          },
        ],
      },
      {
        id: "import-reception",
        icon: "📦",
        title: "Importer les réceptions",
        keywords: "import réception packing list colisage tailles auto rattachement",
        sections: [
          {
            lines: [
              "Dépose la **liste de colisage (packing list)**. Les tailles sont repérées **par leur nom** (l'ordre des colonnes n'a pas d'importance).",
              "Deux présentations passent : **une colonne par taille** (S, M, L…), ou **une ligne par taille** avec des colonnes `Taille` et `Quantité`. 👍",
              "Le n° de commande fournisseur est **facultatif** : sans lui, la réception se rattache **automatiquement** à la commande de la saison qui contient ces produits.",
            ],
            tip: "Importe la **commande fournisseur d'abord**, sinon l'auto-rattachement ne trouve rien.",
          },
          {
            h: "Un produit du colisage n'a pas été importé ?",
            lines: [
              "Le résultat d'import te dit **combien de pièces** n'ont pas été prises et **pourquoi**, produit par produit. Lis le cadre rouge : la cause y est écrite en clair.",
              "**La référence existe mais pas dans cette couleur** → c'est le code couleur qui diffère. Vérifie le colisage, ou crée une **équivalence de couleur** dans Infos produits.",
              "**La référence est inconnue** → le plus souvent le fournisseur a livré un produit **non commandé**, ou le colisage comporte une coquille. L'outil te dit si la référence figure ou non dans la commande fournisseur.",
              "Un produit n'est **jamais créé** depuis une réception : c'est une sécurité pour ne pas fabriquer un produit fantôme à partir d'une erreur de saisie du fournisseur. Passe par la **commande fournisseur**, qui elle crée les produits manquants.",
            ],
            tip: "Le reste de la réception est bien enregistré : seules les lignes non résolues sont écartées. 👍",
          },
        ],
      },
      {
        id: "import-reception-plus",
        icon: "🧾",
        title: "Réceptions : choisir la commande et formats reconnus",
        keywords: "réception commande fournisseur rattacher recherche format packing list imder club ju récapitulatif colisage",
        sections: [
          {
            lines: [
              "Une réception doit être rattachée à **une commande fournisseur**. Quand le fichier de colisage ne porte pas le numéro de commande, tu peux désormais **la chercher**.",
            ],
          },
          {
            h: "Rattacher la bonne commande",
            lines: [
              "Sous le fichier, le champ **« Commande fournisseur à rattacher »** propose les commandes **déjà importées dans la saison** : tape un numéro ou un nom de fournisseur et choisis dans la liste (n° + fournisseur + nombre de références).",
              "**Laissé vide**, GestLog rattache **automatiquement** la réception à la commande de la saison qui contient le plus de produits reçus.",
              "Le champ reste libre : tu peux saisir un numéro qui n'est pas dans la liste.",
            ],
            tip: "En cas de doute, choisis explicitement la commande : le rattachement automatique se trompe si deux commandes partagent les mêmes références. 🎯",
          },
          {
            h: "Les formats de colisage reconnus",
            lines: [
              "GestLog s'adapte à des mises en page très différentes : il repère les colonnes **par leur nom**, l'en-tête peut être **plus bas** dans la feuille (un titre au-dessus ne gêne pas), et les tailles peuvent être **en colonnes** ou **en lignes**.",
              "Les libellés français sont acceptés (`REFERENCE produit fini`) comme les anglais (`FULL MCS PRODUCT REF`).",
              "Les fichiers contenant **le détail par colis puis un récapitulatif** en bas sont gérés : seul le détail est compté. ⚠️ Sans ça, le récapitulatif était relu comme du détail et les quantités **doublaient**.",
            ],
            tip: "Après import, compare toujours le **total annoncé** à la ligne « TOTAL » de ton fichier : c'est le contrôle le plus rapide. ✅",
          },
        ],
      },
      {
        id: "import-stock",
        icon: "🏷️",
        title: "Importer le stock",
        keywords: "import stock mapping colonnes excel générique",
        sections: [
          {
            lines: [
              "Le stock s'importe depuis un **Excel générique** : tu **associes toi-même** chaque colonne (référence, couleur, tailles) grâce au mapping affiché après le dépôt.",
            ],
          },
        ],
      },
      {
        id: "corriger-reception",
        icon: "🛠️",
        title: "Corriger une réception",
        keywords: "corriger réception éditeur couleur échangée quantité total",
        sections: [
          {
            h: "À quoi ça sert",
            lines: [
              "Réparer une réception **fausse sur quelques lignes** (ex. deux couleurs échangées) **sans tout réimporter**.",
            ],
          },
          {
            h: "Comment faire",
            lines: [
              "Depuis **Comparaison** (bouton « Corriger une réception ») ou le bloc « Imports récents ».",
              "Choisis la réception, puis **change la couleur** d'une ligne (menu déroulant), **ajuste les quantités**, ajoute/supprime des lignes. Le **total en bas se met à jour** en direct.",
              "Pour **échanger 2 couleurs** : change la couleur sur chacune des 2 lignes, puis enregistre.",
            ],
            tip: "Après correction, va sur **Répartition** et clique **Relancer** : la répartition se recalcule sur les nouvelles quantités. 🔄",
          },
        ],
      },
      {
        id: "corriger-reception-doublons",
        icon: "🔗",
        title: "Corriger une réception : lignes en double",
        keywords: "corriger réception doublon fusion même produit couleur addition quantités",
        sections: [
          {
            lines: [
              "Dans l'éditeur de correction, si **deux lignes désignent le même produit** (même référence **et** même code couleur), GestLog les **fusionne à l'enregistrement** en additionnant les quantités taille par taille.",
              "Avant, l'enregistrement était refusé avec un message d'erreur et il fallait fusionner à la main.",
            ],
            tip: "C'est normal et fréquent : un même produit arrive souvent réparti sur **plusieurs colis**. L'import fait déjà la somme, la correction aussi. ➕",
          },
        ],
      },
      {
        id: "annuler-import",
        icon: "🗑️",
        title: "Annuler / supprimer un import",
        keywords: "supprimer import annuler récent erreur ratée écraser",
        sections: [
          {
            lines: [
              "En bas de l'écran **Import**, le bloc « Imports récents (supprimables) » liste tes imports. Le bouton **Supprimer** (confirmation en 2 temps) efface les données créées par cet import.",
            ],
            tip: "⚠️ Supprimer une **commande fournisseur** supprime aussi ses **réceptions**. Les imports faits avant cette fonctionnalité s'affichent « non supprimable ».",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Répartir le stock
  {
    id: "repartition",
    emoji: "🎯",
    title: "Répartir le stock",
    blurb: "Partager équitablement ce qui a été reçu entre les boutiques.",
    articles: [
      {
        id: "comprendre-repartition",
        icon: "⚖️",
        title: "Comprendre la répartition",
        keywords: "répartition allocation simulation stock insuffisant règles priorité",
        sections: [
          {
            lines: [
              "Quand le stock reçu **ne suffit pas** pour toutes les commandes, la répartition décide **qui reçoit quoi**, selon les priorités configurées.",
              "Elle se base sur la **demande** (commandes clients de la source active) et sur le **stock réellement reçu** (les réceptions).",
            ],
          },
          {
            h: "Bon à savoir",
            lines: [
              "Le moteur ne peut **jamais allouer plus que ce qui a été reçu**. Si tu as reçu 0, il alloue 0.",
              "Il évite les **trous de taille**, essaie que **chaque boutique reçoive quelque chose**, et respecte l'**ordre de priorité** (le rang).",
            ],
          },
        ],
      },
      {
        id: "config-priorites",
        icon: "🥇",
        title: "Configurer les priorités (rang, plafonds, seuil)",
        keywords: "configuration rang ranking plafond pourcentage seuil rotation client saison",
        sections: [
          {
            h: "Dans l'écran Configuration",
            lines: [
              "**Rang** : la priorité de la boutique. **Plus petit = servi en premier** (rang 1 = prioritaire).",
              "**% max commande / % max ligne** : la coupe maximale autorisée (protège tes meilleurs clients d'une réduction trop forte).",
              "**Seuil min.** : en dessous de X pièces, on ne livre pas (évite les micro-livraisons).",
              "**Rotation** : départage deux boutiques de même rang.",
            ],
            tip: "Ces réglages sont **par client ET par saison**. Sans configuration active pour une boutique, aucune règle ne s'applique à elle.",
          },
        ],
      },
      {
        id: "lancer-simulation",
        icon: "▶️",
        title: "Lancer et ajuster une simulation",
        keywords: "simulation lancer relancer ajuster manuel filtre vue produit boutique persistance",
        sections: [
          {
            lines: [
              "Choisis tes filtres (catalogue, boutiques, fournisseurs…) puis **Lancer la simulation**.",
              "Le **filtre catalogue** te permet de ne répartir qu'un catalogue de vente, même quand la réception fournisseur couvre plusieurs catalogues. Les réassorts n'appartiennent à aucun catalogue : ils n'apparaissent donc pas quand tu en choisis un.",
              "Bascule entre la vue **par boutique** et **par produit**. En vue produit, l'en-tête montre **Commandé / Reçu / Écart / Alloué**.",
              "Tu peux **modifier une quantité à la main** en cliquant sur une cellule.",
              "Le **filtre réception** (Tout / Réceptionné / Non réceptionné) masque les produits selon leur réception.",
              "Le bloc **Périmètre de l'export EAN** limite le fichier à certains **fournisseurs** et/ou **boutiques**. Il ne touche pas au calcul, et il est **séparé** du périmètre de validation : tu peux exporter une boutique sans pour autant ne valider qu'elle.",
            ],
            tip: "La simulation est **conservée quand tu changes de page** : tu la retrouves telle quelle (avec tes ajustements) sans la relancer. 💾",
          },
          {
            h: "Reprendre une répartition depuis son fichier",
            lines: [
              "Le bouton **Importer une répartition** rejoue une répartition à partir de son **fichier EAN** (celui du bouton « Export EAN »).",
              "Utile si tu as **perdu ta simulation** (page rafraîchie, session expirée) mais que tu avais exporté le fichier : réimporte-le et tu retrouves exactement le même résultat.",
              "Le **fichier fait foi** : aucune règle n'est recalculée. Les quantités commandées, elles, sont relues automatiquement pour afficher les écarts. Ensuite, valide comme d'habitude.",
            ],
            tip: "En mode import, les filtres du haut d'écran sont ignorés : le fichier définit la répartition, il doit pouvoir se reposer en entier. 📄",
          },
        ],
      },
      {
        id: "reste-a-repartir",
        icon: "🧮",
        title: "Ce qui reste vraiment à répartir",
        keywords: "reste à livrer disponible engagé déjà réparti deuxième réception partielle stock réel dispo",
        sections: [
          {
            lines: [
              "C'est **le point le plus important** de l'écran Répartition, et le plus souvent mal compris : ni la colonne **Cmd. clients**, ni la colonne **Reçu fourn.** ne servent directement au calcul.",
              "GestLog raisonne sur **ce qu'il reste à faire** : le **reste à livrer** d'un côté, le **stock encore libre** de l'autre.",
            ],
            tip: "Règle à retenir : **on ne répartit jamais deux fois la même pièce, et on ne redemande jamais ce qui est déjà livré.**",
          },
          {
            h: "Une réception en plusieurs fois : l'exemple à connaître",
            lines: [
              "Une boutique commande **3 polos bleus en L**.",
              "**1ʳᵉ réception** : 1 polo arrive. Tu le répartis, tu valides. Il en reste **2 à livrer**.",
              "**2ᵉ réception** : les 2 polos manquants arrivent. Dans la répartition, la boutique n'affiche plus 3 mais **2** — et il y a **2** pièces disponibles. **La commande est complète, écart à zéro.**",
              "Sans ce mécanisme, la boutique réafficherait **3** demandés face à **2** disponibles : elle paraîtrait coupée d'une pièce alors qu'elle est parfaitement servie.",
            ],
            tip: "Le polo déjà réparti n'est **plus jamais** repris : ni dans la commande, ni dans le stock. 🎯",
          },
          {
            h: "La colonne « Cmd. clients » = le reste à livrer",
            lines: [
              "Ce n'est **pas** la commande d'origine, mais ce qu'il reste dû à la boutique : **commande − déjà livré** dans les répartitions validées, **taille par taille**.",
              "Une ligne entièrement livrée **disparaît** de l'écran : il n'y a plus rien à en faire.",
              "Si une boutique a **plusieurs commandes** du même produit, le déjà-livré s'impute sur ses lignes dans l'ordre.",
            ],
          },
          {
            h: "La tuile « Dispo » = le stock encore libre",
            lines: [
              "Le **disponible** vaut : **Reçu − échantillons − pièces déjà réparties dans une répartition validée**.",
              "Sous « Reçu fourn. », deux mentions expliquent l'écart quand il y en a un : **« dont N éch. »** (mises de côté pour le contrôle qualité) et **« dont N engagé »** (déjà promises à des boutiques).",
              "Exemple lu à l'écran : *Reçu 117, dont 1 éch., dont 116 engagé → **Dispo 0***. Tout est déjà parti, il n'y a plus rien à répartir sur ce produit.",
            ],
            tip: "Le **surplus** et tes **saisies manuelles** sont plafonnés au **Dispo**, jamais au Reçu : impossible de réattribuer une pièce déjà promise. 🔒",
          },
          {
            h: "Les produits entièrement écoulés sont masqués",
            lines: [
              "Un produit reçu dont il ne reste **rien** n'apparaît plus dans la liste : il n'afficherait que des lignes à 0 en « Annulé » à −100 %, ce qui laisse croire à tort que les boutiques n'ont pas été servies — alors qu'elles l'ont été, dans la répartition précédente.",
              "Rien ne disparaît en douce : la barre d'outils affiche **« Afficher les N produits entièrement engagés »** si tu veux les revoir.",
              "Ils sont aussi **exclus de la validation** : une répartition n'enregistre que ce qu'elle distribue réellement.",
            ],
            tip: "Un produit **jamais reçu** n'est pas concerné : c'est le filtre **Non réceptionné** qui te le montre. 📦",
          },
          {
            h: "Deux règles que le moteur ne transgresse jamais",
            lines: [
              "**Une taille ne se transforme pas en une autre.** Si une boutique est servie en S et en L mais qu'il n'existe aucun M, GestLog ne « convertit » pas un S en M pour boucher le trou — sinon on promettrait un M qui n'existe pas.",
              "**Pas de trou de taille.** Quand le trou ne peut pas être comblé faute de stock, GestLog retire le plus petit des deux blocs qui l'entourent, et les pièces retirées **repartent au stock** pour d'autres boutiques.",
            ],
            tip: "Ces pièces libérées ne sont pas perdues : elles se retrouvent dans le **surplus**, que tu peux placer à la main. ♻️",
          },
        ],
      },
      {
        id: "exclure-produit",
        icon: "🚫",
        title: "Écarter un produit d'une répartition",
        keywords: "exclure produit défectueux problème réception ne pas livrer coche case exclusion",
        sections: [
          {
            lines: [
              "Il arrive qu'un produit **ne doive pas partir** : réception défectueuse, erreur de coloris, doute sur la qualité… Tu peux l'**écarter** de la répartition en cours.",
              "Passe en vue **Par produit**. À côté de la référence, coche **« Exclure de la répartition »**.",
            ],
            tip: "Pas besoin de justifier : c'est une simple coche, sans motif à saisir. ✍️",
          },
          {
            h: "Ce que ça fait",
            lines: [
              "Le produit est **écarté de la répartition et de la validation** : ses lignes ne seront **pas enregistrées**.",
              "La carte du produit devient **grisée** et sa référence **barrée** — il reste visible pour que tu puisses revenir en arrière.",
              "La barre d'outils affiche un rappel rouge **« N produits exclus »**, et le bouton de validation indique le nombre exact de lignes qui partiront.",
              "Comme rien n'est enregistré, **le stock n'est pas consommé** : ces pièces resteront disponibles pour une répartition ultérieure, une fois le problème réglé.",
            ],
            tip: "L'exclusion vise le couple **référence + couleur** en entier, pour toutes les boutiques à la fois. Pour ne retirer qu'une boutique ou une taille, mets plutôt la quantité à **0** à la main. 🎯",
          },
          {
            h: "Revenir en arrière",
            lines: [
              "Décoche la case : le produit repart normalement dans la répartition et la validation.",
              "Ton choix est **conservé si tu relances la simulation** — c'est une décision métier, pas un réglage d'affichage. Il est en revanche remis à zéro si tu **changes de saison**.",
            ],
          },
        ],
      },
      {
        id: "echantillons",
        icon: "🧪",
        title: "Mettre des pièces de côté (échantillons)",
        keywords: "échantillon shipment sample contrôle qualité siège prélever retirer disponible",
        sections: [
          {
            lines: [
              "L'écran **Échantillons** sert à mettre de côté des pièces que le **siège récupère pour contrôler la qualité**. Elles ne partiront jamais en boutique.",
              "Deux façons de travailler : choisis une **réception** pour voir **tous les produits** de cette livraison, ou tape une **référence** pour voir ses coloris (toutes réceptions confondues). Tu peux combiner les deux.",
              "Dans les deux cas tu obtiens un **tableau couleurs × tailles** : tu saisis les quantités dans les cases, puis tu cliques **Enregistrer** une seule fois.",
              "Sous chaque case : la quantité **reçue** (tu ne peux pas prélever au-delà), puis l'**excédent** — en vert s'il y a plus de pièces que les boutiques n'en ont commandé. **C'est là qu'il faut prélever** : ça ne pénalise personne. Le second chiffre, en gris, est l'écart avec la commande fournisseur.",
              "Ces pièces sont aussitôt **retirées du disponible à la répartition** : elles ne seront donc jamais attribuées à une boutique.",
            ],
            tip: "La **réception n'est pas modifiée** : elle garde ce que le fournisseur a livré. C'est normal de voir « Reçu 117 » avec la mention « dont 2 éch. » — seules 115 pièces sont réparties. 👌",
          },
          {
            h: "Si les pièces sont déjà attribuées à des boutiques",
            lines: [
              "**Avant même de saisir**, clique sur une **référence** dans la grille : le détail se déplie et te montre **quelle boutique a déjà quelles tailles**.",
              "Les cases **vertes avec un +N** signalent des pièces que la répartition a données **au-delà de ce que la boutique avait commandé** (du surplus). C'est là qu'il faut prélever en priorité : la boutique ne les avait pas demandées.",
              "Sous chaque quantité, une petite case te permet de **mettre cette pièce de côté** : tu saisis le nombre, puis **Mettre de côté (échantillon)**. En **un seul geste**, la pièce sort de la commande de cette boutique **et** du disponible fournisseur, et apparaît dans la liste des échantillons. C'est exactement le mouvement d'un prélèvement pour contrôle qualité.",
              "Quand tu prélèves des pièces qu'une **répartition validée** a déjà distribuées, l'outil t'arrête et affiche les boutiques concernées.",
              "Tu choisis **chez qui reprendre** les pièces (une proposition est pré-remplie, en commençant par les boutiques les mieux servies), puis tu confirmes. **Rien n'est enregistré avant ta confirmation.**",
              "La répartition validée est alors corrigée, et une trace est ajoutée dans ses notes.",
            ],
            tip: "⚠️ Si tu as **déjà généré les livraisons** de cette répartition, elles ne se mettront pas à jour : reprends plutôt des pièces là où il y a de l'excédent (chiffre vert).",
          },
          {
            h: "Changer d'avis",
            lines: [
              "La corbeille en bout de ligne **annule un prélèvement** : les pièces redeviennent disponibles.",
              "Dans les deux cas (ajout ou retrait), pense à **relancer la simulation** de répartition pour que le changement soit pris en compte.",
            ],
          },
        ],
      },
      {
        id: "surplus",
        icon: "➕",
        title: "Répartir le surplus (pièces livrées en plus)",
        keywords: "surplus pièces en plus répartir bouton livré fournisseur exception taille",
        sections: [
          {
            lines: [
              "Si un fournisseur a livré **plus** que commandé, un bouton **« Répartir surplus »** apparaît sur la carte du produit (vue par produit).",
              "Il **comble d'abord les écarts** : chaque pièce va à la boutique **la moins bien servie** en pourcentage, jusqu'à ce que plus personne ne soit en manque. Le rang ne sert qu'à départager deux boutiques à égalité.",
              "**Ensuite seulement**, s'il reste des pièces, elles sont posées **au-delà des commandes** — toujours à la moins bien servie d'abord, pour que les écarts restent serrés.",
            ],
            tip: "Le surplus n'est réparti que sur des **tailles réellement commandées**, et jamais au-delà du stock reçu.",
          },
          {
            h: "Empêcher une boutique de recevoir une taille",
            lines: [
              "Dans **Configuration**, la colonne **Tailles hors surplus** te laisse dire qu'une boutique ne doit **jamais** recevoir telle taille en trop (par exemple du 4XL). Tape la taille puis Entrée ; clique sur une étiquette pour la retirer.",
              "Ce réglage est **global** : il suit la boutique d'une saison à l'autre, tu ne le ressaisis pas chaque saison.",
              "Ce qu'elle a **réellement commandé** lui est toujours servi : l'exception ne bloque que les pièces **en trop**.",
              "Et si **aucune autre boutique n'a commandé cette taille**, l'exception est **levée** — sinon les pièces resteraient bloquées en stock alors que quelqu'un peut les vendre.",
            ],
            tip: "Utile pour les boutiques qui ne tournent pas sur les tailles extrêmes : elles gardent leur commande, mais n'héritent pas des invendus. 👌",
          },
        ],
      },
      {
        id: "valider-repartition",
        icon: "✅",
        title: "Valider une répartition",
        keywords: "valider session répartition figée livraison génération périmètre fournisseur catalogue partielle",
        sections: [
          {
            lines: [
              "**Valider** enregistre la répartition en **session**. C'est cette session validée qui sert ensuite à **générer les livraisons** (écran Préparation).",
            ],
            tip: "Une session validée est un **instantané figé**. Si tu corriges une réception après coup, il faut **re-simuler puis re-valider**.",
          },
          {
            h: "Retrouver une répartition validée",
            lines: [
              "Le bouton **Historique** liste toutes les sessions de la saison. **Clique sur une session** pour rouvrir son détail : qui a reçu quoi, taille par taille, avec les totaux et les écarts.",
              "Tu peux y rechercher une boutique, une référence ou une couleur, et les lignes que quelqu'un a **ajustées à la main** sont signalées par un crayon.",
              "Les sessions sont rattachées à la **saison**, pas à toi : tes collègues qui ont accès à la Répartition voient les mêmes.",
              "Le bouton **Export EAN** y régénère le fichier EAN/quantité **quand tu veux**, même longtemps après la validation. Tu peux le limiter à certains **fournisseurs** et/ou certaines **boutiques** — exactement comme pendant la simulation.",
            ],
            tip: "Filtrer l'export d'une session validée est **sans danger** : la répartition est figée, seul le contenu du fichier change. Ne cherche pas à obtenir le même résultat en relançant une simulation sur quelques boutiques — là, le stock serait partagé entre ces seules boutiques et les quantités seraient fausses. ⚠️",
          },
          {
            h: "Modifier une répartition déjà validée",
            lines: [
              "Une session validée est **figée** — on ne la modifie pas directement. Mais tu peux la **reprendre** : sur sa page de détail, le bouton **Reprendre pour modifier** la recharge dans l'écran de répartition.",
              "Tu réajustes ce que tu veux, puis tu **revalides** : la répartition d'origine est **mise à jour sur place** (sa date est rafraîchie). Elle n'est **pas** dupliquée — avant, on se retrouvait avec deux fois la même répartition dans l'historique.",
              "**Un produit reçu depuis ?** Un champ **« + Ajouter un produit reçu »** apparaît au-dessus du tableau : cherche la référence et elle rejoint la répartition, déjà répartie entre ses boutiques. Pratique quand tu as corrigé une réception après coup.",
              "⚠️ Ne reprends pas une répartition dont tu as **déjà généré les livraisons** : ce qui a été préparé et envoyé en caisse ne se mettrait pas à jour tout seul.",
            ],
          },
          {
            h: "Ne valider qu'une partie : le périmètre de validation",
            lines: [
              "Le bloc **Périmètre de validation**, en haut des résultats, te laisse choisir les **fournisseurs** et les **catalogues** à valider (plusieurs de chaque). Vide = tout.",
              "La **simulation reste calculée sur toute la demande** : c'est indispensable, sinon le stock reçu serait réparti entre moins de boutiques et les coupes seraient fausses. Le périmètre n'agit qu'au moment d'enregistrer.",
              "Pratique quand une **réception fournisseur couvre plusieurs catalogues** : tu valides le catalogue prêt, et tu gardes le reste sous la main.",
              "Après une validation partielle, les lignes **non validées restent affichées** : tu peux enchaîner directement sur un autre fournisseur ou catalogue.",
            ],
            tip: "Quand tu filtres sur un catalogue, les **réassorts** (qui n'appartiennent à aucun catalogue) sont exclus. 📦",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Préparer & livrer
  {
    id: "livraison",
    emoji: "🚚",
    title: "Préparer & livrer",
    blurb: "De la répartition validée jusqu'au magasin.",
    articles: [
      {
        id: "preparation",
        icon: "📋",
        title: "Préparer les livraisons",
        keywords: "préparation livraison génération statut ean dépôt transporteur colis",
        sections: [
          {
            lines: [
              "Depuis une répartition **validée**, tu **génères les livraisons** (une par boutique, seulement les lignes livrables).",
              "Chaque livraison suit un cycle de statut : **Planifiée → En préparation → Envoyée au dépôt → Validée dépôt → Expédiée**.",
              "Tu saisis les infos dépôt (BL, nb de colis, transporteur) et tu peux **exporter le fichier EAN**.",
            ],
            tip: "L'**export EAN est requis** avant d'envoyer au dépôt. Une taille sans EAN sort en `MISSING_…`.",
          },
        ],
      },
      {
        id: "depot",
        icon: "🏬",
        title: "La vue dépôt",
        keywords: "dépôt réception physique colis anomalie valider entrepôt",
        sections: [
          {
            lines: [
              "Côté entrepôt, on **valide la réception physique** des livraisons envoyées, on saisit le **nb de colis reçus**, et on **signale les anomalies**.",
            ],
            tip: "Ne pas confondre **Vue dépôt** (les livraisons internes que tu as générées) avec **Livraisons** (les BL/factures importés de l'entrepôt).",
          },
        ],
      },
      {
        id: "shipments",
        icon: "📄",
        title: "Les livraisons (BL & factures)",
        keywords: "livraisons shipments bl facture fac pdf entrepôt ftp document",
        sections: [
          {
            lines: [
              "Cet écran affiche les **bons de livraison et factures importés de l'entrepôt** (via FTP), regroupés par commande. Tu peux **ouvrir le PDF** et voir le détail des lignes.",
              "Filtres : type (BL/FAC), client, saison, dates, recherche.",
            ],
          },
        ],
      },
      {
        id: "caisse",
        icon: "🧮",
        title: "L'envoi à la caisse",
        keywords: "caisse expédiée réception stock magasin intégration automatique",
        sections: [
          {
            lines: [
              "Quand une livraison passe au statut **Expédiée**, GestLog l'envoie **automatiquement à la caisse** du magasin comme une réception de stock (par EAN).",
            ],
            tip: "C'est **automatique et non bloquant** : si l'envoi échoue, il est marqué en erreur mais ne bloque pas ton travail.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Analyser
  {
    id: "analyser",
    emoji: "📊",
    title: "Analyser",
    blurb: "Tableaux de bord, statistiques et comparaisons.",
    articles: [
      {
        id: "dashboard",
        icon: "📈",
        title: "Le tableau de bord",
        keywords: "dashboard tableau bord kpi taux livraison facturation clients actifs",
        sections: [
          {
            lines: [
              "Vue d'ensemble d'une saison : commandes, pièces commandées, **taux de réception / livraison / facturation**, clients actifs, répartitions en attente, et plusieurs graphiques.",
            ],
          },
          {
            h: "Comment lire les taux",
            lines: [
              "**Taux de livraison** = livré ÷ (commandé − **soldé**). Le soldé est retiré : sinon le taux ne pourrait jamais atteindre 100 %.",
              "**Taux de facturation** = facturé ÷ **livré** (la facture suit la livraison), pas ÷ commandé.",
            ],
          },
        ],
      },
      {
        id: "statistiques",
        icon: "📉",
        title: "Les statistiques",
        keywords: "statistiques graphiques ca chiffre affaires facturé référence filtre",
        sections: [
          {
            lines: [
              "Analyses détaillées d'une saison : commandé/livré/facturé et **CA par client**, conformité fournisseurs, statuts, timeline. Filtrable par **référence produit**.",
            ],
            tip: "Ici, le **CA vient des factures** (montant HT facturé). Dans les écrans de **comparaison**, le CA vient du **montant de la commande**. C'est normal qu'ils diffèrent (voir « Le CA : d'où vient le chiffre ? »).",
          },
        ],
      },
      {
        id: "comparaison-cr",
        icon: "🔍",
        title: "Comparaison commande / réception",
        keywords: "comparaison commande réception écart fournisseur conformité anomalie",
        sections: [
          {
            lines: [
              "Contrôle les **écarts entre ce qui a été commandé aux fournisseurs et ce qui a été reçu**, par fournisseur puis par référence/couleur.",
              "Statut par ligne : **conforme** (écart nul), **écart mineur** (≤ 10 %), **écart majeur** (> 10 %).",
              "Recherche fournisseur + filtre **Tout / Réceptionné / Non réceptionné**.",
            ],
            tip: "Les fournisseurs sont toujours **triés par ordre alphabétique**. L'export Excel exporte **tout** (il ignore la recherche/filtre affichés).",
          },
        ],
      },
      {
        id: "comparaison-blocs",
        icon: "🧱",
        title: "Comparaison : une réception = un bloc",
        keywords: "comparaison réception bloc total séparé fournisseur plusieurs livraisons hors commande",
        sections: [
          {
            lines: [
              "Quand un fournisseur t'a livré **en plusieurs fois**, l'écran Comparaison ne mélange plus tout : chaque **réception a son propre bloc**, avec son tableau et **son total**.",
              "Tu vois donc immédiatement ce qu'a apporté chaque livraison, au lieu d'un « Reçu » global impossible à recouper.",
            ],
          },
          {
            h: "Lire un bloc",
            lines: [
              "L'en-tête indique **R1 · date** et le **total de la réception** en pièces.",
              "Le tableau compare, pour chaque référence/couleur : **Commandé**, **Reçu**, **Écart**, **%** et le **statut**. Une ligne **Total** ferme le bloc.",
              "Un bloc **« Non réceptionné »** regroupe à la fin les références commandées qui ne sont **jamais arrivées**.",
            ],
          },
          {
            h: "« dont N hors commande »",
            lines: [
              "Si le total physique d'une réception dépasse ce qui correspond à des références commandées, l'écart est signalé : le fournisseur a livré des références **absentes de la commande**.",
              "C'est une information utile à remonter au fournisseur, pas une erreur de GestLog.",
            ],
          },
        ],
      },
      {
        id: "comparaison-saisons",
        icon: "🔀",
        title: "Comparer deux saisons / catalogues",
        keywords: "comparaison saisons catalogues catégorie ca quantité évolution export",
        sections: [
          {
            lines: [
              "Compare deux **saisons** ou deux **catalogues** par catégorie produit : CA, quantité, poids et évolution.",
              "L'item 1 est le **total** ; l'item 2 est **filtrable jusqu'à une date** de commande. Filtre boutiques (inclure/exclure) et **export Excel**.",
            ],
          },
        ],
      },
      {
        id: "comparaison-clients",
        icon: "🏢",
        title: "Comparer les clients",
        keywords: "comparaison clients boutique enseigne ca quantité catégorie détail",
        sections: [
          {
            lines: [
              "Compare deux saisons/catalogues **client par client** (CA + quantité), avec le **détail par catégorie**.",
              "Le filtre boutique se fait ici **côté écran** : les totaux se recalculent instantanément sans recharger.",
            ],
          },
        ],
      },
      {
        id: "reassort",
        icon: "📿",
        title: "Suivi & réassort (Commandes client)",
        keywords: "réassort suivi commande client livré facturé solder reste bl",
        sections: [
          {
            lines: [
              "Suit les commandes B2B face aux **livraisons réelles** (BL/factures entrepôt) : livré vs commandé, statut de livraison et de facturation.",
              "Tu peux **solder** les pièces qui ne seront jamais livrées (bouton « Solder le reste ») — c'est tracé (qui/quand).",
            ],
            tip: "Ici « livré » = les **BL de l'entrepôt**. Dans le **Récap clients**, « livré » = les **livraisons internes** que tu as générées. Les deux peuvent différer.",
          },
        ],
      },
      {
        id: "controle-commandes",
        icon: "🔎",
        title: "Contrôle commandes (les « sélections »)",
        keywords: "contrôle commandes sélection une seule taille tio supprimer anomalie",
        sections: [
          {
            h: "À quoi ça sert",
            lines: [
              "Repérer les lignes où un client n'a commandé qu'**une seule taille** pour un produit/couleur — ce qu'on appelle une « **sélection** ».",
              "Objectif : les identifier pour les faire **supprimer dans TIO**.",
            ],
          },
          {
            h: "Comment lire l'écran",
            lines: [
              "Les compteurs en haut donnent le nombre de **lignes**, **commandes**, **boutiques** et **pièces** concernées pour la saison affichée.",
              "Le tableau liste la boutique, le n° de commande, le produit, la **taille commandée** et la **grille complète** du produit (pour voir ce qui manque).",
              "Tu peux filtrer (boutique, n° de commande, référence) et **exporter en Excel** pour transmettre la liste.",
            ],
          },
          {
            h: "Bon à savoir",
            lines: [
              "Les produits en **taille unique** (TU) sont **exclus** : une seule taille y est normale.",
              "En saison **Réassort**, commander une seule taille est **normal** (réassort à l'unité) — ce contrôle vise les commandes de collection.",
            ],
            tip: "Aucune sélection détectée ? L'écran te le dit clairement. 🎉",
          },
        ],
      },
      {
        id: "recap",
        icon: "🧑‍🤝‍🧑",
        title: "Récap clients",
        keywords: "récap clients commandé livré reste taux détail commande",
        sections: [
          {
            lines: [
              "Vue par client d'une saison : commandé, livré, reste à livrer, taux. La page détail compare **commandé vs livré** commande par commande, taille par taille.",
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Exporter
  {
    id: "export",
    emoji: "📤",
    title: "Exporter",
    blurb: "Sortir des fichiers pour le dépôt, la caisse ou l'analyse.",
    articles: [
      {
        id: "menu-export",
        icon: "🗂️",
        title: "Le menu Exports",
        keywords: "export menu regroupe hub réceptions comparaison",
        sections: [
          {
            lines: [
              "L'écran **Exports** regroupe tous les exports B2B (hors BtoC) : **téléchargement direct** des réceptions (CSV EAN) et de la comparaison (Excel), plus des **liens** vers les exports contextuels (répartition, comparaison saisons, répartition magasin, livraisons).",
            ],
          },
        ],
      },
      {
        id: "export-reception",
        icon: "🔢",
        title: "L'export des réceptions (EAN / quantité)",
        keywords: "export réception ean quantité csv saison commande sélecteur vide zip fournisseur fichier",
        sections: [
          {
            h: "Le format",
            lines: [
              "Une valeur par ligne, collée sans espace : **[saison 3c][n° commande 11c][EAN 13c][quantité]**.",
              "Le n° de commande est complété par des 0 à gauche ; les quantités à 0 sont retirées.",
            ],
          },
          {
            h: "Choisir les réceptions",
            lines: [
              "Un **sélecteur** permet de choisir précisément quelles réceptions exporter (multi-sélection + recherche par fournisseur). Aucune sélection = toutes.",
            ],
            tip: "Export **vide** ? Le code saison vient du **fichier commande fournisseur**. S'il manque, **réimporte la commande fournisseur** puis réessaie — le message te le dira.",
          },
          {
            h: "Un seul fichier, ou un par fournisseur",
            lines: [
              "Le sélecteur **Fichiers** te laisse choisir : **un seul fichier** avec toutes les réceptions sélectionnées, ou **un fichier par fournisseur**.",
              "En mode « un par fournisseur », les fichiers arrivent dans un **.zip** — les navigateurs bloquent les téléchargements en rafale, c'est le seul envoi fiable. Chaque fichier porte le code du fournisseur dans son nom.",
              "Le **contenu total est le même** dans les deux cas : seul le découpage change.",
            ],
            tip: "Pratique quand chaque fournisseur doit recevoir **son** fichier : plus besoin de sélectionner ses réceptions à la main puis de recommencer pour le suivant. 📦",
          },
        ],
      },
      {
        id: "a-vendre",
        icon: "🏷️",
        title: "À vendre : écouler le stock",
        keywords: "a vendre stock ecouler destockage trou taille remise pourcentage disponible entrepot solde",
        sections: [
          {
            lines: [
              "Cet écran répond à une question simple : **qu'est-ce qu'on a en stock, et qu'est-ce qui partira le plus facilement ?**",
              "Tu poses tes critères, la liste s'affiche avec les tailles disponibles, et tu vois immédiatement **combien de pièces** et **quel montant** ça représente.",
            ],
            tip: "Tout est exportable en Excel — l'écran n'affiche que les 300 premières lignes, l'export contient tout. 📄",
          },
          {
            h: "Le critère clé : les trous de tailles",
            lines: [
              "Un produit dont il reste **toutes les tailles à la suite** se vend bien. Un produit dépareillé — du S, plus de M, un peu de L — beaucoup moins.",
              "Un **trou**, c'est une taille à zéro **encadrée** par des tailles en stock. Exemple : `S:15 · M:0 · L:7 · XL:6` → **1 trou** (le M manque au milieu).",
              "⚠️ Les tailles absentes **en bout de gamme ne comptent pas** : `S:5 · M:13 · L:17 · XL:14 · 3XL:0` → **0 trou**. La gamme s'arrête simplement plus tôt, elle n'est pas trouée.",
              "Le réglage **Trous de tailles autorisés** fait le tri : **Non** ne garde que les gammes continues, **Oui** affiche tout le stock, dépareillé compris.",
            ],
            tip: "Sur le stock actuel, environ **2 produits sur 3** n'ont aucun trou. 👍",
          },
          {
            h: "Simuler une remise",
            lines: [
              "Saisis un pourcentage : les prix et le montant total se recalculent instantanément.",
              "La remise s'applique au **prix de gros** — celui auquel les boutiques sont facturées, donc celui qu'on brade pour écouler du stock.",
              "Le **prix public** reste affiché au plein tarif : il ne bouge pas, il sert de repère pour situer le positionnement du produit.",
              "Le **Montant** est donc directement ce que rapporterait l'opération, remise déduite.",
            ],
          },
          {
            h: "Bon à savoir",
            lines: [
              "Le stock affiché est le **stock physique de l'entrepôt**, synchronisé depuis TIO.",
              "⚠️ Ce n'est **pas** le même « disponible » que dans la Répartition : là-bas, c'est ce qui reste à distribuer aux boutiques (reçu moins ce qui est déjà réparti). Ici, c'est ce qu'il y a réellement en stock. Les deux chiffres n'ont pas à être identiques.",
              "Le filtre **saison** retient les produits **commandés** dans les saisons choisies. Un produit permanent, commandé sur plusieurs saisons, peut donc apparaître dans plusieurs.",
              "Tous les produits en stock ont un prix de gros, donc le montant est complet. Si un produit venait à en manquer, ses pièces seraient comptées mais **non valorisées**, et l'écran te le signalerait.",
            ],
          },
        ],
      },
      {
        id: "lancement-commande",
        icon: "🚀",
        title: "Lancement de commande",
        keywords: "lancement commande csv couleur categorie onglet taille rea site total achat tcd",
        sections: [
          {
            lines: [
              "Cet écran transforme l'export **« commandes à la couleur »** (le CSV sorti de TIO) en **tableaux de lancement** prêts pour le service achat.",
              "Dépose le fichier : GestLog le lit, affiche un aperçu par catégorie, puis génère le classeur Excel.",
            ],
            tip: "C'est le remplaçant du tableau croisé dynamique fait à la main : même structure, mêmes en-têtes, mêmes formules. 📊",
          },
          {
            h: "Ce que contient le fichier généré",
            lines: [
              "**Un onglet par catégorie** (Jersey, Chemise, Denim, Accessoires…), le plus gros volume en premier.",
              "Dans chaque onglet : une ligne de **total catégorie**, puis les **produits triés de la plus grande à la plus petite quantité**, et sous chacun le détail **par couleur** (également trié).",
              "Les colonnes de tailles s'adaptent à la catégorie : `S → 4XL` pour le haut, `29 → 44` pour les pantalons, `TU` pour les accessoires.",
            ],
          },
          {
            h: "Les colonnes de travail",
            lines: [
              "**Commandé** (bleu) : ce qui a été commandé par les boutiques, par taille, plus le total.",
              "**site** (jaune) : **laissé vide, à toi de le remplir** dans Excel — les quantités destinées au site.",
              "**% réa** (cyan) : la part de chaque taille dans le total de la ligne. Formule automatique.",
              "**rea** : la proposition de réassort, calculée par `=ARRONDI.SUP((total × 10 %) × % réa ; 0,5)`. Tu peux écraser la formule si tu veux fixer une quantité.",
              "**total** (orange) : `commandé + site + réa`. Il se recalcule tout seul dès que tu saisis une valeur dans « site » ou que tu modifies un réassort.",
            ],
            tip: "Les formules ne sont posées que sur les lignes **couleur** — c'est là que se fait le lancement. Les lignes produit et catégorie sont des totaux. ✍️",
          },
          {
            h: "D'où viennent les tailles",
            lines: [
              "Dans le CSV, les quantités sont dans des colonnes `T0`, `T1`, `T2`… qui ne portent **aucun nom de taille** : ce sont des **positions**.",
              "GestLog les traduit avec la **grille du produit** au référentiel : `T0` = 1ʳᵉ taille du produit, `T1` = 2ᵉ, etc. C'est pour ça que le même `T0` vaut `S` pour un polo et `29` pour un jean.",
              "Si une référence est **introuvable au référentiel**, l'écran te le signale et laisse ses colonnes nommées `T0`, `T1`… : **aucune pièce n'est perdue**, mais les tailles ne sont pas nommées.",
            ],
            tip: "Une référence signalée = un produit pas encore synchronisé depuis TIO. Vérifie l'écran **Infos produits**. 🔎",
          },
        ],
      },
      {
        id: "integration-cc",
        icon: "🧾",
        title: "Fichier d'intégration CC",
        keywords: "intégration cc client fichier ean bl texas document ville livraison prix revient",
        sections: [
          {
            lines: [
              "Cet écran transforme un **export EAN / BL** (le fichier large issu de Texas) en **fichier d'intégration** prêt à envoyer au client — 14 colonnes, propre.",
              "Dépose le fichier : GestLog le lit, te montre un aperçu, et génère **un fichier par numéro de document**.",
            ],
          },
          {
            h: "Un fichier par document",
            lines: [
              "Un export Texas contient parfois **plusieurs BL empilés** (et donc plusieurs clients). L'écran les détecte, **liste chaque document** et affiche un avertissement.",
              "Chaque document a une **case à cocher** : décoche ceux que tu ne veux pas générer. S'il en reste plusieurs, le téléchargement se fait en **zip**.",
            ],
            tip: "Si tu obtiens un document inattendu, ouvre ton fichier source : les lignes du BL précédent y sont probablement encore, parfois **masquées** dans Excel. 👀",
          },
          {
            h: "Le nom du fichier",
            lines: [
              "Il est composé automatiquement : **Fichier intégration + VILLE + N° document + date d'import** (ex. `Fichier intégration ROMANS SUR ISERE 143161 23-07-26.xlsx`).",
              "La **ville** est celle de **livraison** du client, retrouvée à partir du code client (elle est synchronisée depuis TIO chaque nuit).",
              "La **date** est celle du **dépôt du fichier**, pas de la génération : régénérer plus tard redonne le même nom.",
            ],
            tip: "Ville manquante ? L'écran te le signale et génère le nom **sans** la ville plutôt que d'inventer. 🏙️",
          },
          {
            h: "Ce qui est repris",
            lines: [
              "**Toutes les marques** sont reprises ; la colonne *fournisseur* porte la marque de chaque ligne.",
              "Le **prix** est celui **du document** — aucun prix n'est recalculé — simplement **arrondi à 2 décimales**.",
              "Les lignes à **quantité nulle** sont ignorées.",
            ],
          },
        ],
      },
      {
        id: "repartition-magasin",
        icon: "🏪",
        title: "Répartition magasin (1 onglet par fournisseur)",
        keywords: "répartition magasin export onglet fournisseur excel tio grille tailles",
        sections: [
          {
            lines: [
              "Transforme un export commande client TIO en un **Excel avec un onglet par fournisseur**, quantités replacées sous les bons libellés de taille.",
            ],
            tip: "À ne pas confondre avec la **Répartition (allocation)** qui partage le stock reçu entre boutiques. Ici, on **découpe un fichier** par fournisseur.",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── BtoC
  {
    id: "btoc",
    emoji: "🛒",
    title: "BtoC (boutique en ligne)",
    blurb: "Le e-commerce WooCommerce et les clients VIP.",
    articles: [
      {
        id: "btoc-overview",
        icon: "🛍️",
        title: "La boutique en ligne",
        keywords: "btoc woocommerce ventes ca statistiques export clients paramètres",
        sections: [
          {
            lines: [
              "L'espace **BtoC** analyse les ventes du site (CA, commandes, panier moyen, top produits/catégories/pays) et propose des **exports** (produits, ventes, clients, meilleures ventes).",
              "Les données viennent de **WooCommerce** (synchronisées automatiquement).",
            ],
          },
        ],
      },
      {
        id: "btoc-ventes-details",
        icon: "📍",
        title: "Export Ventes détaillées (adresses + paiement)",
        keywords: "btoc export ventes détaillées adresse facturation livraison paiement paypal monetico",
        sections: [
          {
            lines: [
              "Dans **BtoC → Export**, l'export **Ventes détaillées** sort **une ligne par commande** avec les coordonnées complètes et le moyen de paiement.",
            ],
          },
          {
            h: "Les colonnes",
            lines: [
              "**Facturation** et **Livraison**, séparément : prénom, nom, adresse, code postal, ville, pays.",
              "**Paiement** : le libellé lisible (PayPal, Monetico…) et son code interne.",
              "**Commande** : n°, date, statut, e-mail, total TTC, TVA, frais de port, remboursé, devise.",
              "Filtres : **plage de dates** et **statuts** (le sélecteur partagé en haut de l'onglet).",
            ],
            tip: "Si une commande n'a pas d'adresse de livraison distincte, les colonnes Livraison **reprennent la facturation**, et une colonne le signale. 📦",
          },
          {
            h: "Bon à savoir",
            lines: [
              "Ces coordonnées ont été **récupérées pour tout l'historique** depuis le 01/01/2026 ; les nouvelles commandes se remplissent automatiquement.",
              "Quelques commandes anciennes peuvent avoir des champs vides : c'est qu'ils sont **vides dans WooCommerce** aussi.",
            ],
          },
        ],
      },
      {
        id: "btoc-vip",
        icon: "⭐",
        title: "Les clients VIP (Brevo)",
        keywords: "vip brevo marketing seuil client fidèle email",
        sections: [
          {
            lines: [
              "Les clients qui **dépassent un certain montant dépensé** sont détectés comme **VIP** et poussés vers **Brevo** (marketing) automatiquement après chaque synchro.",
            ],
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Réglages & accès
  {
    id: "reglages",
    emoji: "⚙️",
    title: "Réglages & accès",
    blurb: "Référentiel produit, utilisateurs, ton compte.",
    articles: [
      {
        id: "infos-produits",
        icon: "🔖",
        title: "Infos produits (référentiel)",
        keywords: "infos produits référentiel ean types tailles fournisseur correspondance",
        sections: [
          {
            lines: [
              "Le référentiel **trans-saison** : les **types de taille**, les **correspondances Fournisseur → Référence**, et la **base EAN**. On l'alimente par import Excel/CSV.",
              "Ces données servent à **apparier les produits** dans tous les imports et exports (EAN, tailles).",
            ],
          },
        ],
      },
      {
        id: "equivalences-couleur",
        icon: "🎨",
        title: "Équivalences de code couleur (produit introuvable)",
        keywords: "équivalence couleur code sss 000 produit introuvable import texas tio ean",
        sections: [
          {
            h: "Le problème",
            lines: [
              "Un même coloris peut avoir **deux codes différents** : par exemple « sans couleur » est **SSS** dans Texas mais **000** dans TIO (le référentiel).",
              "Résultat : à l'import, l'outil ne trouve pas le produit → **« Produit introuvable »**, et la ligne est ignorée.",
            ],
          },
          {
            h: "La solution",
            lines: [
              "Va dans **Infos produits → Équivalences couleur** et crée l'équivalence : code des fichiers = **SSS**, code du référentiel = **000** (libellé « Sans » en option).",
              "À l'import suivant, l'outil cherchera le produit sous **000**, puis le **basculera** sous **SSS**.",
            ],
            tip: "Résultat : **SSS s'affiche partout** (le code de tes commandes), tout en gardant les **EAN** et la **grille de tailles** d'origine. Rien n'est perdu. ✨",
          },
          {
            h: "Bon à savoir",
            lines: [
              "La bascule est **prudente** : seules les références réellement rencontrées en SSS changent. Les autres produits en 000 ne bougent pas.",
              "Elle se fait **au moment de l'import** — il faut donc **réimporter** le fichier après avoir créé l'équivalence.",
              "Supprimer une équivalence n'annule pas les bascules déjà faites.",
            ],
          },
        ],
      },
      {
        id: "utilisateurs",
        icon: "👥",
        title: "Les utilisateurs & permissions",
        keywords: "utilisateurs admin permissions écran code connexion rôle accès",
        sections: [
          {
            lines: [
              "Réservé aux **administrateurs** : créer des comptes (nom + **code de connexion** + rôle) et choisir **à quels écrans** chaque utilisateur a accès.",
            ],
            tip: "Un **administrateur voit tout**. Les restrictions d'écran ne s'appliquent qu'aux comptes **Utilisateur**.",
          },
        ],
      },
      {
        id: "mon-compte",
        icon: "🙋",
        title: "Mon compte",
        keywords: "compte code connexion nom déconnexion mot de passe",
        sections: [
          {
            lines: [
              "Modifie ton **nom affiché**, change ton **code de connexion** (4 chiffres), ou **déconnecte-toi**.",
            ],
            tip: "Il n'y a pas de mot de passe : la connexion se fait avec un **code numérique**. Garde-le pour toi. 🔒",
          },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Concepts clés
  {
    id: "concepts",
    emoji: "🧠",
    title: "Concepts clés",
    blurb: "À comprendre une fois pour ne plus jamais se tromper.",
    articles: [
      {
        id: "tio-vs-texas",
        icon: "⚔️",
        title: "TIO vs Texas : qui gagne ?",
        keywords: "tio texas source vérité archive bascule repli double",
        sections: [
          {
            lines: [
              "**Texas gagne** dès qu'une saison a des commandes Texas importées : tous les écrans B2B basculent dessus (c'est la **vérité**).",
              "**TIO** reste en **archive**. Tant qu'il n'y a pas de Texas pour la saison, tu vois TIO (**repli automatique**).",
            ],
            tip: "Un chiffre te semble faux après un import Texas ? Vérifie que tu regardes la **bonne saison**, et signale l'écran concerné à l'admin.",
          },
        ],
      },
      {
        id: "deux-livre",
        icon: "📦",
        title: "Les deux « livré » (ne pas confondre)",
        keywords: "livré différence bl entrepôt delivery interne récap réassort",
        sections: [
          {
            lines: [
              "**Livré = BL entrepôt** (Réassort, Statistiques) : ce que l'entrepôt a réellement expédié, remonté par les bons de livraison.",
              "**Livré = livraisons internes** (Récap clients) : les livraisons que **tu as générées** dans GestLog (statut Expédiée/Validée dépôt).",
            ],
            tip: "Ces deux chiffres peuvent **différer** : l'un vient de l'entrepôt, l'autre de ton flux de préparation. C'est normal.",
          },
        ],
      },
      {
        id: "depot-vs-livraisons",
        icon: "🔁",
        title: "Dépôt vs Livraisons",
        keywords: "dépôt livraisons différence interne ftp bl document",
        sections: [
          {
            lines: [
              "**Vue dépôt** : les livraisons **internes** que tu as générées, à valider physiquement.",
              "**Livraisons** : les **BL/factures importés de l'entrepôt** (via FTP), pour consultation.",
            ],
          },
        ],
      },
      {
        id: "ean-gammes",
        icon: "🔠",
        title: "EAN, gammes et tailles",
        keywords: "ean gamme taille grille code barre décodage couleur",
        sections: [
          {
            lines: [
              "Un **EAN** est le code-barres d'un produit précis (référence + couleur + taille). Il sert aux exports vers le dépôt et la caisse.",
              "Une **gamme** est un barème de tailles (ex. S,M,L,XL…). Les imports décodent les quantités grâce à la gamme du produit.",
              "La **couleur** est le code avant le tiret : « 208-Cognac » → **208**.",
            ],
          },
        ],
      },
      {
        id: "ca-origine",
        icon: "💶",
        title: "Le CA : d'où vient le chiffre ?",
        keywords: "ca chiffre affaires facturé commande montant différence statistiques comparaison",
        sections: [
          {
            lines: [
              "**Statistiques / Dashboard** : le CA = **montant facturé HT** (issu des factures).",
              "**Comparaison saisons / clients** : le CA = **montant de la commande** (ce qui a été commandé).",
            ],
            tip: "Deux angles différents : l'un mesure ce qui est **réellement facturé**, l'autre ce qui a été **commandé**. Compare toujours des écrans de même nature.",
          },
        ],
      },
    ],
  },
];
