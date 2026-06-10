import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────
interface SizeTypeInfo {
  sizeTypeId: string;
  code: string;
  sizeToPosition: Map<string, number>; // sizeName(UPPER) → position
}

// ─── Build SizeType lookup structures ───────────────────
async function loadSizeTypes() {
  const mappings = await prisma.$queryRawUnsafe<
    { sizeTypeId: string; code: string; position: number; sizeName: string }[]
  >(
    `SELECT stm."sizeTypeId", st.code, stm.position, stm."sizeName"
     FROM "SizeTypeMapping" stm
     JOIN "SizeType" st ON st.id = stm."sizeTypeId"
     ORDER BY stm.position`
  );

  // sizeTypeId → SizeTypeInfo
  const sizeTypes = new Map<string, SizeTypeInfo>();
  // position → Set of all sizeNames at that position (for column headers)
  const positionSizes = new Map<number, Set<string>>();
  let maxPosition = 0;

  for (const m of mappings) {
    if (!sizeTypes.has(m.sizeTypeId)) {
      sizeTypes.set(m.sizeTypeId, {
        sizeTypeId: m.sizeTypeId,
        code: m.code,
        sizeToPosition: new Map(),
      });
    }
    sizeTypes.get(m.sizeTypeId)!.sizeToPosition.set(
      m.sizeName.toUpperCase(),
      m.position
    );

    if (!positionSizes.has(m.position)) positionSizes.set(m.position, new Set());
    positionSizes.get(m.position)!.add(m.sizeName.toUpperCase());
    maxPosition = Math.max(maxPosition, m.position);
  }

  return { sizeTypes, positionSizes, maxPosition };
}

// ─── Determine which SizeType matches a sizeScale ───────
// The sizeScale order must match the position order in the SizeType
// (e.g. sizeScale "M,L,XL,S" means M=pos1, L=pos2, XL=pos3, S=pos4 → HAU)
function findSizeType(
  sizes: string[],
  sizeTypes: Map<string, SizeTypeInfo>
): SizeTypeInfo | null {
  // Pass 1: match with order validation (strict)
  for (const st of sizeTypes.values()) {
    const allFound = sizes.every((s) => st.sizeToPosition.has(s));
    if (!allFound) continue;

    // Verify the sizeScale order matches position order
    const positions = sizes.map((s) => st.sizeToPosition.get(s)!);
    const isOrdered = positions.every(
      (p, i) => i === 0 || p > positions[i - 1]
    );
    if (isOrdered) return st;
  }

  // Pass 2: fallback without order check — prefer most specific
  let bestMatch: SizeTypeInfo | null = null;
  let bestScore = 0;
  for (const st of sizeTypes.values()) {
    const matched = sizes.filter((s) => st.sizeToPosition.has(s)).length;
    if (matched === sizes.length) {
      if (
        matched > bestScore ||
        (matched === bestScore &&
          bestMatch &&
          st.sizeToPosition.size < bestMatch.sizeToPosition.size)
      ) {
        bestScore = matched;
        bestMatch = st;
      }
    }
  }
  return bestMatch;
}

// ─── Build sorted column headers ─────────────────────────
function buildSizeColumns(
  positionSizes: Map<number, Set<string>>,
  maxPosition: number
) {
  const columns: { position: number; header: string }[] = [];
  for (let pos = 1; pos <= maxPosition; pos++) {
    const sizes = positionSizes.get(pos);
    if (sizes && sizes.size > 0) {
      // Sort: numbers first (ascending), then alpha
      const sorted = [...sizes].sort((a, b) => {
        const aNum = /^\d+$/.test(a);
        const bNum = /^\d+$/.test(b);
        if (aNum && bNum) return parseInt(a) - parseInt(b);
        if (aNum) return -1;
        if (bNum) return 1;
        return a.localeCompare(b);
      });
      columns.push({ position: pos, header: sorted.join("/") });
    }
  }
  return columns;
}

// ─── Main handler ────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const productRef = params.get("productRef") || params.get("productName");
    const color = params.get("color");
    const size = params.get("size");
    const customerName = params.get("customerName");

    // ─── Filters ──────────────────────────────────────────
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let idx = 1;

    if (dateFrom) {
      conditions.push(`o."orderDate" >= $${idx}`);
      queryParams.push(new Date(dateFrom));
      idx++;
    }
    if (dateTo) {
      conditions.push(`o."orderDate" <= $${idx}`);
      queryParams.push(new Date(dateTo));
      idx++;
    }
    if (productRef) {
      conditions.push(`(bp.sku ILIKE $${idx} OR SPLIT_PART(ol.sku, '-', 1) ILIKE $${idx})`);
      queryParams.push(`%${productRef}%`);
      idx++;
    }
    if (color) {
      conditions.push(
        `(SPLIT_PART(ol.sku, '-', 2) = $${idx} OR ol.color = $${idx})`
      );
      queryParams.push(color);
      idx++;
    }
    if (size) {
      conditions.push(`UPPER(ol.size) = UPPER($${idx})`);
      queryParams.push(size);
      idx++;
    }
    if (customerName) {
      conditions.push(`o."customerName" ILIKE $${idx}`);
      queryParams.push(`%${customerName}%`);
      idx++;
    }

    const where =
      conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // ─── Step 1: Load SizeType system ─────────────────────
    const { sizeTypes, positionSizes, maxPosition } = await loadSizeTypes();
    const sizeColumns = buildSizeColumns(positionSizes, maxPosition);

    // ─── Step 2: Load BtoB products — ref → sizeType + color info ──
    const btobProducts = await prisma.$queryRawUnsafe<
      {
        reference: string;
        color: string;
        colorCode: string | null;
        sizeScale: string;
        category: string | null;
        subCategory: string | null;
      }[]
    >(
      `SELECT reference, color, "colorCode", "sizeScale", category, "subCategory"
       FROM "Product"
       WHERE "sizeScale" IS NOT NULL AND "sizeScale" != ''`
    );

    // The first character of a reference is a SEASON code (O, P, N, Q, R…).
    // The same garment exists across seasons with the same "body" (ref minus
    // the season char). BtoC sales may reference a season not present in BtoB,
    // so we index by both the exact reference AND the season-agnostic body and
    // fall back to body matching to recover cross-season equivalences.
    const bodyOf = (ref: string) => (ref.length > 1 ? ref.slice(1) : ref);

    // Maps: exact reference → … and body → … (body used as fallback)
    const refSizeTypeMap = new Map<string, SizeTypeInfo>();
    const bodySizeTypeMap = new Map<string, SizeTypeInfo>();
    const refBestScale = new Map<string, number>(); // longest scale per ref
    const bodyBestScale = new Map<string, number>(); // longest scale per body
    for (const prod of btobProducts) {
      const sizes = prod.sizeScale
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (sizes.length === 0) continue;

      const body = bodyOf(prod.reference);
      const currentBest = refBestScale.get(prod.reference) || 0;
      if (sizes.length > currentBest) {
        const st = findSizeType(sizes, sizeTypes);
        if (st) {
          refSizeTypeMap.set(prod.reference, st);
          refBestScale.set(prod.reference, sizes.length);
          if (sizes.length > (bodyBestScale.get(body) || 0)) {
            bodySizeTypeMap.set(body, st);
            bodyBestScale.set(body, sizes.length);
          }
        }
      }
    }

    // Color: `reference|||colorNum` → color name, plus `body|||colorNum` fallback
    const btobColorMap = new Map<string, string>();
    const bodyColorMap = new Map<string, string>();
    // Category: reference → { category, subCategory }, plus body fallback
    const btobCategoryMap = new Map<string, { category: string; subCategory: string }>();
    const bodyCategoryMap = new Map<string, { category: string; subCategory: string }>();
    for (const prod of btobProducts) {
      const colorNum = prod.colorCode
        ? prod.colorCode.includes("-")
          ? prod.colorCode.split("-").pop()!
          : prod.colorCode
        : prod.color;
      const body = bodyOf(prod.reference);
      btobColorMap.set(`${prod.reference}|||${colorNum}`, prod.color);
      if (!bodyColorMap.has(`${body}|||${colorNum}`)) {
        bodyColorMap.set(`${body}|||${colorNum}`, prod.color);
      }

      if (prod.category || prod.subCategory) {
        const cat = {
          category: prod.category || "",
          subCategory: prod.subCategory || "",
        };
        if (!btobCategoryMap.has(prod.reference)) btobCategoryMap.set(prod.reference, cat);
        if (!bodyCategoryMap.has(body)) bodyCategoryMap.set(body, cat);
      }
    }

    // Resolvers: exact reference first, then season-agnostic body
    const resolveSizeType = (ref: string) =>
      refSizeTypeMap.get(ref) || bodySizeTypeMap.get(bodyOf(ref));
    const resolveColor = (ref: string, colorNum: string) =>
      btobColorMap.get(`${ref}|||${colorNum}`) ||
      bodyColorMap.get(`${bodyOf(ref)}|||${colorNum}`) ||
      "";
    const resolveCategory = (ref: string) =>
      btobCategoryMap.get(ref) || bodyCategoryMap.get(bodyOf(ref));

    // ─── Step 3: Query BtoC order lines ───────────────────
    const rows = await prisma.$queryRawUnsafe<
      {
        productName: string;
        parentRef: string;
        colorNum: string | null;
        btocColor: string | null;
        btocCategory: string | null;
        size: string | null;
        quantity: bigint;
        revenue: number;
      }[]
    >(
      `SELECT
        COALESCE(bp.name, ol.name) AS "productName",
        SPLIT_PART(ol.sku, '-', 1) AS "parentRef",
        SPLIT_PART(ol.sku, '-', 2) AS "colorNum",
        ol.color AS "btocColor",
        bp.category AS "btocCategory",
        COALESCE(NULLIF(UPPER(ol.size), ''), UPPER(SPLIT_PART(ol.sku, '-', 3))) AS size,
        SUM(ol.quantity) AS quantity,
        SUM(ol.total) AS revenue
       FROM "BtocOrderLine" ol
       JOIN "BtocOrder" o ON o.id = ol."orderId"
       LEFT JOIN "BtocProduct" bp ON bp.sku = SPLIT_PART(ol.sku, '-', 1)
       ${where}
       GROUP BY
         COALESCE(bp.name, ol.name),
         SPLIT_PART(ol.sku, '-', 1),
         SPLIT_PART(ol.sku, '-', 2),
         ol.color,
         bp.category,
         COALESCE(NULLIF(UPPER(ol.size), ''), UPPER(SPLIT_PART(ol.sku, '-', 3)))
       ORDER BY "productName", "colorNum"`,
      ...queryParams
    );

    // ─── Step 4: Pivot by reference + colorNum ────────────
    interface PivotEntry {
      productName: string;
      parentRef: string;
      colorNum: string;
      btocColor: string;
      btobColor: string;
      btocCategory: string;
      btobCategory: string;
      btobSubCategory: string;
      sizeTypeCode: string;
      totalQuantity: number;
      totalRevenue: number;
      // position → quantity (keyed by position number)
      quantities: Record<number, number>;
    }

    const pivotMap = new Map<string, PivotEntry>();

    for (const row of rows) {
      const ref = row.parentRef || "";
      const colorNum = row.colorNum || "";
      const key = `${ref}|||${colorNum}`;

      if (!pivotMap.has(key)) {
        // Look up BtoB color name (exact ref, then season-agnostic body)
        const btobColor = resolveColor(ref, colorNum);

        // Get sizeType for this reference (with body fallback)
        const sizeType = resolveSizeType(ref);

        // Get BtoB category/subcategory (with body fallback)
        const catInfo = resolveCategory(ref);

        pivotMap.set(key, {
          productName: row.productName,
          parentRef: ref,
          colorNum,
          btocColor: row.btocColor || "",
          btobColor,
          btocCategory: row.btocCategory || "",
          btobCategory: catInfo?.category || "",
          btobSubCategory: catInfo?.subCategory || "",
          sizeTypeCode: sizeType?.code || "",
          totalQuantity: 0,
          totalRevenue: 0,
          quantities: {},
        });
      }

      const entry = pivotMap.get(key)!;
      entry.totalQuantity += Number(row.quantity);
      entry.totalRevenue += Number(row.revenue);

      // Map the size to a position. Prefer the product's resolved sizeType,
      // but if that sizeType doesn't contain this size (e.g. "TU" on a product
      // resolved to another type), fall back to any sizeType that has it.
      if (row.size) {
        const sizeType = resolveSizeType(ref);
        let pos = sizeType?.sizeToPosition.get(row.size);
        if (pos === undefined) {
          for (const st of sizeTypes.values()) {
            const p = st.sizeToPosition.get(row.size);
            if (p !== undefined) {
              pos = p;
              break;
            }
          }
        }
        if (pos !== undefined) {
          entry.quantities[pos] = (entry.quantities[pos] || 0) + Number(row.quantity);
        }
      }
    }

    // ─── Step 5: Fill all positions for each row with 0 ───
    const pivotedRows = Array.from(pivotMap.values()).map((entry) => {
      const sizeType = resolveSizeType(entry.parentRef);
      if (sizeType) {
        // Fill all positions of this sizeType with 0 if missing
        for (const pos of sizeType.sizeToPosition.values()) {
          if (!(pos in entry.quantities)) {
            entry.quantities[pos] = 0;
          }
        }
      }
      entry.totalRevenue = Math.round(entry.totalRevenue * 100) / 100;
      return entry;
    });

    // ─── Available filter values ──────────────────────────
    const availableColors = await prisma.$queryRawUnsafe<{ color: string }[]>(
      `SELECT DISTINCT color FROM "BtocOrderLine"
       WHERE color IS NOT NULL AND color != '' ORDER BY color`
    );
    const availableSizes = await prisma.$queryRawUnsafe<{ size: string }[]>(
      `SELECT DISTINCT UPPER(size) AS size FROM "BtocOrderLine"
       WHERE size IS NOT NULL AND size != '' ORDER BY size`
    );

    return NextResponse.json({
      sizeColumns,
      rows: pivotedRows,
      total: pivotedRows.length,
      availableColors: availableColors.map((c) => c.color),
      availableSizes: availableSizes.map((s) => s.size),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
