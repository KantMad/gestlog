/**
 * Horodatage pour les noms de fichiers exportés : `2026-09-04_14h32`.
 *
 * ⚠️ L'heure et la minute font partie du nom : avec une date seule, deux exports du même
 * jour portent le MÊME nom — le second écrase le premier dans le dossier de
 * téléchargement, ou se retrouve suffixé « (1) » sans qu'on sache lequel est lequel.
 *
 * Heure LOCALE, pas UTC : le nom doit correspondre à l'heure qu'affiche l'horloge de
 * l'utilisateur au moment où il clique.
 */
export function fileStamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}h${p(date.getMinutes())}`
  );
}
