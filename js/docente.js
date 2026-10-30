/* Página «Mis evidencias»: menú de tipos, formulario dinámico con PDF y lista propia. */
import { sb } from "./cliente.js";
import { el, aviso, llenarAnios } from "./ui.js";
import { iniciarPagina } from "./comun.js";
import { ESTADOS, puedeCargar, agruparCatalogo, resumenEvidencia, normalizarDatos, validarArchivo, mensajeError }
    from "./catalogo.js";
import { cargarEvolucion, cargarDetalle, cargarNiveles, cargarFuente, agruparDetalle, siguienteNivel, estimulosDe, porcentajeBarra, INDICADORES }
    from "./puntaje.js";
import { generarReporteDocente } from "./pdf.js";
import { cargarCatalogo, cargarAnioInicio, listarMias, crearEvidencia, actualizarEvidencia, eliminarEvidencia, urlFirmada }
    from "./evidencias.js";

const CFG = window.IPCT_CONFIG;
const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();

let perfil, catalogo = [], tiposPorId = {}, niveles = [], fuente = "";
let puntajeActual = null;           // datos del año mostrado, para el PDF
let editando = null;                 // evidencia en edición o null si se registra una nueva

// ---------- menú de tipos ----------
function construirMenu() {
    const sel = $("sel-tipo");
    sel.replaceChildren(el("option", { value: "" }, "Seleccione una actividad…"));
    for (const ind of agruparCatalogo(catalogo)) {
        for (const blo of ind.bloques) {
            const etiqueta = `${ind.indicador} · ${blo.titulo}` + (blo.tope ? ` (máx. ${blo.tope} computables)` : "");
            const grupo = el("optgroup", { label: etiqueta });
            for (const t of blo.tipos) grupo.append(el("option", { value: t.id }, `${t.nombre} — ${t.puntos} pts`));
            sel.append(grupo);
        }
    }
}

// ---------- formulario dinámico ----------
function campoHtml(c, valor) {
    const id = "campo-" + c.nombre;
    let input;
    if (c.tipo === "textarea") input = el("textarea", { id, class: "campo", rows: "3" });
    else if (c.tipo === "select") {
        input = el("select", { id, class: "campo" }, el("option", { value: "" }, "Seleccione…"));
        for (const o of c.opciones || []) input.append(el("option", { value: o }, o));
    } else {
        const tipo = { url: "url", fecha: "date", numero: "number" }[c.tipo] || "text";
        input = el("input", { id, class: "campo", type: tipo });
    }
    input.name = c.nombre;
    if (c.requerido) input.required = true;
    if (valor !== undefined) input.value = valor;

    const etq = el("label", { class: "etiqueta-campo", for: id }, c.etiqueta);
    if (c.requerido) etq.append(" ", el("span", { class: "obligatorio", "aria-hidden": "true" }, "*"));
    const caja = el("div", {}, etq, input);
    if (c.ayuda) caja.append(el("p", { class: "nota" }, c.ayuda));
    if (c.tipo === "textarea") caja.style.gridColumn = "1 / -1";
    return caja;
}

function abrirFormulario(tipo, evidencia) {
    editando = evidencia || null;
    const datos = (evidencia && evidencia.datos) || {};
    $("campos").replaceChildren(...tipo.esquema.campos.map(c => campoHtml(c, datos[c.nombre])));
    $("titulo-form").textContent = (evidencia ? "Corregir: " : "Nueva evidencia: ") + tipo.nombre;
    $("archivo").value = "";
    $("obl-archivo").hidden = Boolean(evidencia);
    $("nota-archivo").textContent = evidencia
        ? `Archivo actual: ${evidencia.archivo ? evidencia.archivo.nombre : "ninguno"}. Adjunte otro solo si desea reemplazarlo. Máximo 5 MB.`
        : "Solo PDF, máximo 5 MB.";
    $("btn-guardar").textContent = evidencia ? "Guardar y reenviar a validación" : "Guardar evidencia";
    $("sel-tipo").value = tipo.id;
    $("sel-tipo").disabled = Boolean(evidencia);
    if (evidencia) $("sel-anio-form").value = String(evidencia.anio);
    else $("sel-anio-form").value = $("sel-anio").value;
    aviso("mensaje-form", "");
    $("formulario").hidden = false;
    $("formulario").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cerrarFormulario() {
    editando = null;
    $("formulario").hidden = true;
    $("sel-tipo").disabled = false;
    $("sel-tipo").value = "";
    $("info-tipo").textContent = "";
}

function leerValores(tipo) {
    const valores = {};
    for (const c of tipo.esquema.campos) valores[c.nombre] = $("campo-" + c.nombre).value;
    return valores;
}

async function guardar(ev) {
    ev.preventDefault();
    const tipo = tiposPorId[$("sel-tipo").value];
    if (!tipo) return aviso("mensaje-form", "Seleccione el tipo de actividad.");
    const datos = normalizarDatos(leerValores(tipo));
    for (const c of tipo.esquema.campos) {
        if (c.requerido && !datos[c.nombre]) return aviso("mensaje-form", `Falta el campo obligatorio: ${c.etiqueta}.`);
    }
    const archivo = $("archivo").files[0] || null;
    if (archivo || !editando) {
        const err = await validarArchivo(archivo, CFG.MAX_PDF_BYTES);
        if (err) return aviso("mensaje-form", err);
    }
    const anio = parseInt($("sel-anio-form").value, 10);

    $("btn-guardar").disabled = true;
    aviso("mensaje-form", "Guardando…", "ok");
    try {
        if (editando) await actualizarEvidencia(sb, CFG, { evidencia: editando, anio, datos, archivo });
        else await crearEvidencia(sb, CFG, { perfilId: perfil.id, tipoId: tipo.id, anio, datos, archivo });
        const hecho = editando ? "Evidencia corregida y enviada a validación." : "Evidencia registrada. Quedó pendiente de validación.";
        cerrarFormulario();
        $("sel-anio").value = String(anio);
        await refrescarLista();
        aviso("mensaje-lista", hecho, "ok");
    } catch (e) {
        aviso("mensaje-form", (e.parcial ? e.parcial + " " : "") + mensajeError(e));
    } finally {
        $("btn-guardar").disabled = false;
    }
}

// ---------- lista ----------
function filaEvidencia(e) {
    const puedeEditar = e.estado !== "validada";
    const acciones = el("td", { class: "acciones" });
    if (e.archivo) acciones.append(el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => verPdf(e) }, "Ver PDF"), " ");
    if (puedeEditar) {
        acciones.append(
            el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => abrirFormulario(tiposPorId[e.tipo_id], e) }, e.estado === "pendiente" ? "Editar" : "Corregir"),
            " ",
            el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => borrar(e) }, "Eliminar"));
    }
    const tr = el("tr", {},
        el("td", {}, e.tipo ? e.tipo.nombre : e.tipo_id),
        el("td", {}, resumenEvidencia(e.datos, e.tipo && e.tipo.esquema)),
        el("td", {}, e.tipo ? String(e.tipo.puntos) : ""),
        el("td", {}, el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado] || e.estado)),
        acciones);
    const filas = [tr];
    if (e.comentario) {
        filas.push(el("tr", { class: "comentario" },
            el("td", { colspan: "5" }, el("strong", {}, "Comentario de la validación: "), e.comentario)));
    }
    return filas;
}

async function refrescarLista() {
    const anio = parseInt($("sel-anio").value, 10);
    try {
        const lista = await listarMias(sb, perfil.id, anio);
        $("filas").replaceChildren(...lista.flatMap(filaEvidencia));
        $("vacio").hidden = lista.length > 0;
        aviso("mensaje-lista", "");
    } catch (e) {
        aviso("mensaje-lista", "No se pudo cargar la lista. " + mensajeError(e));
    }
    refrescarPuntaje();
}

async function verPdf(e) {
    // Se abre la pestaña antes de la petición para que el navegador no la bloquee.
    const ventana = window.open("", "_blank");
    try {
        const url = await urlFirmada(sb, CFG, e.archivo.ruta);
        if (ventana) { ventana.opener = null; ventana.location.href = url; } else window.location.href = url;
    } catch (err) {
        if (ventana) ventana.close();
        aviso("mensaje-lista", "No se pudo abrir el archivo. " + mensajeError(err));
    }
}

async function borrar(e) {
    if (!window.confirm("¿Eliminar esta evidencia y su archivo? Esta acción no se puede deshacer.")) return;
    try {
        await eliminarEvidencia(sb, CFG, e);
        if (editando && editando.id === e.id) cerrarFormulario();
        await refrescarLista();
        aviso("mensaje-lista", "Evidencia eliminada.", "ok");
    } catch (err) {
        aviso("mensaje-lista", "No se pudo eliminar. " + mensajeError(err));
    }
}

// ---------- puntaje validado ----------
async function refrescarPuntaje() {
    const anio = parseInt($("sel-anio").value, 10);
    $("puntaje-anio").textContent = `· ${anio}`;
    try {
        const [evolucion, detalle] = await Promise.all([cargarEvolucion(sb, perfil.id), cargarDetalle(sb, perfil.id, anio)]);
        const fila = evolucion.find(e => e.anio === anio) || { ii: 0, iid: 0, ivs: 0, total: 0, nivel: "Sin nivel" };
        const grupos = agruparDetalle(detalle, tiposPorId);
        puntajeActual = { anio, fila, grupos };
        pintarPuntaje(fila, grupos);
        pintarEvolucion(evolucion, anio);
        aviso("mensaje-puntaje", "");
    } catch (e) {
        aviso("mensaje-puntaje", "No se pudo cargar su puntaje. " + mensajeError(e));
    }
}

function pintarPuntaje(fila, grupos) {
    $("p-total").textContent = String(fila.total);
    $("p-nivel").textContent = fila.nivel;
    $("p-nivel").className = "estado " + (fila.nivel === "Sin nivel" ? "estado-pendiente" : "estado-validada");

    const sig = siguienteNivel(fila.total, niveles);
    if (sig) {
        const previos = niveles.map(n => n.min_puntos).filter(m => m < sig.min);
        const desde = previos.length ? Math.max(...previos) : 0;
        $("p-progreso").style.width = Math.min(100, Math.max(0, ((fila.total - desde) / (sig.min - desde)) * 100)) + "%";
        $("p-siguiente").textContent = `Le faltan ${sig.faltan} puntos para el ${sig.nombre} (${sig.min} pts).`;
    } else {
        $("p-progreso").style.width = "100%";
        $("p-siguiente").textContent = "Alcanzó el nivel máximo.";
    }

    $("p-desglose").replaceChildren(...["Ii", "IiD", "IVs"].map(id => {
        const puntos = fila[id.toLowerCase()];
        const pct = fila.total > 0 ? (puntos / fila.total) * 100 : 0;
        return el("div", {}, el("div", { class: "linea" }, el("span", {}, INDICADORES[id].nombre), el("strong", {}, `${puntos} pts`)),
            el("div", { class: "barra", "aria-hidden": "true" }, el("span", { style: `width:${pct}%` })));
    }));

    const notas = grupos.flatMap(g => g.bloques.filter(b => b.nota));
    $("p-notas").replaceChildren(...notas.map(b => el("p", { class: "aviso", style: "margin:var(--space-3) 0 0" }, el("strong", {}, "Tope aplicado. "), b.nota)));

    const est = estimulosDe(fila.nivel, niveles);
    const minimo = niveles.length ? Math.min(...niveles.map(n => n.min_puntos)) : 0;
    $("p-estimulos").replaceChildren(...(est.length ? est : [`Se requieren al menos ${minimo} puntos para acceder a un nivel.`]).map(t => el("li", {}, t)));
}

function pintarEvolucion(evolucion, anioSeleccionado) {
    const filas = [...evolucion];
    if (!filas.some(e => e.anio === anioSeleccionado)) filas.push({ anio: anioSeleccionado, total: 0, nivel: "Sin nivel" });
    filas.sort((a, b) => b.anio - a.anio);
    const totales = filas.map(f => f.total);
    $("p-evolucion").replaceChildren(...filas.map(f => el("tr", {},
        el("td", {}, el("strong", {}, String(f.anio))),
        el("td", { class: "barra-celda" }, el("div", { class: "barra", "aria-hidden": "true" }, el("span", { style: `width:${porcentajeBarra(f.total, niveles, totales)}%` }))),
        el("td", {}, `${f.total} pts · ${f.nivel}`))));
}

async function descargarPdf() {
    if (!puntajeActual) return;
    const { anio, fila, grupos } = puntajeActual;
    $("btn-pdf").disabled = true;
    try {
        await generarReporteDocente({
            nombre: perfil.nombre, anio, fecha: new Date(), total: fila.total, nivel: fila.nivel,
            ii: fila.ii, iid: fila.iid, ivs: fila.ivs, indicadores: grupos,
            estimulos: estimulosDe(fila.nivel, niveles), fuente,
            minimoNivel: niveles.length ? Math.min(...niveles.map(n => n.min_puntos)) : 0,
            rutaLogo: "assets/logo-comision-investigacion-color.png",
        });
    } catch (e) {
        aviso("mensaje-puntaje", "No se pudo generar el PDF. " + mensajeError(e));
    } finally {
        $("btn-pdf").disabled = false;
    }
}

// ---------- inicio ----------
async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    $("cargando").hidden = true;
    if (!puedeCargar(perfil)) { $("sin-permiso").hidden = false; return; }

    try {
        catalogo = await cargarCatalogo(sb);
        tiposPorId = Object.fromEntries(catalogo.map(t => [t.id, t]));
        [niveles, fuente] = await Promise.all([cargarNiveles(sb), cargarFuente(sb)]);
        const desde = await cargarAnioInicio(sb, anioActual);
        llenarAnios($("sel-anio"), desde, anioActual);
        llenarAnios($("sel-anio-form"), desde, anioActual);
    } catch (e) {
        $("cargando").hidden = false;
        $("cargando").textContent = "No se pudo cargar el catálogo. " + mensajeError(e);
        return;
    }
    construirMenu();
    $("contenido").hidden = false;

    $("sel-tipo").addEventListener("change", () => {
        const t = tiposPorId[$("sel-tipo").value];
        if (!t) { cerrarFormulario(); return; }
        $("info-tipo").textContent = `${t.puntos} puntos por unidad` + (t.tope ? `. Se computan como máximo ${t.tope} por año en este bloque, priorizando los de mayor puntaje.` : ".");
        abrirFormulario(t, null);
    });
    $("sel-anio").addEventListener("change", refrescarLista);
    $("formulario").addEventListener("submit", guardar);
    $("btn-cancelar").addEventListener("click", cerrarFormulario);
    $("btn-puntaje").addEventListener("click", refrescarPuntaje);
    $("btn-pdf").addEventListener("click", descargarPdf);
    // El puntaje se actualiza solo cada minuto (por si la responsable valida mientras la página está abierta).
    setInterval(() => { if (document.visibilityState === "visible") refrescarLista(); }, 60_000);   // también refresca el puntaje
    await refrescarLista();
}

iniciar();
