-- =====================================================================
-- 0006 · Diagnóstico de sesión
-- Permite explicar a una persona por qué no tiene acceso (correo fuera de
-- la lista, inactivo, dominio distinto o proveedor inesperado). Solo
-- devuelve datos de SU PROPIO token; no consulta a otros usuarios.
-- =====================================================================
create or replace function public.diagnostico_sesion()
returns table (email text, proveedor text, dominio_correcto boolean, en_lista boolean, activo boolean)
language sql stable security definer set search_path = ''
as $$
    with t as (select lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) as correo)
    select t.correo,
           coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', ''),
           split_part(t.correo, '@', 2) =
               coalesce((select a.valor from public.ajustes a where a.clave = 'dominio_permitido'), ''),
           exists (select 1 from public.usuarios u where u.email = t.correo),
           coalesce((select u.activo from public.usuarios u where u.email = t.correo), false)
    from t
$$;

revoke all on function public.diagnostico_sesion() from public, anon;
grant execute on function public.diagnostico_sesion() to authenticated;
