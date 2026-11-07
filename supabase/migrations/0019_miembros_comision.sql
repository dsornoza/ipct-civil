-- =====================================================================
-- 0019 · Miembros de la Comisión de Investigación por período académico
-- Firman los avales. Los define la responsable del IPCT o el administrador en cada período académico
-- ordinario: PI-AAAA (abril–septiembre de AAAA) y PII-AAAA (octubre de AAAA a marzo del año siguiente).
-- Se guardan en «ajustes» con la clave «comision_miembros_PI-AAAA» o «comision_miembros_PII-AAAA»
-- (lista JSON de ids de usuario). La lectura ya la tienen los autorizados.
-- Si un período no tiene lista propia, la pantalla usa la del período anterior más reciente.
-- Ejecutar después de 0018. Es idempotente.
-- =====================================================================

drop function if exists public.fijar_miembros_comision(integer, uuid[]);

create or replace function public.fijar_miembros_comision(p_periodo text, p_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el administrador pueden definir los miembros de la Comisión' using errcode = '42501';
    end if;
    if p_periodo !~ '^PII?-[0-9]{4}$'
       or split_part(p_periodo, '-', 2)::integer < interno.ajuste_int('anio_inicio', 2000)
       or split_part(p_periodo, '-', 2)::integer > extract(year from now())::integer + 5 then
        raise exception 'Período fuera del rango permitido' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(p_ids) i where not exists (select 1 from public.usuarios u where u.id = i and u.activo)) then
        raise exception 'Todos los miembros deben ser personas activas del sistema' using errcode = '23514';
    end if;
    insert into public.ajustes (clave, valor)
    values ('comision_miembros_' || p_periodo, to_json(coalesce(p_ids, '{}'::uuid[]))::text)
    on conflict (clave) do update set valor = excluded.valor;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'miembros_comision', jsonb_build_object('periodo', p_periodo, 'miembros', coalesce(p_ids, '{}'::uuid[])));
end;
$$;

do $$
begin
    revoke all on function public.fijar_miembros_comision(text, uuid[]) from public, anon;
    grant execute on function public.fijar_miembros_comision(text, uuid[]) to authenticated;
end $$;
