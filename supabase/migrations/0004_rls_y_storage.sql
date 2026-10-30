-- =====================================================================
-- 0004 · Seguridad: RLS, bucket privado de Storage y permisos
-- La interfaz solo refleja estos permisos; la autorización real está aquí.
-- =====================================================================

-- Sin acceso anónimo a nada de public.
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all sequences in schema public from anon;

alter table public.ajustes         enable row level security;
alter table public.niveles         enable row level security;
alter table public.tipos_evidencia enable row level security;
alter table public.usuarios        enable row level security;
alter table public.evidencias      enable row level security;
alter table public.archivos        enable row level security;
alter table public.historial       enable row level security;

-- Catálogo y ajustes: leen los autorizados; modifica el superadmin.
do $$
declare t text;
begin
    foreach t in array array['ajustes','niveles','tipos_evidencia'] loop
        execute format('drop policy if exists %I on public.%I', t || '_lee', t);
        execute format('create policy %I on public.%I for select to authenticated using (public.es_autorizado())', t || '_lee', t);
        execute format('drop policy if exists %I on public.%I', t || '_escribe', t);
        execute format('create policy %I on public.%I for all to authenticated using (public.es_superadmin()) with check (public.es_superadmin())', t || '_escribe', t);
    end loop;
end $$;

-- Usuarios: cada quien ve su fila; lectores ven todas; solo el superadmin escribe.
drop policy if exists usuarios_lee on public.usuarios;
create policy usuarios_lee on public.usuarios for select to authenticated
    using (id = (select public.mi_usuario_id()) or (select public.puede_leer_todo()));
drop policy if exists usuarios_escribe on public.usuarios;
create policy usuarios_escribe on public.usuarios for all to authenticated
    using ((select public.es_superadmin())) with check ((select public.es_superadmin()));

-- Evidencias.
drop policy if exists evidencias_lee on public.evidencias;
create policy evidencias_lee on public.evidencias for select to authenticated
    using (docente_id = (select public.mi_usuario_id()) or (select public.puede_leer_todo()));

drop policy if exists evidencias_inserta on public.evidencias;
create policy evidencias_inserta on public.evidencias for insert to authenticated
    with check (docente_id = (select public.mi_usuario_id()) and (select public.puede_cargar()));

drop policy if exists evidencias_docente_actualiza on public.evidencias;
create policy evidencias_docente_actualiza on public.evidencias for update to authenticated
    using (docente_id = (select public.mi_usuario_id()) and estado <> 'validada')
    with check (docente_id = (select public.mi_usuario_id()));

drop policy if exists evidencias_valida on public.evidencias;
create policy evidencias_valida on public.evidencias for update to authenticated
    using ((select public.puede_validar()) and docente_id <> (select public.mi_usuario_id()))
    with check ((select public.puede_validar()) and docente_id <> (select public.mi_usuario_id()));

drop policy if exists evidencias_docente_borra on public.evidencias;
create policy evidencias_docente_borra on public.evidencias for delete to authenticated
    using (docente_id = (select public.mi_usuario_id()) and estado <> 'validada');

-- Archivos (metadatos). La ruta debe ser «docente_id/evidencia_id/...».
drop policy if exists archivos_lee on public.archivos;
create policy archivos_lee on public.archivos for select to authenticated
    using ((select public.puede_leer_todo())
           or exists (select 1 from public.evidencias e
                      where e.id = evidencia_id and e.docente_id = (select public.mi_usuario_id())));

drop policy if exists archivos_inserta on public.archivos;
create policy archivos_inserta on public.archivos for insert to authenticated
    with check (public.evidencia_editable(evidencia_id::text)
                and exists (select 1 from public.evidencias e
                            where e.id = evidencia_id
                              and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_actualiza on public.archivos;
create policy archivos_actualiza on public.archivos for update to authenticated
    using (public.evidencia_editable(evidencia_id::text))
    with check (public.evidencia_editable(evidencia_id::text)
                and exists (select 1 from public.evidencias e
                            where e.id = evidencia_id
                              and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_borra on public.archivos;
create policy archivos_borra on public.archivos for delete to authenticated
    using (public.evidencia_editable(evidencia_id::text));

-- Historial: solo lectura (lo escribe el trigger).
drop policy if exists historial_lee on public.historial;
create policy historial_lee on public.historial for select to authenticated
    using ((select public.puede_leer_todo()) or docente_id = (select public.mi_usuario_id()));

-- Permisos de tabla para usuarios autenticados (RLS decide las filas).
grant usage on schema public to authenticated;
grant select on public.ajustes, public.niveles, public.tipos_evidencia, public.usuarios, public.historial to authenticated;
grant insert, update, delete on public.ajustes, public.niveles, public.tipos_evidencia, public.usuarios to authenticated;
grant select, insert, update, delete on public.evidencias, public.archivos to authenticated;

-- Funciones públicas: solo usuarios con sesión.
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privado «evidencias», solo PDF de hasta 5 MB.
-- Ruta: {usuario_id}/{evidencia_id}/{archivo}.pdf
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 5242880, array['application/pdf'])
on conflict (id) do update
    set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

drop policy if exists evidencias_storage_lee on storage.objects;
create policy evidencias_storage_lee on storage.objects for select to authenticated
    using (bucket_id = 'evidencias'
           and ((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                or (select public.puede_leer_todo())));

drop policy if exists evidencias_storage_inserta on storage.objects;
create policy evidencias_storage_inserta on storage.objects for insert to authenticated
    with check (bucket_id = 'evidencias'
                and (storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                and public.evidencia_editable((storage.foldername(name))[2]));

drop policy if exists evidencias_storage_actualiza on storage.objects;
create policy evidencias_storage_actualiza on storage.objects for update to authenticated
    using (bucket_id = 'evidencias'
           and (storage.foldername(name))[1] = (select public.mi_usuario_id())::text
           and public.evidencia_editable((storage.foldername(name))[2]));

drop policy if exists evidencias_storage_borra on storage.objects;
create policy evidencias_storage_borra on storage.objects for delete to authenticated
    using (bucket_id = 'evidencias'
           and (storage.foldername(name))[1] = (select public.mi_usuario_id())::text
           and public.evidencia_editable((storage.foldername(name))[2]));
