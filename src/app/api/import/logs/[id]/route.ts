import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

// DELETE — Supprime un import et les données qu'il a créées (taguées par importLogId).
//  - RECEPTION      : supprime la/les réception(s) (cascade lignes) + recalcule le
//                     statut de la commande fournisseur rattachée.
//  - SUPPLIER_ORDER : supprime la/les commande(s) fournisseur (cascade lignes ET
//                     réceptions rattachées).
//  - CLIENT_ORDER   : supprime la/les commande(s) client (cascade lignes).
//  - STOCK          : supprime les entrées de stock de cet import.
// Les entités importées AVANT le suivi (importLogId absent) ne sont pas retrouvées.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const log = await prisma.importLog.findUnique({ where: { id } });
    if (!log) {
      return NextResponse.json({ error: "Import introuvable" }, { status: 404 });
    }

    let deleted = 0;
    let detail = "";

    switch (log.importType) {
      case "RECEPTION": {
        const recs = await prisma.supplierReception.findMany({
          where: { importLogId: id },
          select: { id: true, supplierOrderId: true },
        });
        const orderIds = [...new Set(recs.map((r) => r.supplierOrderId))];
        const res = await prisma.supplierReception.deleteMany({ where: { importLogId: id } });
        deleted = res.count;
        // Recalcule le statut des commandes concernées (plus de réception → EN_ATTENTE).
        for (const oid of orderIds) {
          const remaining = await prisma.supplierReception.count({ where: { supplierOrderId: oid } });
          await prisma.supplierOrder.update({
            where: { id: oid },
            data: { status: remaining > 0 ? "PARTIEL" : "EN_ATTENTE" },
          });
        }
        detail = `${deleted} réception(s) supprimée(s)`;
        break;
      }
      case "SUPPLIER_ORDER": {
        const res = await prisma.supplierOrder.deleteMany({ where: { importLogId: id } });
        deleted = res.count;
        detail = `${deleted} commande(s) fournisseur supprimée(s)`;
        break;
      }
      case "CLIENT_ORDER": {
        const res = await prisma.clientOrder.deleteMany({ where: { importLogId: id } });
        deleted = res.count;
        detail = `${deleted} commande(s) client supprimée(s)`;
        break;
      }
      case "STOCK": {
        const res = await prisma.stockEntry.deleteMany({ where: { importLogId: id } });
        deleted = res.count;
        detail = `${deleted} entrée(s) de stock supprimée(s)`;
        break;
      }
      default:
        return NextResponse.json(
          { error: `Type d'import « ${log.importType} » non supprimable.` },
          { status: 400 }
        );
    }

    await prisma.importLog.delete({ where: { id } });

    return NextResponse.json({ data: { deleted, detail, importType: log.importType } });
  } catch (e) {
    return handleApiError(e, "api/import/logs/[id]");
  }
}
