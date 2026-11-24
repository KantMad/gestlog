import { redirect } from "next/navigation";

// Ancienne adresse : le contrôle marketplaces est désormais un onglet de l'écran BtoC
// (ouvert à toute personne qui a BtoC).
export default function ControleMarketplacesPage() {
  redirect("/btoc?tab=marketplaces");
}
