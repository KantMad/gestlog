/**
 * Client Brevo réutilisable (API REST v3, sans SDK).
 * Doc: https://developers.brevo.com/reference
 *
 * À utiliser uniquement côté serveur (route handlers, server actions) :
 * la clé API ne doit jamais être exposée au navigateur.
 */

const BREVO_BASE_URL = "https://api.brevo.com/v3";

function getApiKey(): string {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    throw new Error(
      "BREVO_API_KEY manquante. Ajoute-la dans .env (voir https://app.brevo.com/settings/keys/api).",
    );
  }
  return key;
}

export class BrevoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BrevoError";
  }
}

/**
 * Appel générique à l'API Brevo. Renvoie le JSON parsé (ou null si 204).
 */
async function brevoRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BREVO_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "api-key": getApiKey(),
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // Pas de cache : les appels Brevo sont des mutations / données live.
    cache: "no-store",
  });

  if (res.status === 204) {
    return null as T;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ??
      `Erreur Brevo (HTTP ${res.status})`;
    throw new BrevoError(message, res.status, data);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Briques prêtes à l'emploi
// ---------------------------------------------------------------------------

export interface TransactionalEmail {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent?: string;
  textContent?: string;
  /** Sinon utilise BREVO_SENDER_EMAIL / BREVO_SENDER_NAME du .env */
  sender?: { email: string; name?: string };
  /** Pour utiliser un template Brevo au lieu de htmlContent */
  templateId?: number;
  params?: Record<string, unknown>;
  replyTo?: { email: string; name?: string };
}

/** Envoie un email transactionnel. Renvoie le messageId Brevo. */
export async function sendTransactionalEmail(
  email: TransactionalEmail,
): Promise<{ messageId: string }> {
  const sender = email.sender ?? {
    email: process.env.BREVO_SENDER_EMAIL ?? "",
    name: process.env.BREVO_SENDER_NAME,
  };

  if (!sender.email) {
    throw new Error(
      "Expéditeur manquant : passe `sender` ou définis BREVO_SENDER_EMAIL dans .env.",
    );
  }

  return brevoRequest("/smtp/email", {
    method: "POST",
    body: { ...email, sender },
  });
}

export interface UpsertContactInput {
  email: string;
  /** Attributs Brevo (ex: { PRENOM: "...", NOM: "...", TOTAL_SPENT: 120 }) */
  attributes?: Record<string, unknown>;
  /** IDs des listes Brevo où ajouter le contact */
  listIds?: number[];
  updateEnabled?: boolean;
}

/** Crée ou met à jour un contact. */
export async function upsertContact(input: UpsertContactInput): Promise<void> {
  await brevoRequest("/contacts", {
    method: "POST",
    body: { updateEnabled: true, ...input },
  });
}

export interface TrackEventInput {
  /** Nom de l'événement (a-z, 0-9, - et _ uniquement, max 255). Ex: "commande_expediee" */
  eventName: string;
  /** Identifie le contact. Au moins un champ requis (généralement l'email). */
  identifiers: {
    email_id?: string;
    ext_id?: string;
    phone_id?: string;
    contact_id?: number;
  };
  /** ISO 8601. Par défaut : maintenant. */
  eventDate?: string;
  /** Met à jour les attributs du contact au passage (ex: { PRENOM: "...", TOTAL_SPENT: 120 }) */
  contactProperties?: Record<string, unknown>;
  /** Données de l'événement, utilisables comme conditions/personnalisation dans le scénario */
  eventProperties?: Record<string, unknown>;
}

/**
 * Pousse un événement vers Brevo pour déclencher une automatisation.
 * C'est LA brique pour les scénarios : tu déclenches "commande_expediee" ici,
 * et le scénario configuré dans l'UI Brevo envoie l'email tout seul.
 * Doc: https://developers.brevo.com/reference/create-event
 */
export async function trackEvent(input: TrackEventInput): Promise<void> {
  await brevoRequest("/events", {
    method: "POST",
    body: {
      event_name: input.eventName,
      identifiers: input.identifiers,
      ...(input.eventDate ? { event_date: input.eventDate } : {}),
      ...(input.contactProperties
        ? { contact_properties: input.contactProperties }
        : {}),
      ...(input.eventProperties
        ? { event_properties: input.eventProperties }
        : {}),
    },
  });
}

/** True si la clé API Brevo est configurée. Permet de no-op proprement si non. */
export function isBrevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

export interface VipCustomer {
  email: string;
  firstName?: string;
  lastName?: string;
  totalSpent: number;
  ordersCount?: number;
}

/**
 * Marque un client comme VIP côté Brevo : met à jour ses attributs (+ liste VIP
 * si BREVO_VIP_LIST_ID est défini) et pousse l'événement "client_vip" qui
 * déclenche le scénario d'automatisation configuré dans l'UI Brevo.
 * À appeler UNE fois, au moment où le client franchit le seuil.
 */
export async function markCustomerAsVip(c: VipCustomer): Promise<void> {
  const vipListId = process.env.BREVO_VIP_LIST_ID
    ? Number(process.env.BREVO_VIP_LIST_ID)
    : undefined;

  await upsertContact({
    email: c.email,
    attributes: {
      PRENOM: c.firstName,
      NOM: c.lastName,
      TOTAL_SPENT: c.totalSpent,
      NB_COMMANDES: c.ordersCount,
      VIP: true,
    },
    listIds: vipListId ? [vipListId] : undefined,
  });

  await trackEvent({
    eventName: "client_vip",
    identifiers: { email_id: c.email },
    eventProperties: {
      total_spent: c.totalSpent,
      orders_count: c.ordersCount,
    },
  });
}

/** Vérifie la clé API en récupérant le compte Brevo. Utile pour un health-check. */
export async function getAccount(): Promise<unknown> {
  return brevoRequest("/account");
}

export { brevoRequest };
