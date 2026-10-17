-- =============================================================================
-- Ajustes para cargar catálogos oficiales (CLUES / INEGI)
-- =============================================================================

-- 1. Nombre oficial del municipio 011 de Nayarit según el catálogo del INEGI
--    (Marco Geoestadístico, servicio mgem/18): «Ruiz», sin acento.
update public.municipalities
set name = 'Ruiz'
where state_id = 18 and inegi_code = '011' and name <> 'Ruiz';

-- 2. En CLUES existen unidades distintas con el mismo nombre en el mismo
--    municipio (p. ej. una unidad médica rural y un centro de atención rural
--    obstétrica co-ubicados, cada uno con su propia clave). La clave de unidad
--    ya es única; el nombre normalizado + lugar solo se exige único cuando la
--    instalación no tiene clave de unidad.
drop index if exists public.facilities_name_place_uq;
create unique index facilities_name_place_uq
  on public.facilities (normalized_name, state_id, coalesce(municipality_id, 0))
  where unit_key is null;
