-- =====================================================================
-- 0002 · Funciones auxiliares de autorización y triggers de evidencias
-- =====================================================================

-- Esquema interno: NO está expuesto por la API; solo lo leen funciones definer.
create schema if not exists interno;
revoke all on schema interno from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Identidad del usuario conectado
-- Coincide el correo del token con la lista blanca. Barreras:
--   1) el correo debe estar en public.usuarios y activo;
--   2) su dominio debe ser el de ajustes.dominio_permitido;
--   3) la sesión debe provenir del proveedor Google.
-- ---------------------------------------------------------------------
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

create or replace function public.mi_usuario_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select (public.mi_usuario()).id $$;

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = ''
as $$ select (public.mi_usuario()).rol $$;

create or replace function public.es_autorizado() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.mi_usuario_id() is not null $$;

-- Lectura de todo: responsable, calidad, coordinadora y superadmin.
create or replace function public.puede_leer_todo() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() in ('responsable_ipct','calidad','coordinadora','superadmin'), false) $$;

create or replace function public.puede_validar() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() in ('responsable_ipct','superadmin'), false) $$;

-- Quién puede cargar evidencias propias (calidad y coordinadora son solo lectura).
create or replace function public.puede_cargar() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() in ('docente','responsable_ipct','superadmin'), false) $$;

create or replace function public.es_superadmin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() = 'superadmin', false) $$;

-- ¿La evidencia (id en texto) es del usuario conectado y aún editable?
-- Recibe texto para que las políticas de Storage no fallen con rutas mal formadas.
create or replace function public.evidencia_editable(p_id text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
    return exists (
        select 1 from public.evidencias e
        where e.id = p_id::uuid
          and e.docente_id = public.mi_usuario_id()
          and e.estado <> 'validada'
    );
exception when others then
    return false;
end;
$$;

-- Lee un ajuste numérico (con valor por defecto).
create or replace function interno.ajuste_int(p_clave text, p_defecto integer) returns integer
language sql stable security definer set search_path = ''
as $$ select coalesce((select a.valor::integer from public.ajustes a where a.clave = p_clave), p_defecto) $$;

-- Normaliza un texto para formar claves anti-duplicado (DOI, título...).
create or replace function interno.normalizar_clave(p text) returns text
language sql immutable set search_path = ''
as $$
    select regexp_replace(
        translate(lower(btrim(coalesce(p, ''))), 'áéíóúüñ', 'aeiouun'),
        '^https?://(dx\.)?doi\.org/|[^a-z0-9]+', '', 'g')
$$;

-- ---------------------------------------------------------------------
-- Validación de datos y clave anti-duplicado según el esquema del tipo.
-- Recibe la fila y la devuelve con dedup_key calculada.
-- ---------------------------------------------------------------------
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

    if p.anio < interno.ajuste_int('anio_inicio', 2000)
       or p.anio > extract(year from now())::integer then
        raise exception 'Año de evaluación fuera del rango permitido (% a %)',
            interno.ajuste_int('anio_inicio', 2000), extract(year from now())::integer
            using errcode = '23514';
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

-- ---------------------------------------------------------------------
-- INSERT: siempre nace pendiente
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_antes_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    new.estado := 'pendiente';
    new.validado_por := null;
    new.validado_en := null;
    new.comentario := null;
    new.creado_en := now();
    new.actualizado_en := now();
    return interno.preparar_evidencia(new);
end;
$$;

-- ---------------------------------------------------------------------
-- UPDATE: dos caminos
--   · validador (responsable/superadmin, evidencia ajena): solo cambia estado
--     y comentario; observar/rechazar exige comentario; validar exige PDF.
--   · docente dueño: solo si no está validada; al guardar vuelve a «pendiente».
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_antes_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
    yo uuid := public.mi_usuario_id();
begin
    -- Columnas que nadie puede alterar.
    new.id := old.id;
    new.docente_id := old.docente_id;
    new.creado_en := old.creado_en;
    new.actualizado_en := now();

    if public.puede_validar() and old.docente_id <> yo then
        new.tipo_id := old.tipo_id;
        new.anio := old.anio;
        new.datos := old.datos;
        new.dedup_key := old.dedup_key;
        if new.estado = 'pendiente' then
            raise exception 'Solo el docente puede reenviar una evidencia a pendiente' using errcode = '42501';
        end if;
        if new.estado in ('observada','rechazada') and btrim(coalesce(new.comentario, '')) = '' then
            raise exception 'El comentario es obligatorio al observar o rechazar' using errcode = '23514';
        end if;
        if new.estado = 'validada' then
            if not exists (select 1 from public.archivos a where a.evidencia_id = old.id) then
                raise exception 'No se puede validar una evidencia sin archivo PDF' using errcode = '23514';
            end if;
            new.validado_por := yo;
            new.validado_en := now();
        else
            new.validado_por := null;
            new.validado_en := null;
        end if;
        return new;
    end if;

    if old.docente_id = yo and old.estado <> 'validada' then
        new.estado := 'pendiente';
        new.validado_por := null;
        new.validado_en := null;
        new.comentario := null;       -- el comentario anterior queda en el historial
        return interno.preparar_evidencia(new);
    end if;

    raise exception 'Operación no permitida sobre esta evidencia' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoría: registra altas, cambios de estado, ediciones y bajas
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_historial() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
        values (new.id, new.docente_id, new.tipo_id, null, new.estado, public.mi_usuario_id(), 'Evidencia registrada');
    elsif tg_op = 'UPDATE' then
        if old.estado is distinct from new.estado then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    coalesce(new.comentario, 'Reenviada por el docente'));
        elsif old.datos is distinct from new.datos or old.tipo_id <> new.tipo_id or old.anio <> new.anio then
            insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
            values (new.id, new.docente_id, new.tipo_id, old.estado, new.estado, public.mi_usuario_id(),
                    'Datos editados por el docente');
        end if;
    elsif tg_op = 'DELETE' then
        insert into public.historial (evidencia_id, docente_id, tipo_id, estado_anterior, estado_nuevo, actor_id, comentario)
        values (old.id, old.docente_id, old.tipo_id, old.estado, 'eliminada', public.mi_usuario_id(), 'Evidencia eliminada');
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

drop trigger if exists t_evidencias_aiud on public.evidencias;
create trigger t_evidencias_aiud after insert or update or delete on public.evidencias
    for each row execute function interno.evidencias_historial();
