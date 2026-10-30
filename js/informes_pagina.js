/* Página «Informes»: estadísticas del programa y descargas (PDF, CSV y Excel).
   La ven los roles de lectura (responsable, calidad, coordinadora y superadmin).
   Todo se genera en el navegador con datos que la base de datos ya filtró por permisos. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, llenarAnios, aviso, descargarTexto } from "./ui.js";
import { ROLES_LECTURA, mensajeError } from "./catalogo.js";
import { cargarAnioInicio, cargarCatalogo, cargarUsuariosCompleto, listarPorAnio } from "./evidencias.js";
import { cargarRanking, cargarNiveles, cargarFuente, cargarReporteDetalle, cargarDetalle, agruparDetalle, estimulosDe } from "./puntaje.js";
import { estadisticas, evolucionPrograma, construirMatrices, construirActividades, aCsv, csvDocentes, csvEvidencias, ENCABEZADOS } from "./informes.js";
import { generarInformePrograma, generarReporteDocente } from "./pdf.js";
import { descargarExcel } from "./excel.js";

const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();
const LOGO = "assets/logo-comision-investigacion-color.png";

let perfil, niveles = [], fuente = "", desde = anioActual;
let datos = null;            // {anio, ranking, detalle, est, evolucion} del año mostrado

function pintar(d) {
    const { est } = d;
    $("cifras").replaceChildren(...[
        ["Docentes evaluados", est.docentes], ["Con puntaje", est.conPuntaje], ["IPCT promedio", est.total.media],
        ["Mediana", est.total.mediana], ["Máximo", est.total.maximo],
    ].map(([k, v]) => el("div", { class: "cifra" }, el("span", { class: "etiqueta" }, k), el("span", { class: "valor" }, String(v)))));
    const notas = [`Desviación estándar: ${est.total.desviacion}. Mínimo: ${est.total.minimo}.`,
        `Promedio por indicador — Ii: ${est.promedios.ii}, IiD: ${est.promedios.iid}, IVs: ${est.promedios.ivs}.`,
        `Evidencias validadas: ${est.evidenciasValidadas}; no computadas por tope: ${est.noComputadas}.`];
    if (est.variacionPromedio !== null) notas.push(`Variación del promedio respecto al año anterior: ${est.variacionPromedio > 0 ? "+" : ""}${est.variacionPromedio}.`);
    $("notas-resumen").textContent = notas.join(" ");

    $("niveles").replaceChildren(...est.porNivel.map(n => el("div", {},
        el("div", { class: "linea" }, el("span", {}, n.nivel), el("strong", {}, `${n.n} (${n.pct} %)`)),
        el("div", { class: "barra", "aria-hidden": "true" }, el("span", { style: `width:${n.pct}%` })))));

    $("filas-produccion").replaceChildren(...est.porBloque.map(b => el("tr", {},
        el("td", {}, b.titulo), el("td", {}, b.indicador), el("td", {}, String(b.evidencias)),
        el("td", {}, String(b.computadas)), el("td", {}, String(b.docentes)))));
    $("vacio-produccion").hidden = est.porBloque.length > 0;

    $("filas-evolucion").replaceChildren(...d.evolucion.map(e => el("tr", {},
        el("td", {}, el("strong", {}, String(e.anio))), el("td", {}, String(e.docentes)), el("td", {}, String(e.conPuntaje)),
        el("td", {}, String(e.media)), el("td", {}, String(e.maximo)))));

    $("filas").replaceChildren(...d.ranking.map(f => el("tr", {},
        el("td", {}, String(f.posicion)), el("td", {}, f.nombre), el("td", {}, String(f.ii)), el("td", {}, String(f.iid)),
        el("td", {}, String(f.ivs)), el("td", {}, el("strong", {}, String(f.total))),
        el("td", {}, el("span", { class: "estado " + (f.nivel === "Sin nivel" ? "estado-pendiente" : "estado-validada") }, f.nivel)))));

    const previa = $("s-docente").value;
    $("s-docente").replaceChildren(...d.ranking.map(f => el("option", { value: f.usuario_id }, f.nombre)));
    if (d.ranking.some(f => f.usuario_id === previa)) $("s-docente").value = previa;
}

async function cargarAnio() {
    const anio = parseInt($("f-anio").value, 10);
    aviso("mensaje", "Cargando…", "ok");
    try {
        const anios = [];
        for (let a = desde; a <= anio; a++) anios.push(a);
        const [rankings, detalle] = await Promise.all([Promise.all(anios.map(a => cargarRanking(sb, a))), cargarReporteDetalle(sb, anio)]);
        const porAnio = Object.fromEntries(anios.map((a, i) => [a, rankings[i]]));
        const ranking = porAnio[anio];
        datos = { anio, ranking, detalle, evolucion: evolucionPrograma(porAnio),
                  est: estadisticas({ ranking, detalle, niveles, rankingPrevio: porAnio[anio - 1] || [] }) };
        pintar(datos);
        aviso("mensaje", "");
        $("actualizado").textContent = "Actualizado a las " + new Date().toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
        aviso("mensaje", "No se pudo cargar la información. " + mensajeError(e));
    }
}

// Ejecuta una descarga mostrando el error si falla.
async function descargar(boton, accion) {
    if (!datos) return;
    boton.disabled = true;
    aviso("mensaje-descarga", "");
    try { await accion(); } catch (e) { aviso("mensaje-descarga", "No se pudo generar el archivo. " + mensajeError(e)); } finally { boton.disabled = false; }
}

const csv = (nombre, { encabezados, filas }) => descargarTexto(nombre, aCsv(encabezados, filas), "text/csv", true);

// Avisa si a alguien con evidencias le falta la cédula o los apellidos para la matriz.
function avisarFaltantes(evidencias, usuarios) {
    const ids = new Set(evidencias.filter(e => e.estado === "validada").map(e => e.docente_id));
    const faltan = usuarios.filter(u => ids.has(u.id) && (!u.cedula || !u.apellidos_nombres));
    if (faltan.length) {
        aviso("mensaje-descarga", `El archivo se generó, pero a ${faltan.length} persona(s) les falta la cédula o los apellidos y nombres: ${faltan.map(u => u.nombre).join(", ")}. Complete esos datos en Gestión y vuelva a descargar.`);
    }
}

async function matrizPublicaciones() {
    const [evidencias, usuarios, tipos] = await Promise.all([listarPorAnio(sb, datos.anio), cargarUsuariosCompleto(sb), cargarCatalogo(sb)]);
    const m = construirMatrices({ evidencias, usuarios, tipos });
    const hojas = Object.keys(ENCABEZADOS).map(nombre => ({ nombre, filas: [m[nombre].encabezados, ...m[nombre].filas] }));
    if (hojas.every(h => h.filas.length === 1)) return aviso("mensaje-descarga", "No hay publicaciones validadas en este año.");
    await descargarExcel(`Publicaciones-investigacion-${datos.anio}.xlsx`, hojas);
    avisarFaltantes(evidencias, usuarios);
}

async function matrizActividades() {
    const [evidencias, usuarios, tipos] = await Promise.all([listarPorAnio(sb, datos.anio), cargarUsuariosCompleto(sb), cargarCatalogo(sb)]);
    const a = construirActividades({ evidencias, usuarios, tipos, anio: datos.anio });
    if (!a.docentes) return aviso("mensaje-descarga", "No hay otras actividades de investigación validadas en este año.");
    await descargarExcel(`Actividades-investigacion-${datos.anio}.xlsx`, [{ nombre: "BASE DE DATOS", filas: a.filas, merges: a.merges }]);
    avisarFaltantes(evidencias, usuarios);
}

async function reporteDocente() {
    const fila = datos.ranking.find(r => r.usuario_id === $("s-docente").value);
    if (!fila) return;
    const [detalle, catalogo] = await Promise.all([cargarDetalle(sb, fila.usuario_id, datos.anio), cargarCatalogo(sb)]);
    await generarReporteDocente({
        nombre: fila.nombre, anio: datos.anio, fecha: new Date(), total: fila.total, nivel: fila.nivel,
        ii: fila.ii, iid: fila.iid, ivs: fila.ivs, indicadores: agruparDetalle(detalle, Object.fromEntries(catalogo.map(t => [t.id, t]))),
        estimulos: estimulosDe(fila.nivel, niveles), fuente,
        minimoNivel: niveles.length ? Math.min(...niveles.map(n => n.min_puntos)) : 0, rutaLogo: LOGO,
    });
}

async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    $("cargando").hidden = true;
    if (!ROLES_LECTURA.includes(perfil.rol)) { $("sin-permiso").hidden = false; return; }
    try {
        [desde, niveles, fuente] = await Promise.all([cargarAnioInicio(sb, anioActual), cargarNiveles(sb), cargarFuente(sb)]);
        llenarAnios($("f-anio"), desde, anioActual);
    } catch (e) {
        $("cargando").hidden = false;
        $("cargando").textContent = "No se pudo cargar la información. " + mensajeError(e);
        return;
    }
    $("contenido").hidden = false;
    $("f-anio").addEventListener("change", cargarAnio);
    $("btn-actualizar").addEventListener("click", cargarAnio);

    const b = id => $(id);
    b("d-programa-pdf").addEventListener("click", () => descargar(b("d-programa-pdf"), () => generarInformePrograma({
        programa: perfil.programa || "Ingeniería Civil", anio: datos.anio, fecha: new Date(), est: datos.est, evolucion: datos.evolucion,
        ranking: datos.ranking, fuente, rutaLogo: LOGO })));
    b("d-docentes-csv").addEventListener("click", () => descargar(b("d-docentes-csv"),
        async () => csv(`IPCT-docentes-${datos.anio}.csv`, csvDocentes(datos.ranking, datos.detalle))));
    b("d-evidencias-csv").addEventListener("click", () => descargar(b("d-evidencias-csv"),
        async () => csv(`IPCT-evidencias-validadas-${datos.anio}.csv`, csvEvidencias(datos.detalle))));
    b("d-docente-pdf").addEventListener("click", () => descargar(b("d-docente-pdf"), reporteDocente));
    b("d-matriz-publicaciones").addEventListener("click", () => descargar(b("d-matriz-publicaciones"), matrizPublicaciones));
    b("d-matriz-actividades").addEventListener("click", () => descargar(b("d-matriz-actividades"), matrizActividades));
    await cargarAnio();
}

iniciar();
