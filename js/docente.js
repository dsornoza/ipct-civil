/* Página «Mis evidencias»: menú de tipos, formulario dinámico con PDF y lista propia. */
import { sb } from "./cliente.js";
import { el, aviso, llenarAnios, campoFormulario } from "./ui.js";
import { iniciarPagina } from "./comun.js";
import { ESTADOS, puedeCargar, agruparCatalogo, resumenEvidencia, normalizarDatos, validarArchivo, mensajeError,
         archivosDe, archivosFaltantes, camposVisibles, agruparCoautorias, textoPeriodo }
    from "./catalogo.js";
import { cargarEvolucion, cargarDetalle, cargarNiveles, cargarFuente, agruparDetalle, siguienteNivel, estimulosDe, porcentajeBarra, INDICADORES }
    from "./puntaje.js";
import { generarReporteDocente } from "./pdf.js";
import { cargarCatalogo, cargarAnioInicio, listarMias, crearEvidencia, actualizarEvidencia, eliminarEvidencia, urlFirmada,
         buscarDocentes, cargarCoautorias, estadoPeriodo }
    from "./evidencias.js";

const CFG = window.IPCT_CONFIG;
const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();

let perfil, catalogo = [], tiposPorId = {}, niveles = [], fuente = "";
let puntajeActual = null;           // datos del año mostrado, para el PDF
let editando = null;                 // evidencia en edición o null si se registra una nueva
let docentes = [];                   // docentes a quienes se puede agregar como coautores
let grupos = {};                     // coautorías del año mostrado, por grupo
let periodo = { abierto: true };     // estado de la carga del año mostrado

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
// Una etiqueta de archivo sin el detalle entre paréntesis: «Artículo completo en PDF».
const etiquetaCorta = etiqueta => etiqueta.split("(")[0].trim();

function construirArchivos(tipo, evidencia) {
    const actuales = (evidencia && evidencia.archivos) || [];
    $("bloque-archivos").replaceChildren(el("h3", { style: "font-size:16px" }, "Archivos"),
        ...archivosDe(tipo, "docente").map(a => {
            const actual = actuales.find(x => x.rol === a.rol && x.origen === "docente");
            const etq = el("label", { class: "etiqueta-campo", for: "archivo-" + a.rol }, a.etiqueta);
            if (a.obligatorio && !actual) etq.append(" ", el("span", { class: "obligatorio", "aria-hidden": "true" }, "*"));
            return el("div", { style: "margin-bottom:var(--space-3)" }, etq,
                el("input", { id: "archivo-" + a.rol, class: "campo", type: "file", accept: "application/pdf,.pdf" }),
                el("p", { class: "nota" }, (actual
                    ? `Archivo actual: ${actual.nombre}. Adjunte otro solo si desea reemplazarlo. `
                    : (a.obligatorio ? "Obligatorio. " : "Opcional. ")) + "Solo PDF, máximo 5 MB."));
        }));
}

function filaCoautor(c = {}) {
    const sel = el("select", { class: "campo", "aria-label": "Docente" }, el("option", { value: "" }, "Seleccione un docente…"));
    for (const d of docentes) sel.append(el("option", { value: d.id }, d.nombre));
    sel.value = c.docente_id || "";
    const pos = el("input", { class: "campo", type: "number", min: "1", max: "99", "aria-label": "Posición", placeholder: "Posición" });
    pos.value = c.posicion || "";
    const par = el("select", { class: "campo", "aria-label": "Participación" }, el("option", {}, "Coautor"), el("option", {}, "Autor"));
    par.value = c.participacion || "Coautor";
    const fila = el("div", { class: "fila-coautor" }, sel, pos, par,
        el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => fila.remove() }, "Quitar"));
    return fila;
}

function construirAutoria(tipo, evidencia) {
    const admite = Boolean(tipo.esquema.coautores);
    $("bloque-autoria").hidden = !admite;
    if (!admite) return;
    const aut = (evidencia && evidencia.autoria) || {};
    $("aut-posicion").value = aut.posicion || "";
    $("aut-participacion").value = aut.participacion || "Autor";
    $("lista-coautores").replaceChildren(...coautoresDe(evidencia).map(filaCoautor));
}

// Coautores guardados de una evidencia (los de su grupo que no son el titular).
function coautoresDe(evidencia) {
    return evidencia && evidencia.coautores ? evidencia.coautores : [];
}

function abrirFormulario(tipo, evidencia) {
    editando = evidencia || null;
    const datos = (evidencia && evidencia.datos) || {};
    $("campos").replaceChildren(...camposVisibles(tipo.esquema.campos, datos).map(c => campoFormulario(c, datos[c.nombre])));
    $("titulo-form").textContent = (evidencia ? "Corregir: " : "Nueva evidencia: ") + tipo.nombre;
    construirArchivos(tipo, evidencia);
    construirAutoria(tipo, evidencia);
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
    $("sel-tipo").disabled = !periodo.abierto;
    $("sel-tipo").value = "";
    $("info-tipo").textContent = "";
}

function leerValores(tipo) {
    const valores = {};
    for (const c of tipo.esquema.campos) valores[c.nombre] = $("campo-" + c.nombre).value;
    return valores;
}

// Coautores del formulario; null si hay un error (ya mostrado).
function leerCoautores() {
    const lista = [];
    for (const fila of document.querySelectorAll("#lista-coautores .fila-coautor")) {
        const [sel, pos, par] = fila.querySelectorAll("select, input");
        if (!sel.value) continue;
        if (lista.some(c => c.docente_id === sel.value)) { aviso("mensaje-form", "Un coautor está repetido en la lista."); return null; }
        const nombre = (docentes.find(d => d.id === sel.value) || {}).nombre;
        lista.push({ docente_id: sel.value, nombre, posicion: parseInt(pos.value, 10) || null, participacion: par.value });
    }
    for (const c of lista) {
        if (!c.posicion) { aviso("mensaje-form", `Indique la posición de ${c.nombre} entre los autores.`); return null; }
    }
    return lista;
}

async function guardar(ev) {
    ev.preventDefault();
    const tipo = tiposPorId[$("sel-tipo").value];
    if (!tipo) return aviso("mensaje-form", "Seleccione el tipo de actividad.");
    const datos = normalizarDatos(leerValores(tipo));
    for (const c of tipo.esquema.campos) {
        if (c.requerido && !datos[c.nombre]) return aviso("mensaje-form", `Falta el campo obligatorio: ${c.etiqueta}.`);
    }

    // Un archivo por función: obligatorios y formato.
    const archivos = {};
    for (const a of archivosDe(tipo, "docente")) {
        const f = $("archivo-" + a.rol).files[0] || null;
        if (f) {
            const err = await validarArchivo(f, CFG.MAX_PDF_BYTES);
            if (err) return aviso("mensaje-form", `${etiquetaCorta(a.etiqueta)}: ${err}`);
            archivos[a.rol] = f;
        }
    }
    const faltan = archivosFaltantes(tipo, ((editando && editando.archivos) || []).concat(Object.keys(archivos).map(rol => ({ rol, origen: "docente" }))), "docente");
    if (faltan.length) return aviso("mensaje-form", `Falta adjuntar: ${faltan.map(a => etiquetaCorta(a.etiqueta)).join("; ")}.`);

    let autoria, coautores = null;
    if (tipo.esquema.coautores) {
        const posicion = parseInt($("aut-posicion").value, 10);
        if (!posicion) return aviso("mensaje-form", "Indique su posición entre los autores.");
        autoria = { posicion, participacion: $("aut-participacion").value };
        coautores = leerCoautores();
        if (coautores === null) return;
    }
    const anio = parseInt($("sel-anio-form").value, 10);

    $("btn-guardar").disabled = true;
    aviso("mensaje-form", "Guardando…", "ok");
    try {
        if (editando) await actualizarEvidencia(sb, CFG, { evidencia: editando, anio, datos, autoria, archivos, coautores });
        else await crearEvidencia(sb, CFG, { perfilId: perfil.id, tipoId: tipo.id, anio, datos, autoria, archivos, coautores: coautores || [] });
        const hecho = editando ? "Evidencia corregida y enviada a validación." : "Evidencia registrada. Quedó pendiente de validación.";
        cerrarFormulario();
        $("sel-anio").value = String(anio);
        await refrescarLista();
        aviso("mensaje-lista", hecho, "ok");
    } catch (e) {
        if (e.creada) {          // la evidencia se guardó; solo falló algo secundario
            cerrarFormulario();
            await refrescarLista();
            aviso("mensaje-lista", `${e.parcial} ${mensajeError(e)}`);
        } else {
            aviso("mensaje-form", (e.parcial ? e.parcial + " " : "") + mensajeError(e));
        }
    } finally {
        $("btn-guardar").disabled = false;
    }
}

// ---------- lista ----------
const etiquetaDeRol = (e, a) => {
    const def = ((e.tipo && e.tipo.esquema && e.tipo.esquema.archivos) || []).find(x => x.rol === a.rol);
    return def ? etiquetaCorta(def.etiqueta) : (a.origen === "validador" ? "Adjunto" : "Archivo");
};

function filaEvidencia(e) {
    const miGrupo = grupos[e.titular_id || e.id] || [];
    const titular = miGrupo.find(m => m.es_titular);
    const coautoria = Boolean(e.titular_id);
    const puedeEditar = e.estado !== "validada" && periodo.abierto && !coautoria;
    const acciones = el("td", { class: "acciones" });
    if (puedeEditar) {
        acciones.append(
            el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => abrirFormulario(tiposPorId[e.tipo_id], conCoautores(e, miGrupo)) }, e.estado === "pendiente" ? "Editar" : "Corregir"),
            " ",
            el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => borrar(e) }, "Eliminar"));
    } else if (coautoria && e.estado !== "validada" && periodo.abierto) {
        acciones.append(el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => borrar(e, true) }, "No soy coautor"));
    }
    const detalle = el("div", {}, resumenEvidencia(e.datos, e.tipo && e.tipo.esquema));
    if (coautoria && titular) detalle.append(el("div", { class: "nota" }, `Coautoría registrada por ${titular.nombre}. Su posición: ${(e.autoria && e.autoria.posicion) || "—"}.`));
    else if (miGrupo.length > 1) {
        const otros = miGrupo.filter(m => !m.es_titular).map(m => `${m.nombre} (${m.posicion || "—"})`).join(", ");
        detalle.append(el("div", { class: "nota" }, `Coautores: ${otros}.`));
    }
    const tr = el("tr", {},
        el("td", {}, e.tipo ? e.tipo.nombre : e.tipo_id),
        el("td", {}, detalle),
        el("td", {}, e.tipo ? String(e.tipo.puntos) : ""),
        el("td", {}, el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado] || e.estado)),
        acciones);
    const filas = [tr];

    // Archivos propios y adjuntos de la Comisión
    if (e.archivos.length) {
        const caja = el("div", { class: "fila-botones" }, el("strong", {}, "Archivos: "));
        for (const a of e.archivos) {
            caja.append(el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => verArchivo(a) },
                (a.origen === "validador" ? "Comisión · " : "") + etiquetaDeRol(e, a)));
        }
        filas.push(el("tr", { class: "comentario" }, el("td", { colspan: "5" }, caja)));
    }
    if (e.comentario) {
        filas.push(el("tr", { class: "comentario" },
            el("td", { colspan: "5" }, el("strong", {}, "Comentario de la validación: "), e.comentario)));
    }
    return filas;
}

// Agrega a la evidencia la lista de coautores guardados (para editarla en el formulario).
function conCoautores(e, miGrupo) {
    return { ...e, coautores: miGrupo.filter(m => !m.es_titular).map(m => ({
        docente_id: m.docente_id, nombre: m.nombre, posicion: m.posicion, participacion: m.participacion })) };
}

async function refrescarPeriodo(anio) {
    try {
        periodo = await estadoPeriodo(sb, anio);
    } catch {
        periodo = { abierto: true };
    }
    const texto = textoPeriodo(periodo, anio);
    const aviso_ = $("aviso-periodo");
    aviso_.textContent = texto || "";
    aviso_.hidden = !texto;
    aviso_.className = "aviso " + (periodo.abierto ? "" : "aviso-error");
    $("sel-tipo").disabled = !periodo.abierto;
    $("sel-anio-form").disabled = !periodo.abierto;
    if (!periodo.abierto) cerrarFormulario();
}

async function refrescarLista() {
    const anio = parseInt($("sel-anio").value, 10);
    try {
        const [lista, coautorias] = await Promise.all([listarMias(sb, perfil.id, anio), cargarCoautorias(sb, anio), refrescarPeriodo(anio)]);
        grupos = agruparCoautorias(coautorias);
        $("filas").replaceChildren(...lista.flatMap(filaEvidencia));
        $("vacio").hidden = lista.length > 0;
        aviso("mensaje-lista", "");
    } catch (e) {
        aviso("mensaje-lista", "No se pudo cargar la lista. " + mensajeError(e));
    }
    refrescarPuntaje();
}

async function verArchivo(a) {
    // Se abre la pestaña antes de la petición para que el navegador no la bloquee.
    const ventana = window.open("", "_blank");
    try {
        const url = await urlFirmada(sb, CFG, a.ruta);
        if (ventana) { ventana.opener = null; ventana.location.href = url; } else window.location.href = url;
    } catch (err) {
        if (ventana) ventana.close();
        aviso("mensaje-lista", "No se pudo abrir el archivo. " + mensajeError(err));
    }
}

async function borrar(e, retiro = false) {
    const pregunta = retiro
        ? "¿Retirarse de esta coautoría? La evidencia dejará de aparecer en su cuenta y el autor será avisado."
        : "¿Eliminar esta evidencia y sus archivos? Esta acción no se puede deshacer.";
    if (!window.confirm(pregunta)) return;
    try {
        await eliminarEvidencia(sb, CFG, e);
        if (editando && editando.id === e.id) cerrarFormulario();
        await refrescarLista();
        aviso("mensaje-lista", retiro ? "Se retiró de la coautoría." : "Evidencia eliminada.", "ok");
    } catch (err) {
        aviso("mensaje-lista", "No se pudo completar la acción. " + mensajeError(err));
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
        [niveles, fuente, docentes] = await Promise.all([cargarNiveles(sb), cargarFuente(sb), buscarDocentes(sb)]);
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
    $("btn-agregar-coautor").addEventListener("click", () => $("lista-coautores").append(filaCoautor()));
    $("btn-puntaje").addEventListener("click", refrescarPuntaje);
    $("btn-pdf").addEventListener("click", descargarPdf);
    // El puntaje se actualiza solo cada minuto (por si la responsable valida mientras la página está abierta).
    setInterval(() => { if (document.visibilityState === "visible") refrescarLista(); }, 60_000);   // también refresca el puntaje
    await refrescarLista();
}

iniciar();
