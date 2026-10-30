-- =====================================================================
-- 0012 · Apellidos y nombres para los informes
-- Las matrices de investigación piden «APELLIDOS_NOMBRES» (primero los
-- apellidos, en mayúsculas). Se guarda aparte del nombre con el que la
-- persona se muestra en el sistema. Si está vacío, los informes usan «nombre».
-- Ejecutar después de 0011. Es idempotente.
-- =====================================================================
alter table public.usuarios add column if not exists apellidos_nombres text;
comment on column public.usuarios.apellidos_nombres is
    'Apellidos y nombres como se reportan a investigación (p. ej. SORNOZA PARRALES DIEGO RENATO). Vacío: se usa «nombre».';
