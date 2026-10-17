import type { ReactNode } from "react";
import { AppNav } from "@/components/layout/app-nav";
import { Disclaimer, DemoBanner } from "@/components/layout/disclaimer";
import { OfflineBanner } from "@/components/layout/connection-status";
import { requireUser, ROLE_LABELS } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { publicEnv } from "@/lib/env";
import { logout } from "@/app/actions/auth";

/** Armazón de las vistas autenticadas. Cada página valida además su propio rol. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { primary, personal } = navFor(user.role, Boolean(user.workerId));
  const isWorker = user.role === "trabajador";

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <OfflineBanner />
      {publicEnv.demoMode ? <DemoBanner /> : null}
      <div className="flex flex-1 flex-col lg:flex-row">
        <AppNav
          primary={primary}
          personal={personal}
          userLabel={user.displayName ?? user.email ?? "Usuario"}
          roleLabel={ROLE_LABELS[user.role]}
          logoutAction={logout}
          bottomBar={isWorker}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="contenido" className={isWorker ? "flex-1 px-4 pb-24 pt-4 sm:px-6 lg:pb-8" : "flex-1 px-4 py-4 sm:px-6 lg:py-8"}>
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
          <Disclaimer />
        </div>
      </div>
    </div>
  );
}
