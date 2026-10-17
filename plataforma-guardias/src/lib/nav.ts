import type { AppRole } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  roles: AppRole[];
  /** Otras rutas que marcan este elemento como activo. */
  alsoActive?: string[];
};

/**
 * Navegación de coordinación, administración y auditoría: exactamente los
 * apartados de la especificación. «Correcciones» se abre desde Administración
 * e Inicio (y desde cada asignación), por eso marca activo «Administración».
 */
export const STAFF_NAV: NavItem[] = [
  { href: "/inicio", label: "Inicio", roles: ["admin", "coordinador", "auditor"] },
  { href: "/directorio", label: "Mapa y directorio", roles: ["admin", "coordinador", "auditor"] },
  { href: "/trabajadores", label: "Trabajadores", roles: ["admin", "coordinador", "auditor"] },
  { href: "/guardias", label: "Guardias", roles: ["admin", "coordinador", "auditor"] },
  { href: "/en-servicio", label: "En servicio", roles: ["admin", "coordinador", "auditor"] },
  { href: "/historial", label: "Historial y reportes", roles: ["admin", "coordinador", "auditor"] },
  { href: "/administracion", label: "Administración", roles: ["admin", "coordinador", "auditor"], alsoActive: ["/correcciones"] },
];

/**
 * Navegación del trabajador. Auditoría no la tiene: es de solo lectura y no
 * se vincula a un trabajador (la base de datos lo impide).
 */
export const WORKER_NAV: NavItem[] = [
  { href: "/mi-guardia", label: "Mi guardia", roles: ["trabajador", "admin", "coordinador"] },
  { href: "/registro", label: "Registrar entrada o salida", roles: ["trabajador", "admin", "coordinador"] },
  { href: "/mi-historial", label: "Mi historial", roles: ["trabajador", "admin", "coordinador"] },
];

export function navFor(role: AppRole, hasWorker: boolean): { primary: NavItem[]; personal: NavItem[] } {
  if (role === "trabajador") return { primary: WORKER_NAV, personal: [] };
  return {
    primary: STAFF_NAV.filter((i) => i.roles.includes(role)),
    // Personal de coordinación que también hace guardias.
    personal: hasWorker ? WORKER_NAV.filter((i) => i.roles.includes(role)) : [],
  };
}
