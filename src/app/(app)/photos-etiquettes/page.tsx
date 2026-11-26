"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import { Topbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Camera, Download, Loader2, ScanText, Tag, Trash2, AlertTriangle } from "lucide-react";
import { naturalCompare, planNames, type PhotoItem } from "@/lib/photo-labels";

type Status = "pending" | "reading" | "done" | "error";

interface Photo extends PhotoItem {
  file: File;
  thumb: string;
  status: Status;
  error?: string;
}

const MAX_SIDE = 1600; // assez pour lire l'écriture, léger à envoyer
const CONCURRENCY = 3;

/** Réduit la photo dans le navigateur et la renvoie en JPEG base64 (sans en-tête data:). */
async function shrinkToBase64(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export default function PhotosEtiquettesPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reading, setReading] = useState(false);
  const [includeLabels, setIncludeLabels] = useState(false);
  const [zipping, setZipping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Libère les miniatures en quittant l'écran.
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.thumb)), []);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added: Photo[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name))
      .map((f) => ({
        id: `${f.name}-${f.size}-${f.lastModified}`,
        fileName: f.name,
        file: f,
        thumb: URL.createObjectURL(f),
        isLabel: false,
        status: "pending" as Status,
      }));
    setPhotos((prev) => {
      const known = new Set(prev.map((p) => p.id));
      return [...prev, ...added.filter((p) => !known.has(p.id))].sort((a, b) =>
        naturalCompare(a.fileName, b.fileName)
      );
    });
  };

  const update = (id: string, patch: Partial<Photo>) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  /** Lit une photo. Renvoie un message bloquant (clé IA absente) pour tout arrêter, sinon null. */
  const readOne = async (p: Photo): Promise<string | null> => {
    update(p.id, { status: "reading", error: undefined });
    let image: string;
    try {
      image = await shrinkToBase64(p.file);
    } catch {
      update(p.id, { status: "error", error: "Format illisible par le navigateur (HEIC ? exportez en JPEG)" });
      return null;
    }
    try {
      const res = await fetch("/api/photos-etiquettes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mediaType: "image/jpeg" }),
      });
      const d = await res.json();
      if (!res.ok) {
        update(p.id, { status: "error", error: d.error || "Lecture impossible" });
        return res.status === 503 ? d.error : null;
      }
      update(p.id, {
        status: "done",
        isLabel: d.isLabel,
        label: d.isLabel ? { reference: d.reference, colorCode: d.colorCode, colorName: d.colorName } : undefined,
      });
    } catch {
      update(p.id, { status: "error", error: "Serveur injoignable" });
    }
    return null;
  };

  const readAll = async () => {
    const queue = photosRef.current.filter((p) => p.status !== "done");
    if (!queue.length) return;
    setReading(true);
    let blocking: string | null = null;
    const worker = async () => {
      while (queue.length && !blocking) blocking = await readOne(queue.shift()!);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setReading(false);
    if (blocking) toast.error(blocking);
    else toast.success("Lecture terminée — vérifiez les étiquettes avant de télécharger");
  };

  const plan = useMemo(() => planNames(photos, includeLabels), [photos, includeLabels]);
  const planById = useMemo(() => new Map(plan.map((x) => [x.id, x])), [plan]);

  const labels = photos.filter((p) => p.isLabel);
  const orphans = photos.filter((p) => p.status === "done" && !p.isLabel && planById.get(p.id)?.groupBase === null);
  const unreadable = labels.filter((p) => !planById.get(p.id)?.groupBase);
  const errors = photos.filter((p) => p.status === "error");
  const allRead = photos.length > 0 && photos.every((p) => p.status === "done");
  const showWarnings = !reading && (orphans.length > 0 || unreadable.length > 0 || errors.length > 0);

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const p of photos) {
        const name = planById.get(p.id)?.newName;
        if (name) zip.file(name, p.file);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photos-renommees-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  const reset = () => {
    photos.forEach((p) => URL.revokeObjectURL(p.thumb));
    setPhotos([]);
  };

  return (
    <div>
      <Topbar title="Renommage photos" />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <PageHeader
          title="Renommage photos"
          description="Déposez une série de photos : chaque photo d'étiquette manuscrite (référence, puis code et nom de couleur) donne son nom aux photos du vêtement qui la suivent, jusqu'à l'étiquette suivante. Exemple : THTMANT_901-209-1.jpg. Les photos sont prises dans l'ordre de leur nom de fichier."
        />

        <Card>
          <CardContent className="space-y-4">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-10 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
            >
              <Camera className="h-10 w-10 text-muted-foreground/60" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {photos.length ? `${photos.length} photo(s) — cliquer pour en ajouter` : "Glisser les photos ici ou cliquer"}
                </p>
                <p className="text-xs text-muted-foreground">JPEG ou PNG, dans l’ordre de la prise de vue</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={readAll} disabled={!photos.length || reading || allRead} className="gap-2">
                {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
                Lire les étiquettes
              </Button>
              <Button
                onClick={downloadZip}
                variant="outline"
                disabled={!allRead || zipping || reading}
                className="gap-2"
              >
                {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Télécharger le ZIP renommé
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={includeLabels} onCheckedChange={setIncludeLabels} />
                Inclure les photos d’étiquette
              </label>
              {photos.length > 0 && (
                <Button variant="ghost" onClick={reset} disabled={reading} className="gap-2 ml-auto">
                  <Trash2 className="h-4 w-4" /> Vider
                </Button>
              )}
            </div>
            {reading && (
              <p className="text-xs text-muted-foreground">
                {photos.filter((p) => p.status === "done").length} / {photos.length} photos lues…
              </p>
            )}
          </CardContent>
        </Card>

        {showWarnings ? (
          <Card className="border-amber-200 bg-amber-50/40">
            <CardContent className="text-sm space-y-1">
              {errors.length > 0 && (
                <p>⚠️ {errors.length} photo(s) non lue(s) : relancez « Lire les étiquettes » ou indiquez à la main si c’est une étiquette.</p>
              )}
              {unreadable.length > 0 && (
                <p>⚠️ {unreadable.length} étiquette(s) sans référence lisible : complétez la référence à la main.</p>
              )}
              {orphans.length > 0 && (
                <p>⚠️ {orphans.length} photo(s) sans étiquette avant elles : elles garderont leur nom d’origine.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {photos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Photos ({photos.length}) — {labels.length} étiquette(s)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {photos.map((p) => {
                const planned = planById.get(p.id);
                return (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center gap-3 rounded-lg border p-2 ${p.isLabel ? "border-blue-300 bg-blue-50/50" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt="" className="h-16 w-16 rounded object-cover bg-muted" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-xs text-muted-foreground">{p.fileName}</p>
                      {p.isLabel ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={p.label?.reference ?? ""}
                            placeholder="Référence"
                            className="h-8 w-44 font-mono"
                            onChange={(e) =>
                              update(p.id, { label: { colorCode: "", colorName: "", ...p.label, reference: e.target.value } })
                            }
                          />
                          <Input
                            value={p.label?.colorCode ?? ""}
                            placeholder="Code couleur"
                            className="h-8 w-28 font-mono"
                            onChange={(e) =>
                              update(p.id, { label: { reference: "", colorName: "", ...p.label, colorCode: e.target.value } })
                            }
                          />
                          {p.label?.colorName && <span className="text-xs text-muted-foreground">{p.label.colorName}</span>}
                        </div>
                      ) : (
                        <p className="truncate font-mono text-sm">
                          {planned?.newName ?? "—"}
                          {planned?.groupBase === null && p.status === "done" && (
                            <Badge className="ml-2 bg-amber-100 text-amber-700">sans étiquette</Badge>
                          )}
                        </p>
                      )}
                      {p.error && <p className="text-xs text-red-600"><AlertTriangle className="inline h-3 w-3" /> {p.error}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {p.status === "reading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Button
                        size="sm"
                        variant={p.isLabel ? "default" : "outline"}
                        className="gap-1"
                        disabled={p.status === "reading"}
                        onClick={() =>
                          update(p.id, {
                            isLabel: !p.isLabel,
                            status: p.status === "error" ? "done" : p.status,
                            error: undefined,
                          })
                        }
                        title="Basculer étiquette / vêtement"
                      >
                        <Tag className="h-3.5 w-3.5" />
                        {p.isLabel ? "Étiquette" : "Vêtement"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
