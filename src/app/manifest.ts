import type { MetadataRoute } from "next";

// Manifeste PWA → installation sur écran d'accueil (Android/iOS), affichage plein écran.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GestLog — Gestion logistique",
    short_name: "GestLog",
    description:
      "Gestion des réceptions fournisseurs et répartition des commandes clients",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#18181b",
    lang: "fr",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
