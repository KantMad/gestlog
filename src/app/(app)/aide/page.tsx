"use client";

import { useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, ChevronRight, Lightbulb, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { HELP_THEMES, type HelpArticle } from "./content";

// Rendu d'une ligne avec **gras** inline (petit parseur maison, contenu maîtrisé).
function RichLine({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function ArticleCard({ article, themeTitle }: { article: HelpArticle; themeTitle?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-lg">{article.icon}</span>
          <span className="font-medium">{article.title}</span>
        </span>
        <div className="flex items-center gap-2">
          {themeTitle && (
            <span className="hidden rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">
              {themeTitle}
            </span>
          )}
          <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t px-4 py-4 text-sm text-muted-foreground">
          {article.sections.map((s, i) => (
            <div key={i} className="space-y-1.5">
              {s.h && <p className="font-semibold text-foreground">{s.h}</p>}
              <ul className="space-y-1">
                {s.lines.map((l, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>
                      <RichLine text={l} />
                    </span>
                  </li>
                ))}
              </ul>
              {s.tip && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <RichLine text={s.tip} />
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AidePage() {
  const [query, setQuery] = useState("");
  const [activeTheme, setActiveTheme] = useState<string | null>(null);

  // Index de recherche : titre + mots-clés + tout le texte de l'article.
  const searchIndex = useMemo(
    () =>
      HELP_THEMES.flatMap((t) =>
        t.articles.map((a) => ({
          article: a,
          themeId: t.id,
          themeTitle: `${t.emoji} ${t.title}`,
          hay: (
            a.title +
            " " +
            a.keywords +
            " " +
            a.sections.map((s) => (s.h || "") + " " + s.lines.join(" ") + " " + (s.tip || "")).join(" ")
          ).toLowerCase(),
        }))
      ),
    []
  );

  const q = query.trim().toLowerCase();
  const results = q
    ? searchIndex.filter((r) => q.split(/\s+/).every((w) => r.hay.includes(w)))
    : [];

  const theme = HELP_THEMES.find((t) => t.id === activeTheme) || null;

  return (
    <div>
      <Topbar title="Centre d'aide" />
      <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Hero + recherche */}
        <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <LifeBuoy className="h-4 w-4" />
            Centre d&apos;aide GestLog
          </div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Comment peut-on t&apos;aider ? 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cherche un mot-clé, ou explore les thématiques. Chaque fiche explique{" "}
            <strong>à quoi ça sert</strong>, <strong>comment faire</strong> et{" "}
            <strong>ce qu&apos;il faut savoir</strong>.
          </p>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveTheme(null);
              }}
              placeholder="Rechercher (ex. « réception », « Texas », « surplus », « facturé »)…"
              className="h-11 pl-9 text-base"
            />
          </div>
        </div>

        {/* Résultats de recherche */}
        {q ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {results.length} résultat{results.length > 1 ? "s" : ""} pour «&nbsp;{query}&nbsp;»
            </p>
            {results.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Rien trouvé. Essaie un autre mot (ex. « répartition », « EAN », « dépôt »), ou
                  explore les thématiques en effaçant la recherche.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {results.map((r) => (
                  <ArticleCard key={r.article.id} article={r.article} themeTitle={r.themeTitle} />
                ))}
              </div>
            )}
          </div>
        ) : theme ? (
          /* Une thématique ouverte */
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setActiveTheme(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Toutes les thématiques
            </button>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{theme.emoji}</span>
              <div>
                <h2 className="text-xl font-bold">{theme.title}</h2>
                <p className="text-sm text-muted-foreground">{theme.blurb}</p>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              {theme.articles.map((a) => (
                <ArticleCard key={a.id} article={a} />
              ))}
            </div>
          </div>
        ) : (
          /* Grille des thématiques */
          <div className="grid gap-3 sm:grid-cols-2">
            {HELP_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTheme(t.id)}
                className="group rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{t.emoji}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <p className="mt-2 font-semibold">{t.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t.blurb}</p>
                <p className="mt-2 text-xs text-muted-foreground/70">
                  {t.articles.length} fiche{t.articles.length > 1 ? "s" : ""}
                </p>
              </button>
            ))}
          </div>
        )}

        <p className="pt-2 text-center text-xs text-muted-foreground">
          Une question sans réponse ici ? Signale-la à l&apos;administrateur de l&apos;outil.
        </p>
      </div>
    </div>
  );
}
