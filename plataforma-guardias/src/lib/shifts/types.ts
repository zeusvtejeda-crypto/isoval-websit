import type { ActionResult } from "@/lib/actions";

/** Firma de las Server Actions de formularios del módulo (para useActionState). */
export type FormAction<T = undefined> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

export type WorkerOption = {
  id: string;
  full_name: string;
  internal_code: string;
  facility_id: string | null;
  facility_name?: string | null;
};

export type FacilityRef = { id: string; official_name: string; timezone: string };
