"use client";

import { Label } from "@/components/ui/label";

interface ColumnMapperProps {
  headers: string[];
  fields: { key: string; label: string; required?: boolean }[];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  /** Première valeur de chaque colonne — sert à nommer celles qui n'ont pas de titre. */
  samples?: Record<string, string>;
}

// ⚠️ Une colonne sans titre ressort de la lecture du tableur sous le nom `__EMPTY`
// (`__EMPTY_1`, `__EMPTY_2`…). *Cas réel : dans l'export Texas « CodesBarres », le
// FOURNISSEUR est en 79ᵉ colonne et son en-tête est vide.* Laisser « __EMPTY » dans la
// liste, c'est laisser l'utilisateur devant un choix qu'il ne peut pas faire.
const SANS_TITRE = /^__EMPTY(_\d+)?$/;

export function libelleColonne(header: string, sample?: string): string {
  const m = SANS_TITRE.exec(header);
  if (!m) return header;
  // `__EMPTY` est la 1re sans titre, `__EMPTY_1` la 2e, etc.
  const rang = m[1] ? Number(m[1].slice(1)) + 1 : 0;
  const base = `(colonne sans titre${rang ? ` ${rang}` : ""})`;
  return sample ? `${base} — ex. « ${sample} »` : base;
}

export function ColumnMapper({
  headers,
  fields,
  mapping,
  onMappingChange,
  samples,
}: ColumnMapperProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Correspondance des colonnes</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-xs">
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <select
              value={mapping[field.key] || ""}
              onChange={(e) =>
                onMappingChange({ ...mapping, [field.key]: e.target.value })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Non mappé —</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {libelleColonne(h, samples?.[h])}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

export function autoDetectMapping(
  headers: string[],
  patterns: Record<string, RegExp[]>
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [field, regexes] of Object.entries(patterns)) {
    const match = headers.find((h) =>
      regexes.some((r) => r.test(h.toLowerCase()))
    );
    if (match) mapping[field] = match;
  }
  return mapping;
}

export const CLIENT_ORDER_PATTERNS: Record<string, RegExp[]> = {
  orderNumber: [/n°.*commande/i, /order.*n/i, /commande/i, /^n°$/i],
  clientCode: [/code.*client/i, /client.*code/i, /^code$/i],
  clientName: [/nom.*client/i, /client.*name/i, /raison.*sociale/i, /^client$/i, /^nom$/i],
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /^r[eé]f$/i, /article/i],
  color: [/couleur/i, /color/i, /coloris/i],
  colorCode: [/code.*couleur/i, /color.*code/i],
  catalog: [/catalogue/i, /catalog/i, /collection/i, /^cat\.$/i],
  status: [/statut/i, /status/i, /^etat$/i, /^état$/i],
  deliveryWindow: [/fen[eê]tre/i, /livraison/i, /delivery.*window/i, /semaine/i],
  category: [/cat[eé]gorie/i, /category/i, /^cat$/i, /famille/i],
  sizeTypeCode: [/type.*taille/i, /size.*type/i, /grille/i, /^type$/i],
};

export const SUPPLIER_ORDER_PATTERNS: Record<string, RegExp[]> = {
  orderNumber: [/n°.*commande/i, /order/i, /commande/i],
  supplierCode: [/code.*fourn/i, /fourn.*code/i, /^code$/i],
  supplierName: [/nom.*fourn/i, /fournisseur/i, /supplier/i],
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /article/i],
  color: [/couleur/i, /color/i, /coloris/i],
};

export const RECEPTION_PATTERNS: Record<string, RegExp[]> = {
  supplierOrderNumber: [/n°.*commande/i, /order/i, /commande/i],
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /article/i],
  color: [/couleur/i, /color/i, /coloris/i],
};

export const STOCK_PATTERNS: Record<string, RegExp[]> = {
  reference: [/r[eé]f[eé]rence/i, /^ref$/i, /article/i],
  color: [/couleur/i, /color/i, /coloris/i],
};
