/* Panel de validación. Lo usan la responsable del IPCT y el superadmin para
   decidir; calidad y coordinadora lo ven en solo lectura. Los permisos reales
   están en la base de datos: aquí solo se reflejan. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, aviso, llenarAnios, fechaCorta, fechaHora, campoFormulario } from "./ui.js";
import { ESTADOS, ROLES_LECTURA, ROLES_VALIDA, resumenEvidencia, enlaceDe, mensajeError, archivosDe, camposVisibles,
         tiposReclasificables, agruparCoautorias, textoPeriodo, validarAdjunto }
    from "./catalogo.js";
import { cargarUsuarios, listarPorAnio, historialDe, evidenciasConMismaHuella, resolverEvidencia, cargarAnioInicio, urlFirmada,
         cargarCatalogo, cargarCoautorias, subirAdjunto, quitarAdjunto, estadoPeriodo, fijarPeriodo }
    from "./evidencias.js";

const CFG = window.IPCT_CONFIG;
const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();

let perfil, puedeValidar = false;
let nombres = {};                    // id de usuario -> nombre
let evidencias = [];                 // evidencias del año seleccionado
let seleccionada = null;
let catalogo = [], tiposPorId = {};
let grupos = {};                     // coautorías del año, por grupo
let periodo = { abierto: true };

// ---------- lista ----------
function filtradas() {
    const estado = $("f-estado").value, docente = $("f-docente").value;
    return evidencias.filter(e => (!estado || e.estado === estado) && (!docente || e.docente_id === docente));
}

// Texto breve sobre la coautoría de una evidencia (vacío si no tiene coautores).
function notaCoautoria(e) {
    const g = grupos[e.titular_id || e.id] || [];
    if (g.length < 2) return [];
    const titular = g.find(m => m.es_titular);
    return [el("div", { class: "nota" }, e.titular_id
        ? `Coautoría de ${titular ? titular.nombre : "otro docente"}: se valida desde su evidencia.`
        : `Con ${g.length - 1} coautor(es): ${g.filter(m => !m.es_titular).map(m => m.nombre).join(", ")}.`)];
}

function pintarConteos() {
    const n = estado => evidencias.filter(e => e.estado === estado).length;
    $("conteos").replaceChildren(...Object.keys(ESTADOS).map(k =>
        el("span", {}, el("span", { class: "estado estado-" + k }, ESTADOS[k]), ` ${n(k)}`)));
}

function pintarLista() {
    const lista = filtradas();
    $("filas").replaceChildren(...lista.map(e => {
        const tr = el("tr", e.id === (seleccionada && seleccionada.id) ? { class: "fila-activa" } : {},
            el("td", {}, nombres[e.docente_id] || "(desconocido)"),
            el("td", {}, e.tipo ? e.tipo.nombre : e.tipo_id),
            el("td", {}, resumenEvidencia(e.datos, e.tipo && e.tipo.esquema), ...notaCoautoria(e)),
            el("td", {}, fechaCorta(e.creado_en)),
            el("td", {}, el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado])),
            el("td", { class: "acciones" },
                el("button", { class: "boton boton-primario boton-chico", type: "button", onclick: () => abrirDetalle(e) },
                    puedeValidar && e.estado === "pendiente" ? "Revisar" : "Ver")));
        return tr;
    }));
    $("vacio").hidden = lista.length > 0;
    pintarConteos();
}

async function recargar() {
    const anio = parseInt($("f-anio").value, 10);
    try {
        const [lista, coautorias] = await Promise.all([listarPorAnio(sb, anio), cargarCoautorias(sb, anio), refrescarPeriodo(anio)]);
        evidencias = lista;
        grupos = agruparCoautorias(coautorias);
        if (seleccionada) seleccionada = evidencias.find(e => e.id === seleccionada.id) || null;
        pintarLista();
        aviso("mensaje-lista", "");
    } catch (e) {
        aviso("mensaje-lista", "No se pudo cargar la lista. " + mensajeError(e));
    }
}

// ---------- detalle y decisión ----------
function valorDeCampo(campo, valor) {
    const href = enlaceDe(campo, valor);
    return href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, valor) : document.createTextNode(valor);
}

function pintarDatos(e) {
    const campos = (e.tipo && e.tipo.esquema && e.tipo.esquema.campos) || [];
    const conocidos = new Set(campos.map(c => c.nombre));
    const filas = campos.filter(c => e.datos[c.nombre] !== undefined).map(c => [c.etiqueta, valorDeCampo(c, String(e.datos[c.nombre]))]);
    for (const [k, v] of Object.entries(e.datos)) if (!conocidos.has(k)) filas.push([k, document.createTextNode(String(v))]);
    const validador = (e.tipo && e.tipo.esquema && e.tipo.esquema.validador) || [];
    const hechos = validador.filter(c => (e.datos_validacion || {})[c.nombre] !== undefined && (!c.mostrar_si || (c.mostrar_si.en || []).includes(e.datos_validacion[c.mostrar_si.campo])));
    const filasComision = hechos.map(c => ["Comisión · " + c.etiqueta, valorDeCampo(c, String(e.datos_validacion[c.nombre]))]);
    $("detalle-datos").replaceChildren(...[...filas, ...filasComision].flatMap(([etq, val]) => [el("dt", {}, etq), el("dd", {}, val)]));
}

// Muestra un archivo en el visor (enlace firmado de 10 minutos).
async function verEnVisor(e, a) {
    const visor = $("visor-pdf"), enlace = $("enlace-pdf");
    visor.hidden = true; visor.removeAttribute("src");
    enlace.hidden = true;
    $("info-pdf").textContent = "Cargando el archivo…";
    try {
        const url = await urlFirmada(sb, CFG, a.ruta, 600);
        if (!seleccionada || seleccionada.id !== e.id) return;       // el usuario ya abrió otra
        enlace.href = url; enlace.hidden = false;
        visor.src = url; visor.hidden = false;
        $("info-pdf").textContent = `${a.nombre} · ${(a.tamano / 1048576).toFixed(2)} MB · el enlace caduca en 10 minutos`;
    } catch (err) {
        $("info-pdf").textContent = "No se pudo abrir el archivo. " + mensajeError(err);
    }
}

const etiquetaDeArchivo = (e, a) => {
    const def = ((e.tipo && e.tipo.esquema && e.tipo.esquema.archivos) || []).find(x => x.rol === a.rol);
    return (a.origen === "validador" ? "Comisión · " : "") + (def ? def.etiqueta.split("(")[0].trim() : a.rol);
};

function pintarArchivos(e) {
    const visor = $("visor-pdf");
    $("lista-archivos").replaceChildren(...e.archivos.map(a => el("li", {},
        el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => verEnVisor(e, a) }, "Ver"),
        el("span", {}, `${etiquetaDeArchivo(e, a)} · ${a.nombre}`),
        ...(puedeAdjuntar(e) && a.origen === "validador"
            ? [el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => quitar(e, a) }, "Quitar")]
            : []))));
    if (!e.archivos.length) {
        $("info-pdf").textContent = "Esta evidencia no tiene archivos adjuntos.";
        visor.hidden = true; $("enlace-pdf").hidden = true;
        return;
    }
    const primero = e.archivos.find(a => a.origen === "docente") || e.archivos[0];
    return verEnVisor(e, primero);
}

async function quitar(e, a) {
    try {
        await quitarAdjunto(sb, CFG, a);
        e.archivos = e.archivos.filter(x => x.id !== a.id);
        pintarArchivos(e);
        construirAdjuntos(e, tipoElegido(e));
    } catch (err) {
        aviso("mensaje-decision", "No se pudo quitar el archivo. " + mensajeError(err));
    }
}

async function pintarAvisosYHistorial(e) {
    $("detalle-avisos").replaceChildren();
    $("historial").replaceChildren(el("li", {}, "Cargando…"));
    try {
        const [hist, iguales] = await Promise.all([
            historialDe(sb, e.id),
            evidenciasConMismaHuella(sb, e.archivo && e.archivo.sha256, e.id),
        ]);
        if (!seleccionada || seleccionada.id !== e.id) return;
        if (iguales.length) {
            const donde = iguales.map(a => {
                const otra = evidencias.find(x => x.id === a.evidencia_id);
                return otra ? `${nombres[otra.docente_id] || "otro docente"} (${otra.tipo ? otra.tipo.nombre : otra.tipo_id})` : "otra evidencia de otro año";
            }).join("; ");
            $("detalle-avisos").replaceChildren(el("p", { class: "aviso" }, `Atención: el mismo archivo PDF figura también en ${iguales.length} evidencia(s): ${donde}.`));
        }
        $("historial").replaceChildren(...hist.map(h => el("li", {},
            `${fechaHora(h.fecha)} · ${nombres[h.actor_id] || "sistema"} · `,
            h.estado_anterior && h.estado_anterior !== h.estado_nuevo ? `${ESTADOS[h.estado_anterior] || h.estado_anterior} → ` : "",
            ESTADOS[h.estado_nuevo] || h.estado_nuevo,
            h.comentario ? ` · ${h.comentario}` : "")));
    } catch (err) {
        $("historial").replaceChildren(el("li", {}, "No se pudo cargar el historial. " + mensajeError(err)));
    }
}

// Motivo por el que la persona no puede decidir sobre esta evidencia (vacío si puede).
function motivoNoDecide(e) {
    const g = grupos[e.titular_id || e.id] || [];
    if (!puedeValidar) return "Su rol es de solo lectura: no puede validar ni modificar evidencias.";
    if (e.docente_id === perfil.id) return "No puede validar sus propias evidencias. Otra persona con rol de validación debe revisarla.";
    if (e.titular_id) return "Es una coautoría: se valida desde la evidencia del autor titular y el resultado se copia a todos.";
    if (g.some(m => m.docente_id === perfil.id)) return "Usted figura como coautor de esta evidencia: otra persona con rol de validación debe revisarla.";
    return "";
}

const puedeAdjuntar = e => !motivoNoDecide(e) && e.estado !== "validada";

function pintarGrupo(e) {
    const caja = $("bloque-grupo");
    const g = grupos[e.titular_id || e.id] || [];
    caja.replaceChildren();
    caja.hidden = g.length < 2;
    if (g.length < 2) return;
    const lista = g.map(m => `${m.nombre}${m.es_titular ? " (titular)" : ""} · posición ${m.posicion || "—"} · ${m.participacion || "—"}`);
    caja.append(el("h3", { style: "font-size:16px" }, "Autoría"),
        el("ul", { class: "historial" }, ...lista.map(t => el("li", {}, t))));
    if (e.titular_id) {
        const titular = evidencias.find(x => x.id === e.titular_id);
        if (titular) caja.append(el("p", {}, el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => abrirDetalle(titular) }, "Abrir la evidencia del titular")));
    }
}

function pintarDecision(e) {
    const caja = $("botones-decision");
    caja.replaceChildren();
    aviso("mensaje-decision", "");
    $("comentario").value = "";
    const motivo = motivoNoDecide(e);
    let nota = motivo;
    if (!motivo && e.estado === "validada") nota = "Ya está validada y cuenta para el IPCT. Si hubo un error, devuélvala a «Observada» con un comentario para que el docente la corrija.";
    else if (!motivo && e.estado !== "pendiente") nota = "Está esperando la corrección del docente; si la reenvía volverá a la cola de pendientes.";
    $("nota-decision").textContent = nota;
    $("form-decision").hidden = Boolean(motivo);
    if (motivo) return;
    const botones = [
        ["validada", "Validar", "boton boton-primario"],
        ["observada", "Observar", "boton boton-secundario"],
        ["rechazada", "Rechazar", "boton boton-peligro"],
    ];
    for (const [estado, texto, clase] of botones) {
        if (estado === e.estado) continue;
        caja.append(el("button", { class: clase, type: "button", onclick: () => decidir(estado) }, texto));
    }
}

// ---------- datos y archivos que completa la responsable ----------
const valorDe = id => { const x = $(id); return x ? x.value : ""; };

function leerCamposValidador(tipo) {
    const campos = (tipo.esquema && tipo.esquema.validador) || [];
    const valores = {};
    for (const c of campos) valores[c.nombre] = valorDe("v-" + c.nombre).trim();
    const datos = {};
    for (const c of camposVisibles(campos, valores)) if (valores[c.nombre]) datos[c.nombre] = valores[c.nombre];
    return datos;
}

function leerVerificacion() {
    return [...document.querySelectorAll("#lista-verificacion input:checked")].map(i => i.value);
}

function construirCamposValidador(e, tipo, valores) {
    const campos = (tipo.esquema && tipo.esquema.validador) || [];
    const cajas = campos.map(c => {
        const caja = campoFormulario(c, valores[c.nombre], "v-");
        caja.dataset.campo = c.nombre;
        return caja;
    });
    $("campos-validador").replaceChildren(...cajas);
    const actualizar = () => {
        const actuales = {};
        for (const c of campos) actuales[c.nombre] = valorDe("v-" + c.nombre);
        const visibles = new Set(camposVisibles(campos, actuales).map(c => c.nombre));
        cajas.forEach(caja => { caja.hidden = !visibles.has(caja.dataset.campo); });
    };
    cajas.forEach(caja => caja.addEventListener("change", actualizar));
    actualizar();
}

function construirAdjuntos(e, tipo) {
    const subidos = e.archivos.filter(a => a.origen === "validador");
    $("adjuntos-requeridos").replaceChildren(...archivosDe(tipo, "validador").map(a => {
        const hecho = subidos.some(x => x.rol === a.rol);
        const etq = el("label", { class: "etiqueta-campo", for: "adj-" + a.rol }, a.etiqueta);
        if (a.obligatorio && !hecho) etq.append(" ", el("span", { class: "obligatorio", "aria-hidden": "true" }, "*"));
        return el("div", { style: "margin-bottom:var(--space-3)" }, etq,
            el("input", { id: "adj-" + a.rol, class: "campo", type: "file", accept: "application/pdf,image/png,image/jpeg,image/webp" }),
            hecho ? el("p", { class: "nota" }, "Ya hay un archivo con esta función; si sube otro se agrega a la lista.") : "");
    }));
    $("adj-extra").value = "";
}

function construirVerificacion(e, tipo) {
    const items = (tipo.esquema && tipo.esquema.verificacion) || [];
    $("bloque-verificacion").hidden = items.length === 0;
    $("lista-verificacion").replaceChildren(...items.map(v => el("li", {}, el("label", {},
        Object.assign(el("input", { type: "checkbox", value: v.id }), { checked: (e.verificacion || []).includes(v.id) }),
        el("span", {}, v.texto)))));
}

function pintarValidador(e) {
    const activo = puedeAdjuntar(e);
    $("bloque-validador").hidden = !activo;
    if (!activo) return;
    const actual = e.tipo ? { id: e.tipo_id, grupo_dedup: e.tipo.grupo_dedup } : { id: e.tipo_id };
    const alternativas = tiposReclasificables(actual, catalogo);
    const sel = $("sel-reclasificar");
    $("bloque-reclasificar").hidden = alternativas.length === 0;
    sel.replaceChildren(...[tiposPorId[e.tipo_id], ...alternativas].filter(Boolean)
        .map(t => el("option", { value: t.id }, `${t.nombre} — ${t.puntos} pts`)));
    sel.value = e.tipo_id;
    const tipo = tiposPorId[e.tipo_id] || e.tipo;
    construirCamposValidador(e, tipo, e.datos_validacion || {});
    construirAdjuntos(e, tipo);
    construirVerificacion(e, tipo);
}

// Tipo elegido en el selector (o el actual de la evidencia).
const tipoElegido = e => tiposPorId[$("sel-reclasificar").value] || tiposPorId[e.tipo_id] || e.tipo;

// Al cambiar el tipo, la lista de campos y de archivos puede cambiar: se rehace conservando lo escrito.
function cambioDeTipo() {
    const e = seleccionada;
    const tipo = tiposPorId[$("sel-reclasificar").value];
    if (!e || !tipo) return;
    const previos = leerCamposValidador(e.tipo ? tiposPorId[e.tipo_id] || e.tipo : tipo);
    construirCamposValidador(e, tipo, previos);
    construirAdjuntos(e, tipo);
    construirVerificacion({ ...e, verificacion: leerVerificacion() }, tipo);
}

async function abrirDetalle(e) {
    seleccionada = e;
    pintarLista();
    $("t-detalle").textContent = e.tipo ? e.tipo.nombre : e.tipo_id;
    $("detalle-meta").replaceChildren(
        `Docente: ${nombres[e.docente_id] || "(desconocido)"} · Año ${e.anio} · ${e.tipo ? e.tipo.puntos : "?"} pts por unidad · Registrada el ${fechaCorta(e.creado_en)} · Estado: `,
        el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado]),
        e.comentario ? ` · Comentario actual: ${e.comentario}` : "");
    pintarDatos(e);
    pintarGrupo(e);
    pintarDecision(e);
    pintarValidador(e);
    $("detalle").hidden = false;
    $("detalle").scrollIntoView({ behavior: "smooth", block: "start" });
    await Promise.all([pintarArchivos(e), pintarAvisosYHistorial(e)]);
}

function cerrarDetalle() {
    seleccionada = null;
    $("detalle").hidden = true;
    $("visor-pdf").removeAttribute("src");
    pintarLista();
}

// Sube los archivos de la responsable (uno por función y un adjunto adicional). Valida todos antes de subir.
async function subirAdjuntos(e, tipo) {
    const pendientes = [];
    for (const a of archivosDe(tipo, "validador")) {
        const campo = $("adj-" + a.rol);
        const f = campo ? campo.files[0] : null;
        if (f) pendientes.push({ rol: a.rol, archivo: f, etiqueta: a.etiqueta.split("(")[0].trim() });
    }
    const extra = $("adj-extra").files[0];
    if (extra) pendientes.push({ rol: "retroalimentacion", archivo: extra, etiqueta: "Adjunto adicional" });
    for (const p of pendientes) {
        const err = await validarAdjunto(p.archivo, CFG.MAX_PDF_BYTES);
        if (err) throw Object.assign(new Error(`${p.etiqueta}: ${err}`), { code: "23514" });
    }
    for (const p of pendientes) e.archivos.push(await subirAdjunto(sb, CFG, { evidencia: e, rol: p.rol, archivo: p.archivo }));
    if (pendientes.length) { pintarArchivos(e); construirAdjuntos(e, tipo); }   // sin tocar lo que ya escribió
}

async function decidir(estado) {
    const e = seleccionada;
    const comentario = $("comentario").value.trim();
    if ((estado === "observada" || estado === "rechazada") && !comentario) {
        return aviso("mensaje-decision", "Escriba un comentario: el docente lo necesita para corregir.");
    }
    const botones = [...$("botones-decision").querySelectorAll("button")];
    botones.forEach(b => (b.disabled = true));
    aviso("mensaje-decision", "Guardando…", "ok");
    try {
        let extra = {};
        if (!$("bloque-validador").hidden) {
            const tipo = tipoElegido(e);
            // Se leen antes de subir: subir los archivos refresca la lista de archivos.
            extra = { datosValidacion: leerCamposValidador(tipo), verificacion: leerVerificacion(),
                      tipoId: tipo.id !== e.tipo_id ? tipo.id : undefined };
            await subirAdjuntos(e, tipo);
        }
        await resolverEvidencia(sb, e.id, estado, comentario, extra);
        const quien = nombres[e.docente_id] || "el docente";
        cerrarDetalle();
        await recargar();
        aviso("mensaje-lista", `Evidencia de ${quien} marcada como ${ESTADOS[estado].toLowerCase()}.`, "ok");
        $("t-lista").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
        aviso("mensaje-decision", mensajeError(err));
        botones.forEach(b => (b.disabled = false));
    }
}

// ---------- cierre de carga ----------
async function refrescarPeriodo(anio) {
    try { periodo = await estadoPeriodo(sb, anio); } catch { periodo = { abierto: true }; }
    if (!puedeValidar) return;
    $("panel-periodo").hidden = false;
    $("estado-periodo").textContent = textoPeriodo(periodo, anio) || `La carga de evidencias del año ${anio} está abierta.`;
    $("estado-periodo").className = "aviso " + (periodo.abierto ? "aviso-ok" : "aviso-error");
    $("btn-periodo").textContent = periodo.abierto ? "Cerrar carga" : "Reabrir carga";
    $("f-cierra").value = periodo.cierra_el || "";
}

async function cambiarPeriodo(abierto, cierraEl) {
    const anio = parseInt($("f-anio").value, 10);
    aviso("mensaje-periodo", "Guardando…", "ok");
    try {
        await fijarPeriodo(sb, anio, abierto, cierraEl);
        await refrescarPeriodo(anio);
        aviso("mensaje-periodo", abierto ? "Cambio guardado." : "Carga cerrada. Los docentes ya no pueden modificar evidencias de ese año.", "ok");
    } catch (err) {
        aviso("mensaje-periodo", "No se pudo guardar. " + mensajeError(err));
    }
}

function alternarPeriodo() {
    const anio = $("f-anio").value;
    if (periodo.abierto) {
        if (!window.confirm(`¿Cerrar la carga de evidencias del año ${anio}? Los docentes ya no podrán registrar, editar ni eliminar evidencias de ese año. Usted podrá reabrirla.`)) return;
        cambiarPeriodo(false, periodo.cierra_el || null);
    } else {
        cambiarPeriodo(true, null);     // reabrir quita también el cierre automático
    }
}

// ---------- inicio ----------
async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    $("cargando").hidden = true;
    if (!ROLES_LECTURA.includes(perfil.rol)) { $("sin-permiso").hidden = false; return; }
    puedeValidar = ROLES_VALIDA.includes(perfil.rol);
    if (!puedeValidar) {
        $("titulo-pagina").textContent = "Evidencias del programa";
        $("subtitulo-pagina").textContent = "Consulta de evidencias y certificados. Su rol es de solo lectura.";
    }

    try {
        catalogo = await cargarCatalogo(sb);
        tiposPorId = Object.fromEntries(catalogo.map(t => [t.id, t]));
        const usuarios = await cargarUsuarios(sb);
        nombres = Object.fromEntries(usuarios.map(u => [u.id, u.nombre]));
        const desde = await cargarAnioInicio(sb, anioActual);
        llenarAnios($("f-anio"), desde, anioActual);
        $("f-estado").replaceChildren(el("option", { value: "" }, "Todos"),
            ...Object.entries(ESTADOS).map(([k, v]) => el("option", { value: k }, v)));
        $("f-estado").value = "pendiente";
        $("f-docente").replaceChildren(el("option", { value: "" }, "Todos"),
            ...usuarios.filter(u => u.evaluado).map(u => el("option", { value: u.id }, u.nombre)));
    } catch (e) {
        $("cargando").hidden = false;
        $("cargando").textContent = "No se pudo cargar la información. " + mensajeError(e);
        return;
    }
    $("contenido").hidden = false;
    $("f-anio").addEventListener("change", () => { cerrarDetalle(); recargar(); });
    $("f-estado").addEventListener("change", pintarLista);
    $("f-docente").addEventListener("change", pintarLista);
    $("btn-cerrar-detalle").addEventListener("click", cerrarDetalle);
    $("form-decision").addEventListener("submit", ev => ev.preventDefault());
    $("sel-reclasificar").addEventListener("change", cambioDeTipo);
    $("btn-periodo").addEventListener("click", alternarPeriodo);
    $("btn-fecha-cierre").addEventListener("click", () => cambiarPeriodo(!periodo.cierre_manual, $("f-cierra").value || null));
    await recargar();
}

iniciar();
