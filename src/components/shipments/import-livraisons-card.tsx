"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, TriangleAlert, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

// Import manuel d'un fichier de livraisons entrepôt (export Texas « CodesBarres »).
//
// ⚠️ Rien n'est écrit sans un aperçu préalable : le fichier part d'abord en `dryRun`, on
// montre ce qui va être créé ou remplacé, et l'écriture demande un second clic. Un
// fichier de livraisons touche des centaines de documents d'un coup.

interface Apercu {
  dryRun: boolean;
  documents: number;
  documentsFichier: number;
  pieces: number;
  lignes: number;
  lignesIgnorees: number;
  clients: number;
  dejaEnBase: string[];
  parTraitement: Record<string, { documents: number; pieces: number }>;
  du: string | null;
  au: string | null;
  tioOrderNumber: string | null;
  ecrits?: number;
  remplaces?: number;
  errors?: string[];
}

export function ImportLivraisonsCard({ onImported }: { onImported: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [resultat, setResultat] = useState<Apercu | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setApercu(null);
    setResultat(null);
    setTypes([]);
  };

  const envoyer = useCallback(async (f: File, dryRun: boolean, traitements: string[]) => {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("docType", "BL");
    if (dryRun) fd.append("dryRun", "1");
    if (traitements.length) fd.append("treatments", traitements.join(","));
    const res = await fetch("/api/shipments/import", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Import impossible");
    return json.data as Apercu;
  }, []);

  const choisir = async (f: File) => {
    setFile(f);
    setResultat(null);
    setBusy(true);
    try {
      const d = await envoyer(f, true, []);
      setApercu(d);
      // Tout coché par défaut : on ne décide pas à la place de l'exploitant.
      setTypes(Object.keys(d.parTraitement));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      reset();
    } finally {
      setBusy(false);
    }
  };

  const rejouerApercu = async (t: string[]) => {
    if (!file) return;
    setTypes(t);
    setBusy(true);
    try {
      setApercu(await envoyer(file, true, t));
    } catch {
      /* l'aperçu précédent reste affiché */
    } finally {
      setBusy(false);
    }
  };

  const importer = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const d = await envoyer(file, false, types);
      setResultat(d);
      toast.success(`${d.ecrits} document(s) importé(s) — ${formatNumber(d.pieces)} pièces`);
      onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ouvert) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOuvert(true)} className="gap-2">
        <Upload className="h-4 w-4" />
        Importer un fichier de livraisons
      </Button>
    );
  }

  const a = resultat ?? apercu;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Importer un fichier de livraisons</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOuvert(false);
            }}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Fermer
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!a && (
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
              busy ? "opacity-60" : "hover:bg-muted/40"
            )}
          >
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choisir un fichier .xlsx"}</span>
            <span className="text-xs text-muted-foreground">
              {busy ? "Analyse en cours…" : "Export « CodesBarres » de l'entrepôt, un ou plusieurs BL"}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) choisir(f);
              }}
            />
          </label>
        )}

        {a && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Chiffre valeur={a.documents} legende="documents" />
              <Chiffre valeur={a.pieces} legende="pièces" />
              <Chiffre valeur={a.lignes} legende="lignes" />
              <Chiffre valeur={a.clients} legende="boutiques" />
            </div>

            <p className="text-sm text-muted-foreground">
              {a.du && a.au
                ? `Livraisons du ${fr(a.du)} au ${fr(a.au)}.`
                : "Aucune date de livraison lisible."}{" "}
              {a.documentsFichier !== a.documents &&
                `${a.documentsFichier} document(s) dans le fichier, ${a.documents} retenu(s).`}
            </p>

            {Object.keys(a.parTraitement).length > 1 && !resultat && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">Types de traitement présents</p>
                {Object.entries(a.parTraitement).map(([t, v]) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={types.includes(t)}
                      disabled={busy}
                      onChange={(e) =>
                        rejouerApercu(e.target.checked ? [...types, t] : types.filter((x) => x !== t))
                      }
                      className="h-4 w-4"
                    />
                    <span className="font-mono">{t}</span>
                    <span className="text-muted-foreground">
                      {v.documents} document(s) · {formatNumber(v.pieces)} pièces
                    </span>
                  </label>
                ))}
              </div>
            )}

            {a.dejaEnBase.length > 0 && (
              <Alerte ton="amber">
                <strong>{a.dejaEnBase.length} document(s) déjà en base</strong> seront{" "}
                <strong>remplacés</strong> — leurs lignes sont réécrites, jamais doublées :{" "}
                {a.dejaEnBase.slice(0, 10).join(", ")}
                {a.dejaEnBase.length > 10 && "…"}
              </Alerte>
            )}

            {a.lignesIgnorees > 0 && (
              <Alerte ton="amber">
                <strong>{formatNumber(a.lignesIgnorees)} ligne(s) sans « N° Document »</strong> :
                impossible de les rattacher, elles ne seront pas importées.
              </Alerte>
            )}

            {!a.tioOrderNumber && (
              <Alerte ton="sky">
                Le nom du fichier ne porte pas de référence de commande (<code>IS-…</code> ou{" "}
                <code>PO-…</code>) : ces documents seront rattachés aux boutiques par leur{" "}
                <strong>code client</strong>, mais pas à une commande TIO précise.
              </Alerte>
            )}

            {resultat ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{resultat.ecrits} document(s) importé(s)</strong>
                    {(resultat.remplaces ?? 0) > 0 && `, dont ${resultat.remplaces} remplacé(s)`}.
                  </span>
                </div>
                {(resultat.errors?.length ?? 0) > 0 && (
                  <Alerte ton="red">
                    {resultat.errors!.length} erreur(s) : {resultat.errors!.slice(0, 5).join(" · ")}
                  </Alerte>
                )}
                <Button variant="outline" size="sm" onClick={reset}>
                  Importer un autre fichier
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button onClick={importer} disabled={busy || a.documents === 0} className="gap-2">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Importer {a.documents} document(s)
                </Button>
                <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const fr = (iso: string) => iso.split("-").reverse().join("/");

function Chiffre({ valeur, legende }: { valeur: number; legende: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xl font-bold tabular-nums">{formatNumber(valeur)}</div>
      <p className="text-xs text-muted-foreground">{legende}</p>
    </div>
  );
}

function Alerte({ ton, children }: { ton: "amber" | "red" | "sky"; children: React.ReactNode }) {
  const styles = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    red: "border-red-300 bg-red-50 text-red-900",
    sky: "border-sky-300 bg-sky-50 text-sky-900",
  }[ton];
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", styles)}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
