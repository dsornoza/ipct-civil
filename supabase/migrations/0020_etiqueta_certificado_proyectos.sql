-- =====================================================================
-- 0020 · Texto del primer PDF de los proyectos
-- En los proyectos de investigación (externos e internos) y de vinculación, el
-- archivo principal del docente se pide como «Documento de participación en el
-- proyecto (Certificado en PDF)». Solo cambia la etiqueta; no toca datos ni reglas.
-- Ejecutar después de 0019. Es idempotente.
-- =====================================================================
update public.tipos_evidencia t
   set esquema = jsonb_set(t.esquema, '{archivos}', (
         select jsonb_agg(
                  case when a->>'rol' = 'principal'
                       then jsonb_set(a, '{etiqueta}', '"Documento de participación en el proyecto (Certificado en PDF)"'::jsonb)
                       else a end
                  order by ord)
           from jsonb_array_elements(t.esquema->'archivos') with ordinality as x(a, ord)))
 where t.grupo_dedup in ('proy_ext', 'proy_int', 'proy_vinc');
