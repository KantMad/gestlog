import { timingSafeEqual } from "node:crypto";

// Clé de lecture des routes `/api/assistant/*` : en-tête `x-api-key` = ASSISTANT_READ_KEY
// (distincte de SYNC_API_KEY, qui permet d'ÉCRIRE). Sans clé configurée, tout est refusé.
export function cleAssistantValide(recue: string | null): boolean {
  const attendue = process.env.ASSISTANT_READ_KEY;
  if (!attendue || !recue) return false;
  const a = Buffer.from(recue);
  const b = Buffer.from(attendue);
  return a.length === b.length && timingSafeEqual(a, b);
}
