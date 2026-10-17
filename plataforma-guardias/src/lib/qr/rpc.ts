/**
 * Formas de las respuestas de las funciones RPC del registro con QR.
 * Se validan antes de usarlas: la respuesta llega como JSON sin tipo.
 */
import { z } from "zod";
import { QR_TOKEN_PATTERN, type QrIssueErrorKind } from "./core";

const timestamp = z.string().refine((v) => Number.isFinite(Date.parse(v)), "Fecha inválida");

const issuedSchema = z.object({
  token: z.string().regex(QR_TOKEN_PATTERN),
  expires_at: timestamp,
  ttl_seconds: z.number().int().positive(),
  server_time: timestamp,
});

export type IssuedQrToken = { token: string; expiresAt: string; ttlSeconds: number; serverTime: string };

/** Respuesta de issue_qr_token, o null si no tiene la forma esperada. */
export function parseIssuedToken(data: unknown): IssuedQrToken | null {
  const r = issuedSchema.safeParse(data);
  if (!r.success) return null;
  return { token: r.data.token, expiresAt: r.data.expires_at, ttlSeconds: r.data.ttl_seconds, serverTime: r.data.server_time };
}

const contextSchema = z.object({
  assignment_id: z.string().min(1),
  shift_id: z.string().min(1),
  shift_title: z.string().nullable().optional(),
  meeting_point: z.string(),
  starts_at: timestamp,
  ends_at: timestamp,
  facility_name: z.string().nullable().optional(),
  facility_timezone: z.string().nullable().optional(),
  has_open_session: z.boolean(),
  can_register: z.boolean().optional(),
  shift_status: z.string().optional(),
  assignment_status: z.string().optional(),
  worker_active: z.boolean().optional(),
  expires_at: timestamp.nullable().optional(),
  server_time: timestamp,
});

export type QrTokenContext = {
  assignmentId: string;
  shiftId: string;
  shiftTitle: string | null;
  meetingPoint: string;
  startsAt: string;
  endsAt: string;
  facilityName: string | null;
  facilityTimezone: string | null;
  hasOpenSession: boolean;
  /** false si la guardia está cancelada, la asignación no está activa o el trabajador está inactivo. */
  canRegister: boolean;
  /** Motivo legible cuando no se puede registrar. */
  blockedReason: string | null;
  expiresAt: string | null;
  serverTime: string;
};

function blockedReasonOf(d: { shift_status?: string; assignment_status?: string; worker_active?: boolean }): string | null {
  if (d.shift_status === "cancelada") return "La guardia está cancelada.";
  if (d.assignment_status && d.assignment_status !== "asignado") return "Tu asignación a esta guardia no está activa.";
  if (d.worker_active === false) return "Tu registro de trabajador está inactivo.";
  return null;
}

/** Respuesta de qr_token_context, o null si no tiene la forma esperada. */
export function parseQrContext(data: unknown): QrTokenContext | null {
  const r = contextSchema.safeParse(data);
  if (!r.success) return null;
  const d = r.data;
  return {
    assignmentId: d.assignment_id,
    shiftId: d.shift_id,
    shiftTitle: d.shift_title?.trim() ? d.shift_title.trim() : null,
    meetingPoint: d.meeting_point,
    startsAt: d.starts_at,
    endsAt: d.ends_at,
    facilityName: d.facility_name ?? null,
    facilityTimezone: d.facility_timezone ?? null,
    hasOpenSession: d.has_open_session,
    canRegister: d.can_register ?? true,
    blockedReason: d.can_register === false ? (blockedReasonOf(d) ?? "No es posible registrar con este código.") : null,
    expiresAt: d.expires_at ?? null,
    serverTime: d.server_time,
  };
}

/** Resultado de la Server Action que emite el código (lo que recibe la pantalla). */
export type QrIssueResult =
  | { ok: true; token: string; url: string; svg: string; expiresAt: string; serverTime: string; ttlSeconds: number }
  | { ok: false; kind: QrIssueErrorKind; message: string };
