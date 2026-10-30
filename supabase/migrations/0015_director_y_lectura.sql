-- =====================================================================
-- 0015 · Director de Investigación, acceso con vencimiento y copia ZIP
--   · Rol «director_investigacion»: solo lectura, igual que calidad y coordinadora.
--   · usuarios.acceso_hasta (opcional): después de esa fecha la cuenta deja de
--     tener acceso, sin necesidad de desactivarla a mano.
--   · Los roles de lectura pueden descargar la copia ZIP de las evidencias de un
--     año (archivos_anio y datos_anio ya no son solo del superadmin; borrar y
--     archivar siguen siendo solo del superadmin).
-- Ejecutar después de 0014. Es idempotente.
-- =====================================================================

alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios add constraint usuarios_rol_check
    check (rol in ('docente','responsable_ipct','calidad','coordinadora','director_investigacion','superadmin'));

alter table public.usuarios add column if not exists acceso_hasta date;
comment on column public.usuarios.acceso_hasta is
    'Último día (inclusive) con acceso. Vacío = sin vencimiento. Después de esa fecha la persona no puede ingresar.';

-- Lectura de todo: responsable, calidad, coordinadora, director de investigación y superadmin.
create or replace function public.puede_leer_todo() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() in ('responsable_ipct','calidad','coordinadora','director_investigacion','superadmin'), false) $$;

-- Identidad del usuario: ahora también respeta acceso_hasta (se recrea para tomar la columna nueva).
create or replace function public.mi_usuario()
returns public.usuarios
language sql stable security definer set search_path = ''
as $$
    select u.*
    from public.usuarios u
    where u.activo
      and (u.acceso_hasta is null or (now() at time zone 'America/Guayaquil')::date <= u.acceso_hasta)
      and u.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
      and split_part(u.email, '@', 2) =
          (select a.valor from public.ajustes a where a.clave = 'dominio_permitido')
      and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
    limit 1
$$;

-- La responsable también gestiona al Director (solo lectura).
drop policy if exists usuarios_responsable_inserta on public.usuarios;
create policy usuarios_responsable_inserta on public.usuarios for insert to authenticated
    with check ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora','director_investigacion'));
drop policy if exists usuarios_responsable_actualiza on public.usuarios;
create policy usuarios_responsable_actualiza on public.usuarios for update to authenticated
    using ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora','director_investigacion'))
    with check ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora','director_investigacion'));

-- Diagnóstico de sesión: ahora indica si el acceso venció.
drop function if exists public.diagnostico_sesion();
create function public.diagnostico_sesion()
returns table (email text, proveedor text, dominio_correcto boolean, en_lista boolean, activo boolean, vencido boolean)
language sql stable security definer set search_path = ''
as $$
    with t as (select lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) as correo)
    select t.correo,
           coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', ''),
           split_part(t.correo, '@', 2) =
               coalesce((select a.valor from public.ajustes a where a.clave = 'dominio_permitido'), ''),
           exists (select 1 from public.usuarios u where u.email = t.correo),
           coalesce((select u.activo from public.usuarios u where u.email = t.correo), false),
           coalesce((select u.acceso_hasta is not null and (now() at time zone 'America/Guayaquil')::date > u.acceso_hasta
                     from public.usuarios u where u.email = t.correo), false)
    from t
$$;

-- Copia de un año: la pueden pedir los roles de lectura (con «estado» para poder filtrar).
drop function if exists public.archivos_anio(integer);
create function public.archivos_anio(p_anio integer)
returns table (archivo_id uuid, evidencia_id uuid, docente_id uuid, docente text, tipo_nombre text, resumen text,
               ruta text, nombre text, tamano bigint, sha256 text, rol text, origen text, archivado_en timestamptz, estado text)
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.puede_leer_todo() then
        raise exception 'No tiene permiso para descargar las evidencias' using errcode = '42501';
    end if;
    return query
    select a.id, e.id, e.docente_id, coalesce(u.apellidos_nombres, u.nombre), t.nombre,
           coalesce(e.datos ->> 'titulo', e.datos ->> 'nombre', e.datos ->> 'entidad', e.datos ->> 'revista', e.datos ->> 'estudiante', ''),
           a.ruta, a.nombre, a.tamano, a.sha256, a.rol, a.origen, a.archivado_en, e.estado
    from public.archivos a
    join public.evidencias e on e.id = a.evidencia_id
    join public.usuarios u on u.id = e.docente_id
    join public.tipos_evidencia t on t.id = e.tipo_id
    where e.anio = p_anio
    order by coalesce(u.apellidos_nombres, u.nombre), e.creado_en, a.rol;
end;
$$;

create or replace function public.datos_anio(p_anio integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.puede_leer_todo() then
        raise exception 'No tiene permiso para descargar las evidencias' using errcode = '42501';
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

do $$
declare f text;
begin
    foreach f in array array['public.puede_leer_todo()', 'public.mi_usuario()', 'public.diagnostico_sesion()',
                             'public.archivos_anio(integer)', 'public.datos_anio(integer)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
