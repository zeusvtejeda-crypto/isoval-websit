import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeText } from "@/lib/validation/facility";

/**
 * saveFacility (alta y edición manual) con una base simulada en memoria:
 * duplicados por nombre y lugar con la misma regla que la importación
 * (unidades co-ubicadas con claves distintas no chocan) y municipio obligatorio.
 */

type FacilityStub = {
  id: string;
  internal_code: string;
  official_name: string;
  unit_key: string | null;
  state_id: number;
  municipality_id: number;
  phone: string | null;
  change_reason: string | null;
};

const ID_A = "f1000000-0000-4000-8000-00000000000a";
const ID_B = "f1000000-0000-4000-8000-00000000000b";
const ID_C = "f1000000-0000-4000-8000-00000000000c";
const NEW_ID = "f1000000-0000-4000-8000-0000000000ff";
const DEL_NAYAR = 9;

const h = vi.hoisted(() => ({
  facilities: [] as FacilityStub[],
  writes: [] as { op: "insert" | "update"; payload: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "p-admin", isAdmin: true })) }));
vi.mock("@/app/(app)/administracion/instalaciones/_lib/reason", () => ({ resetRepeatedReason: vi.fn(async () => null) }));

function matches(f: FacilityStub, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => {
    if (key === "normalized_name") return normalizeText(f.official_name) === value;
    if (key === "ilike:unit_key") return (f.unit_key ?? "").toUpperCase() === String(value).toUpperCase();
    return (f as Record<string, unknown>)[key] === value;
  });
}

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let op: "select" | "insert" | "update" = "select";
  const rows = (): unknown[] => {
    if (table === "facility_categories") return [{ id: 3, name: "Otras unidades médicas", active: true }];
    if (table === "states") return [{ id: 18, default_timezone: "America/Mazatlan" }];
    if (table === "municipalities") return [{ id: DEL_NAYAR, state_id: 18, timezone: null }].filter((m) => m.id === filters.id);
    if (op === "update") return [{ id: filters.id }];
    if (op === "insert") return [{ id: NEW_ID }];
    return h.facilities.filter((f) => matches(f, filters));
  };
  const q = {
    select: () => q,
    limit: () => q,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return q;
    },
    ilike: (column: string, value: unknown) => {
      filters[`ilike:${column}`] = value;
      return q;
    },
    update: (payload: Record<string, unknown>) => {
      op = "update";
      h.writes.push({ op, payload });
      return q;
    },
    insert: (payload: Record<string, unknown>) => {
      op = "insert";
      h.writes.push({ op, payload });
      return q;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => query(table) }) }));

import { saveFacility } from "@/app/(app)/administracion/instalaciones/actions";

function facility(partial: Partial<FacilityStub> & Pick<FacilityStub, "id" | "internal_code" | "official_name">): FacilityStub {
  return { unit_key: null, state_id: 18, municipality_id: DEL_NAYAR, phone: null, change_reason: "Importación: catalogo.csv", ...partial };
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  const values: Record<string, string> = {
    official_name: "LINDA VISTA",
    category_id: "3",
    state_id: "18",
    municipality_id: String(DEL_NAYAR),
    source: "CLUES DGIS (corte 2026-08)",
    verification_status: "pendiente",
    is_public: "on",
    active: "on",
    ...entries,
  };
  for (const [k, v] of Object.entries(values)) if (v !== "") fd.set(k, v);
  return fd;
}

beforeEach(() => {
  h.writes = [];
  // Dos unidades oficiales co-ubicadas: mismo nombre y municipio, distinta CLUES.
  h.facilities = [
    facility({ id: ID_A, internal_code: "INS-000010", official_name: "LINDA VISTA", unit_key: "NTIMS000721" }),
    facility({ id: ID_B, internal_code: "INS-000011", official_name: "Linda Vista", unit_key: "NTIMS001235" }),
  ];
});

describe("saveFacility: nombre repetido en el mismo municipio", () => {
  it("edita (solo el teléfono) una de dos unidades co-ubicadas con claves distintas", async () => {
    const fd = form({ id: ID_A, unit_key: "NTIMS000721", phone: "311 000 0000", change_reason: "Actualización de teléfono" });
    await expect(saveFacility(null, fd)).rejects.toThrow(`NEXT_REDIRECT:/administracion/instalaciones/${ID_A}/editar?guardado=cambios`);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ op: "update", payload: { phone: "311 000 0000", unit_key: "NTIMS000721", municipality_id: DEL_NAYAR } });
  });

  it("da de alta a mano otra unidad co-ubicada con su propia clave", async () => {
    await expect(saveFacility(null, form({ unit_key: "NTIMS009999" }))).rejects.toThrow(`NEXT_REDIRECT:/administracion/instalaciones/${NEW_ID}/editar?guardado=alta`);
    expect(h.writes[0]).toMatchObject({ op: "insert", payload: { official_name: "LINDA VISTA", unit_key: "NTIMS009999" } });
  });

  it("sigue rechazando un duplicado real: sin clave de unidad no se distingue", async () => {
    const r = await saveFacility(null, form({ official_name: "Linda  Vista" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { official_name: expect.stringMatching(/^Ya existe INS-000010 \(LINDA VISTA\) con el mismo nombre/) } });
    expect(h.writes).toHaveLength(0);
  });

  it("una unidad con clave choca con una registrada sin clave (podría ser la misma)", async () => {
    h.facilities.push(facility({ id: ID_C, internal_code: "INS-000012", official_name: "Linda Vista", unit_key: null }));
    const r = await saveFacility(null, form({ id: ID_A, unit_key: "NTIMS000721", phone: "311 000 0000", change_reason: "Actualización de teléfono" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { official_name: expect.stringMatching(/INS-000012/) } });
    expect(h.writes).toHaveLength(0);
  });

  it("la misma clave de unidad en otra instalación se rechaza", async () => {
    const r = await saveFacility(null, form({ unit_key: "ntims001235" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { unit_key: expect.stringMatching(/INS-000011/) } });
  });
});

describe("saveFacility: municipio obligatorio", () => {
  it("rechaza el alta sin municipio antes de consultar la base", async () => {
    const r = await saveFacility(null, form({ municipality_id: "", unit_key: "NTIMS009999" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { municipality_id: "Elige el municipio." } });
    expect(h.writes).toHaveLength(0);
  });

  it("rechaza un municipio de otro estado", async () => {
    const r = await saveFacility(null, form({ municipality_id: "999", unit_key: "NTIMS009999" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { municipality_id: "El municipio no corresponde al estado elegido." } });
  });
});
