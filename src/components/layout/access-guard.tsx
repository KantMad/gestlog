"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { APP_SCREENS, canAccessScreen } from "@/lib/screens";

// Client-side route guard: redirects a logged-in user away from screens they
// are not allowed to access (per their screenAccess permissions). The sidebar
// already hides those links; this prevents direct URL navigation too.
export function AccessGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const allowed =
    !user || canAccessScreen(user.role, user.screenAccess, pathname);

  useEffect(() => {
    if (loading || !user || allowed) return;
    // Redirect to the first screen this user is allowed to see
    const firstAllowed = APP_SCREENS.find((s) =>
      canAccessScreen(user.role, user.screenAccess, s.key)
    );
    router.replace(firstAllowed ? firstAllowed.key : "/login");
  }, [loading, user, allowed, router]);

  // Block rendering of a forbidden screen while the redirect is in flight
  if (user && !allowed) return null;

  return <>{children}</>;
}
