-- =====================================================================
-- 0008 · Cuentas institucionales (p. ej. la cuenta de la Comisión)
-- Añade usuarios.evaluado: indica si la persona es evaluada por el IPCT.
--   evaluado = true  (por defecto): carga evidencias y aparece en el ranking.
--   evaluado = false: cuenta de gestión (valida/consulta). No carga evidencias
--                     ni aparece en el ranking; así nunca tiene evidencias propias
--                     y puede validar las de cualquier docente.
-- =====================================================================
alter table public.usuarios add column if not exists evaluado boolean not null default true;
comment on column public.usuarios.evaluado is
    'true: es evaluado por el IPCT (carga evidencias, aparece en el ranking). false: cuenta de gestión.';

-- Se recrea con el mismo cuerpo para que tome la nueva columna de la tabla.
create or replace function public.mi_usuario()
returns public.usuarios
language sql stable security definer set search_path = ''
as $$
    select u.*
    from public.usuarios u
    where u.activo
      and u.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
      and split_part(u.email, '@', 2) =
          (select a.valor from public.ajustes a where a.clave = 'dominio_permitido')
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
    limit 1
$$;

-- Cargar evidencias: rol permitido Y ser evaluado.
create or replace function public.puede_cargar() returns boolean
language sql stable security definer set search_path = ''
as $$
    select coalesce(public.mi_rol() in ('docente','responsable_ipct','superadmin')
                    and (public.mi_usuario()).evaluado, false)
$$;

-- El perfil que recibe la interfaz incluye ahora «evaluado».
drop function if exists public.vincular_sesion();
create function public.vincular_sesion()
returns table (id uuid, email text, nombre text, rol text, programa text, evaluado boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
    u public.usuarios := public.mi_usuario();
begin
    if u.id is null then
        return;
    end if;
    update public.usuarios set auth_user_id = auth.uid()
     where public.usuarios.id = u.id and auth_user_id is distinct from auth.uid();
    return query select u.id, u.email, u.nombre, u.rol, u.programa, u.evaluado;
end;
$$;
revoke all on function public.vincular_sesion() from public, anon;
grant execute on function public.vincular_sesion() to authenticated;

-- El ranking solo incluye a las personas evaluadas.
create or replace function public.ranking(p_anio integer)
returns table (posicion bigint, usuario_id uuid, nombre text, ii integer, iid integer, ivs integer, total integer, nivel text)
language sql stable security definer set search_path = ''
as $$
    select rank() over (order by coalesce(i.total, 0) desc),
           u.id, u.nombre,
           coalesce(i.ii, 0), coalesce(i.iid, 0), coalesce(i.ivs, 0), coalesce(i.total, 0),
           public.nivel_de(coalesce(i.total, 0))
    from public.usuarios u
    left join interno.v_ipct i on i.docente_id = u.id and i.anio = p_anio
    where public.es_autorizado()
      and u.activo and u.evaluado and u.rol in ('docente','responsable_ipct','superadmin')
    order by 1, u.nombre
$$;
