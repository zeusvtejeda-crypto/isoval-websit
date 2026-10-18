-- =============================================================================
-- Límite de intentos: reserva atómica y ventana deslizante
-- - Antes se consultaba el bloqueo y el fallo se registraba después de llamar a
--   Auth: varias solicitudes simultáneas pasaban todas la consulta. Ahora cada
--   intento se reserva (se cuenta) antes de llamar a Auth, en una sola llamada
--   con las filas bloqueadas; acertar devuelve la reserva (limpia la clave) y un
--   error del servicio de acceso (429 o 5xx) la reembolsa.
-- - Ventana deslizante igual que los contadores en memoria: se guardan las horas
--   de los intentos recientes y se bloquea al llegar al máximo dentro de la ventana.
-- - Las claves con reserva son IP + correo, correo y cuenta (cambio de
--   contraseña); la IP sola se cuenta después del fallo (una red compartida con
--   muchos accesos correctos no debe agotar su umbral), pero su bloqueo también
--   se respeta al reservar.
-- El contenido de app.rate_limits es efímero: se recrea la tabla.
-- =============================================================================

drop function if exists public.rate_limit_retry_after(jsonb);
drop function if exists public.rate_limit_fail(jsonb);
drop function if exists public.rate_limit_clear(jsonb);
drop table if exists app.rate_limits;

create table app.rate_limits (
  scope text not null check (scope in ('pair', 'ip', 'email', 'password')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempts timestamptz[] not null default '{}',
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);
comment on table app.rate_limits is
  'Intentos recientes de inicio de sesión y de cambio de contraseña por huella de clave (IP, correo, IP+correo o cuenta). No guarda los datos originales.';
create index rate_limits_updated_idx on app.rate_limits (updated_at);
alter table app.rate_limits enable row level security;
revoke all on table app.rate_limits from public, anon, authenticated;

-- Lee y bloquea las filas de los elementos (en orden fijo, sin interbloqueos),
-- descarta intentos fuera de la ventana y bloqueos vencidos.
-- p_items: [{"scope", "key", "max", "window_ms", "block_ms", "reserve"?}]
create or replace function app.rate_limit_load(p_items jsonb)
returns table (scope text, key_hash text, max integer, window_ms bigint, block_ms bigint, reserve boolean, attempts timestamptz[], blocked_until timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 10 then
    raise exception 'Solicitud de límite inválida' using errcode = '22023';
  end if;
  for v_item in
    select * from jsonb_to_recordset(p_items) as i(scope text, key text, max integer, window_ms bigint, block_ms bigint, reserve boolean)
  loop
    if v_item.max is null or v_item.max < 1 or v_item.window_ms is null or v_item.window_ms < 1000 or v_item.block_ms is null or v_item.block_ms < 1000 then
      raise exception 'Parámetros de límite inválidos' using errcode = '22023';
    end if;
    insert into app.rate_limits (scope, key_hash) values (v_item.scope, v_item.key) on conflict on constraint rate_limits_pkey do nothing;
  end loop;

  return query
  with items as (
    select * from jsonb_to_recordset(p_items) as i(scope text, key text, max integer, window_ms bigint, block_ms bigint, reserve boolean)
  ),
  locked as (
    select r.* from app.rate_limits r
    join items i on i.scope = r.scope and i.key = r.key_hash
    order by r.scope, r.key_hash
    for update of r
  )
  select i.scope, i.key, i.max, i.window_ms, i.block_ms, coalesce(i.reserve, false),
    -- Un bloqueo vencido reinicia la cuenta; si no, solo los intentos dentro de la ventana.
    case
      when l.blocked_until is not null and l.blocked_until <= now() then '{}'::timestamptz[]
      else coalesce((select array_agg(a order by a) from unnest(l.attempts) as a
                     where a > now() - make_interval(secs => i.window_ms / 1000.0)), '{}'::timestamptz[])
    end,
    case when l.blocked_until > now() then l.blocked_until end
  from items i join locked l on l.scope = i.scope and l.key_hash = i.key;
end;
$$;

revoke all on function app.rate_limit_load(jsonb) from public, anon, authenticated;

-- Reserva un intento: si alguna clave está bloqueada devuelve la espera (ms) sin
-- contar nada; si no, cuenta el intento en las claves con "reserve" y devuelve 0.
create or replace function public.rate_limit_attempt(p_items jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_wait bigint := 0;
  v_attempts timestamptz[];
  v_blocked timestamptz;
begin
  -- Primera lectura (bloquea las filas): ¿alguna clave está bloqueada? La
  -- segunda devuelve lo mismo (misma transacción, mismo now()) para aplicar.
  select coalesce(max(greatest(0, floor(extract(epoch from (r.blocked_until - now())) * 1000))), 0)::bigint
    into v_wait from app.rate_limit_load(p_items) r where r.blocked_until is not null;

  for v_row in select * from app.rate_limit_load(p_items) loop
    v_attempts := v_row.attempts;
    v_blocked := v_row.blocked_until;
    if v_wait = 0 and v_row.reserve then
      v_attempts := v_attempts || now();
      if cardinality(v_attempts) >= v_row.max then
        v_blocked := now() + make_interval(secs => v_row.block_ms / 1000.0);
      end if;
    end if;
    update app.rate_limits
    set attempts = v_attempts, blocked_until = v_blocked, updated_at = now()
    where scope = v_row.scope and key_hash = v_row.key_hash;
  end loop;
  return v_wait;
end;
$$;

-- Fallo contado después del intento (la IP sola): igual que FailureLimiter.fail,
-- al llegar al máximo bloquea y vacía la cuenta.
create or replace function public.rate_limit_fail(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_attempts timestamptz[];
  v_blocked timestamptz;
begin
  for v_row in select * from app.rate_limit_load(p_items) loop
    v_attempts := v_row.attempts || now();
    v_blocked := v_row.blocked_until;
    if cardinality(v_attempts) >= v_row.max then
      v_blocked := now() + make_interval(secs => v_row.block_ms / 1000.0);
      v_attempts := '{}';
    end if;
    update app.rate_limits
    set attempts = v_attempts, blocked_until = v_blocked, updated_at = now()
    where scope = v_row.scope and key_hash = v_row.key_hash;
  end loop;

  -- Limpieza ocasional de claves sin actividad ni bloqueo vigente.
  if random() < 0.02 then
    delete from app.rate_limits
    where updated_at < now() - interval '1 day'
      and (blocked_until is null or blocked_until < now());
  end if;
end;
$$;

-- Devuelve la última reserva (error del servicio de acceso, no de credenciales):
-- quita el intento más reciente y, si con ello ya no llega al máximo, el bloqueo.
create or replace function public.rate_limit_refund(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_attempts timestamptz[];
  v_blocked timestamptz;
begin
  for v_row in select * from app.rate_limit_load(p_items) loop
    v_attempts := v_row.attempts;
    v_blocked := v_row.blocked_until;
    if cardinality(v_attempts) > 0 then
      v_attempts := v_attempts[1:cardinality(v_attempts) - 1];
      if v_blocked is not null and cardinality(v_attempts) < v_row.max then
        v_blocked := null;
      end if;
    end if;
    update app.rate_limits
    set attempts = v_attempts, blocked_until = v_blocked, updated_at = now()
    where scope = v_row.scope and key_hash = v_row.key_hash;
  end loop;
end;
$$;

-- Acertar: limpia las claves indicadas (el servidor nunca incluye la IP sola).
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

revoke all on function public.rate_limit_attempt(jsonb) from public, anon, authenticated;
revoke all on function public.rate_limit_fail(jsonb) from public, anon, authenticated;
revoke all on function public.rate_limit_refund(jsonb) from public, anon, authenticated;
revoke all on function public.rate_limit_clear(jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_attempt(jsonb) to service_role;
grant execute on function public.rate_limit_fail(jsonb) to service_role;
grant execute on function public.rate_limit_refund(jsonb) to service_role;
grant execute on function public.rate_limit_clear(jsonb) to service_role;
