import "server-only";
import { cache } from "react";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/data/fetch-all";
import type { PublicFacilityRow } from "./types";
import type { CategoryOption, DirectoryFacility, DirectoryLookups, MunicipalityOption, PublicFacilityDetail, StateOption } from "./types";
import { DIRECTORY_LIST_COLUMNS, PUBLIC_FACILITY_COLUMNS, isUuid, toDirectoryFacility, toPublicFacilityDetail } from "./mappers";
import { buildMunicipalityOptions, toMunicipalityOption, type MunicipalityRow } from "./municipalities";

/*
 * Consultas del directorio público. Solo leen la vista public_facilities y los
 * catálogos públicos (categorías, estados, municipios) con el cliente con RLS:
 * una persona anónima ve únicamente lo público.
 */

const CATEGORY_COLUMNS = "id, slug, name, color, icon, active";
const MUNICIPALITY_COLUMNS = "id, state_id, name, inegi_code";

export type DirectoryData = DirectoryLookups & { facilities: DirectoryFacility[] };

async function loadCategories(supabase: ServerSupabase): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from("facility_categories")
    .select(CATEGORY_COLUMNS)
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

/**
 * Municipios con instalaciones. Se lee el catálogo completo de los estados
 * involucrados (a lo sumo los 2,478 del país) para distinguir con la clave
 * INEGI los nombres repetidos dentro de un estado (Oaxaca), aunque solo uno de
 * ellos tenga instalaciones.
 */
async function loadMunicipalities(supabase: ServerSupabase, stateIds: number[], ids: number[]): Promise<MunicipalityOption[]> {
  if (ids.length === 0 || stateIds.length === 0) return [];
  const catalog = await fetchAll<MunicipalityRow>((from, to) =>
    supabase.from("municipalities").select(MUNICIPALITY_COLUMNS).in("state_id", stateIds).order("id").range(from, to),
  );
  return buildMunicipalityOptions(catalog, new Set(ids));
}

/** ¿Hay otro municipio con el mismo nombre en el mismo estado? */
async function hasRepeatedName(supabase: ServerSupabase, row: MunicipalityRow): Promise<boolean> {
  const { count, error } = await supabase
    .from("municipalities")
    .select("id", { count: "exact", head: true })
    .eq("state_id", row.state_id)
    .eq("name", row.name);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 1;
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
    loadMunicipalities(supabase, stateIds, municipalityIds),
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
      ? supabase.from("facility_categories").select(CATEGORY_COLUMNS).eq("id", facility.categoryId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    facility.stateId != null
      ? supabase.from("states").select("id, name, abbreviation").eq("id", facility.stateId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    facility.municipalityId != null
      ? supabase.from("municipalities").select(MUNICIPALITY_COLUMNS).eq("id", facility.municipalityId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // Un error de catálogo no debe mostrarse como «Sin dato registrado»: lo atiende error.tsx.
  const lookupError = category.error ?? state.error ?? municipality.error;
  if (lookupError) throw new Error(lookupError.message);

  const municipalityRow = municipality.data ?? null;
  const repeated = municipalityRow ? await hasRepeatedName(supabase, municipalityRow) : false;

  return {
    facility,
    category: category.data ?? null,
    state: state.data ?? null,
    municipality: municipalityRow ? toMunicipalityOption(municipalityRow, repeated) : null,
  };
});
