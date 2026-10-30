/* Cliente de Supabase y funciones de sesión compartidas por todas las páginas.
   Requiere cargar antes, en este orden: config.js y la librería supabase-js
   (que define el objeto global «supabase»). */

const CFG = window.IPCT_CONFIG;

// Nombres legibles de los roles.
export const ROLES = {
    docente: "Docente",
    responsable_ipct: "Responsable del IPCT",
    calidad: "Calidad",
    coordinadora: "Coordinadora",
    director_investigacion: "Director de Investigación",
    superadmin: "Superadministrador",
};

// Detecta si config.js todavía tiene valores de ejemplo.
export function configuracionCompleta() {
    return Boolean(CFG && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY
        && !CFG.SUPABASE_URL.includes("[completar") && !CFG.SUPABASE_ANON_KEY.includes("[completar"));
}

// PKCE: el navegador recibe un código de un solo uso en lugar del token en la URL.
export const sb = configuracionCompleta()
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

// Inicia el flujo de Google. «hd» y «select_account» solo guían el selector.
export async function iniciarSesion() {
    return sb.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: CFG.URL_RETORNO,
            queryParams: { hd: CFG.DOMINIO_PISTA, prompt: "select_account" },
        },
    });
}

export async function cerrarSesion() {
    await sb.auth.signOut();
}

// Devuelve la sesión actual o null.
export async function sesionActual() {
    const { data } = await sb.auth.getSession();
    return data.session;
}

// Enlaza la sesión con la lista blanca. Devuelve el perfil o null si no está autorizado.
// (La decisión real la toma la base de datos; aquí solo se refleja.)
export async function obtenerPerfil() {
    const { data, error } = await sb.rpc("vincular_sesion");
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

// Motivos por los que una sesión no tiene acceso (para ayudar a quien lo reporte).
export async function diagnostico() {
    const { data, error } = await sb.rpc("diagnostico_sesion");
    if (error) throw error;
    return data && data.length ? data[0] : null;
}
