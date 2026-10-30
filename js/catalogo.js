/* Funciones puras del catálogo y de los archivos (sin DOM ni red).
   Se prueban con `node --test supabase/pruebas/js`. */

export const ESTADOS = {
    pendiente: "Pendiente",
    observada: "Observada",
    rechazada: "Rechazada",
    validada: "Validada",
};

// Roles que pueden cargar evidencias propias (debe coincidir con public.puede_cargar()).
export const ROLES_CARGA = ["docente", "responsable_ipct", "superadmin"];

// Agrupa el catálogo plano en indicador > bloque > tipos, respetando la columna «orden».
export function agruparCatalogo(tipos) {
    const indicadores = [];
    const ordenados = [...tipos].sort((a, b) => a.orden - b.orden);
    for (const t of ordenados) {
        let ind = indicadores.find(i => i.indicador === t.indicador);
        if (!ind) { ind = { indicador: t.indicador, bloques: [] }; indicadores.push(ind); }
        let blo = ind.bloques.find(b => b.bloque === t.bloque);
        if (!blo) { blo = { bloque: t.bloque, titulo: t.bloque_titulo, tope: t.tope, tipos: [] }; ind.bloques.push(blo); }
        blo.tipos.push(t);
    }
    return indicadores;
}

// Texto corto para identificar una evidencia en la lista: el primer campo obligatorio con valor.
export function resumenEvidencia(datos, esquema) {
    const campos = (esquema && esquema.campos) || [];
    const orden = [...campos.filter(c => c.requerido), ...campos.filter(c => !c.requerido)];
    for (const c of orden) {
        const v = datos && datos[c.nombre];
        if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "(sin descripción)";
}

// Recorta los textos y descarta los campos vacíos antes de guardar.
export function normalizarDatos(valores) {
    const datos = {};
    for (const [k, v] of Object.entries(valores)) {
        const t = typeof v === "string" ? v.trim() : v;
        if (t !== "" && t !== null && t !== undefined) datos[k] = t;
    }
    return datos;
}

// Un PDF válido empieza con «%PDF-». No basta con la extensión.
export async function esPdf(archivo) {
    const cab = new Uint8Array(await archivo.slice(0, 5).arrayBuffer());
    return String.fromCharCode(...cab) === "%PDF-";
}

// Devuelve un mensaje de error o null si el archivo es aceptable.
export async function validarArchivo(archivo, maxBytes) {
    if (!archivo) return "Adjunte el certificado en PDF.";
    if (archivo.size === 0) return "El archivo está vacío.";
    if (archivo.size > maxBytes) {
        return `El archivo pesa ${(archivo.size / 1048576).toFixed(1)} MB; el máximo es ${(maxBytes / 1048576).toFixed(0)} MB.`;
    }
    if (!(await esPdf(archivo))) return "El archivo no es un PDF válido.";
    return null;
}

// Huella SHA-256 (hexadecimal), útil para detectar el mismo PDF subido dos veces.
export async function sha256Hex(archivo) {
    const hash = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer());
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Traduce errores de Supabase/Postgres a mensajes claros para el docente.
export function mensajeError(error) {
    if (!error) return "Ocurrió un error inesperado.";
    const msg = error.message || String(error);
    if (error.code === "23505") return "Ya registró esta evidencia (mismo DOI, código o título). Búsquela en su lista y corríjala si es necesario.";
    if (error.code === "23514") return msg;                       // mensajes de validación escritos en la base de datos
    if (error.code === "PGRST116") return "No se pudo modificar: la evidencia ya fue validada o no es suya.";
    if (error.code === "42501" || /row-level security/i.test(msg)) return "No tiene permiso para realizar esta acción.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Sin conexión con el servidor. Revise su internet e intente de nuevo.";
    return msg;
}
