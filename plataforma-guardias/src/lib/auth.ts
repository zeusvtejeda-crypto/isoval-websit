import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administración general",
  coordinador: "Coordinación",
  trabajador: "Trabajador",
  auditor: "Consulta o auditoría",
};

/** Roles con acceso a vistas de gestión (lectura). */
export const STAFF_ROLES: AppRole[] = ["admin", "coordinador", "auditor"];
/** Roles que pueden modificar datos operativos (guardias, asistencias). */
export const MANAGER_ROLES: AppRole[] = ["admin", "coordinador"];

export type SessionUser = {
  id: string;
  email: string | null;
  role: AppRole;
  displayName: string | null;
  workerId: string | null;
  /** Sedes asignadas (coordinación/auditoría). Administración tiene alcance total. */
  facilityIds: string[];
  isAdmin: boolean;
  canManage: boolean;
  isStaff: boolean;
};

/**
 * Capa de acceso a datos: obtiene el usuario autenticado y su perfil.
 * Se memoriza por solicitud. Valida el JWT con getClaims().
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const sub = claims?.sub;
  if (!sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, display_name, worker_id, active")
    .eq("id", sub)
    .maybeSingle();
  if (!profile || !profile.active) return null;

  let facilityIds: string[] = [];
  if (profile.role === "coordinador" || profile.role === "auditor") {
    const { data: scopes } = await supabase
      .from("user_facility_scopes")
      .select("facility_id")
      .eq("user_id", sub);
    facilityIds = (scopes ?? []).map((s) => s.facility_id);
  }

  const role = profile.role;
  return {
    id: profile.id,
    email: typeof claims?.email === "string" ? claims.email : null,
    role,
    displayName: profile.display_name,
    workerId: profile.worker_id,
    facilityIds,
    isAdmin: role === "admin",
    canManage: MANAGER_ROLES.includes(role),
    isStaff: STAFF_ROLES.includes(role),
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(roles: AppRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/sin-acceso");
  return user;
}

export const requireStaff = () => requireRole(STAFF_ROLES);
export const requireManager = () => requireRole(MANAGER_ROLES);
export const requireAdmin = () => requireRole(["admin"]);

export function homePathFor(role: AppRole): string {
  return role === "trabajador" ? "/mi-guardia" : "/inicio";
}

/** ¿Puede el usuario gestionar (escribir) en esta sede? Espejo de app.can_manage(). */
export function canManageFacility(user: SessionUser, facilityId: string | null | undefined): boolean {
  if (user.isAdmin) return true;
  return user.role === "coordinador" && !!facilityId && user.facilityIds.includes(facilityId);
}
