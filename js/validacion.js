/* Panel de validación. Lo usan la responsable del IPCT y el superadmin para
   decidir; calidad y coordinadora lo ven en solo lectura. Los permisos reales
   están en la base de datos: aquí solo se reflejan. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, aviso, llenarAnios, fechaCorta, fechaHora } from "./ui.js";
import { ESTADOS, ROLES_CARGA, ROLES_LECTURA, ROLES_VALIDA, resumenEvidencia, enlaceDe, mensajeError } from "./catalogo.js";
import { cargarUsuarios, listarPorAnio, historialDe, evidenciasConMismaHuella, resolverEvidencia, cargarAnioInicio, urlFirmada }
    from "./evidencias.js";

const CFG = window.IPCT_CONFIG;
const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();

let perfil, puedeValidar = false;
let nombres = {};                    // id de usuario -> nombre
let evidencias = [];                 // evidencias del año seleccionado
let seleccionada = null;

// ---------- lista ----------
function filtradas() {
    const estado = $("f-estado").value, docente = $("f-docente").value;
    return evidencias.filter(e => (!estado || e.estado === estado) && (!docente || e.docente_id === docente));
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
            el("td", {}, resumenEvidencia(e.datos, e.tipo && e.tipo.esquema)),
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
        evidencias = await listarPorAnio(sb, anio);
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
    $("detalle-datos").replaceChildren(...filas.flatMap(([etq, val]) => [el("dt", {}, etq), el("dd", {}, val)]));
}

async function pintarPdf(e) {
    const visor = $("visor-pdf"), enlace = $("enlace-pdf");
    visor.hidden = true; visor.removeAttribute("src");
    enlace.hidden = true;
    $("info-pdf").textContent = e.archivo ? "Cargando el certificado…" : "Esta evidencia no tiene archivo adjunto.";
    if (!e.archivo) return;
    try {
        const url = await urlFirmada(sb, CFG, e.archivo.ruta, 600);
        if (!seleccionada || seleccionada.id !== e.id) return;       // el usuario ya abrió otra
        enlace.href = url; enlace.hidden = false;
        visor.src = url; visor.hidden = false;
        $("info-pdf").textContent = `${e.archivo.nombre} · ${(e.archivo.tamano / 1048576).toFixed(2)} MB · el enlace caduca en 10 minutos`;
    } catch (err) {
        $("info-pdf").textContent = "No se pudo abrir el archivo. " + mensajeError(err);
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

function pintarDecision(e) {
    const caja = $("botones-decision");
    caja.replaceChildren();
    aviso("mensaje-decision", "");
    $("comentario").value = "";
    const propia = e.docente_id === perfil.id;
    let nota = "";
    if (!puedeValidar) nota = "Su rol es de solo lectura: no puede validar ni modificar evidencias.";
    else if (propia) nota = "No puede validar sus propias evidencias. Otra persona con rol de validación debe revisarla.";
    else if (e.estado === "validada") nota = "Ya está validada y cuenta para el IPCT. Si hubo un error, devuélvala a «Observada» con un comentario para que el docente la corrija.";
    else if (e.estado !== "pendiente") nota = "Está esperando la corrección del docente; si la reenvía volverá a la cola de pendientes.";
    $("nota-decision").textContent = nota;
    $("form-decision").hidden = !puedeValidar || propia;
    if (!puedeValidar || propia) return;
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

async function abrirDetalle(e) {
    seleccionada = e;
    pintarLista();
    $("t-detalle").textContent = e.tipo ? e.tipo.nombre : e.tipo_id;
    $("detalle-meta").replaceChildren(
        `Docente: ${nombres[e.docente_id] || "(desconocido)"} · Año ${e.anio} · ${e.tipo ? e.tipo.puntos : "?"} pts por unidad · Registrada el ${fechaCorta(e.creado_en)} · Estado: `,
        el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado]),
        e.comentario ? ` · Comentario actual: ${e.comentario}` : "");
    pintarDatos(e);
    pintarDecision(e);
    $("detalle").hidden = false;
    $("detalle").scrollIntoView({ behavior: "smooth", block: "start" });
    await Promise.all([pintarPdf(e), pintarAvisosYHistorial(e)]);
}

function cerrarDetalle() {
    seleccionada = null;
    $("detalle").hidden = true;
    $("visor-pdf").removeAttribute("src");
    pintarLista();
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
        await resolverEvidencia(sb, e.id, estado, comentario);
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
        const usuarios = await cargarUsuarios(sb);
        nombres = Object.fromEntries(usuarios.map(u => [u.id, u.nombre]));
        const desde = await cargarAnioInicio(sb, anioActual);
        llenarAnios($("f-anio"), desde, anioActual);
        $("f-estado").replaceChildren(el("option", { value: "" }, "Todos"),
            ...Object.entries(ESTADOS).map(([k, v]) => el("option", { value: k }, v)));
        $("f-estado").value = "pendiente";
        $("f-docente").replaceChildren(el("option", { value: "" }, "Todos"),
            ...usuarios.filter(u => ROLES_CARGA.includes(u.rol)).map(u => el("option", { value: u.id }, u.nombre)));
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
    await recargar();
}

iniciar();
