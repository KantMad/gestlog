"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportPreviewProps {
  headers: string[];
  rows: Record<string, string | number | null>[];
  maxRows?: number;
}

export function ImportPreview({ headers, rows, maxRows = 5 }: ImportPreviewProps) {
  const displayRows = rows.slice(0, maxRows);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Aperçu des données</p>
        <p className="text-xs text-muted-foreground">
          {rows.length} ligne{rows.length > 1 ? "s" : ""} détectée{rows.length > 1 ? "s" : ""}
        </p>
      </div>
      <ScrollArea className="rounded-md border">
        <div className="max-h-64 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.slice(0, 12).map((h) => (
                  <TableHead key={h} className="text-xs whitespace-nowrap">
                    {h}
                  </TableHead>
                ))}
                {headers.length > 12 && (
                  <TableHead className="text-xs">
                    +{headers.length - 12}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row, i) => (
                <TableRow key={i}>
                  {headers.slice(0, 12).map((h) => (
                    <TableCell key={h} className="text-xs whitespace-nowrap">
                      {row[h] !== null && row[h] !== undefined
                        ? String(row[h])
                        : "—"}
                    </TableCell>
                  ))}
                  {headers.length > 12 && (
                    <TableCell className="text-xs text-muted-foreground">
                      ...
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
      {rows.length > maxRows && (
        <p className="text-xs text-muted-foreground text-center">
          ... et {rows.length - maxRows} autres lignes
        </p>
      )}
    </div>
  );
}
