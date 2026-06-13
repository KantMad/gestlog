import { Sidebar } from "@/components/layout/sidebar";
import { AccessGuard } from "@/components/layout/access-guard";
import { SeasonProvider } from "@/lib/season-context";
import { MobileNavProvider } from "@/lib/mobile-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SeasonProvider>
      <MobileNavProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          {/* Marge gauche réservée à la sidebar fixe sur desktop uniquement */}
          <main className="flex-1 min-w-0 lg:ml-64">
            <AccessGuard>{children}</AccessGuard>
          </main>
        </div>
      </MobileNavProvider>
    </SeasonProvider>
  );
}
