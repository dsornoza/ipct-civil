-- =====================================================================
-- 0013 · Participantes por año
-- El personal contratado entra y sale: cada año tiene su lista de personas
-- evaluadas. Solo quien figura en un año puede registrar evidencias de ese año
-- y aparece en su ranking. Quien se va conserva sus años anteriores: puede
-- terminar de cargar su último año mientras esté abierto, aunque ya no trabaje
-- en la facultad, y no puede registrar nada en los años siguientes.
-- Ejecutar después de 0012. Es idempotente.
-- =====================================================================

create table if not exists public.usuarios_anios (
    usuario_id uuid not null references public.usuarios(id) on delete cascade,
    anio       integer not null,
    primary key (usuario_id, anio)
);
create index if not exists usuarios_anios_anio_idx on public.usuarios_anios (anio);
alter table public.usuarios_anios enable row level security;
drop policy if exists usuarios_anios_lee on public.usuarios_anios;
create policy usuarios_anios_lee on public.usuarios_anios for select to authenticated
    using (usuario_id = (select public.mi_usuario_id()) or (select public.puede_leer_todo()));
revoke all on public.usuarios_anios from anon;
grant select on public.usuarios_anios to authenticated;

-- ¿La persona figura en la lista de ese año?
create or replace function interno.participa(p_usuario uuid, p_anio integer) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.usuarios_anios a where a.usuario_id = p_usuario and a.anio = p_anio) $$;

-- Años ya habilitados que todavía no tienen lista: se arma con las personas evaluadas
-- activas (así nadie pierde acceso al actualizar). Solo corre una vez por año.
insert into public.usuarios_anios (usuario_id, anio)
select u.id, p.anio
from public.periodos p
cross join public.usuarios u
where u.activo and u.evaluado and u.rol in ('docente','responsable_ipct','superadmin')
  and not exists (select 1 from public.usuarios_anios a where a.anio = p.anio)
on conflict do nothing;

-- Quien ingresa mientras hay años abiertos queda en esos años.
create or replace function interno.usuarios_asignar_anios() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    if new.evaluado and new.rol in ('docente','responsable_ipct','superadmin') then
        insert into public.usuarios_anios (usuario_id, anio)
        select new.id, p.anio from public.periodos p where interno.periodo_abierto(p.anio)
        on conflict do nothing;
    end if;
    return null;
end;
$$;
drop trigger if exists t_usuarios_ai_anios on public.usuarios;
create trigger t_usuarios_ai_anios after insert on public.usuarios
    for each row execute function interno.usuarios_asignar_anios();

-- ---------------------------------------------------------------------
-- Registrar evidencias: además del año abierto, la persona debe figurar en él.
-- (Mismo cuerpo que en 0009, con la comprobación nueva.)
-- ---------------------------------------------------------------------
create or replace function interno.evidencias_antes_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    perform interno.exigir_periodo_abierto(new.anio);
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
    -- Solo agregar_coautor() puede crear una coautoría.
    if current_setting('ipct.coautoria', true) is distinct from '1' then
        new.titular_id := null;
    end if;
    return interno.preparar_evidencia(new);
end;
$$;

-- Coautores: deben figurar en el año (no se exige que sigan activos).
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

-- ---------------------------------------------------------------------
-- Ranking: solo quienes figuran en el año (aunque ya no estén activos).
-- ---------------------------------------------------------------------
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
      and u.evaluado and u.rol in ('docente','responsable_ipct','superadmin')
      and interno.participa(u.id, p_anio)
    order by 1, u.nombre
$$;

-- Años habilitados que la persona puede ver: aquellos en que figura o en que tiene evidencias
-- (los roles de lectura ven todos). «participa» indica si puede registrar en ese año.
drop function if exists public.periodos_visibles();
create function public.periodos_visibles()
returns table (anio integer, abierto boolean, cierra_el date, participa boolean)
language sql stable security definer set search_path = ''
as $$
    select p.anio, interno.periodo_abierto(p.anio), p.cierra_el, interno.participa(public.mi_usuario_id(), p.anio)
    from public.periodos p
    where public.es_autorizado()
      and (public.puede_leer_todo()
           or interno.participa(public.mi_usuario_id(), p.anio)
           or exists (select 1 from public.evidencias e where e.docente_id = public.mi_usuario_id() and e.anio = p.anio))
    order by p.anio desc
$$;

-- ---------------------------------------------------------------------
-- Administrar la lista de un año (responsable o superadmin)
-- ---------------------------------------------------------------------
create or replace function public.fijar_participacion(p_usuario uuid, p_anio integer, p_participa boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el superadmin pueden administrar los participantes' using errcode = '42501';
    end if;
    if not exists (select 1 from public.periodos p where p.anio = p_anio) then
        raise exception 'Primero habilite el año %', p_anio using errcode = '23514';
    end if;
    if not exists (select 1 from public.usuarios u where u.id = p_usuario and u.evaluado
                   and u.rol in ('docente','responsable_ipct','superadmin')) then
        raise exception 'La persona no es evaluada por el IPCT' using errcode = '23514';
    end if;
    if p_participa then
        insert into public.usuarios_anios (usuario_id, anio) values (p_usuario, p_anio) on conflict do nothing;
    else
        delete from public.usuarios_anios where usuario_id = p_usuario and anio = p_anio;
    end if;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'participante',
            jsonb_build_object('usuario', p_usuario, 'anio', p_anio, 'participa', p_participa));
end;
$$;

-- Copia a un año las personas del año anterior que siguen activas. Devuelve cuántas agregó.
create or replace function public.copiar_participantes(p_desde integer, p_hacia integer)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare n integer;
begin
    if not public.puede_validar() then
        raise exception 'Solo la responsable del IPCT o el superadmin pueden administrar los participantes' using errcode = '42501';
    end if;
    if not exists (select 1 from public.periodos p where p.anio = p_hacia) then
        raise exception 'Primero habilite el año %', p_hacia using errcode = '23514';
    end if;
    insert into public.usuarios_anios (usuario_id, anio)
    select a.usuario_id, p_hacia
    from public.usuarios_anios a
    join public.usuarios u on u.id = a.usuario_id
    where a.anio = p_desde and u.activo and u.evaluado
    on conflict do nothing;
    get diagnostics n = row_count;
    insert into public.bitacora (actor_id, accion, detalle)
    values (public.mi_usuario_id(), 'copiar_participantes', jsonb_build_object('desde', p_desde, 'hacia', p_hacia, 'agregadas', n));
    return n;
end;
$$;

-- Respaldo: incluye las listas por año.
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
        'usuarios_anios',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.usuarios_anios x),
        'evidencias',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.evidencias x),
        'archivos',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.archivos x),
        'historial',       (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.historial x),
        'periodos',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.periodos x),
        'bitacora',        (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.bitacora x)
    );
end;
$$;

do $$
declare f text;
begin
    foreach f in array array['public.agregar_coautor(uuid,uuid,integer,text)', 'public.ranking(integer)',
                             'public.periodos_visibles()', 'public.fijar_participacion(uuid,integer,boolean)',
                             'public.copiar_participantes(integer,integer)', 'public.exportar_respaldo()'] loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;
