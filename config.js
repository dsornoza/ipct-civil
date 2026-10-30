/* =====================================================================
   config.js — ÚNICO archivo con configuración dependiente del entorno.
   Si el sistema se traslada a otro dominio o a otro proyecto de Supabase,
   solo se edita este archivo (y las URLs en Supabase/Google; ver README).

   Todos los valores de aquí son PÚBLICOS (el sitio es estático). Nunca
   escriba aquí una clave «service_role» ni ningún secreto.
   ===================================================================== */
window.IPCT_CONFIG = {
    // Supabase > Project Settings > API > Project URL.
    // Ejemplo: "https://abcdefghijklmno.supabase.co"
    SUPABASE_URL: "[completar: URL del proyecto de Supabase]",

    // Supabase > Project Settings > API > clave «anon» (o «publishable»).
    // Es pública por diseño: la seguridad real la dan las políticas RLS.
    SUPABASE_ANON_KEY: "[completar: clave anon pública]",

    // URL a la que Google/Supabase devuelve al usuario tras iniciar sesión.
    // Por defecto es la carpeta donde vive este sitio, sea cual sea el dominio
    // (https://dsornoza.github.io/ipct-civil/ hoy, otro lugar mañana).
    // Debe estar también en Supabase > Authentication > URL Configuration.
    URL_RETORNO: new URL("./", window.location.href).href,

    // Dominio institucional. Es solo una pista para el selector de cuentas de
    // Google (parámetro «hd»); la barrera real está en la base de datos.
    DOMINIO_PISTA: "unesum.edu.ec",

    // Bucket privado de Storage donde se guardan los PDF.
    BUCKET: "evidencias",

    // Tamaño máximo de PDF en bytes (5 MB). Debe coincidir con la base de datos
    // (migración 0004: file_size_limit y restricción de la tabla archivos).
    MAX_PDF_BYTES: 5 * 1024 * 1024,
};
