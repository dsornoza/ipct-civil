-- =====================================================================
-- 0005 · Catálogo inicial (equivale al CONFIG del simulador /ipct/)
-- Fuente: Reforma del Instructivo para el reconocimiento y estímulo al
-- personal académico y estudiantes con actividades de I+D+i y vinculación
-- (UNESUM, OCS, 4 de marzo de 2022, SE Nº ROCS-05-Nº-12-2022).
-- Si cambia el reglamento, edite estas tablas (puntos, tope, niveles).
--
-- Formato de «esquema»:
--   campos: [{nombre, etiqueta, tipo(texto|textarea|url|fecha|numero|select),
--             requerido, opciones?, ayuda?}]
--   dedup:  {grupos: [[campos...], ...], incluye_anio: bool}
--           Se usa el primer grupo cuyos campos estén todos llenos para
--           formar la clave anti-duplicado (p. ej. DOI, o título + revista).
-- =====================================================================

insert into public.ajustes (clave, valor) values
    ('dominio_permitido', 'unesum.edu.ec'),
    ('anio_inicio',       '2026'),            -- primer año evaluable (sin historial anterior)
    ('sin_nivel',         'Sin nivel'),
    ('cuota_bytes',       '1073741824'),      -- 1 GB del plan gratuito (solo informativo)
    ('fuente_normativa',  'Reforma del Instructivo para el reconocimiento y estímulo al personal académico y estudiantes con actividades de investigación, desarrollo, innovación y vinculación con la sociedad de la UNESUM (OCS, 4 de marzo de 2022; SE Nº ROCS-05-Nº-12-2022)')
on conflict (clave) do update set valor = excluded.valor;

insert into public.niveles (min_puntos, nombre, estimulos) values
 (50, 'Nivel 1', '["Fondos hasta $2.500 USD para capacitaciones, estancias o pasantías en centros de investigación a nivel internacional.","Fondos hasta $1.500 USD para difundir resultados en eventos científicos a nivel internacional."]'),
 (40, 'Nivel 2', '["Fondos hasta $2.000 USD para capacitaciones, estancias o pasantías en centros de investigación a nivel internacional.","Fondos hasta $1.500 USD para difundir resultados en eventos científicos a nivel internacional."]'),
 (30, 'Nivel 3', '["Fondos hasta $1.500 USD para difundir resultados en eventos científicos a nivel internacional."]'),
 (20, 'Nivel 4', '["Reconocimiento público al mérito científico por parte del Vicerrectorado Académico y la Dirección de Investigación."]')
on conflict (min_puntos) do update set nombre = excluded.nombre, estimulos = excluded.estimulos;

do $$
declare
    f_articulo  jsonb := '{"campos":[
        {"nombre":"titulo","etiqueta":"Título del artículo","tipo":"textarea","requerido":true},
        {"nombre":"revista","etiqueta":"Revista","tipo":"texto","requerido":true},
        {"nombre":"base","etiqueta":"Base de indexación (p. ej. Scopus, Web of Science, SciELO)","tipo":"texto","requerido":false},
        {"nombre":"doi","etiqueta":"DOI","tipo":"texto","requerido":false,"ayuda":"Ejemplo: 10.1000/xyz123. Evita duplicados."},
        {"nombre":"url","etiqueta":"Enlace al artículo","tipo":"url","requerido":false}],
        "dedup":{"grupos":[["doi"],["titulo","revista"]],"incluye_anio":false}}';
    f_ponencia  jsonb := '{"campos":[
        {"nombre":"titulo","etiqueta":"Título de la ponencia","tipo":"textarea","requerido":true},
        {"nombre":"evento","etiqueta":"Evento científico","tipo":"texto","requerido":true},
        {"nombre":"publicacion","etiqueta":"Revista o libro de memorias (con ISSN/ISBN)","tipo":"texto","requerido":true},
        {"nombre":"doi","etiqueta":"DOI","tipo":"texto","requerido":false},
        {"nombre":"url","etiqueta":"Enlace","tipo":"url","requerido":false}],
        "dedup":{"grupos":[["doi"],["titulo","evento"]],"incluye_anio":false}}';
    f_proy_ext  jsonb := '{"campos":[
        {"nombre":"nombre","etiqueta":"Nombre del proyecto","tipo":"textarea","requerido":true},
        {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto","requerido":false},
        {"nombre":"financiamiento","etiqueta":"Entidad financiadora externa","tipo":"texto","requerido":true},
        {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
        {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha","requerido":false},
        {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["codigo"],["nombre"]],"incluye_anio":true}}';
    f_proy_int  jsonb := '{"campos":[
        {"nombre":"nombre","etiqueta":"Nombre del proyecto","tipo":"textarea","requerido":true},
        {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto","requerido":false},
        {"nombre":"financiamiento","etiqueta":"Fuente de financiamiento interno","tipo":"texto","requerido":true},
        {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
        {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha","requerido":false},
        {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["codigo"],["nombre"]],"incluye_anio":true}}';
    f_proy_vinc jsonb := '{"campos":[
        {"nombre":"nombre","etiqueta":"Nombre del proyecto de vinculación","tipo":"textarea","requerido":true},
        {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto","requerido":false},
        {"nombre":"beneficiarios","etiqueta":"Comunidad o institución beneficiaria","tipo":"texto","requerido":true},
        {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
        {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha","requerido":false},
        {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["codigo"],["nombre"]],"incluye_anio":true}}';
    f_libro     jsonb := '{"campos":[
        {"nombre":"titulo","etiqueta":"Título del libro","tipo":"textarea","requerido":true},
        {"nombre":"editorial","etiqueta":"Editorial","tipo":"texto","requerido":true},
        {"nombre":"isbn","etiqueta":"ISBN","tipo":"texto","requerido":true},
        {"nombre":"url","etiqueta":"Enlace","tipo":"url","requerido":false}],
        "dedup":{"grupos":[["isbn"],["titulo","editorial"]],"incluye_anio":false}}';
    f_comite    jsonb := '{"campos":[
        {"nombre":"entidad","etiqueta":"Revista o entidad","tipo":"texto","requerido":true},
        {"nombre":"cargo","etiqueta":"Cargo o función en el comité","tipo":"texto","requerido":true},
        {"nombre":"issn","etiqueta":"ISSN (si aplica)","tipo":"texto","requerido":false},
        {"nombre":"url","etiqueta":"Enlace","tipo":"url","requerido":false}],
        "dedup":{"grupos":[["entidad"]],"incluye_anio":true}}';
    f_premio    jsonb := '{"campos":[
        {"nombre":"nombre","etiqueta":"Premio o reconocimiento","tipo":"texto","requerido":true},
        {"nombre":"entidad","etiqueta":"Entidad que lo otorga","tipo":"texto","requerido":true},
        {"nombre":"fecha","etiqueta":"Fecha","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["nombre","entidad"]],"incluye_anio":true}}';
    f_revisor   jsonb := '{"campos":[
        {"nombre":"revista","etiqueta":"Revista","tipo":"texto","requerido":true},
        {"nombre":"referencia","etiqueta":"Código o referencia del manuscrito revisado","tipo":"texto","requerido":true},
        {"nombre":"fecha","etiqueta":"Fecha de la revisión","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["revista","referencia"]],"incluye_anio":false}}';
    f_red       jsonb := '{"campos":[
        {"nombre":"nombre","etiqueta":"Red o asociación científica","tipo":"texto","requerido":true},
        {"nombre":"pais","etiqueta":"País o ámbito","tipo":"texto","requerido":false},
        {"nombre":"url","etiqueta":"Enlace","tipo":"url","requerido":false}],
        "dedup":{"grupos":[["nombre"]],"incluye_anio":true}}';
    f_tesis     jsonb := '{"campos":[
        {"nombre":"titulo","etiqueta":"Título de la tesis","tipo":"textarea","requerido":true},
        {"nombre":"estudiante","etiqueta":"Estudiante (nombre)","tipo":"texto","requerido":true},
        {"nombre":"universidad","etiqueta":"Universidad o programa","tipo":"texto","requerido":true},
        {"nombre":"rol","etiqueta":"Función","tipo":"select","requerido":true,"opciones":["Tutor","Director"]},
        {"nombre":"fecha_defensa","etiqueta":"Fecha de defensa","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["estudiante","titulo"]],"incluye_anio":false}}';
    f_patente   jsonb := '{"campos":[
        {"nombre":"titulo","etiqueta":"Título de la patente","tipo":"textarea","requerido":true},
        {"nombre":"numero","etiqueta":"Número de registro SENADI","tipo":"texto","requerido":true},
        {"nombre":"fecha","etiqueta":"Fecha de registro","tipo":"fecha","requerido":false}],
        "dedup":{"grupos":[["numero"]],"incluye_anio":false}}';
begin
    insert into public.tipos_evidencia (id, indicador, bloque, bloque_titulo, nombre, puntos, tope, grupo_dedup, esquema, orden) values
    -- Ii · Artículos
    ('q1','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos Q1',6,null,'articulo',f_articulo,10),
    ('q2','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos Q2',5,null,'articulo',f_articulo,11),
    ('q3','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos Q3',4,null,'articulo',f_articulo,12),
    ('q4','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos Q4',3,null,'articulo',f_articulo,13),
    ('scielo','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos SciELO',2,null,'articulo',f_articulo,14),
    ('latindex','Ii','articulos','Artículos publicados (WOS, Scopus y bases regionales)','Artículos Latindex, Redalyc y otros',2,null,'articulo',f_articulo,15),
    -- Ii · Ponencias
    ('pon_rev','Ii','ponencias','Ponencias en eventos científicos','Ponencias publicadas en revista',2,null,'ponencia',f_ponencia,20),
    ('pon_mem','Ii','ponencias','Ponencias en eventos científicos','Ponencias publicadas en libro de memorias',1,null,'ponencia',f_ponencia,21),
    -- Ii · Proyectos externos (tope 3)
    ('pe_dir','Ii','proy_ext','Proyectos de investigación externos (financiamiento externo)','Proyectos externos (director)',10,3,'proy_ext',f_proy_ext,30),
    ('pe_pri','Ii','proy_ext','Proyectos de investigación externos (financiamiento externo)','Proyectos externos (investigador principal)',8,3,'proy_ext',f_proy_ext,31),
    ('pe_inv','Ii','proy_ext','Proyectos de investigación externos (financiamiento externo)','Proyectos externos (investigador)',4,3,'proy_ext',f_proy_ext,32),
    -- Ii · Proyectos internos (tope 3)
    ('pi_dir','Ii','proy_int','Proyectos de investigación internos (financiamiento interno)','Proyectos internos (director)',8,3,'proy_int',f_proy_int,40),
    ('pi_pri','Ii','proy_int','Proyectos de investigación internos (financiamiento interno)','Proyectos internos (investigador principal)',6,3,'proy_int',f_proy_int,41),
    ('pi_inv','Ii','proy_int','Proyectos de investigación internos (financiamiento interno)','Proyectos internos (investigador)',4,3,'proy_int',f_proy_int,42),
    -- Ii · Libros
    ('lib_inv','Ii','libros','Libros arbitrados y publicados','Libros de resultados de investigación',5,null,'libro',f_libro,50),
    ('lib_aca','Ii','libros','Libros arbitrados y publicados','Libros académicos',2,null,'libro',f_libro,51),
    -- Ii · Otras actividades
    ('comites','Ii','otras','Otras actividades de investigación','Participación en comités o consejos editoriales',3,null,'comite',f_comite,60),
    ('premios','Ii','otras','Otras actividades de investigación','Premios o reconocimientos',2,null,'premio',f_premio,61),
    ('revisor','Ii','otras','Otras actividades de investigación','Revisor de artículos',1,null,'revisor',f_revisor,62),
    ('red','Ii','otras','Otras actividades de investigación','Miembro de red o asociación científica',1,null,'red',f_red,63),
    -- Ii · Tesis
    ('tesis_doc','Ii','tesis','Tutoría o dirección de tesis','Tesis de doctorado',3,null,'tesis',f_tesis,70),
    ('tesis_mi','Ii','tesis','Tutoría o dirección de tesis','Tesis de maestría de investigación',2,null,'tesis',f_tesis,71),
    ('tesis_mp','Ii','tesis','Tutoría o dirección de tesis','Tesis de maestría profesionalizante',1,null,'tesis',f_tesis,72),
    -- IiD
    ('patentes','IiD','patentes','Registro de patentes','Patentes registradas en el SENADI',6,null,'patente',f_patente,80),
    -- IVs (tope 2)
    ('v_dir','IVs','vinculacion','Proyectos de vinculación con la sociedad','Proyectos de vinculación (director)',3,2,'proy_vinc',f_proy_vinc,90),
    ('v_par','IVs','vinculacion','Proyectos de vinculación con la sociedad','Proyectos de vinculación (participante)',2,2,'proy_vinc',f_proy_vinc,91)
    on conflict (id) do update set
        indicador = excluded.indicador, bloque = excluded.bloque, bloque_titulo = excluded.bloque_titulo,
        nombre = excluded.nombre, puntos = excluded.puntos, tope = excluded.tope,
        grupo_dedup = excluded.grupo_dedup, esquema = excluded.esquema, orden = excluded.orden;
end $$;
