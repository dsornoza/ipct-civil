-- =====================================================================
-- 0010 · Catálogo de la etapa 5b
-- Cada tipo define, en su «esquema»:
--   campos        lo que llena el docente
--   validador     lo que completa la responsable al validar (matriz de investigación)
--   archivos      archivos del docente y de la responsable (rol, etiqueta, quien, obligatorio)
--   verificacion  lista que la responsable marca antes de validar (Modelo MECCAIIC, ind. 20 y 22)
--   coautores     si admite registrar a otros docentes como coautores
--   dedup         claves anti-duplicado
-- Ejecutar después de 0009. Es idempotente.
-- =====================================================================
do $$
declare
    lineas jsonb := '["Estructuras e ingeniería de materiales","Educación y comunicación para el desarrollo humano y social","Infraestructura del transporte, tránsito y seguridad vial","Tecnología de la información e innovación aplicado al desarrollo social","Recursos hídricos y obras de saneamiento ambiental","Ambiente, biodiversidad y cambio climático","Educación en ciencias de la salud","Salud pública","Emprendimiento, innovación y desarrollo local sostenible","Planeamiento estratégico y dirección de organizaciones productivas y empresa"]';
    periodos jsonb := '["PII-2025","PI-2026","PII-2026","PI-2027","PII-2027"]';
    bases jsonb := '["SCOPUS","WEB OF SCIENCE","LATINDEX CATALOGO 2.0","SCIELO","REDALYC","DOAJ","EBSCO","ERIHPLUS","JSTOR","OAJI","PROQUEST","REDIB","COMPENDEX","INSPEC","IEEE XPLORE"]';

    -- Campos que completa la responsable (matriz de investigación)
    v_proyecto jsonb := '[
        {"nombre":"resultado_de","etiqueta":"Resultado de proyecto","tipo":"select","opciones":["Ninguno","Proyecto de investigación","Proyecto de vinculación"]},
        {"nombre":"proyecto_titulo","etiqueta":"Título del proyecto","tipo":"texto","mostrar_si":{"campo":"resultado_de","en":["Proyecto de investigación","Proyecto de vinculación"]}},
        {"nombre":"proyecto_estado","etiqueta":"Estado del proyecto","tipo":"select","opciones":["En ejecución","Finalizado"],"mostrar_si":{"campo":"resultado_de","en":["Proyecto de investigación","Proyecto de vinculación"]}}]';
    v_articulo jsonb;
    v_ponencia jsonb;
    v_libro    jsonb;

    f_articulo jsonb; f_ponencia jsonb; f_libro_inv jsonb; f_libro_aca jsonb; f_capitulo jsonb;
    f_proy_ext jsonb; f_proy_int jsonb; f_proy_vinc jsonb;
    f_comite jsonb; f_premio jsonb; f_revisor jsonb; f_red jsonb; f_tesis jsonb; f_patente jsonb; f_software jsonb;

    a_doc jsonb := '[{"rol":"principal","etiqueta":"Documento de verificación (PDF)","quien":"docente","obligatorio":true}]';
begin
    v_articulo := jsonb_build_array(
        jsonb_build_object('nombre','base','etiqueta','Base de datos de indexación','tipo','select','requerido',true,'opciones',bases),
        '{"nombre":"issn","etiqueta":"ISSN de la revista","tipo":"texto","requerido":true}'::jsonb,
        '{"nombre":"numero","etiqueta":"Volumen y número","tipo":"texto","ayuda":"Ejemplo: Vol. 1, N° 2"}'::jsonb,
        '{"nombre":"sjr","etiqueta":"SJR","tipo":"texto","ayuda":"Ejemplo: 0.29"}'::jsonb,
        '{"nombre":"cuartil","etiqueta":"Cuartil del año de publicación","tipo":"select","opciones":["Q1","Q2","Q3","Q4"]}'::jsonb,
        '{"nombre":"fecha_publicacion","etiqueta":"Fecha de publicación","tipo":"fecha","requerido":true}'::jsonb,
        '{"nombre":"link_revista","etiqueta":"Enlace a la página principal de la revista","tipo":"url"}'::jsonb,
        '{"nombre":"campo_detallado","etiqueta":"Campo detallado (código)","tipo":"texto","ayuda":"Ejemplo: 2-37A"}'::jsonb,
        jsonb_build_object('nombre','linea','etiqueta','Línea de investigación','tipo','select','opciones',lineas),
        jsonb_build_object('nombre','periodo','etiqueta','Período académico','tipo','select','opciones',periodos),
        '{"nombre":"interculturalidad","etiqueta":"Interculturalidad","tipo":"select","opciones":["No","Sí"]}'::jsonb,
        '{"nombre":"n_autores_unesum","etiqueta":"Autores con filiación a la UNESUM","tipo":"numero","ayuda":"El Modelo no reconoce publicaciones con más de 4."}'::jsonb
    ) || v_proyecto;

    v_ponencia := jsonb_build_array(
        '{"nombre":"indexacion","etiqueta":"Indexación de las memorias (si aplica)","tipo":"texto"}'::jsonb,
        '{"nombre":"issn_isbn","etiqueta":"ISSN o ISBN de la publicación","tipo":"texto"}'::jsonb,
        '{"nombre":"campo_detallado","etiqueta":"Campo detallado (código)","tipo":"texto","ayuda":"Ejemplo: 2-37A"}'::jsonb,
        jsonb_build_object('nombre','linea','etiqueta','Línea de investigación','tipo','select','opciones',lineas),
        jsonb_build_object('nombre','periodo','etiqueta','Período académico','tipo','select','opciones',periodos)
    ) || v_proyecto;

    v_libro := jsonb_build_array(
        '{"nombre":"revisado_pares","etiqueta":"Revisado por pares","tipo":"select","requerido":true,"opciones":["Sí","No"]}'::jsonb,
        '{"nombre":"fecha_publicacion","etiqueta":"Fecha de publicación","tipo":"fecha","requerido":true}'::jsonb,
        '{"nombre":"campo_detallado","etiqueta":"Campo detallado (código)","tipo":"texto","ayuda":"Ejemplo: 2-37A"}'::jsonb,
        jsonb_build_object('nombre','linea','etiqueta','Línea de investigación','tipo','select','opciones',lineas),
        jsonb_build_object('nombre','periodo','etiqueta','Período académico','tipo','select','opciones',periodos),
        '{"nombre":"n_autores_unesum","etiqueta":"Autores con filiación a la UNESUM","tipo":"numero","ayuda":"El Modelo no reconoce libros con más de 4."}'::jsonb
    ) || v_proyecto;

    -- ---------------- Artículos ----------------
    f_articulo := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título del artículo","tipo":"textarea","requerido":true},
            {"nombre":"revista","etiqueta":"Nombre de la revista","tipo":"texto","requerido":true},
            {"nombre":"doi","etiqueta":"DOI","tipo":"texto","ayuda":"Ejemplo: 10.1000/xyz123. Evita duplicados."},
            {"nombre":"url","etiqueta":"Enlace al artículo","tipo":"url"}]'::jsonb,
        'validador', v_articulo,
        'archivos', '[
            {"rol":"principal","etiqueta":"Artículo completo en PDF (portada de la revista, ISSN, nombre y filiación UNESUM, fecha)","quien":"docente","obligatorio":true},
            {"rol":"indexacion","etiqueta":"Captura de la indexación o del cuartil (Scimago o Web of Science) del año de publicación","quien":"validador","obligatorio":true}]'::jsonb,
        'verificacion', '[
            {"id":"revista","texto":"El PDF muestra la portada de la revista y el ISSN"},
            {"id":"autor","texto":"Se ve el nombre del autor y su filiación a la UNESUM"},
            {"id":"fecha","texto":"La fecha de publicación está dentro del año evaluado"},
            {"id":"indexacion","texto":"La base de indexación (y el cuartil, si aplica) corresponde al año de publicación"},
            {"id":"linea","texto":"La publicación es afín a las líneas de investigación de la carrera"}]'::jsonb,
        'coautores', true,
        'dedup', '{"grupos":[["doi"],["titulo","revista"]],"incluye_anio":false}'::jsonb);

    -- ---------------- Ponencias ----------------
    f_ponencia := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título de la ponencia","tipo":"textarea","requerido":true},
            {"nombre":"evento","etiqueta":"Evento científico","tipo":"texto","requerido":true},
            {"nombre":"edicion","etiqueta":"Edición del evento","tipo":"texto"},
            {"nombre":"organizador","etiqueta":"Organizador del evento","tipo":"texto"},
            {"nombre":"comite","etiqueta":"Comité organizador","tipo":"texto"},
            {"nombre":"pais","etiqueta":"País","tipo":"texto"},
            {"nombre":"ciudad","etiqueta":"Ciudad","tipo":"texto"},
            {"nombre":"fecha_evento","etiqueta":"Fecha de la ponencia","tipo":"fecha"},
            {"nombre":"publicacion","etiqueta":"Revista o libro de memorias (con ISSN/ISBN)","tipo":"texto","requerido":true},
            {"nombre":"doi","etiqueta":"DOI","tipo":"texto"},
            {"nombre":"url","etiqueta":"Enlace","tipo":"url"}]'::jsonb,
        'validador', v_ponencia,
        'archivos', '[
            {"rol":"principal","etiqueta":"Certificado de la ponencia (PDF)","quien":"docente","obligatorio":true},
            {"rol":"publicacion","etiqueta":"Revista o libro de memorias donde se publicó (PDF)","quien":"docente","obligatorio":true},
            {"rol":"indexacion","etiqueta":"Captura de la indexación (si es Scopus o Web of Science)","quien":"validador","obligatorio":false}]'::jsonb,
        'verificacion', '[
            {"id":"evento","texto":"Se identifica el evento y el nombre del ponente"},
            {"id":"publicacion","texto":"La publicación muestra el ISSN o el ISBN"}]'::jsonb,
        'coautores', true,
        'dedup', '{"grupos":[["doi"],["titulo","evento"]],"incluye_anio":false}'::jsonb);

    -- ---------------- Libros y capítulos ----------------
    f_libro_inv := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título del libro","tipo":"textarea","requerido":true},
            {"nombre":"editorial","etiqueta":"Editorial","tipo":"texto","requerido":true},
            {"nombre":"isbn","etiqueta":"ISBN","tipo":"texto","requerido":true},
            {"nombre":"url","etiqueta":"Enlace al libro","tipo":"url"}]'::jsonb,
        'validador', v_libro,
        'archivos', '[
            {"rol":"principal","etiqueta":"Libro en PDF (portada, contraportada, índice con su nombre y filiación, año, consejo editorial e ISBN)","quien":"docente","obligatorio":true},
            {"rol":"pares","etiqueta":"Certificado o informes de revisión por pares (PDF)","quien":"docente","obligatorio":true},
            {"rol":"aval","etiqueta":"Aval de la Comisión de Investigación (PDF)","quien":"docente","obligatorio":true},
            {"rol":"soporte","etiqueta":"Soporte adicional de la Comisión","quien":"validador","obligatorio":false}]'::jsonb,
        'verificacion', '[
            {"id":"libro","texto":"El libro muestra portada, contraportada, índice con el nombre y la filiación del autor, año, consejo editorial e ISBN"},
            {"id":"pares","texto":"Hay constancia de revisión por pares externos a la UNESUM"},
            {"id":"aval","texto":"El aval de la Comisión de Investigación corresponde a este libro"},
            {"id":"linea","texto":"El libro es afín a las líneas de investigación de la carrera"}]'::jsonb,
        'coautores', true,
        'dedup', '{"grupos":[["isbn"],["titulo","editorial"]],"incluye_anio":false}'::jsonb);

    -- El libro académico no lleva aval de la Comisión (los casos son excluyentes).
    f_libro_aca := jsonb_set(jsonb_set(f_libro_inv, '{archivos}',
            '[
            {"rol":"principal","etiqueta":"Libro en PDF (portada, contraportada, índice con su nombre y filiación, año, consejo editorial e ISBN)","quien":"docente","obligatorio":true},
            {"rol":"pares","etiqueta":"Certificado o informes de revisión por pares (PDF)","quien":"docente","obligatorio":true},
            {"rol":"soporte","etiqueta":"Soporte adicional de la Comisión","quien":"validador","obligatorio":false}]'::jsonb),
        '{verificacion}',
            '[
            {"id":"libro","texto":"El libro muestra portada, contraportada, índice con el nombre y la filiación del autor, año, consejo editorial e ISBN"},
            {"id":"pares","texto":"Hay constancia de revisión por pares externos a la UNESUM"},
            {"id":"linea","texto":"El libro es afín a las líneas de investigación de la carrera"}]'::jsonb);

    f_capitulo := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título del capítulo","tipo":"textarea","requerido":true},
            {"nombre":"libro","etiqueta":"Título del libro","tipo":"textarea","requerido":true},
            {"nombre":"isbn","etiqueta":"ISBN del libro","tipo":"texto","requerido":true},
            {"nombre":"editor","etiqueta":"Editor o compilador","tipo":"texto"},
            {"nombre":"paginas","etiqueta":"Páginas (desde-hasta)","tipo":"texto","ayuda":"Ejemplo: 49-62"},
            {"nombre":"total_capitulos","etiqueta":"Total de capítulos del libro","tipo":"numero"},
            {"nombre":"url","etiqueta":"Enlace al capítulo","tipo":"url"}]'::jsonb,
        'validador', v_libro,
        'archivos', '[
            {"rol":"principal","etiqueta":"Capítulo en PDF (portada, contraportada, índice del libro, filiación, año, consejo editorial e ISBN)","quien":"docente","obligatorio":true},
            {"rol":"pares","etiqueta":"Certificado o informes de revisión por pares (PDF)","quien":"docente","obligatorio":true},
            {"rol":"aval","etiqueta":"Aval de la Comisión de Investigación, si es resultado de un proyecto (PDF)","quien":"docente","obligatorio":false},
            {"rol":"soporte","etiqueta":"Soporte adicional de la Comisión","quien":"validador","obligatorio":false}]'::jsonb,
        'verificacion', '[
            {"id":"capitulo","texto":"El PDF muestra portada, contraportada, índice con los capítulos, filiación, año, consejo editorial e ISBN"},
            {"id":"pares","texto":"Hay constancia de revisión por pares externos a la UNESUM"},
            {"id":"libro","texto":"El libro completo no se reporta por separado (no se cuentan sus capítulos además del libro)"}]'::jsonb,
        'coautores', true,
        'dedup', '{"grupos":[["isbn","titulo"],["titulo","libro"]],"incluye_anio":false}'::jsonb);

    -- ---------------- Proyectos ----------------
    f_proy_ext := jsonb_build_object(
        'campos', '[
            {"nombre":"nombre","etiqueta":"Nombre del proyecto","tipo":"textarea","requerido":true},
            {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto"},
            {"nombre":"financiamiento","etiqueta":"Entidad financiadora externa","tipo":"texto","requerido":true},
            {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
            {"nombre":"horas","etiqueta":"Horas semanales de dedicación","tipo":"numero"},
            {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha"},
            {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha"}]'::jsonb,
        'validador', jsonb_build_array(jsonb_build_object('nombre','linea','etiqueta','Línea de investigación','tipo','select','opciones',lineas),
                                       jsonb_build_object('nombre','periodo','etiqueta','Período académico','tipo','select','opciones',periodos)),
        'archivos', '[
            {"rol":"principal","etiqueta":"Documento de registro del proyecto, con su rol y sus horas de dedicación (PDF)","quien":"docente","obligatorio":true},
            {"rol":"distributivo","etiqueta":"Distributivo académico con las horas de investigación (opcional)","quien":"docente","obligatorio":false}]'::jsonb,
        'verificacion', '[
            {"id":"registro","texto":"El documento acredita el registro institucional del proyecto, el rol del docente y las horas de dedicación"},
            {"id":"linea","texto":"El proyecto pertenece a una línea de investigación afín a la carrera"},
            {"id":"vigencia","texto":"El proyecto estuvo en ejecución durante el año evaluado"}]'::jsonb,
        'coautores', false,
        'dedup', '{"grupos":[["codigo"],["nombre"]],"incluye_anio":true}'::jsonb);

    f_proy_int := jsonb_set(f_proy_ext, '{campos}', '[
            {"nombre":"nombre","etiqueta":"Nombre del proyecto","tipo":"textarea","requerido":true},
            {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto"},
            {"nombre":"financiamiento","etiqueta":"Fuente de financiamiento interno","tipo":"select","requerido":true,"opciones":["POA","Convocatoria","Otros"]},
            {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
            {"nombre":"horas","etiqueta":"Horas semanales de dedicación","tipo":"numero"},
            {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha"},
            {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha"}]'::jsonb);

    f_proy_vinc := jsonb_set(jsonb_set(jsonb_set(f_proy_ext, '{campos}', '[
            {"nombre":"nombre","etiqueta":"Nombre del proyecto de vinculación","tipo":"textarea","requerido":true},
            {"nombre":"codigo","etiqueta":"Código o resolución del proyecto","tipo":"texto"},
            {"nombre":"beneficiarios","etiqueta":"Comunidad o institución beneficiaria","tipo":"texto","requerido":true},
            {"nombre":"estado","etiqueta":"Estado del proyecto","tipo":"select","requerido":true,"opciones":["En ejecución","Finalizado"]},
            {"nombre":"horas","etiqueta":"Horas semanales de dedicación","tipo":"numero"},
            {"nombre":"fecha_inicio","etiqueta":"Fecha de inicio","tipo":"fecha"},
            {"nombre":"fecha_fin","etiqueta":"Fecha de fin","tipo":"fecha"}]'::jsonb),
        '{validador}', '[]'::jsonb),
        '{verificacion}', '[
            {"id":"registro","texto":"El documento acredita el registro institucional del proyecto, el rol del docente y las horas de dedicación"},
            {"id":"vigencia","texto":"El proyecto estuvo en ejecución durante el año evaluado"}]'::jsonb);

    -- ---------------- Otras actividades ----------------
    f_comite := jsonb_build_object(
        'campos', '[
            {"nombre":"institucion","etiqueta":"Institución u organización","tipo":"texto","requerido":true},
            {"nombre":"entidad","etiqueta":"Nombre de la revista","tipo":"texto","requerido":true},
            {"nombre":"cargo","etiqueta":"Cargo o función en el comité","tipo":"texto","requerido":true},
            {"nombre":"issn","etiqueta":"ISSN (si aplica)","tipo":"texto"},
            {"nombre":"url","etiqueta":"Enlace","tipo":"url"}]'::jsonb,
        'archivos', a_doc, 'coautores', false,
        'dedup', '{"grupos":[["entidad"]],"incluye_anio":true}'::jsonb);
    f_premio := jsonb_build_object(
        'campos', '[
            {"nombre":"nombre","etiqueta":"Tipo de premio, distinción o reconocimiento","tipo":"texto","requerido":true},
            {"nombre":"entidad","etiqueta":"Institución organizadora","tipo":"texto","requerido":true},
            {"nombre":"ambito","etiqueta":"Ámbito del reconocimiento","tipo":"select","requerido":true,"opciones":["Nacional","Internacional"]},
            {"nombre":"fecha","etiqueta":"Fecha","tipo":"fecha"}]'::jsonb,
        'archivos', a_doc, 'coautores', false,
        'dedup', '{"grupos":[["nombre","entidad"]],"incluye_anio":true}'::jsonb);
    f_revisor := jsonb_build_object(
        'campos', '[
            {"nombre":"institucion","etiqueta":"Institución u organización (editorial)","tipo":"texto","requerido":true},
            {"nombre":"revista","etiqueta":"Nombre de la revista","tipo":"texto","requerido":true},
            {"nombre":"referencia","etiqueta":"Código o referencia del manuscrito revisado","tipo":"texto","requerido":true},
            {"nombre":"fecha","etiqueta":"Fecha de la revisión","tipo":"fecha"}]'::jsonb,
        'archivos', a_doc, 'coautores', false,
        'dedup', '{"grupos":[["revista","referencia"]],"incluye_anio":false}'::jsonb);
    f_red := jsonb_build_object(
        'campos', '[
            {"nombre":"institucion","etiqueta":"Institución u organización","tipo":"texto","requerido":true},
            {"nombre":"nombre","etiqueta":"Nombre de la red o asociación científica","tipo":"texto","requerido":true},
            {"nombre":"pais","etiqueta":"País o ámbito","tipo":"texto"},
            {"nombre":"url","etiqueta":"Enlace","tipo":"url"}]'::jsonb,
        'archivos', a_doc, 'coautores', false,
        'dedup', '{"grupos":[["nombre"]],"incluye_anio":true}'::jsonb);
    f_tesis := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título de la tesis","tipo":"textarea","requerido":true},
            {"nombre":"estudiante","etiqueta":"Estudiante (nombre)","tipo":"texto","requerido":true},
            {"nombre":"universidad","etiqueta":"Universidad o programa","tipo":"texto","requerido":true},
            {"nombre":"rol","etiqueta":"Función","tipo":"select","requerido":true,"opciones":["Tutor","Director"]},
            {"nombre":"fecha_defensa","etiqueta":"Fecha de defensa","tipo":"fecha"}]'::jsonb,
        'archivos', a_doc, 'coautores', false,
        'dedup', '{"grupos":[["estudiante","titulo"]],"incluye_anio":false}'::jsonb);

    -- ---------------- Propiedad intelectual (SENADI) ----------------
    f_patente := jsonb_build_object(
        'campos', '[
            {"nombre":"titulo","etiqueta":"Título de la patente","tipo":"textarea","requerido":true},
            {"nombre":"numero","etiqueta":"Número de registro SENADI","tipo":"texto","requerido":true},
            {"nombre":"fecha","etiqueta":"Fecha de registro","tipo":"fecha"},
            {"nombre":"proyecto","etiqueta":"Proyecto o programa del que resulta","tipo":"texto"},
            {"nombre":"url","etiqueta":"Enlace","tipo":"url"}]'::jsonb,
        'validador', jsonb_build_array(jsonb_build_object('nombre','linea','etiqueta','Línea de investigación','tipo','select','opciones',lineas)),
        'archivos', '[
            {"rol":"principal","etiqueta":"Certificado de registro del SENADI (PDF)","quien":"docente","obligatorio":true}]'::jsonb,
        'verificacion', '[
            {"id":"senadi","texto":"El certificado corresponde a un registro del SENADI a nombre del docente"},
            {"id":"fecha","texto":"La fecha de registro está dentro del año evaluado"}]'::jsonb,
        'coautores', true,
        'dedup', '{"grupos":[["numero"]],"incluye_anio":false}'::jsonb);
    f_software := jsonb_set(f_patente, '{campos}', '[
            {"nombre":"titulo","etiqueta":"Título del software, prototipo o diseño","tipo":"textarea","requerido":true},
            {"nombre":"numero","etiqueta":"Número de registro SENADI","tipo":"texto","requerido":true},
            {"nombre":"fecha","etiqueta":"Fecha de registro","tipo":"fecha"},
            {"nombre":"proyecto","etiqueta":"Proyecto o programa del que resulta","tipo":"texto"},
            {"nombre":"url","etiqueta":"Enlace","tipo":"url"}]'::jsonb);

    -- ---------------- Aplicación ----------------
    update public.tipos_evidencia set esquema = f_articulo where grupo_dedup = 'articulo';
    -- El cuartil es obligatorio solo en los artículos Q1 a Q4.
    update public.tipos_evidencia t
       set esquema = jsonb_set(t.esquema, '{validador}',
           (select jsonb_agg(case when v ->> 'nombre' = 'cuartil' then v || '{"requerido":true}'::jsonb else v end)
              from jsonb_array_elements(t.esquema -> 'validador') v))
     where t.id in ('q1','q2','q3','q4');
    update public.tipos_evidencia set esquema = f_ponencia   where grupo_dedup = 'ponencia';
    update public.tipos_evidencia set esquema = f_libro_inv  where id = 'lib_inv';
    update public.tipos_evidencia set esquema = f_libro_aca  where id = 'lib_aca';
    update public.tipos_evidencia set esquema = f_proy_ext   where grupo_dedup = 'proy_ext';
    update public.tipos_evidencia set esquema = f_proy_int   where grupo_dedup = 'proy_int';
    update public.tipos_evidencia set esquema = f_proy_vinc  where grupo_dedup = 'proy_vinc';
    update public.tipos_evidencia set esquema = f_comite     where grupo_dedup = 'comite';
    update public.tipos_evidencia set esquema = f_premio     where grupo_dedup = 'premio';
    update public.tipos_evidencia set esquema = f_revisor    where grupo_dedup = 'revisor';
    update public.tipos_evidencia set esquema = f_red        where grupo_dedup = 'red';
    update public.tipos_evidencia set esquema = f_tesis      where grupo_dedup = 'tesis';
    update public.tipos_evidencia set esquema = f_patente    where id = 'patentes';

    -- Tipos nuevos
    insert into public.tipos_evidencia (id, indicador, bloque, bloque_titulo, nombre, puntos, tope, grupo_dedup, esquema, orden) values
        ('capitulo','Ii','capitulos','Capítulos de libros (solo se reportan; no suman puntos)','Capítulos de libro revisados por pares',0,null,'capitulo',f_capitulo,55),
        ('software','IiD','software','Registro de software, prototipos y diseños','Software, prototipos y diseños registrados en el SENADI',6,null,'software',f_software,81)
    on conflict (id) do update set
        indicador = excluded.indicador, bloque = excluded.bloque, bloque_titulo = excluded.bloque_titulo,
        nombre = excluded.nombre, puntos = excluded.puntos, tope = excluded.tope,
        grupo_dedup = excluded.grupo_dedup, esquema = excluded.esquema, orden = excluded.orden;
end $$;
