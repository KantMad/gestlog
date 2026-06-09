"use client";

import { useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ClientWithSeason } from "@/lib/types";

interface ClientConfigTableProps {
  clients: ClientWithSeason[];
  onUpdate: () => void;
}

function InlineEditCell({
  value,
  seasonId,
  field,
  type = "number",
  min,
  max,
  suffix,
  onSaved,
}: {
  value: number;
  seasonId: string;
  field: string;
  type?: string;
  min?: number;
  max?: number;
  suffix?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    const numVal = parseFloat(editValue);
    if (isNaN(numVal) || numVal === value) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/client-seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: numVal }),
      });
      if (!res.ok) throw new Error();
      onSaved();
      setEditing(false);
    } catch {
      toast.error("Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  }, [editValue, value, seasonId, field, onSaved]);

  if (editing) {
    return (
      <input
        type={type}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        min={min}
        max={max}
        disabled={saving}
        autoFocus
        className="w-20 rounded border border-primary bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setEditValue(String(value));
        setEditing(true);
      }}
      className="rounded px-2 py-1 text-sm hover:bg-muted transition-colors cursor-pointer"
    >
      {value}
      {suffix}
    </button>
  );
}

export function ClientConfigTable({ clients, onUpdate }: ClientConfigTableProps) {
  const handleToggleActive = async (seasonId: string, isActive: boolean) => {
    try {
      const res = await fetch(`/api/client-seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error();
      onUpdate();
    } catch {
      toast.error("Erreur de sauvegarde");
    }
  };

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Aucun client pour cette saison. Importez des commandes clients pour
          les voir apparaître ici.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Rang</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Nom</TableHead>
            <TableHead className="text-center">% max commande</TableHead>
            <TableHead className="text-center">% max ligne</TableHead>
            <TableHead className="text-center">Seuil min.</TableHead>
            <TableHead className="text-center">Rotation</TableHead>
            <TableHead className="text-center">Actif</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const s = client.season;
            if (!s) return null;
            return (
              <TableRow
                key={client.id}
                className={cn(!s.isActive && "opacity-50")}
              >
                <TableCell>
                  <InlineEditCell
                    value={s.ranking}
                    seasonId={s.id}
                    field="ranking"
                    min={1}
                    onSaved={onUpdate}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono">
                    {client.code}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{client.name}</TableCell>
                <TableCell className="text-center">
                  <InlineEditCell
                    value={s.maxReductionOrder}
                    seasonId={s.id}
                    field="maxReductionOrder"
                    min={0}
                    max={100}
                    suffix="%"
                    onSaved={onUpdate}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <InlineEditCell
                    value={s.maxReductionLine}
                    seasonId={s.id}
                    field="maxReductionLine"
                    min={0}
                    max={100}
                    suffix="%"
                    onSaved={onUpdate}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <InlineEditCell
                    value={s.minDeliveryThreshold}
                    seasonId={s.id}
                    field="minDeliveryThreshold"
                    min={0}
                    onSaved={onUpdate}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <InlineEditCell
                    value={s.rotationScore}
                    seasonId={s.id}
                    field="rotationScore"
                    min={0}
                    onSaved={onUpdate}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={s.isActive}
                    onCheckedChange={(checked) =>
                      handleToggleActive(s.id, checked)
                    }
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
