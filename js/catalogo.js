/* Funciones puras del catálogo y de los archivos (sin DOM ni red).
   Se prueban con `node --test supabase/pruebas/js`. */

export const ESTADOS = {
    pendiente: "Pendiente",
    observada: "Observada",
    rechazada: "Rechazada",
    validada: "Validada",
};

// Roles según las funciones SQL puede_cargar(), puede_leer_todo() y puede_validar().
export const ROLES_CARGA = ["docente", "responsable_ipct", "superadmin"];
// Cargar evidencias: rol permitido y ser evaluado (las cuentas de gestión tienen evaluado = false).
export const puedeCargar = perfil => ROLES_CARGA.includes(perfil.rol) && perfil.evaluado !== false;
export const ROLES_LECTURA = ["responsable_ipct", "calidad", "coordinadora", "superadmin"];
export const ROLES_VALIDA = ["responsable_ipct", "superadmin"];

// Etiqueta de un valor del formulario: enlaces para URL y DOI, texto para el resto.
export function enlaceDe(campo, valor) {
    if (typeof valor !== "string") return null;
    if (campo.tipo === "url" && /^https?:\/\//i.test(valor)) return valor;
    if (campo.nombre === "doi") {
        const doi = valor.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
        if (/^10\.\d{4,}\//.test(doi)) return "https://doi.org/" + doi;
    }
    return null;
}

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

// ---------- Archivos por tipo (esquema.archivos) ----------
// Cada tipo define qué archivos pide: {rol, etiqueta, quien: "docente"|"validador", obligatorio}.
// Sin definición (tipos antiguos) se pide un solo PDF obligatorio del docente.
const ARCHIVO_POR_DEFECTO = [{ rol: "principal", etiqueta: "Certificado en PDF", quien: "docente", obligatorio: true }];

export function archivosDe(tipo, quien) {
    const lista = (tipo && tipo.esquema && tipo.esquema.archivos) || ARCHIVO_POR_DEFECTO;
    return lista.filter(a => (a.quien || "docente") === quien);
}

// Archivos obligatorios de ese origen que todavía no están en la lista de archivos de la evidencia.
export function archivosFaltantes(tipo, archivos, quien) {
    return archivosDe(tipo, quien).filter(a => a.obligatorio && !archivos.some(x => x.rol === a.rol && x.origen === quien));
}

// Campos que se muestran: los que tienen «mostrar_si» solo aparecen si el campo indicado tiene uno de los valores.
export function camposVisibles(campos, valores) {
    return campos.filter(c => !c.mostrar_si || (c.mostrar_si.en || []).includes((valores || {})[c.mostrar_si.campo]));
}

// Textos de la lista de verificación del tipo que aún no están marcados.
export function verificacionFaltante(tipo, marcados) {
    return ((tipo && tipo.esquema && tipo.esquema.verificacion) || []).filter(v => !(marcados || []).includes(v.id)).map(v => v.texto);
}

// Tipos a los que se puede reclasificar (mismo producto: p. ej. de Q3 a Q1), sin contar el actual.
export function tiposReclasificables(tipo, catalogo) {
    return catalogo.filter(t => t.id !== tipo.id && t.grupo_dedup === tipo.grupo_dedup);
}

// Agrupa las filas de la función coautorias() por grupo, con el titular primero.
export function agruparCoautorias(filas) {
    const grupos = {};
    for (const f of filas || []) (grupos[f.grupo_id] ||= []).push(f);
    for (const g of Object.values(grupos)) g.sort((a, b) => Number(b.es_titular) - Number(a.es_titular) || (a.posicion || 99) - (b.posicion || 99));
    return grupos;
}

// Compara los coautores guardados con los del formulario: qué agregar, quitar y actualizar.
export function diferenciaCoautores(actuales, nuevos) {
    const clave = x => x.docente_id;
    const agregar = nuevos.filter(n => !actuales.some(a => clave(a) === clave(n)));
    const quitar = actuales.filter(a => !nuevos.some(n => clave(n) === clave(a)));
    const actualizar = nuevos.filter(n => {
        const a = actuales.find(x => clave(x) === clave(n));
        return a && (Number(a.posicion) !== Number(n.posicion) || a.participacion !== n.participacion);
    });
    return { agregar, quitar, actualizar };
}

// Texto sobre el estado de la carga de un año (o null si está abierta sin fecha de cierre).
export function textoPeriodo(periodo, anio) {
    if (!periodo.abierto) {
        return `La carga de evidencias del año ${anio} está cerrada: ya no se pueden registrar ni modificar. La validación continúa.`;
    }
    if (periodo.cierra_el) {
        const [a, m, d] = periodo.cierra_el.split("-").map(Number);
        const fecha = new Date(a, m - 1, d).toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
        return `La carga de evidencias del año ${anio} se cierra el ${fecha}.`;
    }
    return null;
}

// Tipo de archivo por su cabecera (no por la extensión): pdf, png, jpg, webp o null.
export async function tipoDeArchivo(archivo) {
    const b = new Uint8Array(await archivo.slice(0, 12).arrayBuffer());
    const txt = (i, n) => String.fromCharCode(...b.slice(i, i + n));
    if (txt(0, 5) === "%PDF-") return "pdf";
    if (b[0] === 0x89 && txt(1, 3) === "PNG") return "png";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    if (txt(0, 4) === "RIFF" && txt(8, 4) === "WEBP") return "webp";
    return null;
}
export const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

// Adjunto de la responsable: PDF o imagen (captura de pantalla). Devuelve un mensaje de error o null.
export async function validarAdjunto(archivo, maxBytes) {
    if (!archivo) return "Seleccione un archivo.";
    if (archivo.size === 0) return "El archivo está vacío.";
    if (archivo.size > maxBytes) {
        return `El archivo pesa ${(archivo.size / 1048576).toFixed(1)} MB; el máximo es ${(maxBytes / 1048576).toFixed(0)} MB.`;
    }
    if (!(await tipoDeArchivo(archivo))) return "El archivo debe ser un PDF o una imagen (PNG, JPG o WebP).";
    return null;
}

// Un PDF válido empieza con «%PDF-». No basta con la extensión.
export async function esPdf(archivo) {
    const cab = new Uint8Array(await archivo.slice(0, 5).arrayBuffer());
    return String.fromCharCode(...cab) === "%PDF-";
}

// Devuelve un mensaje de error o null si el archivo es aceptable.
export async function validarArchivo(archivo, maxBytes) {
    if (!archivo) return "Adjunte el archivo en PDF.";
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
