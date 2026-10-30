-- =====================================================================
-- 0009 · Etapa 5b: archivos múltiples, campos de la responsable, coautoría,
--        cierre de carga y gestión de usuarios por la responsable.
-- Ejecutar después de 0001-0008. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Usuarios: cédula y facultad (la carrera es la columna «programa»)
-- ---------------------------------------------------------------------
alter table public.usuarios add column if not exists cedula   text;
alter table public.usuarios add column if not exists facultad text not null default 'Ciencias Técnicas';
create unique index if not exists usuarios_cedula_uq on public.usuarios (cedula) where cedula is not null;

-- Se recrea para que tome las columnas nuevas de la tabla.
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

-- La responsable gestiona docentes, calidad y coordinadora (no asigna los roles
-- de responsable ni de superadmin, que son del superadmin).
drop policy if exists usuarios_responsable_inserta on public.usuarios;
create policy usuarios_responsable_inserta on public.usuarios for insert to authenticated
    with check ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora'));
drop policy if exists usuarios_responsable_actualiza on public.usuarios;
create policy usuarios_responsable_actualiza on public.usuarios for update to authenticated
    using ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora'))
    with check ((select public.mi_rol()) = 'responsable_ipct' and rol in ('docente','calidad','coordinadora'));

-- ---------------------------------------------------------------------
-- 2. Tipos: puntos >= 0 (los capítulos de libro solo se reportan)
-- ---------------------------------------------------------------------
alter table public.tipos_evidencia drop constraint if exists tipos_evidencia_puntos_check;
alter table public.tipos_evidencia add constraint tipos_evidencia_puntos_check check (puntos >= 0);

-- ---------------------------------------------------------------------
-- 3. Evidencias: coautoría, datos de la responsable y lista de verificación
-- ---------------------------------------------------------------------
alter table public.evidencias add column if not exists titular_id uuid references public.evidencias(id) on delete cascade;
alter table public.evidencias add column if not exists autoria jsonb not null default '{}'::jsonb;            -- {posicion, participacion}
alter table public.evidencias add column if not exists datos_validacion jsonb not null default '{}'::jsonb;   -- campos que completa la responsable
alter table public.evidencias add column if not exists verificacion jsonb not null default '[]'::jsonb;      -- ids de la lista marcados
create index if not exists evidencias_titular_idx on public.evidencias (titular_id) where titular_id is not null;
comment on column public.evidencias.titular_id is
    'Coautoría: id de la evidencia del autor titular (null si esta es la evidencia del titular o una evidencia sin coautores).';

-- ---------------------------------------------------------------------
-- 4. Archivos: varios por evidencia, cada uno con su función
-- ---------------------------------------------------------------------
alter table public.archivos drop constraint if exists archivos_evidencia_id_key;
alter table public.archivos add column if not exists rol    text not null default 'principal';
alter table public.archivos add column if not exists origen text not null default 'docente';
alter table public.archivos drop constraint if exists archivos_origen_check;
alter table public.archivos add constraint archivos_origen_check check (origen in ('docente','validador'));
alter table public.archivos drop constraint if exists archivos_ext_check;
alter table public.archivos add constraint archivos_ext_check
    check ((origen = 'docente' and lower(ruta) like '%.pdf')
        or (origen = 'validador' and lower(ruta) ~ '\.(pdf|png|jpe?g|webp)$'));
-- Un archivo del docente por función; la responsable puede adjuntar varios.
create unique index if not exists archivos_docente_rol_uq on public.archivos (evidencia_id, rol) where origen = 'docente';

-- ---------------------------------------------------------------------
-- 5. Cierre de carga por año y bitácora de gestión
-- ---------------------------------------------------------------------
create table if not exists public.periodos (
    anio            integer primary key,
    abierto         boolean not null default true,
    cierra_el       date,                       -- cierre automático (inclusive); null = sin fecha
    actualizado_por uuid,
    actualizado_en  timestamptz not null default now()
);
create table if not exists public.bitacora (
    id       bigint generated always as identity primary key,
    fecha    timestamptz not null default now(),
    actor_id uuid,
    accion   text not null,
    detalle  jsonb not null default '{}'::jsonb
);
alter table public.periodos enable row level security;
alter table public.bitacora enable row level security;
drop policy if exists periodos_lee on public.periodos;
create policy periodos_lee on public.periodos for select to authenticated using (public.es_autorizado());
drop policy if exists bitacora_lee on public.bitacora;
create policy bitacora_lee on public.bitacora for select to authenticated using ((select public.puede_leer_todo()));
revoke all on public.periodos, public.bitacora from anon;
grant select on public.periodos, public.bitacora to authenticated;

-- ¿Se pueden registrar o modificar evidencias de ese año?
create or replace function interno.periodo_abierto(p_anio integer) returns boolean
language sql stable security definer set search_path = ''
as $$
    select not exists (
        select 1 from public.periodos p
        where p.anio = p_anio
          and (not p.abierto or (p.cierra_el is not null and (now() at time zone 'America/Guayaquil')::date > p.cierra_el)))
$$;

create or replace function interno.exigir_periodo_abierto(p_anio integer) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not interno.periodo_abierto(p_anio) then
        raise exception 'La carga de evidencias del año % está cerrada', p_anio using errcode = '23514';
    end if;
end;
$$;

drop function if exists public.estado_periodo(integer);   -- la 0011 le agrega una columna
create or replace function public.estado_periodo(p_anio integer)
returns table (anio integer, abierto boolean, cierra_el date, cierre_manual boolean)
language sql stable security definer set search_path = ''
as $$
    select p_anio,
           interno.periodo_abierto(p_anio),
           (select p.cierra_el from public.periodos p where p.anio = p_anio),
           coalesce((select not p.abierto from public.periodos p where p.anio = p_anio), false)
    where public.es_autorizado()
$$;

-- Abre o cierra la carga de un año (responsable o superadmin). Reabrir sin fecha
-- quita el cierre automático.
create or replace function public.fijar_periodo(p_anio integer, p_abierto boolean, p_cierra_el date default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el superadmin pueden abrir o cerrar la carga' using errcode = '42501';
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

-- ---------------------------------------------------------------------
-- 6. Funciones de acceso
-- ---------------------------------------------------------------------
-- ¿La evidencia es del usuario, no está validada, no es coautoría y el año sigue abierto?
create or replace function public.evidencia_editable(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and e.docente_id = public.mi_usuario_id()
          and e.titular_id is null
          and e.estado <> 'validada'
          and interno.periodo_abierto(e.anio)
    );
exception when others then
    return false;
end;
$$;

-- La responsable puede adjuntar archivos a evidencias ajenas aún no validadas
-- (capturas de indexación, soportes de su retroalimentación). No si es coautora.
create or replace function public.puede_adjuntar(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_validar() and exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and e.titular_id is null
          and e.docente_id <> public.mi_usuario_id()
          and e.estado <> 'validada'
          and not exists (select 1 from public.evidencias c
                          where c.titular_id = e.id and c.docente_id = public.mi_usuario_id())
    );
exception when others then
    return false;
end;
$$;

-- Ruta «docente_id/evidencia_id/archivo»: la responsable puede adjuntar ahí.
create or replace function public.puede_adjuntar_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_adjuntar(split_part(p_ruta, '/', 2))
       and exists (select 1 from public.evidencias e
                   where e.id = split_part(p_ruta, '/', 2)::uuid
                     and e.docente_id::text = split_part(p_ruta, '/', 1));
exception when others then
    return false;
end;
$$;

-- ¿Es una evidencia mía o el titular de una coautoría mía? (para leer sus archivos)
create or replace function public.puede_ver_evidencia(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and (e.docente_id = public.mi_usuario_id()
               or exists (select 1 from public.evidencias c
                          where c.titular_id = e.id and c.docente_id = public.mi_usuario_id()))
    );
exception when others then
    return false;
end;
$$;

create or replace function public.puede_ver_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_ver_evidencia(split_part(p_ruta, '/', 2));
exception when others then
    return false;
end;
$$;

-- ¿La ruta corresponde a un archivo subido por la responsable?
create or replace function public.ruta_es_de_validador(p_ruta text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.archivos a where a.ruta = p_ruta and a.origen = 'validador') $$;

-- ---------------------------------------------------------------------
-- 7. Requisitos para validar: archivos, campos de la responsable y lista
-- ---------------------------------------------------------------------
create or replace function interno.exigir_requisitos_validacion(e public.evidencias)
returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
    t   public.tipos_evidencia;
    f   jsonb;
    arch jsonb;
begin
    select * into t from public.tipos_evidencia where id = e.tipo_id;
    arch := coalesce(t.esquema -> 'archivos', '[]'::jsonb);

    if jsonb_array_length(arch) = 0 then
        if not exists (select 1 from public.archivos a where a.evidencia_id = e.id) then
            raise exception 'No se puede validar una evidencia sin archivo PDF' using errcode = '23514';
        end if;
    end if;
    for f in select * from jsonb_array_elements(arch) loop
        if coalesce((f ->> 'obligatorio')::boolean, false)
           and not exists (select 1 from public.archivos a
                           where a.evidencia_id = e.id and a.rol = f ->> 'rol'
                             and a.origen = coalesce(f ->> 'quien', 'docente')) then
            raise exception 'Falta el archivo obligatorio: %', f ->> 'etiqueta' using errcode = '23514';
        end if;
    end loop;

    for f in select * from jsonb_array_elements(coalesce(t.esquema -> 'validador', '[]'::jsonb)) loop
        if coalesce((f ->> 'requerido')::boolean, false)
           and (not (f ? 'mostrar_si')
                or (e.datos_validacion ->> (f -> 'mostrar_si' ->> 'campo')) in
                   (select jsonb_array_elements_text(f -> 'mostrar_si' -> 'en')))
           and btrim(coalesce(e.datos_validacion ->> (f ->> 'nombre'), '')) = '' then
            raise exception 'Falta completar: %', f ->> 'etiqueta' using errcode = '23514';
        end if;
    end loop;

    for f in select * from jsonb_array_elements(coalesce(t.esquema -> 'verificacion', '[]'::jsonb)) loop
        if not (e.verificacion ? (f ->> 'id')) then
            raise exception 'Falta marcar en la lista de verificación: %', f ->> 'texto' using errcode = '23514';
        end if;
    end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Triggers de evidencias (reemplazan a los de 0002)
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_antes_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    perform interno.exigir_periodo_abierto(new.anio);
    new.estado := 'pendiente';
    new.validado_por := null;
    new.validado_en := null;
    new.comentario := null;
    new.datos_validacion := '{}'::jsonb;
    new.verificacion := '[]'::jsonb;
    new.creado_en := now();
    new.actualizado_en := now();
    -- Solo agregar_coautor() puede crear una coautoría.
    if current_setting('ipct.coautoria', true) is distinct from '1' then
        new.titular_id := null;
    end if;
    return interno.preparar_evidencia(new);
end;
$$;

create or replace function interno.evidencias_antes_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    yo   uuid := public.mi_usuario_id();
    prop boolean := current_setting('ipct.propagando', true) = '1';
begin
    -- Columnas que nadie puede alterar.
    new.id := old.id;
    new.docente_id := old.docente_id;
    new.creado_en := old.creado_en;
    new.titular_id := old.titular_id;
    new.actualizado_en := now();

    -- Copia desde el titular hacia sus coautores (la hace interno.evidencias_propagar).
    if prop then
        return interno.preparar_evidencia(new);
    end if;

    if public.puede_validar() and old.docente_id <> yo then
        if old.titular_id is not null then
            raise exception 'Es una coautoría: valide la evidencia del autor titular' using errcode = '42501';
        end if;
        if exists (select 1 from public.evidencias c where c.titular_id = old.id and c.docente_id = yo) then
            raise exception 'No puede validar una evidencia en la que usted es coautor' using errcode = '42501';
        end if;
        new.anio := old.anio;
        new.datos := old.datos;
        new.autoria := old.autoria;
        new.dedup_key := old.dedup_key;
        -- La responsable puede reclasificar dentro del mismo tipo de producto (p. ej. Q3 -> Q1).
        if new.tipo_id <> old.tipo_id and not exists (
               select 1 from public.tipos_evidencia a, public.tipos_evidencia b
               where a.id = old.tipo_id and b.id = new.tipo_id and b.activo and a.grupo_dedup = b.grupo_dedup) then
            raise exception 'Solo se puede reclasificar dentro del mismo tipo de producto' using errcode = '23514';
        end if;
        if new.estado = 'pendiente' then
            raise exception 'Solo el docente puede reenviar una evidencia a pendiente' using errcode = '42501';
        end if;
        if new.estado in ('observada','rechazada') and btrim(coalesce(new.comentario, '')) = '' then
            raise exception 'El comentario es obligatorio al observar o rechazar' using errcode = '23514';
        end if;
        if new.estado = 'validada' then
            perform interno.exigir_requisitos_validacion(new);
            new.validado_por := yo;
            new.validado_en := now();
        else
            new.validado_por := null;
            new.validado_en := null;
        end if;
        return new;
    end if;

    if old.docente_id = yo and old.estado <> 'validada' then
        if old.titular_id is not null then
            raise exception 'Los datos de una coautoría los edita el autor titular' using errcode = '42501';
        end if;
        perform interno.exigir_periodo_abierto(old.anio);
        perform interno.exigir_periodo_abierto(new.anio);
        new.estado := 'pendiente';
        new.validado_por := null;
        new.validado_en := null;
        new.comentario := null;       -- el comentario anterior queda en el historial
        new.datos_validacion := old.datos_validacion;
        new.verificacion := '[]'::jsonb;   -- hay que volver a verificar los datos corregidos
        return interno.preparar_evidencia(new);
    end if;

    raise exception 'Operación no permitida sobre esta evidencia' using errcode = '42501';
end;
$$;

-- El titular manda: lo que cambia en su evidencia se copia a las coautorías.
create or replace function interno.evidencias_propagar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if old.titular_id is null
       and (old.tipo_id, old.anio, old.datos, old.estado, old.comentario, old.validado_por, old.validado_en,
            old.datos_validacion, old.verificacion)
           is distinct from
           (new.tipo_id, new.anio, new.datos, new.estado, new.comentario, new.validado_por, new.validado_en,
            new.datos_validacion, new.verificacion) then
        perform set_config('ipct.propagando', '1', true);
        update public.evidencias c
           set tipo_id = new.tipo_id, anio = new.anio, datos = new.datos, estado = new.estado,
               comentario = new.comentario, validado_por = new.validado_por, validado_en = new.validado_en,
               datos_validacion = new.datos_validacion, verificacion = new.verificacion
         where c.titular_id = new.id;
        perform set_config('ipct.propagando', '0', true);
    end if;
    return null;
end;
$$;

create or replace function interno.evidencias_antes_borrar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    perform interno.exigir_periodo_abierto(old.anio);
    return old;
end;
$$;

create or replace function interno.evidencias_historial() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    es_val boolean;
    titular public.evidencias;
begin
    if tg_op = 'INSERT' then
        insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
        values (new.id, new.docente_id, new.tipo_id, null, new.estado, public.mi_usuario_id(),
                case when new.titular_id is null then 'Evidencia registrada'
                     else 'Agregada como coautoría por el autor titular' end);
    elsif tg_op = 'UPDATE' then
        es_val := public.puede_validar() and old.docente_id is distinct from public.mi_usuario_id();
        if old.estado is distinct from new.estado then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    coalesce(new.comentario, 'Reenviada por el docente'));
        elsif old.datos is distinct from new.datos or old.anio <> new.anio or (old.tipo_id <> new.tipo_id and not es_val) then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    'Datos editados por el docente');
        end if;
        if old.tipo_id <> new.tipo_id and es_val then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    'Reclasificada por la Comisión: ' ||
                    (select nombre from public.tipos_evidencia where id = old.tipo_id) || ' → ' ||
                    (select nombre from public.tipos_evidencia where id = new.tipo_id));
        end if;
    elsif tg_op = 'DELETE' then
        insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
        values (old.id, old.docente_id, old.tipo_id, old.estado, 'eliminada', public.mi_usuario_id(),
                case when old.titular_id is null then 'Evidencia eliminada'
                     else 'Se retiró de la coautoría' end);
        if old.titular_id is not null then
            select * into titular from public.evidencias where id = old.titular_id;
            if found then   -- no existe si se está borrando la evidencia del titular
                insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
                values (titular.id, titular.docente_id, titular.tipo_id, titular.estado, titular.estado, public.mi_usuario_id(),
                        'Un coautor se retiró de la evidencia');
            end if;
        end if;
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists t_evidencias_bi on public.evidencias;
create trigger t_evidencias_bi before insert on public.evidencias
    for each row execute function interno.evidencias_antes_insert();
drop trigger if exists t_evidencias_bu on public.evidencias;
create trigger t_evidencias_bu before update on public.evidencias
    for each row execute function interno.evidencias_antes_update();
drop trigger if exists t_evidencias_bd on public.evidencias;
create trigger t_evidencias_bd before delete on public.evidencias
    for each row execute function interno.evidencias_antes_borrar();
drop trigger if exists t_evidencias_au_propagar on public.evidencias;
create trigger t_evidencias_au_propagar after update on public.evidencias
    for each row when (old.titular_id is null) execute function interno.evidencias_propagar();
drop trigger if exists t_evidencias_aiud on public.evidencias;
create trigger t_evidencias_aiud after insert or update or delete on public.evidencias
    for each row execute function interno.evidencias_historial();

-- ---------------------------------------------------------------------
-- 9. Coautoría
-- ---------------------------------------------------------------------
-- Docentes a quienes se puede agregar como coautores (sin datos personales).
create or replace function public.buscar_docentes()
returns table (id uuid, nombre text)
language sql stable security definer set search_path = ''
as $$
    select u.id, u.nombre
    from public.usuarios u
    where public.puede_cargar()
      and u.activo and u.evaluado and u.rol in ('docente','responsable_ipct','superadmin')
      and u.id <> public.mi_usuario_id()
    order by u.nombre
$$;

create or replace function public.agregar_coautor(p_evidencia uuid, p_docente uuid, p_posicion integer,
                                                  p_participacion text default 'Coautor')
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
    e     public.evidencias;
    t     public.tipos_evidencia;
    nuevo uuid;
    yo    uuid := public.mi_usuario_id();
begin
    select * into e from public.evidencias where id = p_evidencia;
    if e.id is null or e.docente_id is distinct from yo or e.titular_id is not null then
        raise exception 'Solo el autor que registró la evidencia puede agregar coautores' using errcode = '42501';
    end if;
    if e.estado = 'validada' then
        raise exception 'La evidencia ya fue validada: no se pueden agregar coautores' using errcode = '23514';
    end if;
    perform interno.exigir_periodo_abierto(e.anio);
    select * into t from public.tipos_evidencia where id = e.tipo_id;
    if not coalesce((t.esquema ->> 'coautores')::boolean, false) then
        raise exception 'Este tipo de evidencia no admite coautores' using errcode = '23514';
    end if;
    if p_docente = yo then
        raise exception 'Usted ya es el autor titular de esta evidencia' using errcode = '23514';
    end if;
    if not exists (select 1 from public.usuarios u
                   where u.id = p_docente and u.activo and u.evaluado
                     and u.rol in ('docente','responsable_ipct','superadmin')) then
        raise exception 'La persona elegida no existe o no es evaluada por el IPCT' using errcode = '23514';
    end if;
    if exists (select 1 from public.evidencias c where c.titular_id = e.id and c.docente_id = p_docente) then
        raise exception 'Esa persona ya figura como coautora' using errcode = '23514';
    end if;
    if p_participacion not in ('Autor','Coautor') then
        raise exception 'La participación debe ser Autor o Coautor' using errcode = '23514';
    end if;

    perform set_config('ipct.coautoria', '1', true);
    begin
        insert into public.evidencias (docente_id, tipo_id, anio, datos, titular_id, autoria)
        values (p_docente, e.tipo_id, e.anio, e.datos, e.id,
                jsonb_build_object('posicion', p_posicion, 'participacion', p_participacion))
        returning id into nuevo;
    exception when unique_violation then
        perform set_config('ipct.coautoria', '0', true);
        raise exception 'Esa persona ya registró esta publicación por su cuenta (mismo DOI o título). Pídale que la elimine de su lista y vuelva a agregarla.'
            using errcode = '23514';
    end;
    perform set_config('ipct.coautoria', '0', true);

    -- La coautoría nace con el mismo estado que la evidencia del titular.
    perform set_config('ipct.propagando', '1', true);
    update public.evidencias set estado = e.estado, comentario = e.comentario,
                                 datos_validacion = e.datos_validacion, verificacion = e.verificacion
     where id = nuevo;
    perform set_config('ipct.propagando', '0', true);
    return nuevo;
end;
$$;

create or replace function public.quitar_coautor(p_evidencia uuid, p_docente uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare e public.evidencias;
begin
    select * into e from public.evidencias where id = p_evidencia;
    if e.id is null or e.docente_id is distinct from public.mi_usuario_id() or e.titular_id is not null then
        raise exception 'Solo el autor que registró la evidencia puede quitar coautores' using errcode = '42501';
    end if;
    if e.estado = 'validada' then
        raise exception 'La evidencia ya fue validada: no se pueden quitar coautores' using errcode = '23514';
    end if;
    delete from public.evidencias where titular_id = p_evidencia and docente_id = p_docente;
end;
$$;

create or replace function public.actualizar_autoria(p_evidencia uuid, p_docente uuid, p_posicion integer, p_participacion text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare e public.evidencias;
begin
    select * into e from public.evidencias where id = p_evidencia;
    if e.id is null or e.docente_id is distinct from public.mi_usuario_id() or e.titular_id is not null then
        raise exception 'Solo el autor que registró la evidencia puede cambiar la autoría' using errcode = '42501';
    end if;
    if e.estado = 'validada' then
        raise exception 'La evidencia ya fue validada' using errcode = '23514';
    end if;
    perform interno.exigir_periodo_abierto(e.anio);
    if p_participacion not in ('Autor','Coautor') then
        raise exception 'La participación debe ser Autor o Coautor' using errcode = '23514';
    end if;
    update public.evidencias
       set autoria = jsonb_build_object('posicion', p_posicion, 'participacion', p_participacion)
     where titular_id = p_evidencia and docente_id = p_docente;
end;
$$;

-- Grupos de coautoría de un año que me involucran (o todos, si soy lector).
create or replace function public.coautorias(p_anio integer)
returns table (grupo_id uuid, evidencia_id uuid, docente_id uuid, nombre text, es_titular boolean,
               posicion integer, participacion text, estado text)
language sql stable security definer set search_path = ''
as $$
    select coalesce(x.titular_id, x.id), x.id, x.docente_id, u.nombre, x.titular_id is null,
           nullif(x.autoria ->> 'posicion', '')::integer, x.autoria ->> 'participacion', x.estado
    from public.evidencias x
    join public.usuarios u on u.id = x.docente_id
    where public.es_autorizado()
      and x.anio = p_anio
      and coalesce(x.titular_id, x.id) in (select c.titular_id from public.evidencias c where c.titular_id is not null)
      and (public.puede_leer_todo()
           or coalesce(x.titular_id, x.id) in (select coalesce(y.titular_id, y.id) from public.evidencias y
                                                where y.docente_id = public.mi_usuario_id()))
    order by 1, (x.titular_id is not null), 6
$$;

-- ---------------------------------------------------------------------
-- 10. Políticas de archivos y de Storage
-- ---------------------------------------------------------------------
drop policy if exists archivos_lee on public.archivos;
create policy archivos_lee on public.archivos for select to authenticated
    using ((select public.puede_leer_todo()) or public.puede_ver_evidencia(evidencia_id::text));

drop policy if exists archivos_inserta on public.archivos;
create policy archivos_inserta on public.archivos for insert to authenticated
    with check (
        ((origen = 'docente' and public.evidencia_editable(evidencia_id::text))
         or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text)))
        and exists (select 1 from public.evidencias e
                    where e.id = evidencia_id
                      and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_actualiza on public.archivos;
create policy archivos_actualiza on public.archivos for update to authenticated
    using (origen = 'docente' and public.evidencia_editable(evidencia_id::text))
    with check (origen = 'docente' and public.evidencia_editable(evidencia_id::text)
                and exists (select 1 from public.evidencias e
                            where e.id = evidencia_id
                              and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_borra on public.archivos;
create policy archivos_borra on public.archivos for delete to authenticated
    using ((origen = 'docente' and public.evidencia_editable(evidencia_id::text))
           or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text)));

-- Storage: PDF del docente; PDF o imagen de la responsable (captura de pantalla).
update storage.buckets
   set public = false, file_size_limit = 5242880,
       allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp']
 where id = 'evidencias';

drop policy if exists evidencias_storage_lee on storage.objects;
create policy evidencias_storage_lee on storage.objects for select to authenticated
    using (bucket_id = 'evidencias'
           and ((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                or (select public.puede_leer_todo())
                or public.puede_ver_ruta(name)));

drop policy if exists evidencias_storage_inserta on storage.objects;
create policy evidencias_storage_inserta on storage.objects for insert to authenticated
    with check (bucket_id = 'evidencias'
                and ((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                     and public.evidencia_editable((storage.foldername(name))[2])
                     and lower(name) like '%.pdf')
                    or (bucket_id = 'evidencias'
                        and public.puede_adjuntar_ruta(name)
                        and lower(name) ~ '\.(pdf|png|jpe?g|webp)$'));

drop policy if exists evidencias_storage_actualiza on storage.objects;
create policy evidencias_storage_actualiza on storage.objects for update to authenticated
    using (bucket_id = 'evidencias'
           and (storage.foldername(name))[1] = (select public.mi_usuario_id())::text
           and public.evidencia_editable((storage.foldername(name))[2])
           and not public.ruta_es_de_validador(name));

drop policy if exists evidencias_storage_borra on storage.objects;
create policy evidencias_storage_borra on storage.objects for delete to authenticated
    using (bucket_id = 'evidencias'
           and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                 and public.evidencia_editable((storage.foldername(name))[2])
                 and not public.ruta_es_de_validador(name))
                or public.puede_adjuntar_ruta(name)));

-- ---------------------------------------------------------------------
-- 11. Respaldo: incluye los períodos y la bitácora
-- ---------------------------------------------------------------------
create or replace function public.exportar_respaldo() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.es_superadmin() then
        raise exception 'Solo el superadmin puede exportar el respaldo' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'generado_en',     now(),
        'ajustes',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.ajustes x),
        'niveles',         (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.niveles x),
        'tipos_evidencia', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.tipos_evidencia x),
        'usuarios',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.usuarios x),
        'evidencias',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.evidencias x),
        'archivos',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.archivos x),
        'historial',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.historial x),
        'periodos',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.periodos x),
        'bitacora',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.bitacora x)
    );
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Permisos de las funciones nuevas (solo usuarios con sesión)
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
    foreach f in array array[
        'public.estado_periodo(integer)', 'public.fijar_periodo(integer,boolean,date)',
        'public.evidencia_editable(text)', 'public.puede_adjuntar(text)', 'public.puede_adjuntar_ruta(text)',
        'public.puede_ver_evidencia(text)', 'public.puede_ver_ruta(text)', 'public.ruta_es_de_validador(text)',
        'public.buscar_docentes()', 'public.agregar_coautor(uuid,uuid,integer,text)',
        'public.quitar_coautor(uuid,uuid)', 'public.actualizar_autoria(uuid,uuid,integer,text)',
        'public.coautorias(integer)', 'public.exportar_respaldo()', 'public.mi_usuario()'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
