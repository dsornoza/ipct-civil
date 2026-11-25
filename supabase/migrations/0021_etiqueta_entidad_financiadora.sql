-- =====================================================================
-- 0021 · Texto del campo de financiamiento de los proyectos externos
-- «Entidad financiadora externa» pasa a «Entidad financiadora externa o Red».
-- Solo cambia la etiqueta; el nombre interno del campo (financiamiento) no cambia,
-- así que las evidencias y las matrices siguen funcionando igual.
-- Ejecutar después de 0020. Es idempotente.
-- =====================================================================
update public.tipos_evidencia t
   set esquema = jsonb_set(t.esquema, '{campos}', (
         select jsonb_agg(
                  case when c->>'nombre' = 'financiamiento'
                       then jsonb_set(c, '{etiqueta}', '"Entidad financiadora externa o Red"'::jsonb)
                       else c end
                  order by ord)
           from jsonb_array_elements(t.esquema->'campos') with ordinality as x(c, ord)))
 where t.grupo_dedup = 'proy_ext';
