-- =============================================================================
-- Municipio obligatorio en instalaciones
-- =============================================================================
-- El directorio se organiza por estado → municipio → sede y la ficha de cada
-- instalación muestra su municipio. El formulario, la Server Action y la
-- importación ya lo exigen; aquí la base de datos lo garantiza. La llave
-- facilities_municipality_state_fk sigue exigiendo que pertenezca al estado.
-- =============================================================================

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from public.facilities where municipality_id is null;
  if v_missing > 0 then
    raise exception 'Hay % instalaciones sin municipio: asígnales uno antes de aplicar esta migración', v_missing
      using errcode = '23502';
  end if;
end;
$$;

alter table public.facilities alter column municipality_id set not null;
comment on column public.facilities.municipality_id is 'Municipio (obligatorio; del mismo estado, ver facilities_municipality_state_fk).';
