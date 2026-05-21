import { Sidebar } from "@/components/layout/sidebar";
import { SeasonProvider } from "@/lib/season-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SeasonProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-64">
          {children}
        </main>
      </div>
    </SeasonProvider>
  );
}
