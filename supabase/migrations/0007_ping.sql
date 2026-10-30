-- =====================================================================
-- 0007 · Función de «latido» para la acción diaria de GitHub
-- Responde 1 sin leer ningún dato. Permite comprobar que la API y la base
-- de datos están activas (evita la pausa del plan gratuito) sin dar a
-- usuarios anónimos acceso a ninguna tabla.
-- =====================================================================
create or replace function public.ping() returns integer
language sql stable security invoker set search_path = ''
as $$ select 1 $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
