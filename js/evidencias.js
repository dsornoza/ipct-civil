/* Acceso a datos de evidencias. Recibe el cliente de Supabase («sb») y la
   configuración como parámetros para poder probarse sin red.
   La seguridad real está en la base de datos (RLS y triggers); aquí solo se
   ordena el flujo: guardar la evidencia, subir el PDF, registrar el archivo. */
import { sha256Hex } from "./catalogo.js";

const uno = x => (Array.isArray(x) ? x[0] : x) || null;

function lanzar(error) { if (error) throw error; }

export async function cargarCatalogo(sb) {
    const { data, error } = await sb.from("tipos_evidencia").select("*").eq("activo", true).order("orden");
    lanzar(error);
    return data;
}

// Primer año evaluable (ajuste anio_inicio); por defecto el año actual.
export async function cargarAnioInicio(sb, anioActual) {
    const { data, error } = await sb.from("ajustes").select("valor").eq("clave", "anio_inicio");
    lanzar(error);
    const n = parseInt(data && data[0] && data[0].valor, 10);
    return Number.isFinite(n) ? Math.min(n, anioActual) : anioActual;
}

// Evidencias del usuario en un año (RLS limita a las propias).
export async function listarMias(sb, perfilId, anio) {
    const { data, error } = await sb.from("evidencias")
        .select("*, tipos_evidencia(nombre, indicador, puntos, esquema), archivos(id, ruta, nombre, tamano)")
        .eq("docente_id", perfilId).eq("anio", anio).order("creado_en", { ascending: false });
    lanzar(error);
    return data.map(e => ({ ...e, tipo: uno(e.tipos_evidencia), archivo: uno(e.archivos) }));
}

function rutaNueva(perfilId, evidenciaId) {
    return `${perfilId}/${evidenciaId}/${crypto.randomUUID()}.pdf`;
}

async function subir(sb, cfg, ruta, archivo) {
    const { error } = await sb.storage.from(cfg.BUCKET).upload(ruta, archivo, { contentType: "application/pdf", upsert: false });
    lanzar(error);
}

// Crea la evidencia y su PDF. Si algo falla después de crearla, la deshace.
export async function crearEvidencia(sb, cfg, { perfilId, tipoId, anio, datos, archivo }) {
    const { data, error } = await sb.from("evidencias")
        .insert({ docente_id: perfilId, tipo_id: tipoId, anio, datos }).select().single();
    lanzar(error);
    const ruta = rutaNueva(perfilId, data.id);
    try {
        await subir(sb, cfg, ruta, archivo);
    } catch (e) {
        await sb.from("evidencias").delete().eq("id", data.id);
        throw e;
    }
    const { error: errArchivo } = await sb.from("archivos").insert({
        evidencia_id: data.id, ruta, nombre: archivo.name, tamano: archivo.size, sha256: await sha256Hex(archivo),
    });
    if (errArchivo) {
        await sb.storage.from(cfg.BUCKET).remove([ruta]);
        await sb.from("evidencias").delete().eq("id", data.id);
        throw errArchivo;
    }
    return data;
}

// Corrige una evidencia (pendiente, observada o rechazada). El trigger de la
// base de datos la devuelve a «pendiente». Si hay archivo nuevo, reemplaza al anterior.
export async function actualizarEvidencia(sb, cfg, { evidencia, anio, datos, archivo }) {
    const { data, error } = await sb.from("evidencias")
        .update({ anio, datos }).eq("id", evidencia.id).select().single();
    lanzar(error);
    if (!archivo) return data;

    const ruta = rutaNueva(evidencia.docente_id, evidencia.id);
    try {
        await subir(sb, cfg, ruta, archivo);
        const { error: errArchivo } = await sb.from("archivos").update({
            ruta, nombre: archivo.name, tamano: archivo.size, sha256: await sha256Hex(archivo),
        }).eq("evidencia_id", evidencia.id);
        lanzar(errArchivo);
    } catch (e) {
        e.parcial = "Los datos se guardaron, pero no se pudo reemplazar el PDF.";
        throw e;
    }
    if (evidencia.archivo) await sb.storage.from(cfg.BUCKET).remove([evidencia.archivo.ruta]);
    return data;
}

// Elimina una evidencia no validada. El archivo se borra primero: después de
// borrar la fila, la política de Storage ya no reconocería la evidencia.
export async function eliminarEvidencia(sb, cfg, evidencia) {
    if (evidencia.archivo) {
        const { error } = await sb.storage.from(cfg.BUCKET).remove([evidencia.archivo.ruta]);
        lanzar(error);
    }
    const { error } = await sb.from("evidencias").delete().eq("id", evidencia.id);
    lanzar(error);
}

// Enlace temporal para abrir el PDF (2 minutos por defecto).
export async function urlFirmada(sb, cfg, ruta, segundos = 120) {
    const { data, error } = await sb.storage.from(cfg.BUCKET).createSignedUrl(ruta, segundos);
    lanzar(error);
    return data.signedUrl;
}

// ---------- Validación (roles con lectura total; RLS lo garantiza) ----------

export async function cargarUsuarios(sb) {
    const { data, error } = await sb.from("usuarios").select("id, nombre, rol, activo").order("nombre");
    lanzar(error);
    return data;
}

// Todas las evidencias de un año con su tipo y archivo, de la más antigua a la más reciente.
export async function listarPorAnio(sb, anio) {
    const { data, error } = await sb.from("evidencias")
        .select("*, tipos_evidencia(nombre, indicador, puntos, esquema), archivos(id, ruta, nombre, tamano, sha256)")
        .eq("anio", anio).order("creado_en", { ascending: true });
    lanzar(error);
    return data.map(e => ({ ...e, tipo: uno(e.tipos_evidencia), archivo: uno(e.archivos) }));
}

export async function historialDe(sb, evidenciaId) {
    const { data, error } = await sb.from("historial").select("*").eq("evidencia_id", evidenciaId).order("fecha", { ascending: true });
    lanzar(error);
    return data;
}

// Otras evidencias con exactamente el mismo PDF (misma huella SHA-256).
export async function evidenciasConMismaHuella(sb, sha256, excluirId) {
    if (!sha256) return [];
    const { data, error } = await sb.from("archivos").select("evidencia_id, nombre").eq("sha256", sha256).neq("evidencia_id", excluirId);
    lanzar(error);
    return data;
}

// Valida, observa o rechaza. La base de datos exige comentario al observar/rechazar,
// un PDF para validar y que nadie valide sus propias evidencias.
export async function resolverEvidencia(sb, evidenciaId, estado, comentario) {
    const texto = (comentario || "").trim();
    const { data, error } = await sb.from("evidencias")
        .update({ estado, comentario: texto || null }).eq("id", evidenciaId).select().single();
    lanzar(error);
    return data;
}
