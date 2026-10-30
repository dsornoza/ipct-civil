-- Pruebas de reglas de negocio, topes y RLS. Se ejecuta tras las migraciones.
\set ON_ERROR_STOP on
\set QUIET on
create schema if not exists pruebas;
grant usage on schema pruebas to authenticated, anon;

-- Ejecuta una sentencia y exige que falle con el código SQLSTATE indicado.
create or replace function pruebas.debe_fallar(p_sql text, p_codigo text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_codigo then return; end if;
    raise exception 'FALLO: se esperaba % y llegó % (%)', p_codigo, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO: debía fallar y no falló: %', p_sql;
end $$;

-- Ejecuta una sentencia y devuelve las filas afectadas (RLS filtra sin error).
create or replace function pruebas.filas(p_sql text) returns integer
language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pruebas to authenticated, anon;

create or replace function pruebas.como(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'email', p_email, 'sub', (select id from auth.users where email = p_email),
    'app_metadata', json_build_object('provider', 'google'))::text, false);
end $$;
grant execute on function pruebas.como(text) to authenticated;

-- Datos de partida
insert into auth.users (email) values
 ('admin@unesum.edu.ec'),('resp@unesum.edu.ec'),('cal@unesum.edu.ec'),
 ('d1@unesum.edu.ec'),('d2@unesum.edu.ec'),('intruso@unesum.edu.ec'),('externo@gmail.com'),('comision@unesum.edu.ec');
insert into public.usuarios (email, nombre, rol) values
 ('admin@unesum.edu.ec','Admin','superadmin'),
 ('resp@unesum.edu.ec','Responsable','responsable_ipct'),
 ('cal@unesum.edu.ec','Calidad','calidad'),
 ('d1@unesum.edu.ec','Docente Uno','docente'),
 ('d2@unesum.edu.ec','Docente Dos','docente'),
 ('externo@gmail.com','Externo en lista','docente');   -- dominio no permitido
insert into public.usuarios (email, nombre, rol, evaluado) values
 ('comision@unesum.edu.ec','Comisión','responsable_ipct', false);   -- cuenta de gestión
update public.ajustes set valor = '2026' where clave = 'anio_inicio';

-- ===== Latido (acción diaria): anon puede llamar a ping(), pero no leer tablas =====
set role anon;
do $$ begin
  assert public.ping() = 1, 'ping responde';
  perform pruebas.debe_fallar('select count(*) from public.tipos_evidencia', '42501');
end $$;
reset role;

-- ===== Acceso =====
select pruebas.como('intruso@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion()) = 0, 'intruso no debe vincularse';
  assert (select count(*) from public.tipos_evidencia) = 0, 'intruso no ve el catálogo';
  assert (select count(*) from public.ranking(2026)) = 0, 'intruso no ve el ranking';
end $$;
do $$ begin
  assert (select count(*) from public.diagnostico_sesion() where en_lista is false and dominio_correcto) = 1, 'diagnóstico del intruso';
end $$;
reset role;
select pruebas.como('externo@gmail.com') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion()) = 0, 'dominio ajeno bloqueado';
  assert (select count(*) from public.diagnostico_sesion() where en_lista and not dominio_correcto) = 1, 'diagnóstico de dominio';
end $$;
reset role;

select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion()) = 1, 'd1 se vincula';
  assert (select count(*) from public.tipos_evidencia) = 28, 'catálogo de 28 tipos';
end $$;

-- ===== Carga del docente =====
insert into public.evidencias (docente_id, tipo_id, anio, datos)
select public.mi_usuario_id(), t, 2026, d from (values
 ('pe_dir','{"nombre":"Proyecto A","financiamiento":"SENESCYT","estado":"En ejecución"}'::jsonb),
 ('pe_dir','{"nombre":"Proyecto B","financiamiento":"SENESCYT","estado":"En ejecución"}'),
 ('pe_pri','{"nombre":"Proyecto C","financiamiento":"CEDIA","estado":"Finalizado"}'),
 ('pe_inv','{"nombre":"Proyecto D","financiamiento":"CEDIA","estado":"Finalizado"}'),
 ('q1','{"titulo":"Hormigón reciclado","revista":"Rev X","doi":"10.1000/ABC.123"}'),
 ('patentes','{"titulo":"Dispositivo","numero":"SENADI-2026-1"}'),
 ('v_dir','{"nombre":"Vinc 1","beneficiarios":"Comunidad","estado":"Finalizado"}'),
 ('v_dir','{"nombre":"Vinc 2","beneficiarios":"Comunidad","estado":"Finalizado"}'),
 ('v_par','{"nombre":"Vinc 3","beneficiarios":"Comunidad","estado":"Finalizado"}')
) v(t, d);

do $$ begin
  assert (select count(*) from public.evidencias where estado = 'pendiente') = 9, '9 pendientes';
  -- Duplicado por DOI (mayúsculas y prefijo distintos)
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'q2',2026,'{"titulo":"otro","revista":"Y","doi":"https://doi.org/10.1000/abc.123"}')$q$, '23505');
  -- Campo obligatorio
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'q1',2026,'{"revista":"Y"}')$q$, '23514');
  -- Año fuera de rango
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2020,'{"nombre":"R","institucion":"Inst"}')$q$, '23514');
  -- No puede cargar a nombre de otro
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (gen_random_uuid(),'red',2026,'{"nombre":"R","institucion":"Inst"}')$q$, '42501');
  -- No puede autovalidarse: el trigger lo devuelve a pendiente
  update public.evidencias set estado = 'validada' where tipo_id = 'q1';
  assert (select estado from public.evidencias where tipo_id = 'q1') = 'pendiente', 'sin autovalidación';
  assert (select validado_por from public.evidencias where tipo_id = 'q1') is null, 'sin validado_por';
end $$;

-- Archivo PDF por evidencia (ruta docente/evidencia/archivo)
insert into public.archivos (evidencia_id, ruta, nombre, tamano)
select id, docente_id || '/' || id || '/cert.pdf', 'cert.pdf', 120000 from public.evidencias;
do $$ begin
  perform pruebas.debe_fallar($q$insert into public.archivos (evidencia_id,ruta,nombre,tamano)
     select id, docente_id || '/' || id || '/z.pdf','z.pdf',10 from public.evidencias limit 1$q$, '23505');
  perform pruebas.debe_fallar($q$update public.archivos set tamano = 6000000$q$, '23514');  -- > 5 MB
end $$;
reset role;

-- ===== Validación =====
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.evidencias) = 0, 'd2 no ve evidencias ajenas';
  assert (select count(*) from public.archivos) = 0, 'd2 no ve archivos ajenos';
  assert pruebas.filas($q$update public.evidencias set estado='validada'$q$) = 0, 'd2 no valida';
end $$;
reset role;

select pruebas.como('cal@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.evidencias) = 9, 'calidad lee todo';
  assert pruebas.filas($q$update public.evidencias set estado='validada'$q$) = 0, 'calidad no modifica';
  assert pruebas.filas($q$delete from public.evidencias$q$) = 0, 'calidad no borra';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     select id,'red',2026,'{"nombre":"R","institucion":"Inst"}' from public.usuarios where email='cal@unesum.edu.ec'$q$, '42501');
  assert (select usado from public.uso_almacenamiento()) = 9 * 120000, 'uso de almacenamiento';
end $$;
reset role;

select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  -- Observar/rechazar exige comentario
  perform pruebas.debe_fallar($q$update public.evidencias set estado='observada' where tipo_id='q1'$q$, '23514');
  -- Validar todo salvo el artículo, que se observa
  -- Se validan marcando toda la lista de verificación del tipo (etapa 5b).
  update public.evidencias e set estado = 'validada',
         verificacion = (select coalesce(jsonb_agg(v ->> 'id'), '[]'::jsonb)
                           from public.tipos_evidencia t, jsonb_array_elements(coalesce(t.esquema -> 'verificacion', '[]')) v
                          where t.id = e.tipo_id)
   where tipo_id <> 'q1';
  update public.evidencias set estado = 'observada', comentario = 'Falta DOI legible' where tipo_id = 'q1';
  -- El validador no toca los datos
  update public.evidencias set datos = '{}', anio = 2025 where tipo_id = 'pe_inv';
  assert (select datos ->> 'nombre' from public.evidencias where tipo_id = 'pe_inv') = 'Proyecto D', 'datos intactos';
  -- No puede devolver a pendiente
  perform pruebas.debe_fallar($q$update public.evidencias set estado='pendiente' where tipo_id='pe_inv'$q$, '42501');
  -- Cargar y validar lo propio: no se puede validar lo propio
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Red Civil","institucion":"Inst"}');
  update public.evidencias set estado = 'validada' where tipo_id = 'red' and docente_id = public.mi_usuario_id();
  assert (select estado from public.evidencias where tipo_id = 'red' and docente_id = public.mi_usuario_id()) = 'pendiente',
         'el responsable no se valida a sí mismo';
end $$;
reset role;

-- Sin PDF no se valida
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
insert into public.evidencias (docente_id, tipo_id, anio, datos)
  values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Sin PDF","institucion":"Inst"}');
reset role;
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar($q$update public.evidencias set estado='validada' where datos->>'nombre'='Sin PDF'$q$, '23514');
end $$;
reset role;

-- ===== Cálculo: topes, IPCT, nivel, ranking =====
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare r record;
begin
  -- Proyectos externos: 10 + 10 + 8 computan; el de 4 queda fuera por el tope de 3.
  -- IVs: v_dir 3 + 3 computan; v_par 2 queda fuera (tope 2). IiD: 6. El artículo está observado.
  select * into r from public.ranking(2026) where nombre = 'Docente Uno';
  assert r.ii = 28 and r.iid = 6 and r.ivs = 6 and r.total = 40, format('IPCT esperado 40, llegó %s', r.total);
  assert r.nivel = 'Nivel 2', 'nivel 2 con 40 puntos';
  assert r.posicion = 1, 'primer lugar';
  assert (select count(*) from public.ranking(2025) where total > 0) = 0, 'otro año sin puntos';
  assert (select count(*) from public.detalle_docente(
            (select id from public.usuarios where email='d1@unesum.edu.ec'), 2026)) = 0
         , 'd2 no ve el detalle de d1';
end $$;
reset role;

select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.detalle_docente(public.mi_usuario_id(), 2026) where not computada) = 2,
         'dos evidencias no computadas por tope';
  assert (select total from public.evolucion(public.mi_usuario_id()) where anio = 2026) = 40, 'evolución 2026';
  -- Validada: el docente no puede editarla ni borrarla
  assert pruebas.filas($q$update public.evidencias set datos='{"nombre":"X"}' where tipo_id='pe_dir'$q$) = 0, 'validada no editable';
  assert pruebas.filas($q$delete from public.evidencias where tipo_id='pe_dir'$q$) = 0, 'validada no se borra';
  assert pruebas.filas($q$delete from public.archivos where evidencia_id in (select id from public.evidencias where tipo_id='pe_dir')$q$) = 0, 'archivo de validada intacto';
  -- Observada: corrige y reenvía; vuelve a pendiente y se limpia el comentario
  assert (select comentario from public.evidencias where tipo_id='q1') = 'Falta DOI legible', 've el comentario';
  update public.evidencias set datos = datos || '{"url":"https://doi.org/10.1000/abc.123"}' where tipo_id = 'q1';
  assert (select estado from public.evidencias where tipo_id='q1') = 'pendiente', 'reenviada a pendiente';
  assert (select comentario from public.evidencias where tipo_id='q1') is null, 'comentario limpiado';
  -- Una pendiente sí se puede borrar
  assert pruebas.filas($q$delete from public.evidencias where datos->>'nombre'='Sin PDF'$q$) = 1, 'pendiente se borra';
  assert (select count(*) from public.historial where estado_nuevo = 'eliminada') = 1, 'baja en historial';
  assert (select count(*) from public.historial where estado_anterior = 'observada' and estado_nuevo = 'pendiente') = 1, 'reenvío en historial';
  -- Docente no puede cambiar roles ni ver usuarios ajenos
  assert (select count(*) from public.usuarios) = 1, 'solo ve su fila';
  assert pruebas.filas($q$update public.usuarios set rol='superadmin'$q$) = 0, 'no escala rol';
end $$;
reset role;

-- Respaldo: solo superadmin
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin perform pruebas.debe_fallar('select public.exportar_respaldo()', '42501'); end $$;
reset role;
select pruebas.como('admin@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert jsonb_array_length(public.exportar_respaldo() -> 'evidencias') >= 9, 'respaldo con evidencias';
  assert pruebas.filas($q$update public.usuarios set activo = activo$q$) = 7, 'superadmin gestiona usuarios';
end $$;
reset role;

-- ===== Cuenta institucional (evaluado = false) =====
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
insert into public.evidencias (docente_id, tipo_id, anio, datos)
  values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Red de Dos","institucion":"Inst"}');
insert into public.archivos (evidencia_id, ruta, nombre, tamano)
  select id, docente_id || '/' || id || '/c.pdf', 'c.pdf', 1000 from public.evidencias where datos->>'nombre' = 'Red de Dos';
reset role;
select pruebas.como('comision@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion() where not evaluado) = 1, 'perfil con evaluado = false';
  assert public.puede_cargar() is false, 'la cuenta de gestión no carga';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2026,'{"nombre":"R","institucion":"Inst"}')$q$, '42501');
  assert (select count(*) from public.ranking(2026) where nombre = 'Comisión') = 0, 'fuera del ranking';
  assert (select count(*) from public.ranking(2026) where nombre = 'Responsable') = 1, 'la responsable evaluada sí aparece';
  update public.evidencias set estado = 'validada', comentario = 'Verificado por la Comisión' where datos->>'nombre' = 'Red de Dos';
  assert (select estado from public.evidencias where datos->>'nombre' = 'Red de Dos') = 'validada', 'la Comisión valida a cualquier docente';
end $$;
reset role;

-- ===== Storage =====
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare yo uuid := public.mi_usuario_id(); ev_pend uuid; ev_val uuid;
begin
  select id into ev_pend from public.evidencias where tipo_id = 'q1';
  select id into ev_val from public.evidencias where tipo_id = 'pe_dir' limit 1;
  insert into storage.objects (bucket_id, name) values ('evidencias', yo || '/' || ev_pend || '/a.pdf');
  perform pruebas.debe_fallar(format($q$insert into storage.objects (bucket_id,name) values ('evidencias','%s/%s/a.pdf')$q$, yo, ev_val), '42501');
  perform pruebas.debe_fallar($q$insert into storage.objects (bucket_id,name) values ('evidencias','otro-id/x/a.pdf')$q$, '42501');
end $$;
reset role;
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin assert (select count(*) from storage.objects) = 0, 'd2 no ve archivos de d1'; end $$;
reset role;
select pruebas.como('cal@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin assert (select count(*) from storage.objects) = 1, 'calidad ve archivos'; end $$;
reset role;

