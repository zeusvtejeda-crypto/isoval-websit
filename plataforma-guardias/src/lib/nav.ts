import type { AppRole } from "@/lib/auth";

export type NavItem = { href: string; label: string; short?: string; roles: AppRole[] };

/** Navegación de coordinación, administración y auditoría. */
export const STAFF_NAV: NavItem[] = [
  { href: "/inicio", label: "Inicio", roles: ["admin", "coordinador", "auditor"] },
  { href: "/directorio", label: "Mapa y directorio", short: "Mapa", roles: ["admin", "coordinador", "auditor"] },
  { href: "/trabajadores", label: "Trabajadores", roles: ["admin", "coordinador", "auditor"] },
  { href: "/guardias", label: "Guardias", roles: ["admin", "coordinador", "auditor"] },
  { href: "/en-servicio", label: "En servicio", roles: ["admin", "coordinador", "auditor"] },
  { href: "/historial", label: "Historial y reportes", short: "Reportes", roles: ["admin", "coordinador", "auditor"] },
  { href: "/administracion", label: "Administración", roles: ["admin", "coordinador", "auditor"] },
];

/** Navegación del trabajador. */
export const WORKER_NAV: NavItem[] = [
  { href: "/mi-guardia", label: "Mi guardia", roles: ["trabajador", "admin", "coordinador", "auditor"] },
  { href: "/registro", label: "Registrar entrada o salida", short: "Registrar", roles: ["trabajador", "admin", "coordinador", "auditor"] },
  { href: "/mi-historial", label: "Mi historial", roles: ["trabajador", "admin", "coordinador", "auditor"] },
];

export function navFor(role: AppRole, hasWorker: boolean): { primary: NavItem[]; personal: NavItem[] } {
  if (role === "trabajador") return { primary: WORKER_NAV, personal: [] };
  return {
    primary: STAFF_NAV.filter((i) => i.roles.includes(role)),
    // Personal de coordinación que también hace guardias.
    personal: hasWorker ? WORKER_NAV : [],
  };
}
