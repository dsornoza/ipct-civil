-- =====================================================================
-- 0016 · Ajustes del piloto (1)
--   · El DOCENTE declara si el producto deriva de un proyecto de investigación o de
--     vinculación (Sí/No) y, si es Sí, el tipo, el nombre y el estado del proyecto.
--     Ya no lo completa la responsable. Los campos que dependen de otra respuesta
--     («mostrar_si») solo son obligatorios cuando se muestran.
--   · El aval de la Comisión ya no lo sube el docente: lo generará el sistema.
--   · La copia ZIP de un año incluye a cada coautor en su propia carpeta y la fecha
--     de validación de cada archivo.
-- Ejecutar después de 0015. Es idempotente.
-- =====================================================================

-- Campos obligatorios: los que tienen «mostrar_si» solo cuentan si la condición se cumple.
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

    for campo in select * from jsonb_array_elements(t.esquema -> 'campos') loop
        if (campo ->> 'requerido')::boolean is true
           and (not (campo ? 'mostrar_si')
                or (p.datos ->> (campo -> 'mostrar_si' ->> 'campo')) in
                   (select jsonb_array_elements_text(campo -> 'mostrar_si' -> 'en')))
           and btrim(coalesce(p.datos ->> (campo ->> 'nombre'), '')) = '' then
            raise exception 'Falta el campo obligatorio: %', campo ->> 'etiqueta' using errcode = '23514';
        end if;
    end loop;

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

-- Catálogo: la pregunta del proyecto pasa al docente.
do $$
declare
    proy jsonb := '[
        {"nombre":"deriva_proyecto","etiqueta":"¿Es resultado de un proyecto de investigación o de vinculación?","tipo":"select","requerido":true,"opciones":["No","Sí"]},
        {"nombre":"tipo_proyecto","etiqueta":"Tipo de proyecto","tipo":"select","requerido":true,"opciones":["Investigación","Vinculación"],"mostrar_si":{"campo":"deriva_proyecto","en":["Sí"]}},
        {"nombre":"proyecto_titulo","etiqueta":"Nombre del proyecto","tipo":"texto","requerido":true,"mostrar_si":{"campo":"deriva_proyecto","en":["Sí"]}},
        {"nombre":"proyecto_estado","etiqueta":"Estado del proyecto","tipo":"select","opciones":["En ejecución","Finalizado"],"mostrar_si":{"campo":"deriva_proyecto","en":["Sí"]}}]';
begin
    update public.tipos_evidencia t
       set esquema = jsonb_set(jsonb_set(t.esquema, '{campos}',
               coalesce((select jsonb_agg(c) from jsonb_array_elements(t.esquema -> 'campos') c
                          where c ->> 'nombre' not in ('proyecto','deriva_proyecto','tipo_proyecto','proyecto_titulo','proyecto_estado')), '[]'::jsonb) || proy),
           '{validador}',
               coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(t.esquema -> 'validador', '[]'::jsonb)) v
                          where v ->> 'nombre' not in ('resultado_de','proyecto_titulo','proyecto_estado')), '[]'::jsonb))
     where t.grupo_dedup in ('articulo','ponencia','capitulo','patente','software') or t.id = 'lib_inv';

    -- Sin aval subido por el docente (el sistema lo generará)
    update public.tipos_evidencia t
       set esquema = jsonb_set(jsonb_set(t.esquema, '{archivos}',
               coalesce((select jsonb_agg(a) from jsonb_array_elements(t.esquema -> 'archivos') a where a ->> 'rol' <> 'aval'), '[]'::jsonb)),
           '{verificacion}',
               coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(t.esquema -> 'verificacion', '[]'::jsonb)) v where v ->> 'id' <> 'aval'), '[]'::jsonb))
     where t.id in ('lib_inv', 'capitulo');
end $$;

-- Copia ZIP: cada archivo con todas las personas de la evidencia (autor y coautores) y su fecha de validación.
drop function if exists public.archivos_anio(integer);
create function public.archivos_anio(p_anio integer)
returns table (archivo_id uuid, evidencia_id uuid, docente_id uuid, docente text, tipo_nombre text, resumen text,
               ruta text, nombre text, tamano bigint, sha256 text, rol text, origen text, archivado_en timestamptz, estado text,
               docentes text[], validado_en timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
    if not public.puede_leer_todo() then
        raise exception 'No tiene permiso para descargar las evidencias' using errcode = '42501';
    end if;
    return query
    select a.id, e.id, e.docente_id, coalesce(u.apellidos_nombres, u.nombre), t.nombre,
           coalesce(e.datos ->> 'titulo', e.datos ->> 'nombre', e.datos ->> 'entidad', e.datos ->> 'revista', e.datos ->> 'estudiante', ''),
           a.ruta, a.nombre, a.tamano, a.sha256, a.rol, a.origen, a.archivado_en, e.estado,
           (select array_agg(distinct coalesce(u2.apellidos_nombres, u2.nombre))
              from public.evidencias e2 join public.usuarios u2 on u2.id = e2.docente_id
             where e2.id = e.id or e2.titular_id = e.id),
           e.validado_en
    from public.archivos a
    join public.evidencias e on e.id = a.evidencia_id
    join public.usuarios u on u.id = e.docente_id
    join public.tipos_evidencia t on t.id = e.tipo_id
    where e.anio = p_anio
    order by coalesce(u.apellidos_nombres, u.nombre), e.creado_en, a.rol;
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['public.archivos_anio(integer)'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
