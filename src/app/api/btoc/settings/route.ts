import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SETTINGS_KEY = "btoc_export_fields";

const DEFAULT_FIELDS: Record<string, boolean> = {
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
};

export async function GET() {
  try {
    const setting = await prisma.$queryRawUnsafe<
      { value: string }[]
    >(
      `SELECT value FROM "Setting" WHERE key = $1 LIMIT 1`,
      SETTINGS_KEY
    );

    let fields: Record<string, boolean>;
    if (setting.length > 0) {
      try {
        fields = JSON.parse(setting[0].value);
      } catch {
        fields = { ...DEFAULT_FIELDS };
      }
    } else {
      fields = { ...DEFAULT_FIELDS };
    }

    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fields } = body;

    if (!fields || typeof fields !== "object") {
      return NextResponse.json(
        { error: "Champ 'fields' requis (objet clé/booléen)" },
        { status: 400 }
      );
    }

    // Validate that all values are booleans
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== "boolean") {
        return NextResponse.json(
          { error: `Le champ '${key}' doit être un booléen` },
          { status: 400 }
        );
      }
    }

    const jsonValue = JSON.stringify(fields);

    // Upsert the setting
    await prisma.$queryRawUnsafe(
      `INSERT INTO "Setting" (id, key, value, "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = $2, "updatedAt" = NOW()`,
      SETTINGS_KEY,
      jsonValue
    );

    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur: ${String(e)}` },
      { status: 500 }
    );
  }
}
