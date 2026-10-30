-- =====================================================================
-- 0014 · Archivar un año para liberar espacio de almacenamiento
-- Los archivos (PDF e imágenes) son lo que ocupa el 1 GB gratuito; los datos
-- pesan muy poco. Al archivar un año CERRADO, el superadmin descarga una copia
-- verificada y borra solo los archivos del sistema: las evidencias, puntajes,
-- ranking, informes e historial se conservan. Cada archivo borrado queda
-- marcado con «archivado_en» y deja de contar en el uso del almacenamiento.
-- Ejecutar después de 0013. Es idempotente.
-- =====================================================================

alter table public.archivos add column if not exists archivado_en timestamptz;
comment on column public.archivos.archivado_en is
    'Fecha en que el archivo se descargó y se borró del almacenamiento. La fila se conserva como registro.';

-- El uso del almacenamiento no cuenta los archivos archivados.
create or replace function public.uso_almacenamiento()
returns table (usado bigint, cuota bigint, archivos bigint)
language sql stable security definer set search_path = ''
as $$
    select coalesce(sum(a.tamano), 0)::bigint,
           coalesce((select s.valor::bigint from public.ajustes s where s.clave = 'cuota_bytes'), 1073741824),
           count(*)::bigint
    from public.archivos a
    where public.puede_leer_todo() and a.archivado_en is null
$$;

-- ¿El año tiene fila en «periodos» y está cerrado (a mano o por fecha)?
create or replace function interno.anio_cerrado(p_anio integer) returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.periodos p where p.anio = p_anio) and not interno.periodo_abierto(p_anio)
$$;

-- El superadmin puede borrar del almacenamiento los archivos de años cerrados.
create or replace function public.puede_borrar_ruta_archivada(p_ruta text) returns boolean
language sql stable security definer set search_path = ''
as $$
    select public.es_superadmin() and exists (
        select 1 from public.archivos a
        join public.evidencias e on e.id = a.evidencia_id
        where a.ruta = p_ruta and interno.anio_cerrado(e.anio))
$$;

-- ¿La ruta es un archivo subido por el docente? (la responsable no puede borrarlos)
create or replace function public.ruta_es_de_docente(p_ruta text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.archivos a where a.ruta = p_ruta and a.origen = 'docente') $$;

drop policy if exists evidencias_storage_borra on storage.objects;
create policy evidencias_storage_borra on storage.objects for delete to authenticated
    using (bucket_id = 'evidencias'
           and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                 and public.evidencia_editable((storage.foldername(name))[2])
                 and not public.ruta_es_de_validador(name))
                -- La responsable solo quita sus propios adjuntos, nunca los archivos del docente.
                or (public.puede_adjuntar_ruta(name) and not public.ruta_es_de_docente(name))
                or public.puede_borrar_ruta_archivada(name)));

-- Archivos de un año con los datos para ordenar la copia (solo superadmin).
create or replace function public.archivos_anio(p_anio integer)
returns table (archivo_id uuid, evidencia_id uuid, docente_id uuid, docente text, tipo_nombre text, resumen text,
               ruta text, nombre text, tamano bigint, sha256 text, rol text, origen text, archivado_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.es_superadmin() then
        raise exception 'Solo el superadmin puede archivar años' using errcode = '42501';
    end if;
    return query
    select a.id, e.id, e.docente_id, coalesce(u.apellidos_nombres, u.nombre), t.nombre,
           coalesce(e.datos ->> 'titulo', e.datos ->> 'nombre', e.datos ->> 'entidad', e.datos ->> 'revista', e.datos ->> 'estudiante', ''),
           a.ruta, a.nombre, a.tamano, a.sha256, a.rol, a.origen, a.archivado_en
    from public.archivos a
    join public.evidencias e on e.id = a.evidencia_id
    join public.usuarios u on u.id = e.docente_id
    join public.tipos_evidencia t on t.id = e.tipo_id
    where e.anio = p_anio
    order by coalesce(u.apellidos_nombres, u.nombre), e.creado_en, a.rol;
end;
$$;

-- Todos los datos de un año en JSON (para la copia). Solo superadmin.
create or replace function public.datos_anio(p_anio integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.es_superadmin() then
        raise exception 'Solo el superadmin puede archivar años' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'anio', p_anio,
        'generado_en', now(),
        'periodo', (select to_jsonb(p) from public.periodos p where p.anio = p_anio),
        'usuarios_anios', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.usuarios_anios a where a.anio = p_anio),
        'usuarios', (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.usuarios u
                     where u.id in (select usuario_id from public.usuarios_anios where anio = p_anio)
                        or u.id in (select docente_id from public.evidencias where anio = p_anio)),
        'evidencias', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.evidencias e where e.anio = p_anio),
        'archivos', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.archivos a
                     where a.evidencia_id in (select id from public.evidencias where anio = p_anio)),
        'historial', (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.historial h
                      where h.evidencia_id in (select id from public.evidencias where anio = p_anio))
    );
end;
$$;

-- Marca como archivados los archivos ya borrados del almacenamiento. Solo años cerrados.
create or replace function public.marcar_archivados(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare n integer;
begin
    if not public.es_superadmin() then
        raise exception 'Solo el superadmin puede archivar años' using errcode = '42501';
    end if;
    if exists (select 1 from public.archivos a join public.evidencias e on e.id = a.evidencia_id
               where a.id = any(p_ids) and not interno.anio_cerrado(e.anio)) then
        raise exception 'Solo se pueden archivar archivos de años cerrados' using errcode = '23514';
    end if;
    update public.archivos set archivado_en = now() where id = any(p_ids) and archivado_en is null;
    get diagnostics n = row_count;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'archivar_archivos', jsonb_build_object('archivos', n));
    return n;
end;
$$;

-- Un año con archivos archivados no se reabre: los archivos ya no están en el sistema.
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
    if p_abierto and exists (select 1 from public.archivos a join public.evidencias e on e.id = a.evidencia_id
                             where e.anio = p_anio and a.archivado_en is not null) then
        raise exception 'El año % tiene archivos archivados fuera del sistema: no se puede reabrir', p_anio using errcode = '23514';
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
    foreach f in array array['public.uso_almacenamiento()', 'public.puede_borrar_ruta_archivada(text)', 'public.ruta_es_de_docente(text)',
                             'public.archivos_anio(integer)', 'public.datos_anio(integer)',
                             'public.marcar_archivados(uuid[])', 'public.fijar_periodo(integer,boolean,date)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
