-- =============================================================================
-- Límite de intentos fallidos compartido entre instancias
-- Antes vivía en la memoria de cada instancia del servidor: con varias
-- instancias, cada una contaba por separado. Ahora se guarda en la base.
-- - Solo la llave de servicio (el servidor) puede usar estas funciones: así
--   nadie puede provocar bloqueos dirigidos llamándolas desde el navegador.
-- - No se guardan correos ni IP: el servidor envía una huella HMAC de cada clave.
-- - Misma regla que antes: N fallos dentro de la ventana bloquean durante el
--   periodo indicado; acertar limpia las claves que el servidor indique.
-- =============================================================================

create table app.rate_limits (
  scope text not null check (scope in ('pair', 'ip', 'email', 'password')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  primary key (scope, key_hash)
);
comment on table app.rate_limits is
  'Intentos fallidos de inicio de sesión y de cambio de contraseña por huella de clave (IP, correo, IP+correo o cuenta). No guarda los datos originales.';
create index rate_limits_cleanup_idx on app.rate_limits (window_started_at);
alter table app.rate_limits enable row level security;
revoke all on table app.rate_limits from public, anon, authenticated;

-- Milisegundos de bloqueo restantes (el máximo entre las claves; 0 = permitido).
-- p_items: [{"scope": "...", "key": "<huella>"}]
create or replace function public.rate_limit_retry_after(p_items jsonb)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(greatest(0, floor(extract(epoch from (r.blocked_until - now())) * 1000)))::bigint, 0)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(scope text, key text)
  join app.rate_limits r on r.scope = i.scope and r.key_hash = i.key
  where r.blocked_until > now();
$$;

-- Registra un fallo en cada clave y devuelve el bloqueo resultante (ms).
-- p_items: [{"scope", "key", "max", "window_ms", "block_ms"}]
create or replace function public.rate_limit_fail(p_items jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_row app.rate_limits;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 10 then
    raise exception 'Solicitud de límite inválida' using errcode = '22023';
  end if;
  for v_item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(scope text, key text, max integer, window_ms bigint, block_ms bigint)
  loop
    if v_item.max is null or v_item.max < 1 or v_item.window_ms is null or v_item.window_ms < 1000 or v_item.block_ms is null or v_item.block_ms < 1000 then
      raise exception 'Parámetros de límite inválidos' using errcode = '22023';
    end if;
    insert into app.rate_limits (scope, key_hash) values (v_item.scope, v_item.key)
    on conflict (scope, key_hash) do nothing;
    select * into v_row from app.rate_limits where scope = v_item.scope and key_hash = v_item.key for update;
    -- Ventana vencida: se empieza a contar de nuevo.
    if v_row.window_started_at <= now() - make_interval(secs => v_item.window_ms / 1000.0) then
      v_row.failures := 0;
      v_row.window_started_at := now();
    end if;
    v_row.failures := v_row.failures + 1;
    if v_row.failures >= v_item.max then
      v_row.blocked_until := now() + make_interval(secs => v_item.block_ms / 1000.0);
      v_row.failures := 0;
      v_row.window_started_at := now();
    end if;
    update app.rate_limits
    set failures = v_row.failures, window_started_at = v_row.window_started_at, blocked_until = v_row.blocked_until
    where scope = v_item.scope and key_hash = v_item.key;
  end loop;

  -- Limpieza ocasional de claves sin fallos recientes ni bloqueo vigente.
  if random() < 0.02 then
    delete from app.rate_limits
    where window_started_at < now() - interval '1 day'
      and (blocked_until is null or blocked_until < now());
  end if;

  return public.rate_limit_retry_after(p_items);
end;
$$;

-- Acertar: limpia las claves indicadas (el servidor nunca incluye la de la IP sola).
create or replace function public.rate_limit_clear(p_items jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from app.rate_limits r
  using jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(scope text, key text)
  where r.scope = i.scope and r.key_hash = i.key;
$$;

revoke all on function public.rate_limit_retry_after(jsonb) from public, anon, authenticated;
revoke all on function public.rate_limit_fail(jsonb) from public, anon, authenticated;
revoke all on function public.rate_limit_clear(jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_retry_after(jsonb) to service_role;
grant execute on function public.rate_limit_fail(jsonb) to service_role;
grant execute on function public.rate_limit_clear(jsonb) to service_role;
