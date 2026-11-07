-- =====================================================================
-- 0019 · Miembros de la Comisión de Investigación por año
-- Firman los avales. Los define la responsable del IPCT o el administrador, año por año
-- (la Comisión puede cambiar de un período a otro). Se guardan en «ajustes» con la clave
-- «comision_miembros_AAAA» (lista JSON de ids de usuario); la lectura ya la tienen los autorizados.
-- Si un año no tiene lista propia, la pantalla usa la del año anterior más reciente.
-- Ejecutar después de 0018. Es idempotente.
-- =====================================================================

create or replace function public.fijar_miembros_comision(p_anio integer, p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el administrador pueden definir los miembros de la Comisión' using errcode = '42501';
    end if;
    if p_anio < interno.ajuste_int('anio_inicio', 2000) or p_anio > extract(year from now())::integer + 5 then
        raise exception 'Año fuera del rango permitido' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.usuarios u where u.id = i and u.activo)) then
        raise exception 'Todos los miembros deben ser personas activas del sistema' using errcode = '23514';
    end if;
    insert into public.ajustes (clave, valor)
    values ('comision_miembros_' || p_anio, to_json(coalesce(p_ids, '{}'::uuid[]))::text)
    on conflict (clave) do update set valor = excluded.valor;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'miembros_comision', jsonb_build_object('anio', p_anio, 'miembros', coalesce(p_ids, '{}'::uuid[])));
end;
$$;

do $$
begin
    revoke all on function public.fijar_miembros_comision(integer, uuid[]) from public, anon;
    grant execute on function public.fijar_miembros_comision(integer, uuid[]) to authenticated;
end $$;
