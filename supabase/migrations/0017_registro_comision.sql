-- =====================================================================
-- 0017 · La Comisión registra evidencias a nombre de otros docentes
-- Caso: un docente tiene una publicación y no la reporta; la responsable la
-- encuentra, la registra a nombre de los docentes que aparecen en ella y suma
-- para su IPCT. Reglas:
--   · Solo la responsable del IPCT o el superadmin (puede_validar) registran a nombre de otros.
--   · La evidencia es del docente (aparece en su cuenta y suma para él y sus coautores)
--     y queda marcada con «registrada_por».
--   · QUIEN LA REGISTRÓ NO LA VALIDA: debe resolverla otra persona (otra responsable, la
--     cuenta de la Comisión o el superadmin). Puede corregir sus datos y archivos mientras
--     no esté validada.
--   · Puede hacerlo en años cerrados (la carga cerrada es para los docentes), pero no en
--     años no habilitados ni archivados; el docente debe figurar entre los participantes del año.
--   · Los validadores pueden guardar sus datos sin resolver (borrador).
-- Ejecutar después de 0016. Es idempotente.
-- =====================================================================

alter table public.evidencias add column if not exists registrada_por uuid references public.usuarios(id);
create index if not exists evidencias_registrada_idx on public.evidencias (registrada_por) where registrada_por is not null;
comment on column public.evidencias.registrada_por is
    'Persona de la Comisión que registró la evidencia a nombre del docente (null si la registró el propio docente).';

-- ¿Es una evidencia que yo registré a nombre de otro y aún no está validada? (para sus archivos)
create or replace function public.es_registrada_por_mi(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.puede_validar() and exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and e.registrada_por = public.mi_usuario_id()
          and e.titular_id is null
          and e.estado <> 'validada');
exception when others then
    return false;
end;
$$;

create or replace function public.es_registrada_por_mi_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return public.es_registrada_por_mi(split_part(p_ruta, '/', 2))
       and exists (select 1 from public.evidencias e
                   where e.id = split_part(p_ruta, '/', 2)::uuid
                     and e.docente_id::text = split_part(p_ruta, '/', 1));
exception when others then
    return false;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers (reemplazan a los de 0009/0013)
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_antes_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if current_setting('ipct.registro_comision', true) = '1' then
        new.registrada_por := public.mi_usuario_id();     -- solo registrar_para() y agregar_coautor() activan esto
    else
        new.registrada_por := null;
        perform interno.exigir_periodo_abierto(new.anio);
    end if;
    if not interno.participa(new.docente_id, new.anio) then
        raise exception 'La persona no figura entre los participantes del año %', new.anio using errcode = '23514';
    end if;
    new.estado := 'pendiente';
    new.validado_por := null;
    new.validado_en := null;
    new.comentario := null;
    new.datos_validacion := '{}'::jsonb;
    new.verificacion := '[]'::jsonb;
    new.creado_en := now();
    new.actualizado_en := now();
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
    new.id := old.id;
    new.docente_id := old.docente_id;
    new.creado_en := old.creado_en;
    new.titular_id := old.titular_id;
    new.registrada_por := old.registrada_por;
    new.actualizado_en := now();

    if prop then
        return interno.preparar_evidencia(new);
    end if;

    -- La Comisión corrige los datos de lo que registró mientras no esté validado (como lo haría el docente).
    if old.registrada_por is not null and old.registrada_por = yo and old.titular_id is null
       and old.estado <> 'validada' and public.puede_validar()
       and (new.datos is distinct from old.datos or new.anio <> old.anio or new.tipo_id <> old.tipo_id) then
        new.estado := 'pendiente';
        new.validado_por := null;
        new.validado_en := null;
        new.comentario := null;
        new.datos_validacion := old.datos_validacion;
        new.verificacion := '[]'::jsonb;
        return interno.preparar_evidencia(new);
    end if;

    if public.puede_validar() and old.docente_id <> yo then
        if old.titular_id is not null then
            raise exception 'Es una coautoría: valide la evidencia del autor titular' using errcode = '42501';
        end if;
        if exists (select 1 from public.evidencias c where c.titular_id = old.id and c.docente_id = yo) then
            raise exception 'No puede validar una evidencia en la que usted es coautor' using errcode = '42501';
        end if;
        -- Quien registró la evidencia a nombre de otro no la resuelve: debe hacerlo otra persona.
        if old.registrada_por = yo and new.estado is distinct from old.estado then
            raise exception 'No puede validar, observar ni rechazar una evidencia que usted registró: debe resolverla otra persona' using errcode = '42501';
        end if;
        new.anio := old.anio;
        new.datos := old.datos;
        new.autoria := old.autoria;
        new.dedup_key := old.dedup_key;
        if new.tipo_id <> old.tipo_id and not exists (
               select 1 from public.tipos_evidencia a, public.tipos_evidencia b
               where a.id = old.tipo_id and b.id = new.tipo_id and b.activo and a.grupo_dedup = b.grupo_dedup) then
            raise exception 'Solo se puede reclasificar dentro del mismo tipo de producto' using errcode = '23514';
        end if;
        -- Guardar los datos sin resolver (pendiente -> pendiente) está permitido; devolver a pendiente algo ya resuelto, no.
        if new.estado = 'pendiente' and old.estado <> 'pendiente' then
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
        new.comentario := null;
        new.datos_validacion := old.datos_validacion;
        new.verificacion := '[]'::jsonb;
        return interno.preparar_evidencia(new);
    end if;

    raise exception 'Operación no permitida sobre esta evidencia' using errcode = '42501';
end;
$$;

-- Lo que registró la Comisión se puede borrar también en años cerrados (antes de validarse).
create or replace function interno.evidencias_antes_borrar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if old.registrada_por is distinct from public.mi_usuario_id() then
        perform interno.exigir_periodo_abierto(old.anio);
    end if;
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
                case when new.titular_id is not null then 'Agregada como coautoría por el autor titular'
                     when new.registrada_por is not null then 'Registrada por la Comisión de Investigación a nombre del docente'
                     else 'Evidencia registrada' end);
    elsif tg_op = 'UPDATE' then
        es_val := public.puede_validar() and old.docente_id is distinct from public.mi_usuario_id();
        if old.estado is distinct from new.estado then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    coalesce(new.comentario, case when old.registrada_por = public.mi_usuario_id() then 'Corregida por la Comisión'
                                                  else 'Reenviada por el docente' end));
        elsif old.datos is distinct from new.datos or old.anio <> new.anio or (old.tipo_id <> new.tipo_id and not es_val)
              or (old.tipo_id <> new.tipo_id and old.registrada_por = public.mi_usuario_id()) then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    case when old.registrada_por is not null and old.registrada_por = public.mi_usuario_id()
                         then 'Datos corregidos por la Comisión (evidencia registrada por ella)'
                         else 'Datos editados por el docente' end);
        end if;
        if old.tipo_id <> new.tipo_id and es_val and old.registrada_por is distinct from public.mi_usuario_id() then
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
            if found then
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

-- ---------------------------------------------------------------------
-- Registrar a nombre de otro docente
-- ---------------------------------------------------------------------
create or replace function public.registrar_para(p_docente uuid, p_tipo text, p_anio integer,
                                                 p_datos jsonb, p_autoria jsonb default '{}'::jsonb)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
    nuevo uuid;
    yo    uuid := public.mi_usuario_id();
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el superadmin pueden registrar evidencias a nombre de otros' using errcode = '42501';
    end if;
    if p_docente = yo then
        raise exception 'Para registrar sus propias evidencias use «Mis evidencias»' using errcode = '23514';
    end if;
    if not exists (select 1 from public.periodos p where p.anio = p_anio) then
        raise exception 'El año % no está habilitado', p_anio using errcode = '23514';
    end if;
    if exists (select 1 from public.archivos a join public.evidencias e on e.id = a.evidencia_id
               where e.anio = p_anio and a.archivado_en is not null) then
        raise exception 'El año % ya fue archivado: no se pueden agregar evidencias', p_anio using errcode = '23514';
    end if;
    if not exists (select 1 from public.usuarios u where u.id = p_docente and u.evaluado
                   and u.rol in ('docente','responsable_ipct','superadmin')) then
        raise exception 'La persona elegida no es evaluada por el IPCT' using errcode = '23514';
    end if;

    perform set_config('ipct.registro_comision', '1', true);
    insert into public.evidencias (docente_id, tipo_id, anio, datos, autoria)
    values (p_docente, p_tipo, p_anio, p_datos, coalesce(p_autoria, '{}'::jsonb))
    returning id into nuevo;
    perform set_config('ipct.registro_comision', '0', true);
    return nuevo;
end;
$$;

-- Coautores: el autor o, si la evidencia la registró la Comisión, quien la registró.
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
    comision boolean;
begin
    select * into e from public.evidencias where id = p_evidencia;
    comision := e.registrada_por is not null and e.registrada_por = yo and public.puede_validar();
    if e.id is null or e.titular_id is not null or (e.docente_id is distinct from yo and not comision) then
        raise exception 'Solo el autor que registró la evidencia puede agregar coautores' using errcode = '42501';
    end if;
    if e.estado = 'validada' then
        raise exception 'La evidencia ya fue validada: no se pueden agregar coautores' using errcode = '23514';
    end if;
    if not comision then
        perform interno.exigir_periodo_abierto(e.anio);
    end if;
    select * into t from public.tipos_evidencia where id = e.tipo_id;
    if not coalesce((t.esquema ->> 'coautores')::boolean, false) then
        raise exception 'Este tipo de evidencia no admite coautores' using errcode = '23514';
    end if;
    if p_docente = e.docente_id then
        raise exception 'Esa persona ya es la autora titular de esta evidencia' using errcode = '23514';
    end if;
    if not exists (select 1 from public.usuarios u
                   where u.id = p_docente and u.evaluado
                     and u.rol in ('docente','responsable_ipct','superadmin')) then
        raise exception 'La persona elegida no existe o no es evaluada por el IPCT' using errcode = '23514';
    end if;
    if not interno.participa(p_docente, e.anio) then
        raise exception 'Esa persona no figura entre los participantes del año %', e.anio using errcode = '23514';
    end if;
    if exists (select 1 from public.evidencias c where c.titular_id = e.id and c.docente_id = p_docente) then
        raise exception 'Esa persona ya figura como coautora' using errcode = '23514';
    end if;
    if p_participacion not in ('Autor','Coautor') then
        raise exception 'La participación debe ser Autor o Coautor' using errcode = '23514';
    end if;

    perform set_config('ipct.coautoria', '1', true);
    if comision then perform set_config('ipct.registro_comision', '1', true); end if;
    begin
        insert into public.evidencias (docente_id, tipo_id, anio, datos, titular_id, autoria)
        values (p_docente, e.tipo_id, e.anio, e.datos, e.id,
                jsonb_build_object('posicion', p_posicion, 'participacion', p_participacion))
        returning id into nuevo;
    exception when unique_violation then
        perform set_config('ipct.coautoria', '0', true);
        perform set_config('ipct.registro_comision', '0', true);
        raise exception 'Esa persona ya registró esta publicación por su cuenta (mismo DOI o título). Pídale que la elimine de su lista y vuelva a agregarla.'
            using errcode = '23514';
    end;
    perform set_config('ipct.coautoria', '0', true);
    perform set_config('ipct.registro_comision', '0', true);

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
    if e.id is null or e.titular_id is not null
       or (e.docente_id is distinct from public.mi_usuario_id()
           and not (e.registrada_por is not null and e.registrada_por = public.mi_usuario_id() and public.puede_validar())) then
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
declare e public.evidencias; comision boolean;
begin
    select * into e from public.evidencias where id = p_evidencia;
    comision := e.registrada_por is not null and e.registrada_por = public.mi_usuario_id() and public.puede_validar();
    if e.id is null or e.titular_id is not null or (e.docente_id is distinct from public.mi_usuario_id() and not comision) then
        raise exception 'Solo el autor que registró la evidencia puede cambiar la autoría' using errcode = '42501';
    end if;
    if e.estado = 'validada' then
        raise exception 'La evidencia ya fue validada' using errcode = '23514';
    end if;
    if not comision then
        perform interno.exigir_periodo_abierto(e.anio);
    end if;
    if p_participacion not in ('Autor','Coautor') then
        raise exception 'La participación debe ser Autor o Coautor' using errcode = '23514';
    end if;
    update public.evidencias
       set autoria = jsonb_build_object('posicion', p_posicion, 'participacion', p_participacion)
     where titular_id = p_evidencia and docente_id = p_docente;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
drop policy if exists evidencias_registrador_borra on public.evidencias;
create policy evidencias_registrador_borra on public.evidencias for delete to authenticated
    using (registrada_por = (select public.mi_usuario_id()) and estado <> 'validada' and (select public.puede_validar()));

-- Archivos: la persona de la Comisión sube, reemplaza y quita los archivos «del docente» de lo que registró.
drop policy if exists archivos_inserta on public.archivos;
create policy archivos_inserta on public.archivos for insert to authenticated
    with check (
        ((origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text)))
         or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text)))
        and exists (select 1 from public.evidencias e
                    where e.id = evidencia_id
                      and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_actualiza on public.archivos;
create policy archivos_actualiza on public.archivos for update to authenticated
    using (origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text)))
    with check (origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text))
                and exists (select 1 from public.evidencias e
                            where e.id = evidencia_id
                              and ruta like e.docente_id::text || '/' || e.id::text || '/%'));

drop policy if exists archivos_borra on public.archivos;
create policy archivos_borra on public.archivos for delete to authenticated
    using ((origen = 'docente' and (public.evidencia_editable(evidencia_id::text) or public.es_registrada_por_mi(evidencia_id::text)))
           or (origen = 'validador' and public.puede_adjuntar(evidencia_id::text)));

-- Storage (ruta «docente_id/evidencia_id/archivo»)
drop policy if exists evidencias_storage_inserta on storage.objects;
create policy evidencias_storage_inserta on storage.objects for insert to authenticated
    with check (bucket_id = 'evidencias'
                and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                      and public.evidencia_editable((storage.foldername(name))[2])
                      and lower(name) like '%.pdf')
                     or (public.puede_adjuntar_ruta(name) and lower(name) ~ '\.(pdf|png|jpe?g|webp)$')
                     or (public.es_registrada_por_mi_ruta(name) and lower(name) like '%.pdf')));

drop policy if exists evidencias_storage_actualiza on storage.objects;
create policy evidencias_storage_actualiza on storage.objects for update to authenticated
    using (bucket_id = 'evidencias'
           and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                 and public.evidencia_editable((storage.foldername(name))[2]))
                or public.es_registrada_por_mi_ruta(name))
           and not public.ruta_es_de_validador(name));

drop policy if exists evidencias_storage_borra on storage.objects;
create policy evidencias_storage_borra on storage.objects for delete to authenticated
    using (bucket_id = 'evidencias'
           and (((storage.foldername(name))[1] = (select public.mi_usuario_id())::text
                 and public.evidencia_editable((storage.foldername(name))[2])
                 and not public.ruta_es_de_validador(name))
                or (public.es_registrada_por_mi_ruta(name) and not public.ruta_es_de_validador(name))
                or (public.puede_adjuntar_ruta(name) and not public.ruta_es_de_docente(name))
                or public.puede_borrar_ruta_archivada(name)));

do $$
declare f text;
begin
    foreach f in array array['public.es_registrada_por_mi(text)', 'public.es_registrada_por_mi_ruta(text)',
                             'public.registrar_para(uuid,text,integer,jsonb,jsonb)',
                             'public.agregar_coautor(uuid,uuid,integer,text)', 'public.quitar_coautor(uuid,uuid)',
                             'public.actualizar_autoria(uuid,uuid,integer,text)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
