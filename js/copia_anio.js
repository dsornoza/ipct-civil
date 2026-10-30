/* Copia de las evidencias de un año en ZIP (carpetas por docente y actividad), con los datos
   del año y los informes. La usan Informes (roles de lectura) y Gestión (archivar un año). */
import { exportarAnio } from "./archivo_anio.js";
import { crearZip } from "./zip.js";
import { descargarBlob } from "./ui.js";
import { generarExcel } from "./excel.js";
import { cargarRanking, cargarReporteDetalle } from "./puntaje.js";
import { cargarCatalogo, cargarUsuariosCompleto, listarPorAnio } from "./evidencias.js";
import { construirMatrices, construirActividades, aCsv, csvDocentes, csvEvidencias, ENCABEZADOS } from "./informes.js";

// Informes del año que van dentro de la copia (los que se puedan generar).
export async function informesDelAnio(sb, anio) {
    const [ranking, detalle, evidencias, usuarios, tipos] = await Promise.all([
        cargarRanking(sb, anio), cargarReporteDetalle(sb, anio), listarPorAnio(sb, anio), cargarUsuariosCompleto(sb), cargarCatalogo(sb)]);
    const extras = [];
    const d = csvDocentes(ranking, detalle), e = csvEvidencias(detalle);
    extras.push({ ruta: `informes/docentes-${anio}.csv`, contenido: aCsv(d.encabezados, d.filas) },
                { ruta: `informes/evidencias-validadas-${anio}.csv`, contenido: aCsv(e.encabezados, e.filas) });
    const m = construirMatrices({ evidencias, usuarios, tipos });
    const hojas = Object.keys(ENCABEZADOS).map(nombre => ({ nombre, filas: [m[nombre].encabezados, ...m[nombre].filas] }));
    if (hojas.some(h => h.filas.length > 1)) extras.push({ ruta: `informes/Publicaciones-investigacion-${anio}.xlsx`, contenido: await generarExcel(hojas) });
    const a = construirActividades({ evidencias, usuarios, tipos, anio });
    if (a.docentes) extras.push({ ruta: `informes/Actividades-investigacion-${anio}.xlsx`, contenido: await generarExcel([{ nombre: "BASE DE DATOS", filas: a.filas, merges: a.merges }]) });
    return extras;
}

// Genera y descarga la copia. soloValidadas: solo los archivos de evidencias validadas.
export async function generarCopia(sb, cfg, anio, { onProgreso = () => {}, soloValidadas = false } = {}) {
    onProgreso({ texto: "Preparando los informes del año…", actual: 0, total: 0 });
    const extras = await informesDelAnio(sb, anio);
    return exportarAnio(sb, cfg, anio, {
        crearZip, extras, onProgreso, soloValidadas,
        filtro: soloValidadas ? (f => f.estado === "validada") : null,
        entregar: async (nombre, blob) => descargarBlob(nombre, blob),
    });
}
