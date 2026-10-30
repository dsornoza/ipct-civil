/* Acceso a datos de evidencias. Recibe el cliente de Supabase («sb») y la
   configuración como parámetros para poder probarse sin red.
   La seguridad real está en la base de datos (RLS y triggers); aquí solo se
   ordena el flujo: guardar la evidencia, subir sus archivos, registrar cada archivo. */
import { sha256Hex, tipoDeArchivo, MIME, diferenciaCoautores } from "./catalogo.js";

const uno = x => (Array.isArray(x) ? x[0] : x) || null;

function lanzar(error) { if (error) throw error; }

const COLUMNAS_ARCHIVO = "id, evidencia_id, ruta, nombre, tamano, rol, origen, sha256";
const SELECT_EVIDENCIA = `*, tipos_evidencia(nombre, indicador, puntos, esquema, grupo_dedup), archivos(${COLUMNAS_ARCHIVO})`;

const armar = e => ({ ...e, tipo: uno(e.tipos_evidencia), archivos: e.archivos || [] });

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

// En una coautoría los archivos son los de la evidencia del titular.
async function conArchivosDelTitular(sb, lista) {
    const ids = [...new Set(lista.filter(e => e.titular_id).map(e => e.titular_id))];
    if (!ids.length) return lista;
    const { data, error } = await sb.from("archivos").select(COLUMNAS_ARCHIVO).in("evidencia_id", ids);
    lanzar(error);
    return lista.map(e => (e.titular_id ? { ...e, archivos: data.filter(a => a.evidencia_id === e.titular_id) } : e));
}

// Evidencias del usuario en un año (RLS limita a las propias).
export async function listarMias(sb, perfilId, anio) {
    const { data, error } = await sb.from("evidencias").select(SELECT_EVIDENCIA)
        .eq("docente_id", perfilId).eq("anio", anio).order("creado_en", { ascending: false });
    lanzar(error);
    return conArchivosDelTitular(sb, data.map(armar));
}

// ---------- Coautoría y cierre de carga ----------

// Docentes a quienes se puede agregar como coautores.
export async function buscarDocentes(sb) {
    const { data, error } = await sb.rpc("buscar_docentes");
    lanzar(error);
    return data;
}

// Filas de coautoría del año que involucran al usuario (o todas, si es lector).
export async function cargarCoautorias(sb, anio) {
    const { data, error } = await sb.rpc("coautorias", { p_anio: anio });
    lanzar(error);
    return data;
}

// Estado de la carga de un año: {abierto, cierra_el, cierre_manual, configurado}. Un año sin habilitar es «configurado: false».
export async function estadoPeriodo(sb, anio) {
    const { data, error } = await sb.rpc("estado_periodo", { p_anio: anio });
    lanzar(error);
    return uno(data) || { anio, abierto: false, cierra_el: null, cierre_manual: false, configurado: false };
}

// Años ya habilitados alguna vez, con su estado actual, del más reciente al más antiguo.
export async function aniosVisibles(sb) {
    const { data, error } = await sb.rpc("periodos_visibles");
    lanzar(error);
    return data || [];
}

export async function fijarPeriodo(sb, anio, abierto, cierraEl = null) {
    const { error } = await sb.rpc("fijar_periodo", { p_anio: anio, p_abierto: abierto, p_cierra_el: cierraEl });
    lanzar(error);
}

// Agrega, quita o actualiza coautores. Devuelve la lista de los que fallaron.
async function sincronizarCoautores(sb, evidenciaId, actuales, nuevos) {
    const { agregar, quitar, actualizar } = diferenciaCoautores(actuales, nuevos);
    const fallos = [];
    const paso = async (docente, llamada) => {
        const { error } = await llamada;
        if (error) fallos.push({ docente_id: docente.docente_id, error });
    };
    for (const c of quitar) await paso(c, sb.rpc("quitar_coautor", { p_evidencia: evidenciaId, p_docente: c.docente_id }));
    for (const c of agregar) {
        await paso(c, sb.rpc("agregar_coautor", { p_evidencia: evidenciaId, p_docente: c.docente_id,
            p_posicion: Number(c.posicion) || 1, p_participacion: c.participacion || "Coautor" }));
    }
    for (const c of actualizar) {
        await paso(c, sb.rpc("actualizar_autoria", { p_evidencia: evidenciaId, p_docente: c.docente_id,
            p_posicion: Number(c.posicion) || 1, p_participacion: c.participacion || "Coautor" }));
    }
    return fallos;
}

// ---------- Archivos ----------

async function subir(sb, cfg, ruta, archivo, tipo) {
    const { error } = await sb.storage.from(cfg.BUCKET).upload(ruta, archivo, { contentType: MIME[tipo], upsert: false });
    lanzar(error);
}

async function rutaYTipo(duenoId, evidenciaId, archivo) {
    const tipo = (await tipoDeArchivo(archivo)) || "pdf";
    return { tipo, ruta: `${duenoId}/${evidenciaId}/${crypto.randomUUID()}.${tipo}` };
}

async function filaArchivo(evidenciaId, rol, origen, ruta, archivo) {
    return { evidencia_id: evidenciaId, rol, origen, ruta, nombre: archivo.name, tamano: archivo.size, sha256: await sha256Hex(archivo) };
}

// Crea la evidencia, sus archivos (uno por función) y sus coautores.
// Si falla un archivo, deshace todo. Si fallan solo los coautores, la evidencia
// queda guardada y el error trae `creada = true` para que la pantalla refresque.
export async function crearEvidencia(sb, cfg, { perfilId, tipoId, anio, datos, autoria = {}, archivos = {}, coautores = [] }) {
    const { data, error } = await sb.from("evidencias")
        .insert({ docente_id: perfilId, tipo_id: tipoId, anio, datos, autoria }).select().single();
    lanzar(error);
    const subidos = [];
    try {
        for (const [rol, archivo] of Object.entries(archivos)) {
            const { tipo, ruta } = await rutaYTipo(perfilId, data.id, archivo);
            await subir(sb, cfg, ruta, archivo, tipo);
            subidos.push(ruta);
            const { error: errArchivo } = await sb.from("archivos").insert(await filaArchivo(data.id, rol, "docente", ruta, archivo));
            lanzar(errArchivo);
        }
    } catch (e) {
        if (subidos.length) await sb.storage.from(cfg.BUCKET).remove(subidos);
        await sb.from("evidencias").delete().eq("id", data.id);
        throw e;
    }
    const fallos = await sincronizarCoautores(sb, data.id, [], coautores);
    if (fallos.length) throw errorDeCoautores(fallos);
    return data;
}

function errorDeCoautores(fallos) {
    const e = new Error(fallos[0].error.message || "No se pudo agregar a un coautor.");
    e.code = fallos[0].error.code;
    e.creada = true;
    e.parcial = "La evidencia se guardó, pero hubo un problema con los coautores.";
    return e;
}

// Corrige una evidencia (pendiente, observada o rechazada). El trigger de la
// base de datos la devuelve a «pendiente». Los archivos nuevos reemplazan al de su misma función.
// `coautores` (opcional) es la lista deseada; `evidencia.coautores` la actual.
export async function actualizarEvidencia(sb, cfg, { evidencia, anio, datos, autoria, archivos = {}, coautores = null }) {
    const cambios = { anio, datos };
    if (autoria) cambios.autoria = autoria;
    const { data, error } = await sb.from("evidencias").update(cambios).eq("id", evidencia.id).select().single();
    lanzar(error);

    try {
        for (const [rol, archivo] of Object.entries(archivos)) {
            const previo = (evidencia.archivos || []).find(a => a.rol === rol && a.origen === "docente");
            const { tipo, ruta } = await rutaYTipo(evidencia.docente_id, evidencia.id, archivo);
            await subir(sb, cfg, ruta, archivo, tipo);
            const fila = await filaArchivo(evidencia.id, rol, "docente", ruta, archivo);
            const { error: errArchivo } = previo
                ? await sb.from("archivos").update(fila).eq("id", previo.id)
                : await sb.from("archivos").insert(fila);
            lanzar(errArchivo);
            if (previo) await sb.storage.from(cfg.BUCKET).remove([previo.ruta]);
        }
    } catch (e) {
        e.parcial = "Los datos se guardaron, pero no se pudo reemplazar un archivo.";
        throw e;
    }
    if (coautores) {
        const fallos = await sincronizarCoautores(sb, evidencia.id, evidencia.coautores || [], coautores);
        if (fallos.length) throw errorDeCoautores(fallos);
    }
    return data;
}

// Elimina una evidencia no validada. Los archivos se borran primero: después de
// borrar la fila, la política de Storage ya no reconocería la evidencia. En una
// coautoría los archivos son del titular y no se tocan.
export async function eliminarEvidencia(sb, cfg, evidencia) {
    const propios = evidencia.titular_id ? [] : (evidencia.archivos || []).filter(a => a.origen === "docente");
    if (propios.length) {
        const { error } = await sb.storage.from(cfg.BUCKET).remove(propios.map(a => a.ruta));
        lanzar(error);
    }
    const { error } = await sb.from("evidencias").delete().eq("id", evidencia.id);
    lanzar(error);
}

// Enlace temporal para abrir un archivo (2 minutos por defecto).
export async function urlFirmada(sb, cfg, ruta, segundos = 120) {
    const { data, error } = await sb.storage.from(cfg.BUCKET).createSignedUrl(ruta, segundos);
    lanzar(error);
    return data.signedUrl;
}

// ---------- Validación (roles con lectura total; RLS lo garantiza) ----------

export async function cargarUsuarios(sb) {
    const { data, error } = await sb.from("usuarios").select("id, nombre, rol, activo, evaluado").order("nombre");
    lanzar(error);
    return data;
}

// Todas las evidencias de un año con su tipo y archivos, de la más antigua a la más reciente.
export async function listarPorAnio(sb, anio) {
    const { data, error } = await sb.from("evidencias").select(SELECT_EVIDENCIA)
        .eq("anio", anio).order("creado_en", { ascending: true });
    lanzar(error);
    return conArchivosDelTitular(sb, data.map(armar));
}

export async function historialDe(sb, evidenciaId) {
    const { data, error } = await sb.from("historial").select("*").eq("evidencia_id", evidenciaId).order("fecha", { ascending: true });
    lanzar(error);
    return data;
}

// Otras evidencias con exactamente el mismo archivo (misma huella SHA-256).
export async function evidenciasConMismaHuella(sb, sha256, excluirId) {
    if (!sha256) return [];
    const { data, error } = await sb.from("archivos").select("evidencia_id, nombre").eq("sha256", sha256).neq("evidencia_id", excluirId);
    lanzar(error);
    return data;
}

// La responsable adjunta una captura o un documento (PDF o imagen) a la evidencia de un docente.
export async function subirAdjunto(sb, cfg, { evidencia, rol, archivo }) {
    const { tipo, ruta } = await rutaYTipo(evidencia.docente_id, evidencia.id, archivo);
    await subir(sb, cfg, ruta, archivo, tipo);
    const { data, error } = await sb.from("archivos").insert(await filaArchivo(evidencia.id, rol, "validador", ruta, archivo)).select().single();
    if (error) {
        await sb.storage.from(cfg.BUCKET).remove([ruta]);
        throw error;
    }
    return data;
}

export async function quitarAdjunto(sb, cfg, archivo) {
    const { error: errArchivo } = await sb.from("archivos").delete().eq("id", archivo.id);
    lanzar(errArchivo);
    await sb.storage.from(cfg.BUCKET).remove([archivo.ruta]);
}

// Valida, observa o rechaza. En la misma operación guarda lo que completó la responsable
// (datos de la matriz, lista de verificación y, si corrige el tipo, la reclasificación).
// La base de datos exige comentario al observar/rechazar, los archivos y campos obligatorios
// para validar, y que nadie valide sus propias evidencias.
export async function resolverEvidencia(sb, evidenciaId, estado, comentario, extra = {}) {
    const texto = (comentario || "").trim();
    const cambios = { estado, comentario: texto || null };
    if (extra.tipoId) cambios.tipo_id = extra.tipoId;
    if (extra.datosValidacion) cambios.datos_validacion = extra.datosValidacion;
    if (extra.verificacion) cambios.verificacion = extra.verificacion;
    const { data, error } = await sb.from("evidencias").update(cambios).eq("id", evidenciaId).select().single();
    lanzar(error);
    return data;
}
