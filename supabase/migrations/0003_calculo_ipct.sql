-- =====================================================================
-- 0003 · Cálculo del IPCT, nivel y ranking (única fuente de verdad)
-- Solo cuentan evidencias VALIDADAS. Los topes se aplican por docente,
-- año y bloque, priorizando mayor puntaje (igual que calcBloque del simulador).
-- =====================================================================

-- Nivel según los umbrales de la tabla niveles.
create or replace function public.nivel_de(p_total integer) returns text
language sql stable security definer set search_path = ''
as $$
    select coalesce(
        (select n.nombre from public.niveles n where p_total >= n.min_puntos order by n.min_puntos desc limit 1),
        (select a.valor from public.ajustes a where a.clave = 'sin_nivel'),
        'Sin nivel')
$$;

-- Detalle por evidencia: ¿computa o quedó fuera por el tope?
create or replace view interno.v_calculo as
with base as (
    select e.id as evidencia_id, e.docente_id, e.anio, e.tipo_id,
           t.indicador, t.bloque, t.bloque_titulo, t.nombre as tipo_nombre,
           t.puntos as puntos_unidad, t.tope, e.estado, e.datos, e.creado_en,
           case when e.estado = 'validada' then
               row_number() over (
                   partition by e.docente_id, e.anio, t.bloque, (e.estado = 'validada')
                   order by t.puntos desc, e.validado_en, e.creado_en, e.id)
           end as orden
    from public.evidencias e
    join public.tipos_evidencia t on t.id = e.tipo_id
)
select b.*,
       (b.estado = 'validada' and (b.tope is null or b.orden <= b.tope)) as computada
from base b;

-- Totales por docente y año.
create or replace view interno.v_ipct as
select docente_id, anio, ii, iid, ivs, ii + iid + ivs as total
from (
    select c.docente_id, c.anio,
           coalesce(sum(c.puntos_unidad) filter (where c.computada and c.indicador = 'Ii'), 0)::integer  as ii,
           coalesce(sum(c.puntos_unidad) filter (where c.computada and c.indicador = 'IiD'), 0)::integer as iid,
           coalesce(sum(c.puntos_unidad) filter (where c.computada and c.indicador = 'IVs'), 0)::integer as ivs
    from interno.v_calculo c
    where c.estado = 'validada'
    group by c.docente_id, c.anio
) x;

-- ---------------------------------------------------------------------
-- API (RPC). Todas verifican la autorización por dentro.
-- ---------------------------------------------------------------------

-- Ranking de un año: lo ve cualquier usuario autorizado; solo nombres y puntajes.
create or replace function public.ranking(p_anio integer)
returns table (posicion bigint, usuario_id uuid, nombre text, ii integer, iid integer, ivs integer, total integer, nivel text)
language sql stable security definer set search_path = ''
as $$
    select rank() over (order by coalesce(i.total, 0) desc),
           u.id, u.nombre,
           coalesce(i.ii, 0), coalesce(i.iid, 0), coalesce(i.ivs, 0), coalesce(i.total, 0),
           public.nivel_de(coalesce(i.total, 0))
    from public.usuarios u
    left join interno.v_ipct i on i.docente_id = u.id and i.anio = p_anio
    where public.es_autorizado()
      and u.activo and u.rol in ('docente','responsable_ipct','superadmin')
    order by 1, u.nombre
$$;

-- Evolución por año de un docente (él mismo o roles de lectura).
create or replace function public.evolucion(p_usuario uuid)
returns table (anio integer, ii integer, iid integer, ivs integer, total integer, nivel text)
language sql stable security definer set search_path = ''
as $$
    select i.anio, i.ii, i.iid, i.ivs, i.total, public.nivel_de(i.total)
    from interno.v_ipct i
    where i.docente_id = p_usuario
      and (p_usuario = public.mi_usuario_id() or public.puede_leer_todo())
    order by i.anio
$$;

-- Detalle de evidencias validadas de un docente en un año (para su PDF).
create or replace function public.detalle_docente(p_usuario uuid, p_anio integer)
returns table (evidencia_id uuid, indicador text, bloque text, bloque_titulo text, tipo_id text,
               tipo_nombre text, puntos_unidad integer, tope integer, datos jsonb,
               computada boolean, orden bigint)
language sql stable security definer set search_path = ''
as $$
    select c.evidencia_id, c.indicador, c.bloque, c.bloque_titulo, c.tipo_id, c.tipo_nombre,
           c.puntos_unidad, c.tope, c.datos, c.computada, c.orden
    from interno.v_calculo c
    where c.docente_id = p_usuario and c.anio = p_anio and c.estado = 'validada'
      and (p_usuario = public.mi_usuario_id() or public.puede_leer_todo())
    order by c.indicador desc, c.bloque, c.orden
$$;

-- Detalle de todo el programa en un año (reportes). Solo roles de lectura.
create or replace function public.reporte_detalle(p_anio integer)
returns table (docente_id uuid, docente text, evidencia_id uuid, indicador text, bloque_titulo text,
               tipo_nombre text, puntos_unidad integer, tope integer, datos jsonb,
               computada boolean, orden bigint)
language sql stable security definer set search_path = ''
as $$
    select c.docente_id, u.nombre, c.evidencia_id, c.indicador, c.bloque_titulo, c.tipo_nombre,
           c.puntos_unidad, c.tope, c.datos, c.computada, c.orden
    from interno.v_calculo c
    join public.usuarios u on u.id = c.docente_id
    where c.anio = p_anio and c.estado = 'validada' and public.puede_leer_todo()
    order by u.nombre, c.indicador desc, c.bloque, c.orden
$$;

-- Enlaza el usuario de Auth con la lista blanca. Se llama tras iniciar sesión.
-- Devuelve una fila si está autorizado y ninguna si no lo está.
create or replace function public.vincular_sesion()
returns table (id uuid, email text, nombre text, rol text, programa text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
    u public.usuarios := public.mi_usuario();
begin
    if u.id is null then
        return;
    end if;
    update public.usuarios set auth_user_id = auth.uid()
     where public.usuarios.id = u.id and auth_user_id is distinct from auth.uid();
    return query select u.id, u.email, u.nombre, u.rol, u.programa;
end;
$$;

-- Uso del almacenamiento (bytes usados y cuota configurada).
create or replace function public.uso_almacenamiento()
returns table (usado bigint, cuota bigint, archivos bigint)
language sql stable security definer set search_path = ''
as $$
    select coalesce(sum(a.tamano), 0)::bigint,
           coalesce((select s.valor::bigint from public.ajustes s where s.clave = 'cuota_bytes'), 1073741824),
           count(*)::bigint
    from public.archivos a
    where public.puede_leer_todo()
$$;

-- Respaldo completo de datos en JSON (solo superadmin). Los PDF se respaldan aparte.
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
        'historial',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.historial x)
    );
end;
$$;
