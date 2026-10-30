-- =====================================================================
-- Semilla de usuarios (NO es una migración: ejecutar a mano, una vez).
-- Reemplace los correos y nombres. Debe haber al menos un superadmin
-- ANTES del primer inicio de sesión. El correo debe ser el de la cuenta
-- de Google con la que se iniciará sesión y terminar en el dominio
-- configurado en public.ajustes (dominio_permitido).
-- =====================================================================
insert into public.usuarios (email, nombre, rol) values
    ('[correo-superadmin]@unesum.edu.ec',  '[Nombre del superadmin]',  'superadmin'),
    ('[correo-responsable]@unesum.edu.ec', '[Nombre de la responsable del IPCT]', 'responsable_ipct')
on conflict (email) do nothing;
