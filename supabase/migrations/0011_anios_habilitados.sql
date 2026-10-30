-- =====================================================================
-- 0011 · Años habilitados para la carga
-- Un año nace CERRADO: los docentes solo cargan en los años que la responsable
-- o el superadmin habilitan (y hasta su fecha de cierre, si la tiene).
--   · Sin fila en «periodos» = año no habilitado.
--   · Fila con abierto = true = habilitado (con cierre automático opcional).
--   · Fila con abierto = false = cerrado a mano.
-- Ejecutar después de 0010. Es idempotente.
-- =====================================================================

-- Los años ya evaluables quedan habilitados (para no cortar la carga en curso).
insert into public.periodos (anio, abierto)
select y, true
from generate_series(interno.ajuste_int('anio_inicio', extract(year from now())::integer),
                     extract(year from now())::integer) y
on conflict (anio) do nothing;

-- Habilitado = hay fila, está abierto y no pasó su fecha de cierre (inclusive).
create or replace function interno.periodo_abierto(p_anio integer) returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.periodos p
        where p.anio = p_anio
          and p.abierto
          and (p.cierra_el is null or (now() at time zone 'America/Guayaquil')::date <= p.cierra_el))
$$;

create or replace function interno.exigir_periodo_abierto(p_anio integer) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not interno.periodo_abierto(p_anio) then
        if exists (select 1 from public.periodos p where p.anio = p_anio) then
            raise exception 'La carga de evidencias del año % está cerrada', p_anio using errcode = '23514';
        end if;
        raise exception 'El año % aún no está habilitado para la carga de evidencias', p_anio using errcode = '23514';
    end if;
end;
$$;

-- Ya no se limita el año al calendario: lo controla la habilitación del año.
create or replace function interno.preparar_evidencia(p public.evidencias)
returns public.evidencias
language plpgsql security definer set search_path = ''
as $$
declare
    t        public.tipos_evidencia;
    campo    jsonb;
    grupo    jsonb;
    nom      text;
    completo boolean;
    clave    text;
begin
    select * into t from public.tipos_evidencia where id = p.tipo_id and activo;
    if t.id is null then
        raise exception 'Tipo de evidencia inexistente o inactivo' using errcode = '23514';
    end if;

    if p.anio < interno.ajuste_int('anio_inicio', 2000) then
        raise exception 'Año de evaluación fuera del rango permitido (desde %)',
            interno.ajuste_int('anio_inicio', 2000) using errcode = '23514';
    end if;

    -- Campos obligatorios del formulario.
    for campo in select * from jsonb_array_elements(t.esquema -> 'campos') loop
        if (campo ->> 'requerido')::boolean is true
           and btrim(coalesce(p.datos ->> (campo ->> 'nombre'), '')) = '' then
            raise exception 'Falta el campo obligatorio: %', campo ->> 'etiqueta' using errcode = '23514';
        end if;
    end loop;

    -- Clave anti-duplicado: el primer grupo de campos totalmente llenos.
    p.dedup_key := null;
    for grupo in select * from jsonb_array_elements(coalesce(t.esquema -> 'dedup' -> 'grupos', '[]'::jsonb)) loop
        completo := true;
        clave := '';
        for nom in select * from jsonb_array_elements_text(grupo) loop
            if btrim(coalesce(p.datos ->> nom, '')) = '' then
                completo := false;
                exit;
            end if;
            clave := clave || '|' || interno.normalizar_clave(p.datos ->> nom);
        end loop;
        if completo then
            p.dedup_key := t.grupo_dedup || ':' || clave;
            if (t.esquema -> 'dedup' ->> 'incluye_anio')::boolean is true then
                p.dedup_key := p.dedup_key || '|' || p.anio;
            end if;
            exit;
        end if;
    end loop;
    return p;
end;
$$;

-- Estado de un año: abierto = se puede cargar ahora; configurado = tiene fila.
drop function if exists public.estado_periodo(integer);
create function public.estado_periodo(p_anio integer)
returns table (anio integer, abierto boolean, cierra_el date, cierre_manual boolean, configurado boolean)
language sql stable security definer set search_path = ''
as $$
    select p_anio,
           interno.periodo_abierto(p_anio),
           (select p.cierra_el from public.periodos p where p.anio = p_anio),
           coalesce((select not p.abierto from public.periodos p where p.anio = p_anio), false),
           exists (select 1 from public.periodos p where p.anio = p_anio)
    where public.es_autorizado()
$$;

-- Años que ya fueron habilitados (con su estado actual): los que ven los docentes.
-- (la 0013 le agrega columnas)
drop function if exists public.periodos_visibles();
create function public.periodos_visibles()
returns table (anio integer, abierto boolean, cierra_el date)
language sql stable security definer set search_path = ''
as $$
    select p.anio, interno.periodo_abierto(p.anio), p.cierra_el
    from public.periodos p
    where public.es_autorizado()
    order by p.anio desc
$$;

-- Habilita, cierra o programa el cierre de un año (responsable o superadmin).
create or replace function public.fijar_periodo(p_anio integer, p_abierto boolean, p_cierra_el date default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el superadmin pueden habilitar o cerrar la carga' using errcode = '42501';
    end if;
    if p_anio < interno.ajuste_int('anio_inicio', 2000) or p_anio > extract(year from now())::integer + 5 then
        raise exception 'Año fuera del rango permitido' using errcode = '23514';
    end if;
    insert into public.periodos (anio, abierto, cierra_el, actualizado_por, actualizado_en)
    values (p_anio, p_abierto, p_cierra_el, public.mi_usuario_id(), now())
    on conflict (anio) do update
        set abierto = excluded.abierto, cierra_el = excluded.cierra_el,
            actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'periodo',
            jsonb_build_object('anio', p_anio, 'abierto', p_abierto, 'cierra_el', p_cierra_el));
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['public.estado_periodo(integer)', 'public.periodos_visibles()',
                             'public.fijar_periodo(integer,boolean,date)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
