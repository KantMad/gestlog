import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Support multiple export types via ?type= query param
const VALID_TYPES = ["customers", "products", "orders"] as const;
type ExportType = (typeof VALID_TYPES)[number];

function settingsKey(type: ExportType): string {
  return `btoc_export_fields_${type}`;
}

const DEFAULTS: Record<ExportType, Record<string, boolean>> = {
  customers: {
    email: true,
    firstName: true,
    lastName: true,
    company: true,
    phone: true,
    billingCity: true,
    billingCountry: true,
    shippingCity: true,
    shippingCountry: true,
    totalSpent: true,
    ordersCount: true,
  },
  products: {
    name: true,
    sku: true,
    type: true,
    category: true,
    price: true,
    regularPrice: true,
    salePrice: true,
    stockQuantity: true,
    stockStatus: true,
  },
  orders: {
    reference: true,
    sku: true,
    colorCode: true,
    colorBtob: true,
    color: true,
    category: true,
    categoryBtob: true,
    subCategoryBtob: true,
    sizeTypeBtob: true,
    totalQuantity: true,
    totalRevenue: true,
    sizes: true,
  },
};

async function loadFields(type: ExportType): Promise<Record<string, boolean>> {
  const key = settingsKey(type);

  // Try new key first
  let setting = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM "Setting" WHERE key = $1 LIMIT 1`,
    key
  );

  // Fallback: old key for backwards compat (customers only)
  if (setting.length === 0 && type === "customers") {
    setting = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value FROM "Setting" WHERE key = 'btoc_export_fields' LIMIT 1`
    );
  }

  if (setting.length > 0) {
    try {
      const saved = JSON.parse(setting[0].value);
      // Merge with defaults so new fields added later get their default value
      return { ...DEFAULTS[type], ...saved };
    } catch {
      return { ...DEFAULTS[type] };
    }
  }
  return { ...DEFAULTS[type] };
}

export async function GET(request: NextRequest) {
  try {
    const typeParam = request.nextUrl.searchParams.get("type");

    // If no type, return all types
    if (!typeParam) {
      const all: Record<string, Record<string, boolean>> = {};
      for (const t of VALID_TYPES) {
        all[t] = await loadFields(t);
      }
      return NextResponse.json({ fields: all });
    }

    if (!VALID_TYPES.includes(typeParam as ExportType)) {
      return NextResponse.json(
        { error: `Type invalide. Valeurs acceptees: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const fields = await loadFields(typeParam as ExportType);
    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fields, type } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Champ 'type' requis. Valeurs acceptees: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (!fields || typeof fields !== "object") {
      return NextResponse.json(
        { error: "Champ 'fields' requis (objet cle/booleen)" },
        { status: 400 }
      );
    }

    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== "boolean") {
        return NextResponse.json(
          { error: `Le champ '${k}' doit etre un booleen` },
          { status: 400 }
        );
      }
    }

    const key = settingsKey(type as ExportType);
    const jsonValue = JSON.stringify(fields);

    await prisma.$queryRawUnsafe(
      `INSERT INTO "Setting" (id, key, value, "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = $2, "updatedAt" = NOW()`,
      key,
      jsonValue
    );

    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json({ error: `Erreur: ${String(e)}` }, { status: 500 });
  }
}
