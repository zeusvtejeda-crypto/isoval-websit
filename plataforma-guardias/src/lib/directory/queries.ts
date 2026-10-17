import "server-only";
import { cache } from "react";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import type { PublicFacilityRow } from "./types";
import type { CategoryOption, DirectoryFacility, DirectoryLookups, MunicipalityOption, PublicFacilityDetail, StateOption } from "./types";
import { DIRECTORY_LIST_COLUMNS, PUBLIC_FACILITY_COLUMNS, isUuid, toDirectoryFacility, toPublicFacilityDetail } from "./mappers";

/*
 * Consultas del directorio público. Solo leen la vista public_facilities y los
 * catálogos públicos (categorías, estados, municipios) con el cliente con RLS:
 * una persona anónima ve únicamente lo público.
 */

export type DirectoryData = DirectoryLookups & { facilities: DirectoryFacility[] };

async function loadCategories(supabase: ServerSupabase): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from("facility_categories")
    .select("id, slug, name, color, active")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadStates(supabase: ServerSupabase, ids: number[]): Promise<StateOption[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("states").select("id, name, abbreviation").in("id", ids).order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadMunicipalities(supabase: ServerSupabase, ids: number[]): Promise<MunicipalityOption[]> {
  const out: MunicipalityOption[] = [];
  for (const part of chunk(ids)) {
    const rows = await fetchAll((from, to) =>
      supabase.from("municipalities").select("id, state_id, name").in("id", part).order("name").range(from, to),
    );
    out.push(...rows.map((m) => ({ id: m.id, stateId: m.state_id, name: m.name })));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
}

/**
 * Datos del directorio: instalaciones públicas, categorías activas (más las
 * que tengan instalaciones, para mostrar su nombre), y los estados y municipios
 * que tienen al menos una instalación pública.
 */
export async function loadDirectoryData(): Promise<DirectoryData> {
  const supabase = await createClient();
  const [rows, allCategories] = await Promise.all([
    fetchAll<Partial<PublicFacilityRow>>((from, to) =>
      supabase
        .from("public_facilities")
        .select(DIRECTORY_LIST_COLUMNS)
        .order("official_name")
        .order("id")
        .range(from, to),
    ),
    loadCategories(supabase),
  ]);

  const facilities = rows.map(toDirectoryFacility).filter((f): f is DirectoryFacility => f !== null);
  const stateIds = [...new Set(facilities.map((f) => f.stateId).filter((v): v is number => v != null))];
  const municipalityIds = [...new Set(facilities.map((f) => f.municipalityId).filter((v): v is number => v != null))];
  const usedCategoryIds = new Set(facilities.map((f) => f.categoryId));

  const [states, municipalities] = await Promise.all([
    loadStates(supabase, stateIds),
    loadMunicipalities(supabase, municipalityIds),
  ]);

  return {
    facilities,
    categories: allCategories.filter((c) => c.active || usedCategoryIds.has(c.id)),
    states,
    municipalities,
  };
}

export type FacilityDetailData = {
  facility: PublicFacilityDetail;
  category: CategoryOption | null;
  state: StateOption | null;
  municipality: MunicipalityOption | null;
};

/** Ficha pública por id (null si no existe o no es pública). Memorizada por solicitud. */
export const loadFacilityDetail = cache(async (id: string): Promise<FacilityDetailData | null> => {
  if (!isUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("public_facilities").select(PUBLIC_FACILITY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const facility = data ? toPublicFacilityDetail(data) : null;
  if (!facility) return null;

  const [category, state, municipality] = await Promise.all([
    facility.categoryId != null
      ? supabase.from("facility_categories").select("id, slug, name, color, active").eq("id", facility.categoryId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    facility.stateId != null
      ? supabase.from("states").select("id, name, abbreviation").eq("id", facility.stateId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    facility.municipalityId != null
      ? supabase.from("municipalities").select("id, state_id, name").eq("id", facility.municipalityId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // Un error de catálogo no debe mostrarse como «Sin dato registrado»: lo atiende error.tsx.
  const lookupError = category.error ?? state.error ?? municipality.error;
  if (lookupError) throw new Error(lookupError.message);

  return {
    facility,
    category: category.data ?? null,
    state: state.data ?? null,
    municipality: municipality.data
      ? { id: municipality.data.id, stateId: municipality.data.state_id, name: municipality.data.name }
      : null,
  };
});
