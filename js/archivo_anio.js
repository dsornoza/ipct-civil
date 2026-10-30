/* Archivar un año para liberar almacenamiento (solo superadmin).
   1) «Copia»: descarga todos los archivos del año, comprueba cada uno contra su huella
      SHA-256 y los entrega en ZIP por partes, junto con los datos y los informes.
   2) «Liberar»: solo con la copia completa y verificada, borra esos archivos del
      almacenamiento y los marca como archivados. Las evidencias, puntajes, ranking
      e historial se conservan.
   El acceso a la red y a ZIP se inyecta, para poder probarlo sin navegador. */
import { sha256Hex } from "./catalogo.js";
import { aCsv } from "./informes.js";

export const TAMANO_PARTE = 100 * 1048576;       // cada ZIP pesa unos 100 MB como máximo

function lanzar(error) { if (error) throw error; }

const sinTildes = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// Nombre apto para carpetas y archivos (sin tildes ni caracteres raros).
export function nombreSeguro(texto, max = 60) {
    const t = sinTildes(texto).replace(/[^A-Za-z0-9._ -]+/g, "_").replace(/\s+/g, " ").replace(/^[ ._-]+|[ ._-]+$/g, "");
    return (t || "sin-nombre").slice(0, max).replace(/[ ._-]+$/g, "") || "sin-nombre";
}

// archivos/DOCENTE/TIPO-DETALLE/id-rol-nombre (el id evita choques entre nombres iguales)
export function rutaEnZip(f) {
    const base = nombreSeguro(f.nombre, 80);
    const marca = f.origen === "validador" ? "comision-" : "";
    const estado = f.estado && f.estado !== "validada" ? ` [${f.estado}]` : "";      // lo no validado se distingue en la carpeta
    return `archivos/${nombreSeguro(f.docente, 50)}/${nombreSeguro(f.tipo_nombre, 30)}-${nombreSeguro(f.resumen, 40)}${estado}/${String(f.archivo_id).slice(0, 8)}-${marca}${nombreSeguro(f.rol, 20)}-${base}`;
}

// Reparte los archivos (ya ordenados) en partes de hasta «max» bytes, sin partir a un docente si no hace falta.
export function agruparEnPartes(archivos, max = TAMANO_PARTE) {
    const partes = [];
    let actual = [], bytes = 0;
    for (const f of archivos) {
        if (actual.length && bytes + Number(f.tamano) > max) { partes.push(actual); actual = []; bytes = 0; }
        actual.push(f); bytes += Number(f.tamano);
    }
    if (actual.length) partes.push(actual);
    return partes;
}

// Comprueba lo descargado contra lo registrado: tamaño y, si existe, la huella SHA-256.
export async function verificarArchivo(f, blob) {
    if (!blob) return { ok: false, motivo: "no se pudo descargar" };
    if (Number(f.tamano) && blob.size !== Number(f.tamano)) {
        return { ok: false, motivo: `el tamaño no coincide (esperado ${f.tamano} bytes, llegaron ${blob.size})` };
    }
    if (f.sha256 && (await sha256Hex(blob)) !== f.sha256) return { ok: false, motivo: "la huella SHA-256 no coincide" };
    return { ok: true, huella: f.sha256 ? "verificada" : "solo tamaño" };
}

export const nombreParte = (anio, i, total) => `IPCT-${anio}-copia-parte-${i + 1}-de-${total}.zip`;

export function textoLeeme({ anio, partes, archivos, bytes, fecha, soloValidadas = false, archivados = 0 }) {
    return [
        `COPIA DEL AÑO ${anio} · Sistema del IPCT, Carrera de Ingeniería Civil (UNESUM)`,
        `Generada el ${fecha.toLocaleString("es-EC")}`,
        "",
        `Contenido: ${archivos} archivo(s), ${(bytes / 1048576).toFixed(1)} MB, repartidos en ${partes} ZIP.`,
        soloValidadas ? "Incluye solo las evidencias VALIDADAS por la Comisión de Investigación." : "Incluye todas las evidencias del año, validadas o no (las no validadas llevan su estado entre corchetes en el nombre de la carpeta).",
        ...(archivados ? [`No incluye ${archivados} archivo(s) que ya se archivaron fuera del sistema en una copia anterior.`] : []),
        "Las coautorías figuran en la carpeta del autor que registró la evidencia.",
        "",
        "Qué hay en cada parte:",
        "  - archivos/            Los PDF e imágenes, ordenados por docente y actividad.",
        "  - manifiesto-parte-N.csv  Cada archivo con su ruta original en el sistema, tamaño y huella SHA-256.",
        "En la parte 1 además:",
        `  - datos-${anio}.json      Personas, evidencias, historial y registro de archivos del año (copia de la base de datos).`,
        "  - informes/            Matrices de investigación (Excel) y listados (CSV) del año.",
        "",
        "Cómo recuperar un archivo: súbalo de nuevo al almacenamiento privado «evidencias» con la ruta que figura en la columna",
        "«ruta_original» del manifiesto y quite la marca «archivado_en» del registro en la tabla «archivos».",
        "",
        "Confidencialidad: contiene cédulas y evidencias de las personas. Guárdelo en un lugar seguro y con acceso restringido.",
        "Conserve estas partes completas: son la única copia de los archivos una vez liberado el espacio en el sistema.",
        "",
    ].join("\n");
}

/* Descarga y verifica los archivos pendientes del año y los entrega en ZIP por partes.
   opciones: { crearZip, entregar(nombre, blob), onProgreso({texto, actual, total}), extras: [{ruta, contenido}], maxParte, fecha,
               filtro: función opcional para elegir qué archivos van (p. ej. solo los de evidencias validadas) }
   Devuelve { completo, partes, archivos, bytes, fallos: [{archivo, motivo}], verificados: [archivo], archivados }. */
export async function exportarAnio(sb, cfg, anio, opciones) {
    const { crearZip, entregar, onProgreso = () => {}, extras = [], maxParte = TAMANO_PARTE, fecha = new Date(), filtro = null } = opciones;
    const [datosRpc, listaRpc] = await Promise.all([sb.rpc("datos_anio", { p_anio: anio }), sb.rpc("archivos_anio", { p_anio: anio })]);
    lanzar(datosRpc.error); lanzar(listaRpc.error);
    const todos = (listaRpc.data || []).filter(a => !filtro || filtro(a));
    const pendientes = todos.filter(a => !a.archivado_en);
    const archivados = todos.length - pendientes.length;
    const partes = agruparEnPartes(pendientes, maxParte);
    if (!partes.length) partes.push([]);

    const fallos = [], verificados = [];
    let hecho = 0, bytes = 0;
    for (let i = 0; i < partes.length; i++) {
        const zip = await crearZip();
        const manifiesto = [];
        if (i === 0) {
            zip.agregar(`datos-${anio}.json`, JSON.stringify(datosRpc.data, null, 2));
            for (const x of extras) zip.agregar(x.ruta, x.contenido);
        }
        for (const f of partes[i]) {
            onProgreso({ texto: `Descargando y verificando (parte ${i + 1} de ${partes.length})…`, actual: hecho, total: pendientes.length });
            const { data, error } = await sb.storage.from(cfg.BUCKET).download(f.ruta);
            const v = error ? { ok: false, motivo: "no se pudo descargar: " + (error.message || error) } : await verificarArchivo(f, data);
            if (v.ok) {
                zip.agregar(rutaEnZip(f), data);
                verificados.push(f);
                bytes += Number(f.tamano);
                manifiesto.push([rutaEnZip(f), f.ruta, f.docente, f.tipo_nombre, f.rol, f.origen, f.tamano, f.sha256 || "", v.huella]);
            } else {
                fallos.push({ archivo: f, motivo: v.motivo });
            }
            hecho++;
        }
        zip.agregar(`manifiesto-parte-${i + 1}.csv`, aCsv(
            ["ruta_en_zip", "ruta_original", "docente", "actividad", "funcion", "origen", "bytes", "sha256", "verificacion"], manifiesto));
        if (i === 0) zip.agregar("LEEME.txt", textoLeeme({ anio, partes: partes.length, archivos: pendientes.length, bytes: pendientes.reduce((s, f) => s + Number(f.tamano), 0), fecha, soloValidadas: Boolean(opciones.soloValidadas), archivados }));
        onProgreso({ texto: `Armando el ZIP de la parte ${i + 1} de ${partes.length}…`, actual: hecho, total: pendientes.length });
        await entregar(nombreParte(anio, i, partes.length), await zip.generar());
    }
    return { completo: fallos.length === 0, partes: partes.length, archivos: verificados.length, bytes, fallos, verificados, archivados };
}

/* Borra del almacenamiento los archivos verificados y los marca como archivados, por lotes.
   Marca solo los que realmente se borraron. Devuelve { borrados, noBorrados: [archivo] }. */
export async function liberarEspacio(sb, cfg, archivos, { onProgreso = () => {}, lote = 50 } = {}) {
    let borrados = 0;
    const noBorrados = [];
    for (let i = 0; i < archivos.length; i += lote) {
        const grupo = archivos.slice(i, i + lote);
        onProgreso({ texto: "Liberando espacio…", actual: i, total: archivos.length });
        const { data, error } = await sb.storage.from(cfg.BUCKET).remove(grupo.map(a => a.ruta));
        lanzar(error);
        const quitados = new Set((data || []).map(o => o.name));
        const listos = grupo.filter(a => quitados.has(a.ruta));
        noBorrados.push(...grupo.filter(a => !quitados.has(a.ruta)));
        if (listos.length) {
            const marca = await sb.rpc("marcar_archivados", { p_ids: listos.map(a => a.archivo_id) });
            lanzar(marca.error);
            borrados += listos.length;
        }
    }
    return { borrados, noBorrados };
}

// Resumen para mostrar antes de empezar.
export function resumenAnio(archivos) {
    const pendientes = archivos.filter(a => !a.archivado_en);
    return {
        total: archivos.length,
        pendientes: pendientes.length,
        archivados: archivos.length - pendientes.length,
        bytes: pendientes.reduce((s, a) => s + Number(a.tamano), 0),
    };
}

export async function cargarArchivosAnio(sb, anio) {
    const { data, error } = await sb.rpc("archivos_anio", { p_anio: anio });
    lanzar(error);
    return data || [];
}
