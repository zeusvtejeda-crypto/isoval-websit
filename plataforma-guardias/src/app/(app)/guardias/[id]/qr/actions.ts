"use server";

import { requireManager } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isGuid } from "@/lib/shifts/filters";
import { buildQrUrl, classifyIssueError } from "@/lib/qr/core";
import { parseIssuedToken, type QrIssueResult } from "@/lib/qr/rpc";
import { qrSvg } from "@/lib/qr/svg";

/**
 * Emite un código QR temporal para la guardia y devuelve su imagen SVG.
 * Vuelve a verificar la sesión y el rol; la base de datos (issue_qr_token)
 * exige además que la cuenta gestione la sede, que la guardia no esté
 * cancelada y que esté dentro de la ventana de registro.
 */
export async function issueQrCode(shiftId: string): Promise<QrIssueResult> {
  await requireManager();
  if (typeof shiftId !== "string" || !isGuid(shiftId)) {
    return { ok: false, kind: "not_found", message: "La guardia indicada no es válida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_qr_token", { p_shift_id: shiftId });
  if (error) {
    return { ok: false, kind: classifyIssueError(error), message: friendlyDbError(error, "No se pudo generar el código QR.") };
  }

  const issued = parseIssuedToken(data);
  if (!issued) {
    return { ok: false, kind: "unknown", message: "El servidor no devolvió un código válido. Inténtalo de nuevo." };
  }

  const url = buildQrUrl(publicEnv.siteUrl, issued.token);
  let svg: string;
  try {
    svg = await qrSvg(url);
  } catch {
    return { ok: false, kind: "unknown", message: "No se pudo dibujar el código QR. Inténtalo de nuevo." };
  }

  return {
    ok: true,
    token: issued.token,
    url,
    svg,
    expiresAt: issued.expiresAt,
    serverTime: issued.serverTime,
    ttlSeconds: issued.ttlSeconds,
  };
}
