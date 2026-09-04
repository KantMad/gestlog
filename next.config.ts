import type { NextConfig } from "next";

// En-têtes de sécurité (défense en profondeur). CSP volontairement omise ici :
// une CSP stricte casse facilement Next (scripts/styles inline) → à ajouter
// séparément avec tests (idéalement en Report-Only d'abord).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // ⚠️ Un DOCUMENT HTML ne doit jamais être servi depuis le cache navigateur sans
        // revalidation : il référence les bundles JS/CSS par leur empreinte. Un HTML
        // périmé pointe donc des assets périmés, et un correctif reste invisible pour
        // qui a déjà visité le site — *cas réel : un correctif d'affichage visible sur un
        // téléphone (première visite) mais pas sur l'ordinateur (HTML en cache).*
        //
        // Next sert ces pages en `s-maxage` seul : sans `max-age`, le navigateur applique
        // un cache HEURISTIQUE (souvent plusieurs heures) au lieu de redemander la page.
        // `no-cache` n'interdit pas de stocker, il impose de REVALIDER — avec l'ETag la
        // réponse est un 304, donc quasi gratuite.
        //
        // Les assets de `/_next/static/` sont exclus : leur nom change à chaque
        // modification de contenu (vérifié), leur cache immuable reste donc correct.
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
