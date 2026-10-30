-- Pruebas de la etapa 5b: archivos múltiples, campos de la responsable, coautoría,
-- cierre de carga y gestión de usuarios. Se ejecuta tras 10_prueba_ipct.sql.
\set ON_ERROR_STOP on
\set QUIET on

create table if not exists pruebas.ids (clave text primary key, id uuid);
grant all on pruebas.ids to authenticated;
insert into pruebas.ids select 'u_' || split_part(email, '@', 1), id from public.usuarios where email in ('d1@unesum.edu.ec','d2@unesum.edu.ec','resp@unesum.edu.ec','comision@unesum.edu.ec') on conflict (clave) do nothing;
-- Un segundo año evaluable para probar el cierre de carga por año.
update public.ajustes set valor = '2025' where clave = 'anio_inicio';
insert into public.periodos (anio, abierto) values (2025, true) on conflict (anio) do nothing;
insert into public.usuarios_anios (usuario_id, anio)
  select id, 2025 from public.usuarios where evaluado and rol in ('docente','responsable_ipct','superadmin') on conflict do nothing;

-- ===== Archivos por función y datos de la responsable =====
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare yo uuid := public.mi_usuario_id(); ev uuid;
begin
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (yo, 'q3', 2026, '{"titulo":"Pavimentos permeables","revista":"Rev Civil","doi":"10.5555/pp.1"}') returning id into ev;
  insert into pruebas.ids values ('art', ev);
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol) values (ev, yo || '/' || ev || '/a.pdf', 'a.pdf', 1000, 'principal');
  -- Una función, un archivo del docente
  perform pruebas.debe_fallar(format($q$insert into public.archivos (evidencia_id,ruta,nombre,tamano,rol)
     values ('%s','%s/%s/b.pdf','b.pdf',1000,'principal')$q$, ev, yo, ev), '23505');
  -- El docente solo sube PDF y no puede subir como «validador»
  perform pruebas.debe_fallar(format($q$insert into public.archivos (evidencia_id,ruta,nombre,tamano,rol)
     values ('%s','%s/%s/b.png','b.png',1000,'extra')$q$, ev, yo, ev), '23514');
  perform pruebas.debe_fallar(format($q$insert into public.archivos (evidencia_id,ruta,nombre,tamano,rol,origen)
     values ('%s','%s/%s/c.pdf','c.pdf',1000,'indexacion','validador')$q$, ev, yo, ev), '42501');
end $$;
reset role;

select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev uuid := (select id from pruebas.ids where clave = 'art'); dueno uuid; lista jsonb;
begin
  select docente_id into dueno from public.evidencias where id = ev;
  lista := (select jsonb_agg(v ->> 'id') from public.tipos_evidencia t, jsonb_array_elements(t.esquema -> 'verificacion') v where t.id = 'q3');
  -- Falta la captura de indexación (archivo de la responsable)
  perform pruebas.debe_fallar(format($q$update public.evidencias set estado='validada' where id='%s'$q$, ev), '23514');
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol, origen)
    values (ev, dueno || '/' || ev || '/cap.png', 'cap.png', 50000, 'indexacion', 'validador');
  -- Falta la lista de verificación y los campos obligatorios de la matriz
  perform pruebas.debe_fallar(format($q$update public.evidencias set estado='validada' where id='%s'$q$, ev), '23514');
  update public.evidencias set verificacion = lista, datos_validacion = '{"base":"SCOPUS","issn":"1234-5678"}', estado = 'observada', comentario = 'Pruebo guardar'
   where id = ev;
  -- Falta fecha de publicación y cuartil (obligatorio en Q3)
  perform pruebas.debe_fallar(format($q$update public.evidencias set estado='validada', verificacion='%s', datos_validacion='{"base":"SCOPUS","issn":"1234-5678","fecha_publicacion":"2026-03-01"}' where id='%s'$q$, lista, ev), '23514');
  -- Reclasificar fuera del producto no se puede
  perform pruebas.debe_fallar(format($q$update public.evidencias set tipo_id='pe_dir', estado='observada', comentario='x' where id='%s'$q$, ev), '23514');
end $$;
reset role;

-- El docente ve el adjunto de la Comisión y no puede quitarlo
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev uuid := (select id from pruebas.ids where clave = 'art');
begin
  assert (select count(*) from public.archivos where evidencia_id = ev and origen = 'validador') = 1, 'el docente ve el adjunto';
  assert pruebas.filas(format($q$delete from public.archivos where evidencia_id='%s' and origen='validador'$q$, ev)) = 0, 'no borra adjuntos de la Comisión';
  assert (select estado from public.evidencias where id = ev) = 'observada', 'quedó observada';
  -- Corrige: vuelve a pendiente y la lista de verificación se reinicia
  update public.evidencias set datos = datos || '{"url":"https://doi.org/10.5555/pp.1"}' where id = ev;
  assert (select estado from public.evidencias where id = ev) = 'pendiente', 'pendiente tras corregir';
  assert (select verificacion from public.evidencias where id = ev) = '[]'::jsonb, 'lista de verificación reiniciada';
  assert (select datos_validacion ->> 'base' from public.evidencias where id = ev) = 'SCOPUS', 'datos de la Comisión se conservan';
end $$;
reset role;

-- Reclasificar Q3 -> Q1 y validar
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev uuid := (select id from pruebas.ids where clave = 'art'); lista jsonb;
begin
  lista := (select jsonb_agg(v ->> 'id') from public.tipos_evidencia t, jsonb_array_elements(t.esquema -> 'verificacion') v where t.id = 'q1');
  update public.evidencias
     set tipo_id = 'q1', estado = 'validada', verificacion = lista,
         datos_validacion = '{"base":"SCOPUS","issn":"1234-5678","fecha_publicacion":"2026-03-01","cuartil":"Q1"}'
   where id = ev;
  assert (select tipo_id from public.evidencias where id = ev) = 'q1', 'reclasificada';
  assert (select count(*) from public.historial where evidencia_id = ev and comentario like 'Reclasificada por la Comisión%') = 1, 'reclasificación en el historial';
  assert (select validado_por from public.evidencias where id = ev) = public.mi_usuario_id(), 'validada por la responsable';
end $$;
reset role;

-- ===== Coautoría =====
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare yo uuid := public.mi_usuario_id(); d2 uuid := (select id from pruebas.ids where clave = 'u_d2');
        resp uuid := (select id from pruebas.ids where clave = 'u_resp');
        ev uuid; ev_pe uuid; co uuid;
begin
  insert into public.evidencias (docente_id, tipo_id, anio, datos, autoria)
    values (yo, 'q4', 2026, '{"titulo":"Puentes de bambú","revista":"Rev Puentes","doi":"10.5555/pb.2"}', '{"posicion":1,"participacion":"Autor"}')
    returning id into ev;
  insert into pruebas.ids values ('co', ev);
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol) values (ev, yo || '/' || ev || '/p.pdf', 'p.pdf', 1000, 'principal');

  assert (select count(*) from public.buscar_docentes() where nombre = 'Docente Dos') = 1, 'buscar_docentes ve a Docente Dos';
  assert (select count(*) from public.buscar_docentes() where nombre in ('Comisión','Docente Uno')) = 0, 'sin la cuenta de gestión ni uno mismo';

  co := public.agregar_coautor(ev, d2, 2, 'Coautor');
  insert into pruebas.ids values ('co_fila_d2', co);
  assert (select estado from public.coautorias(2026) where evidencia_id = co) = 'pendiente', 'coautoría pendiente';
  assert (select grupo_id from public.coautorias(2026) where evidencia_id = co) = ev, 'enlazada al titular';
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',3,'Coautor')$q$, ev, d2), '23514');   -- ya figura
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',3,'Coautor')$q$, ev, yo), '23514');   -- uno mismo
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',3,'Coautor')$q$, ev,
      (select id from pruebas.ids where clave = 'u_comision')), '23514');                              -- cuenta de gestión

  -- Los proyectos no admiten coautores
  select id into ev_pe from public.evidencias where tipo_id = 'pe_dir' limit 1;
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',2,'Coautor')$q$, ev_pe, d2), '23514');

  -- La responsable también es coautora de otra publicación (para probar «nadie valida lo propio»)
  insert into public.evidencias (docente_id, tipo_id, anio, datos, autoria)
    values (yo, 'q4', 2026, '{"titulo":"Vigas mixtas","revista":"Rev Vigas","doi":"10.5555/vm.3"}', '{"posicion":1,"participacion":"Autor"}')
    returning id into ev;
  insert into pruebas.ids values ('co_resp', ev);
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol) values (ev, yo || '/' || ev || '/v.pdf', 'v.pdf', 1000, 'principal');
  perform public.agregar_coautor(ev, resp, 2, 'Coautor');
end $$;
reset role;

select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev uuid := (select id from pruebas.ids where clave = 'co'); mia uuid := (select id from pruebas.ids where clave = 'co_fila_d2');
begin
  assert (select count(*) from public.evidencias where id = mia) = 1, 'la coautora la ve en su cuenta';
  assert (select count(*) from public.archivos where evidencia_id = ev) = 1, 'la coautora lee el archivo del titular';
  perform pruebas.debe_fallar(format($q$update public.evidencias set datos = '{"titulo":"Otro","revista":"Y"}' where id = '%s'$q$, mia), '42501');
  assert (select count(*) from public.coautorias(2026) where grupo_id = ev) = 2, 'coautorias: titular y coautora';
  -- No puede registrar la misma publicación por su cuenta
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'q4',2026,'{"titulo":"Puentes de bambú","revista":"Rev Puentes","doi":"10.5555/PB.2"}')$q$, '23505');
  -- No puede fabricarse una coautoría por su cuenta ni leer archivos ajenos
  insert into public.evidencias (docente_id, tipo_id, anio, datos, titular_id)
    values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Red Falsa","institucion":"Inst"}', (select id from pruebas.ids where clave = 'art'));
  assert (select titular_id from public.evidencias where datos ->> 'nombre' = 'Red Falsa') is null, 'titular_id ignorado';
  assert (select count(*) from public.archivos where evidencia_id = (select id from pruebas.ids where clave = 'art')) = 0, 'no lee archivos ajenos';
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',2,'Coautor')$q$, ev, public.mi_usuario_id()), '42501');
end $$;
reset role;

-- La responsable valida al titular y se copia a la coautora; no puede validar donde es coautora
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev uuid := (select id from pruebas.ids where clave = 'co'); ev_r uuid := (select id from pruebas.ids where clave = 'co_resp');
        dueno uuid := (select id from pruebas.ids where clave = 'u_d1'); lista jsonb;
begin
  lista := (select jsonb_agg(v ->> 'id') from public.tipos_evidencia t, jsonb_array_elements(t.esquema -> 'verificacion') v where t.id = 'q4');
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol, origen)
    values (ev, dueno || '/' || ev || '/c.jpg', 'c.jpg', 40000, 'indexacion', 'validador');
  -- En la fila de la coautora no se valida: se hace desde el titular
  perform pruebas.debe_fallar(format($q$update public.evidencias set estado='validada' where titular_id='%s'$q$, ev), '42501');
  update public.evidencias
     set estado = 'validada', verificacion = lista,
         datos_validacion = '{"base":"SCOPUS","issn":"1111-2222","fecha_publicacion":"2026-04-01","cuartil":"Q4"}'
   where id = ev;
  assert (select count(*) from public.evidencias where titular_id = ev and estado = 'validada' and validado_por is not null) = 1, 'se valida junto con el titular';
  assert (select datos_validacion ->> 'cuartil' from public.evidencias where titular_id = ev) = 'Q4', 'datos de la Comisión copiados';
  -- Dentro de una evidencia donde es coautora, la responsable no valida ni adjunta
  perform pruebas.debe_fallar(format($q$update public.evidencias set estado='observada', comentario='x' where id='%s'$q$, ev_r), '42501');
  assert public.puede_adjuntar(ev_r::text) is false, 'no adjunta donde es coautora';
end $$;
reset role;

select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  -- La coautora suma el artículo validado: Q4 = 3 puntos
  assert (select ii from public.ranking(2026) where nombre = 'Docente Dos') >= 3, 'la coautora suma los puntos';
  assert (select count(*) from public.historial where docente_id = public.mi_usuario_id() and estado_nuevo = 'validada') >= 1, 'historial propio de la coautora';
  -- Validada: no puede retirarse
  assert pruebas.filas(format($q$delete from public.evidencias where id = '%s'$q$, (select id from pruebas.ids where clave = 'co_fila_d2'))) = 0, 'validada no se retira';
end $$;
reset role;

-- Retiro de una coautora antes de validar, y borrado en cascada
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert pruebas.filas($q$delete from public.evidencias where titular_id = (select id from pruebas.ids where clave = 'co_resp')$q$) = 0, 'otra persona no se retira por ella';
end $$;
reset role;
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev_r uuid := (select id from pruebas.ids where clave = 'co_resp');
begin
  assert pruebas.filas(format($q$delete from public.evidencias where titular_id = '%s' and docente_id = public.mi_usuario_id()$q$, ev_r)) = 1, 'se retira de la coautoría';
end $$;
reset role;
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ev_r uuid := (select id from pruebas.ids where clave = 'co_resp');
begin
  assert (select count(*) from public.historial where evidencia_id = ev_r and comentario = 'Un coautor se retiró de la evidencia') = 1, 'el titular ve el aviso del retiro';
  perform public.agregar_coautor(ev_r, (select id from pruebas.ids where clave = 'u_d2'), 2, 'Coautor');
  perform public.quitar_coautor(ev_r, (select id from pruebas.ids where clave = 'u_d2'));
  assert (select count(*) from public.evidencias where titular_id = ev_r) = 0, 'el titular quita al coautor';
  perform public.agregar_coautor(ev_r, (select id from pruebas.ids where clave = 'u_d2'), 2, 'Coautor');
  delete from public.evidencias where id = ev_r;
  assert (select count(*) from public.evidencias where titular_id = ev_r) = 0, 'borrar al titular borra las coautorías';
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',2,'Coautor')$q$,
      (select id from pruebas.ids where clave = 'co'), (select id from pruebas.ids where clave = 'u_resp')), '23514'); -- ya validada
end $$;
reset role;

-- ===== Cierre de carga =====
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar('select public.fijar_periodo(2026, false)', '42501');
  assert (select abierto from public.estado_periodo(2026)) is true, 'abierto por defecto';
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Red cierre","institucion":"Inst"}');
  insert into public.archivos (evidencia_id, ruta, nombre, tamano)
    select id, docente_id || '/' || id || '/rc.pdf', 'rc.pdf', 1000 from public.evidencias where datos ->> 'nombre' = 'Red cierre';
end $$;
reset role;

select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
select public.fijar_periodo(2026, false) \g /dev/null
do $$ begin
  assert (select abierto from public.estado_periodo(2026)) is false, 'cerrado a mano';
  assert (select count(*) from public.bitacora where accion = 'periodo') = 1, 'bitácora del cierre';
end $$;
reset role;

select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare yo uuid := public.mi_usuario_id(); ev uuid := (select id from public.evidencias where datos ->> 'nombre' = 'Red cierre');
begin
  assert (select abierto from public.estado_periodo(2026)) is false, 'el docente ve el cierre';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2026,'{"nombre":"Red tarde"}')$q$, '23514');
  perform pruebas.debe_fallar(format($q$update public.evidencias set datos='{"nombre":"Cambio"}' where id='%s'$q$, ev), '23514');
  perform pruebas.debe_fallar(format($q$delete from public.evidencias where id='%s'$q$, ev), '23514');
  perform pruebas.debe_fallar(format($q$insert into public.archivos (evidencia_id,ruta,nombre,tamano) values ('%s','%s/%s/z.pdf','z.pdf',10)$q$, ev, yo, ev), '42501');
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',2,'Coautor')$q$, ev,
      (select id from pruebas.ids where clave = 'u_d2')), '23514');
  -- Otro año sigue abierto
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (yo, 'red', 2025, '{"nombre":"Red de 2025","institucion":"Inst"}');
end $$;
reset role;

-- Con la carga cerrada la responsable sigue validando
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  update public.evidencias set estado = 'validada' where datos ->> 'nombre' = 'Red cierre';
  assert (select estado from public.evidencias where datos ->> 'nombre' = 'Red cierre') = 'validada', 'validar con la carga cerrada';
end $$;
-- Cierre automático por fecha: ayer cerró, mañana cierra
select public.fijar_periodo(2026, true, current_date - 1) \g /dev/null
do $$ begin
  assert (select abierto from public.estado_periodo(2026)) is false, 'cerrado por fecha vencida';
  assert (select cierra_el from public.estado_periodo(2026)) = current_date - 1, 'fecha de cierre visible';
end $$;
select public.fijar_periodo(2026, true, current_date + 1) \g /dev/null
do $$ begin assert (select abierto from public.estado_periodo(2026)) is true, 'abierto hasta la fecha'; end $$;
select public.fijar_periodo(2026, true, null) \g /dev/null
reset role;

-- ===== Gestión de usuarios por la responsable =====
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  insert into public.usuarios (email, nombre, rol, cedula, facultad) values ('d3@unesum.edu.ec', 'Docente Tres', 'docente', '1300000001', 'Ciencias Técnicas');
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x1@unesum.edu.ec','X','superadmin')$q$, '42501');
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x2@unesum.edu.ec','X','responsable_ipct')$q$, '42501');
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol,cedula) values ('x3@unesum.edu.ec','X','docente','1300000001')$q$, '23505');
  assert pruebas.filas($q$update public.usuarios set cedula = '1300000002', programa = 'Ingeniería Civil' where email = 'd3@unesum.edu.ec'$q$) = 1, 'edita cédula de un docente';
  assert pruebas.filas($q$update public.usuarios set activo = false where email = 'd3@unesum.edu.ec'$q$) = 1, 'desactiva a un docente';
  assert pruebas.filas($q$update public.usuarios set nombre = 'Hackeado' where email = 'admin@unesum.edu.ec'$q$) = 0, 'no toca al superadmin';
  perform pruebas.debe_fallar($q$update public.usuarios set rol = 'superadmin' where email = 'd1@unesum.edu.ec'$q$, '42501');
  perform pruebas.debe_fallar($q$update public.usuarios set rol = 'responsable_ipct' where email = 'd1@unesum.edu.ec'$q$, '42501');
  assert pruebas.filas($q$delete from public.usuarios where email = 'd3@unesum.edu.ec'$q$) = 0, 'no borra usuarios (se desactivan)';
end $$;
reset role;
select pruebas.como('cal@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x4@unesum.edu.ec','X','docente')$q$, '42501');
  assert pruebas.filas($q$update public.usuarios set cedula = '9' where email = 'd1@unesum.edu.ec'$q$) = 0, 'calidad no edita usuarios';
end $$;
reset role;
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x5@unesum.edu.ec','X','docente')$q$, '42501');
end $$;
reset role;

-- ===== Storage: capturas de la responsable =====
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare dueno uuid := (select id from pruebas.ids where clave = 'u_d1');
        pend uuid := (select id from public.evidencias where datos ->> 'nombre' = 'Red de 2025');
        val uuid := (select id from pruebas.ids where clave = 'co');
begin
  insert into storage.objects (bucket_id, name) values ('evidencias', dueno || '/' || pend || '/captura.png');
  insert into public.archivos (evidencia_id, ruta, nombre, tamano, rol, origen)
    values (pend, dueno || '/' || pend || '/captura.png', 'captura.png', 100, 'soporte', 'validador');
  perform pruebas.debe_fallar(format($q$insert into storage.objects (bucket_id,name) values ('evidencias','%s/%s/x.exe')$q$, dueno, pend), '42501');
  perform pruebas.debe_fallar(format($q$insert into storage.objects (bucket_id,name) values ('evidencias','%s/%s/x.png')$q$, dueno, val), '42501');  -- validada
  perform pruebas.debe_fallar(format($q$insert into storage.objects (bucket_id,name) values ('evidencias','%s/%s/x.png')$q$, gen_random_uuid(), pend), '42501'); -- ruta ajena
  insert into pruebas.ids values ('pend_2025', pend);
end $$;
reset role;
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare yo uuid := public.mi_usuario_id(); pend uuid := (select id from pruebas.ids where clave = 'pend_2025');
begin
  assert (select count(*) from storage.objects where name like '%/captura.png') = 1, 'el docente ve la captura';
  assert pruebas.filas(format($q$delete from storage.objects where name = '%s/%s/captura.png'$q$, yo, pend)) = 0, 'el docente no borra la captura de la Comisión';
  perform pruebas.debe_fallar(format($q$insert into storage.objects (bucket_id,name) values ('evidencias','%s/%s/foto.png')$q$, yo, pend), '42501');
end $$;
reset role;

-- ===== Años habilitados (los años nacen cerrados) =====
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.periodos_visibles()) >= 2, 'el docente ve los años habilitados';
  assert (select configurado from public.estado_periodo(2027)) is false, '2027 sin configurar';
  assert (select abierto from public.estado_periodo(2027)) is false, '2027 nace cerrado';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2027,'{"nombre":"R27","institucion":"I"}')$q$, '23514');
  perform pruebas.debe_fallar('select public.fijar_periodo(2027, true)', '42501');
end $$;
reset role;

select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar('select public.fijar_periodo(2100, true)', '23514');   -- demasiado lejos
  perform pruebas.debe_fallar('select public.fijar_periodo(2019, true)', '23514');   -- antes del año de inicio
end $$;
select public.fijar_periodo(2027, true) \g /dev/null
reset role;

-- Un año recién habilitado no tiene participantes: nadie puede registrar hasta armar la lista.
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select abierto and configurado from public.estado_periodo(2027)), '2027 habilitado';
  assert (select count(*) from public.periodos_visibles() where anio = 2027) = 0, 'el docente no ve un año en el que no figura';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2027,'{"nombre":"R27","institucion":"I"}')$q$, '23514');
  perform pruebas.debe_fallar('select public.fijar_participacion(public.mi_usuario_id(), 2027, true)', '42501');
  perform pruebas.debe_fallar('select public.copiar_participantes(2026, 2027)', '42501');
end $$;
reset role;

select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare n integer;
begin
  n := public.copiar_participantes(2026, 2027);
  assert n >= 4, format('se copian las personas activas y evaluadas (%s)', n);
  assert public.copiar_participantes(2026, 2027) = 0, 'copiar de nuevo no duplica';
  perform pruebas.debe_fallar('select public.copiar_participantes(2026, 2030)', '23514');                 -- año no habilitado
  perform pruebas.debe_fallar($q$select public.fijar_participacion((select id from public.usuarios where email = 'cal@unesum.edu.ec'), 2027, true)$q$, '23514');   -- no evaluada
  -- Docente Dos se fue: sale de 2027, pero conserva 2026
  perform public.fijar_participacion((select id from pruebas.ids where clave = 'u_d2'), 2027, false);
  assert (select count(*) from public.ranking(2027) where nombre = 'Docente Dos') = 0, 'fuera del ranking de 2027';
  assert (select count(*) from public.ranking(2026) where nombre = 'Docente Dos') = 1, 'sigue en el ranking de 2026';
  assert (select count(*) from public.bitacora where accion in ('participante','copiar_participantes')) >= 3, 'bitácora';
end $$;
reset role;

select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select abierto and participa from public.periodos_visibles() where anio = 2027), 'ahora d1 figura en 2027';
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (public.mi_usuario_id(), 'red', 2027, '{"nombre":"R27","institucion":"I"}');
  insert into public.evidencias (docente_id, tipo_id, anio, datos, autoria)
    values (public.mi_usuario_id(), 'q4', 2027, '{"titulo":"Articulo 2027","revista":"R","doi":"10.9/z27"}', '{"posicion":1,"participacion":"Autor"}');
  -- No se puede agregar como coautor a quien ya no figura en el año
  perform pruebas.debe_fallar(format($q$select public.agregar_coautor('%s','%s',2,'Coautor')$q$,
      (select id from public.evidencias where datos ->> 'titulo' = 'Articulo 2027'), (select id from pruebas.ids where clave = 'u_d2')), '23514');
end $$;
reset role;

-- Docente Dos se fue: ya no ve 2027, no puede registrar en 2027, pero sí termina 2026 mientras esté abierto
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.periodos_visibles() where anio = 2027) = 0, 'no ve 2027';
  assert (select count(*) from public.periodos_visibles() where anio = 2026 and participa) = 1, 'sí figura en 2026';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2027,'{"nombre":"R27x","institucion":"I"}')$q$, '23514');
end $$;
reset role;
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
select public.fijar_periodo(2026, true, null) \g /dev/null
reset role;
select pruebas.como('d2@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  insert into public.evidencias (docente_id, tipo_id, anio, datos)
    values (public.mi_usuario_id(), 'red', 2026, '{"nombre":"Red de salida","institucion":"I"}');
end $$;
reset role;

-- Quien ingresa mientras hay años abiertos queda en ellos (y quien se desactiva conserva su historia)
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  insert into public.usuarios (email, nombre, rol) values ('nuevo@unesum.edu.ec', 'Docente Nuevo', 'docente');
  assert (select count(*) from public.usuarios_anios a join public.usuarios u on u.id = a.usuario_id
          where u.email = 'nuevo@unesum.edu.ec' and a.anio in (2025, 2026, 2027)) = 3, 'el nuevo queda en los años abiertos';
  update public.usuarios set activo = false where email = 'd2@unesum.edu.ec';
  assert (select count(*) from public.ranking(2026) where nombre = 'Docente Dos') = 1, 'un desactivado sigue en el ranking de los años en que figuraba';
  update public.usuarios set activo = true where email = 'd2@unesum.edu.ec';
end $$;
reset role;


select pruebas.como('admin@unesum.edu.ec') \g /dev/null
set role authenticated;
select public.fijar_periodo(2027, false) \g /dev/null
reset role;
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.periodos_visibles() where anio = 2027 and not abierto) = 1, '2027 cerrado por el superadmin';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2027,'{"nombre":"R27b","institucion":"I"}')$q$, '23514');
end $$;
reset role;

-- ===== Etapa 6: apellidos y nombres para los informes =====
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert pruebas.filas($q$update public.usuarios set apellidos_nombres = 'UNO DOCENTE', cedula = '1300000099' where email = 'd1@unesum.edu.ec'$q$) = 1,
         'la responsable carga apellidos y cédula';
  assert (select apellidos_nombres from public.usuarios where email = 'd1@unesum.edu.ec') = 'UNO DOCENTE', 'se guarda';
end $$;
reset role;

-- ===== Archivar un año (liberar almacenamiento) =====
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  -- Los roles de lectura pueden pedir la copia, pero archivar (borrar) es solo del superadmin
  assert (select count(*) from public.archivos_anio(2025)) >= 0, 'la responsable puede listar los archivos del año';
  assert (public.datos_anio(2025) ->> 'anio')::integer = 2025, 'y los datos del año';
  perform pruebas.debe_fallar('select public.marcar_archivados(array[gen_random_uuid()])', '42501');
end $$;
select public.fijar_periodo(2025, false) \g /dev/null
reset role;

-- Un objeto real de un archivo del docente en un año abierto (como lo dejaría una subida)
insert into storage.objects (bucket_id, name)
  select 'evidencias', a.ruta from public.archivos a join public.evidencias e on e.id = a.evidencia_id
   where a.origen = 'docente' and e.anio = 2026 and e.estado = 'pendiente' limit 1;
select pruebas.como('admin@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$
declare ids uuid[]; antes bigint; abierto_id uuid; ruta_abierta text; ruta_cerrada text;
begin
  assert (select count(*) from public.archivos_anio(2025)) >= 1, 'el superadmin lista los archivos del año';
  assert (select count(*) from public.archivos_anio(2026)) >= 1, 'y los de otro año';
  assert (public.datos_anio(2025) ->> 'anio')::integer = 2025, 'datos del año';
  assert jsonb_array_length(public.datos_anio(2025) -> 'evidencias') >= 1, 'incluye las evidencias';
  assert jsonb_array_length(public.datos_anio(2025) -> 'usuarios') >= 1, 'incluye las personas';

  -- No se archivan archivos de un año abierto
  select array_agg(archivo_id) into ids from public.archivos_anio(2026);
  perform pruebas.debe_fallar(format($q$select public.marcar_archivados('%s'::uuid[])$q$, ids), '23514');
  select o.name into ruta_abierta from storage.objects o join public.archivos a on a.ruta = o.name
   where a.origen = 'docente' limit 1;   -- archivo del docente en un año abierto

  -- Solo se borran del almacenamiento los objetos de años cerrados
  select ruta into ruta_cerrada from public.archivos_anio(2025) limit 1;
  assert ruta_abierta is not null, 'hay un objeto de prueba';
  assert pruebas.filas(format($q$delete from storage.objects where name = '%s'$q$, ruta_abierta)) = 0, 'ni el superadmin ni la responsable borran el archivo de un docente en un año abierto';
  assert pruebas.filas(format($q$delete from storage.objects where name = '%s'$q$, ruta_cerrada)) = 1, 'borra de un año cerrado';

  select usado into antes from public.uso_almacenamiento();
  select array_agg(archivo_id) into ids from public.archivos_anio(2025) where archivado_en is null;
  assert public.marcar_archivados(ids) = array_length(ids, 1), 'marca los archivos';
  assert (select usado from public.uso_almacenamiento()) < antes, 'el uso baja';
  assert public.marcar_archivados(ids) = 0, 'marcar de nuevo no cambia nada';
  assert (select count(*) from public.archivos_anio(2025) where archivado_en is not null) = array_length(ids, 1), 'quedan registrados como archivados';
  assert (select count(*) from public.bitacora where accion = 'archivar_archivos') = 2, 'bitácora';
end $$;
reset role;

-- Los datos y el puntaje se conservan; el año no se puede reabrir; el docente no borra del almacenamiento
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.evidencias where anio = 2025) >= 1, 'las evidencias del año siguen en el sistema';
  perform pruebas.debe_fallar('select public.fijar_periodo(2025, true)', '23514');
end $$;
reset role;
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.archivos a join public.evidencias e on e.id = a.evidencia_id
          where e.anio = 2025 and a.archivado_en is not null) >= 1, 'el docente ve que el archivo fue archivado';
end $$;
reset role;

-- ===== Director de Investigación (solo lectura) y acceso con vencimiento =====
insert into auth.users (email) values ('dir@unesum.edu.ec'), ('venc@unesum.edu.ec');
insert into public.usuarios (email, nombre, rol, evaluado) values
  ('dir@unesum.edu.ec', 'Director de Investigación', 'director_investigacion', false),
  ('venc@unesum.edu.ec', 'Revisor temporal', 'calidad', false);
update public.usuarios set acceso_hasta = (now() at time zone 'America/Guayaquil')::date - 1 where email = 'venc@unesum.edu.ec';

select pruebas.como('dir@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion()) = 1, 'el director se vincula';
  assert public.puede_leer_todo() and not public.puede_cargar() and not public.puede_validar(), 'solo lectura';
  assert (select count(*) from public.evidencias) > 10, 'lee todas las evidencias';
  assert (select count(*) from public.usuarios) > 5, 've a las personas';
  assert pruebas.filas($q$update public.evidencias set estado = 'validada'$q$) = 0, 'no valida';
  assert pruebas.filas($q$delete from public.evidencias$q$) = 0, 'no borra';
  perform pruebas.debe_fallar($q$insert into public.evidencias (docente_id,tipo_id,anio,datos)
     values (public.mi_usuario_id(),'red',2026,'{"nombre":"R","institucion":"I"}')$q$, '23514');
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x9@unesum.edu.ec','X','docente')$q$, '42501');
  assert (select count(*) from public.archivos_anio(2026)) >= 1, 'puede pedir la copia del año';
  assert (public.datos_anio(2026) ->> 'anio')::integer = 2026, 'y sus datos';
  assert (select count(*) from public.archivos_anio(2026) where estado is not null) >= 1, 'con el estado de cada evidencia';
  perform pruebas.debe_fallar('select public.marcar_archivados(array[gen_random_uuid()])', '42501');
  perform pruebas.debe_fallar('select public.exportar_respaldo()', '42501');
  perform pruebas.debe_fallar('select public.fijar_periodo(2026, true)', '42501');
  assert (select count(*) from public.ranking(2026)) >= 1, 've el ranking';
end $$;
reset role;

-- Un docente no puede pedir la copia
select pruebas.como('d1@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  perform pruebas.debe_fallar('select * from public.archivos_anio(2026)', '42501');
  perform pruebas.debe_fallar('select public.datos_anio(2026)', '42501');
end $$;
reset role;

-- Acceso vencido: la cuenta deja de funcionar sin desactivarla
select pruebas.como('venc@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.vincular_sesion()) = 0, 'acceso vencido: no se vincula';
  assert (select count(*) from public.tipos_evidencia) = 0, 'y no ve nada';
  assert (select vencido and activo and en_lista from public.diagnostico_sesion()), 'el diagnóstico explica que venció';
end $$;
reset role;
-- Hoy aún es válido (inclusive) y una fecha futura también; quitar la fecha lo deja sin vencimiento
update public.usuarios set acceso_hasta = (now() at time zone 'America/Guayaquil')::date where email = 'venc@unesum.edu.ec';
select pruebas.como('venc@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin assert (select count(*) from public.vincular_sesion()) = 1, 'el último día todavía entra'; end $$;
reset role;
update public.usuarios set acceso_hasta = (now() at time zone 'America/Guayaquil')::date - 1 where email = 'venc@unesum.edu.ec';
select pruebas.como('resp@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin
  -- La responsable puede ampliar el acceso y crear al Director, pero no a un superadmin
  assert pruebas.filas($q$update public.usuarios set acceso_hasta = null where email = 'venc@unesum.edu.ec'$q$) = 1, 'la responsable cambia la fecha';
  insert into public.usuarios (email, nombre, rol, evaluado) values ('dir2@unesum.edu.ec', 'Otro Director', 'director_investigacion', false);
  perform pruebas.debe_fallar($q$insert into public.usuarios (email,nombre,rol) values ('x8@unesum.edu.ec','X','superadmin')$q$, '42501');
end $$;
reset role;
select pruebas.como('venc@unesum.edu.ec') \g /dev/null
set role authenticated;
do $$ begin assert (select count(*) from public.vincular_sesion()) = 1, 'sin vencimiento vuelve a entrar'; end $$;
reset role;

\echo 'TODAS LAS PRUEBAS PASARON'
