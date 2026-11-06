import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { cleAssistantValide } from "@/lib/assistant-cle";
import { prisma } from "@/lib/prisma";
import { motsDeRecherche } from "@/lib/assistant-fiche";
import {
  regrouperClientsB2b,
  regrouperClientsSite,
  type FicheClientSite,
  type LigneClientB2b,
  type LigneCommandeSite,
} from "@/lib/assistant-clients";

// GET — Clients, en LECTURE SEULE pour l'assistant IA.
//   ?recherche=texte   nom, email, code client, ville ou téléphone (mots de 3 lettres ou plus)
// Rend les clients B2B (boutiques revendeuses) et du site dont la fiche contient le plus de mots
// de la recherche (5 au plus de chaque), avec leurs dernières commandes. Données personnelles :
// réservées à l'assistant de la direction (cf. docs/11-assistant-ia.md).
export async function GET(request: NextRequest) {
  try {
    if (!cleAssistantValide(request.headers.get("x-api-key"))) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }
    const recherche = (request.nextUrl.searchParams.get("recherche") ?? "").trim();
    const mots = motsDeRecherche(recherche).map((m) => `%${m.replace(/[%_\\]/g, "\\$&")}%`);
    if (!mots.length || recherche.length > 120) {
      return NextResponse.json({ error: "Paramètre recherche attendu (un mot de 3 lettres ou plus)" }, { status: 400 });
    }

    const [b2b, site] = await Promise.all([clientsB2b(mots), clientsSite(mots)]);
    return NextResponse.json({ b2b, site });
  } catch (e) {
    return handleApiError(e, "api/assistant/clients");
  }
}

/** Seuls les mieux notés : « Martin Lyon » préfère le Martin de Lyon aux autres Martin. */
const meilleurs = <T extends { score: number }>(l: T[]) => l.filter((x) => x.score === l[0]?.score).slice(0, 5);

async function clientsB2b(mots: string[]) {
  const trouves = meilleurs(
    await prisma.$queryRawUnsafe<{ id: string; score: number }[]>(
      `SELECT c.id, (SELECT COUNT(*) FROM unnest($1::text[]) w
                     WHERE CONCAT_WS(' ', c.name, c.code, c.email, c."deliveryCity", c."deliveryPostcode") ILIKE w)::int AS score
       FROM "Client" c
       ORDER BY score DESC, c.name LIMIT 10`,
      mots
    )
  ).filter((c) => c.score > 0);
  if (!trouves.length) return [];
  const lignes = await prisma.$queryRawUnsafe<LigneClientB2b[]>(
    `SELECT c.code, c.name, c.email, c."deliveryCity", c."deliveryPostcode",
            o."orderNumber", o."orderDate", o."totalAmount", o.status, s.name AS saison
     FROM "Client" c
     LEFT JOIN "ClientOrder" o ON o."clientId" = c.id AND o.source = 'TIO'
     LEFT JOIN "Season" s ON s.id = o."seasonId"
     WHERE c.id = ANY($1)`,
    trouves.map((c) => c.id)
  );
  return regrouperClientsB2b(lignes);
}

async function clientsSite(mots: string[]) {
  const trouves = meilleurs(
    await prisma.$queryRawUnsafe<{ cle: string; score: number }[]>(
      `SELECT cle, MAX(score)::int AS score FROM (
         SELECT LOWER(email) AS cle,
                (SELECT COUNT(*) FROM unnest($1::text[]) w WHERE texte ILIKE w) AS score
         FROM (
           SELECT o."customerEmail" AS email,
                  CONCAT_WS(' ', o."customerName", o."billingFirstName", o."billingLastName", o."customerEmail",
                            o."billingCity", o."shippingCity") AS texte
           FROM "BtocOrder" o
           UNION ALL
           SELECT c.email, CONCAT_WS(' ', c."firstName", c."lastName", c.email, c.company, c.phone, c."billingCity")
           FROM "BtocCustomer" c
           UNION ALL
           SELECT h."customerEmail", CONCAT_WS(' ', h."firstName", h."lastName", h."customerEmail", h.phone)
           FROM "HistOrder" h
         ) t
         WHERE email IS NOT NULL AND email <> ''
       ) u
       WHERE score > 0
       GROUP BY cle ORDER BY score DESC LIMIT 10`,
      mots
    )
  );
  if (!trouves.length) return [];
  const cles = trouves.map((c) => c.cle);
  const [commandes, fiches] = await Promise.all([
    prisma.$queryRawUnsafe<LigneCommandeSite[]>(
      `SELECT LOWER(o."customerEmail") AS "emailKey", o."customerEmail" AS email,
              COALESCE(NULLIF(TRIM(o."customerName"), ''), NULLIF(TRIM(CONCAT_WS(' ', o."billingFirstName", o."billingLastName")), '')) AS nom,
              COALESCE(o."shippingCity", o."billingCity") AS ville, COALESCE(o."shippingCountry", o."billingCountry") AS pays,
              o."orderNumber" AS numero, o."orderDate" AS date, o.total - COALESCE(o."totalRefunded", 0) AS montant,
              o.status AS statut, 'site' AS origine
       FROM "BtocOrder" o WHERE LOWER(o."customerEmail") = ANY($1)
       UNION ALL
       SELECT LOWER(h."customerEmail"), h."customerEmail", NULLIF(TRIM(CONCAT_WS(' ', h."firstName", h."lastName")), ''),
              NULL, h.country, h."orderNumber", h."orderDate", h.total, 'completed', 'ancien site'
       FROM "HistOrder" h WHERE LOWER(h."customerEmail") = ANY($1)`,
      cles
    ),
    prisma.$queryRawUnsafe<FicheClientSite[]>(
      `SELECT LOWER(c.email) AS "emailKey", c."firstName" AS prenom, c."lastName" AS nom, c.phone AS telephone,
              COALESCE(c."shippingCity", c."billingCity") AS ville, COALESCE(c."shippingCountry", c."billingCountry") AS pays,
              c."isVip" AS vip
       FROM "BtocCustomer" c WHERE LOWER(c.email) = ANY($1)`,
      cles
    ),
  ]);
  // Un client inscrit sans commande garde sa fiche : une « commande » vide ne compte pas.
  return regrouperClientsSite(commandes, fiches).concat(
    fiches
      .filter((f) => !commandes.some((c) => c.emailKey === f.emailKey))
      .map((f) => ({
        nom: [f.prenom, f.nom].filter(Boolean).join(" ") || f.emailKey, email: f.emailKey, telephone: f.telephone,
        ville: f.ville, pays: f.pays, vip: f.vip, commandes: 0, depenseTtc: 0,
        premiereCommande: null, derniereCommande: null, dernieres: [],
      }))
  ).slice(0, 5);
}
