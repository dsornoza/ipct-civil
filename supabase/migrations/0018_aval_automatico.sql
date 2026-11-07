-- =====================================================================
-- 0018 · Aval de la Comisión generado por el sistema
-- Cuando una obra (artículo, libro, capítulo, ponencia, patente o software) es
-- resultado de un proyecto, el sistema genera el aval en PDF al validarla; se
-- imprime, se firma, se escanea y se adjunta aquí como archivo «aval».
-- La evidencia ya está validada, así que hace falta permitir ese adjunto:
--   · lo sube quien puede validar y NO es autor ni coautor de la obra;
--   · solo con la función «aval» y solo si el docente declaró que deriva de proyecto.
-- Ejecutar después de 0017. Es idempotente.
-- =====================================================================

create or replace function public.puede_adjuntar_aval(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_validar() and exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and e.titular_id is null
          and e.estado = 'validada'
          and e.docente_id <> public.mi_usuario_id()
          and e.datos ->> 'deriva_proyecto' = 'Sí'
          and not exists (select 1 from public.evidencias c
                          where c.titular_id = e.id and c.docente_id = public.mi_usuario_id())
    );
exception when others then
    return false;
end;
$$;

create or replace function public.puede_adjuntar_aval_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_adjuntar_aval(split_part(p_ruta, '/', 2))
       and exists (select 1 from public.evidencias e
                   where e.id = split_part(p_ruta, '/', 2)::uuid
                     and e.docente_id::text = split_part(p_ruta, '/', 1));
exception when others then
    return false;
end;
$$;

-- Archivos: el aval se agrega (o se reemplaza) también con la evidencia validada.
drop policy if exists archivos_inserta on public.archivos;
create policy archivos_inserta on public.archivos for insert to authenticated
    with check (
        ((origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text)))
         or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text))
         or (origen = 'validador' and rol = 'aval' and public.puede_adjuntar_aval(evidencia_id::text)))
        and exists (select 1 from public.evidencias e
                    where e.id = evidencia_id
                      and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_borra on public.archivos;
create policy archivos_borra on public.archivos for delete to authenticated
    using ((origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text)))
           or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text))
           or (origen = 'validador' and rol = 'aval' and public.puede_adjuntar_aval(evidencia_id::text)));

-- Storage (ruta «docente_id/evidencia_id/archivo»)
drop policy if exists evidencias_storage_inserta on storage.objects;
create policy evidencias_storage_inserta on storage.objects for insert to authenticated
    with check (bucket_id = 'evidencias'
                and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                      and public.evidencia_editable((storage.foldername(name))[2])
                      and lower(name) like '%.pdf')
                     or (public.puede_adjuntar_ruta(name) and lower(name) ~ '\.(pdf|png|jpe?g|webp)$')
                     or (public.puede_adjuntar_aval_ruta(name) and lower(name) ~ '\.(pdf|png|jpe?g|webp)$')
                     or (public.es_registrada_por_mi_ruta(name) and lower(name) like '%.pdf')));

drop policy if exists evidencias_storage_borra on storage.objects;
create policy evidencias_storage_borra on storage.objects for delete to authenticated
    using (bucket_id = 'evidencias'
           and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                 and public.evidencia_editable((storage.foldername(name))[2])
                 and not public.ruta_es_de_validador(name))
                or (public.es_registrada_por_mi_ruta(name) and not public.ruta_es_de_validador(name))
                or (public.puede_adjuntar_ruta(name) and not public.ruta_es_de_docente(name))
                or (public.puede_adjuntar_aval_ruta(name) and not public.ruta_es_de_docente(name))
                or public.puede_borrar_ruta_archivada(name)));

do $$
declare f text;
begin
    foreach f in array array['public.puede_adjuntar_aval(text)', 'public.puede_adjuntar_aval_ruta(text)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
