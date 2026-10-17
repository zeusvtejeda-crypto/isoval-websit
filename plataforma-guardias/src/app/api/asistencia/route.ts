import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/actions";

/**
 * Registro de entrada/salida. La hora es SIEMPRE la del servidor (función
 * check_in/check_out en la base de datos). La idempotencia se garantiza con
 * requestId: un reintento con el mismo requestId devuelve el mismo registro.
 */
const bodySchema = z.object({
  action: z.enum(["entrada", "salida"]),
  assignmentId: z.string().uuid(),
  requestId: z.string().uuid(),
  notes: z.string().trim().max(500).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  /** Código QR temporal (opcional). Si viene, el registro es con método «qr». */
  qrToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,100}$/)
    .optional()
    .nullable(),
});

export type AttendanceSessionPayload = {
  id: string;
  assignment_id: string;
  check_in_at: string;
  check_out_at: string | null;
  check_in_method: string;
  check_out_method: string | null;
};

export type AttendanceResultKind = "created" | "duplicate" | "already_open" | "open_elsewhere" | "no_open_session";

export type AttendanceApiResult =
  | { ok: true; result: AttendanceResultKind; message: string; serverTime: string; session: AttendanceSessionPayload | null }
  | {
      ok: false;
      message: string;
      /** No se sabe si el servidor de datos guardó el registro (falla de red/tiempo de espera). */
      unconfirmed?: boolean;
    };

const MESSAGES: Record<string, { entrada: string; salida: string }> = {
  created: { entrada: "Entrada registrada.", salida: "Salida registrada." },
  duplicate: { entrada: "Esta entrada ya estaba registrada (no se duplicó).", salida: "Esta salida ya estaba registrada (no se duplicó)." },
  already_open: { entrada: "Ya tienes una entrada abierta en esta guardia; no se registró otra.", salida: "" },
  open_elsewhere: {
    entrada: "Hay una entrada abierta en otra guardia. Registra la salida de esa guardia o solicita una corrección.",
    salida: "",
  },
  no_open_session: { entrada: "", salida: "No hay una entrada abierta en esta guardia." },
};

/** Rechaza solicitudes de otros sitios (defensa en profundidad además de SameSite). */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  // Detrás de un proxy, el host público llega en x-forwarded-host.
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase());
  try {
    return hosts.includes(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse<AttendanceApiResult>> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, message: "Origen no permitido." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ ok: false, message: "Solicitud inválida." }, { status: 415 });
  }
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Tu sesión terminó. Vuelve a iniciar sesión." }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, message: "Solicitud inválida." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = parsed.qrToken
    ? await supabase.rpc(parsed.action === "entrada" ? "check_in_qr" : "check_out_qr", {
        p_token: parsed.qrToken,
        p_request_id: parsed.requestId,
        p_notes: parsed.notes ?? undefined,
      })
    : await supabase.rpc(parsed.action === "entrada" ? "check_in" : "check_out", {
        p_assignment_id: parsed.assignmentId,
        p_request_id: parsed.requestId,
        p_notes: parsed.notes ?? undefined,
        p_reason: parsed.reason ?? undefined,
      });

  if (error) {
    // Sin código de Postgres = falla de red o tiempo de espera hacia Supabase: el
    // registro pudo o no guardarse. Se responde «no confirmado» para que el
    // cliente reintente con el MISMO identificador (idempotente).
    if (!error.code) {
      return NextResponse.json(
        { ok: false, unconfirmed: true, message: "No se pudo confirmar el registro con el servidor de datos. Reintenta: no se duplicará." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const status = error.code === "42501" ? 403 : error.code === "28000" ? 401 : 422;
    return NextResponse.json({ ok: false, message: friendlyDbError(error) }, { status });
  }

  const payload = data as { result: AttendanceResultKind; session: AttendanceSessionPayload | null; server_time: string };
  const result = payload.result;
  return NextResponse.json(
    {
      ok: true,
      result,
      message: MESSAGES[result]?.[parsed.action] || "Operación completada.",
      serverTime: payload.server_time,
      session: payload.session ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
