import { NextResponse } from "next/server";
import { getAccount, BrevoError } from "@/lib/brevo";

/**
 * Health-check Brevo : vérifie que BREVO_API_KEY est valide.
 * GET /api/brevo/health
 */
export async function GET() {
  try {
    const account = (await getAccount()) as {
      email?: string;
      companyName?: string;
    };
    return NextResponse.json({
      ok: true,
      email: account.email,
      company: account.companyName,
    });
  } catch (error) {
    if (error instanceof BrevoError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
