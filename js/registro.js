/* Página «Registrar para un docente»: la responsable del IPCT (o el superadmin) registra a nombre de un
   docente una evidencia que este no reportó. Queda marcada como registrada por la Comisión, suma para el
   docente y sus coautores, y la valida otra persona (la base de datos lo impide a quien la registró). */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, aviso } from "./ui.js";
import { etiquetaCorta, construirMenuTipos, construirArchivos, filaCoautor, construirAutoria, construirCampos, leerFormulario } from "./formulario.js";
import { ESTADOS, ROLES_VALIDA, resumenEvidencia, mensajeError, agruparCoautorias } from "./catalogo.js";
import { cargarCatalogo, listarRegistradasPorMi, registrarPara, actualizarEvidencia, eliminarEvidencia, urlFirmada, cargarCoautorias,
         cargarUsuariosCompleto } from "./evidencias.js";
import { evaluables, cargarAniosHabilitados, cargarParticipantes } from "./usuarios.js";

const CFG = window.IPCT_CONFIG;
const $ = id => document.getElementById(id);

let perfil, catalogo = [], tiposPorId = {};
let usuarios = [], participantes = [], aniosHab = [];
let editando = null;                 // evidencia en edición o null si se registra una nueva
let docentesForm = [];               // posibles coautores del formulario abierto
let grupos = {};                     // coautorías del año de la lista

// Personas evaluadas que figuran en el año (ordenadas por nombre).
function personasDelAnio(anio) {
    const ids = new Set(participantes.filter(p => p.anio === anio).map(p => p.usuario_id));
    return evaluables(usuarios).filter(u => ids.has(u.id) && u.id !== perfil.id)
        .map(u => ({ id: u.id, nombre: u.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const nombreDe = id => (usuarios.find(u => u.id === id) || {}).nombre || "(desconocido)";

function pintarDocentes() {
    const anio = parseInt($("sel-anio-form").value, 10);
    const previo = $("sel-docente").value;
    const personas = personasDelAnio(anio);
    $("sel-docente").replaceChildren(el("option", { value: "" }, "Seleccione un docente…"), ...personas.map(p => el("option", { value: p.id }, p.nombre)));
    if (personas.some(p => p.id === previo)) $("sel-docente").value = previo;
}

// ---------- formulario ----------
function abrirFormulario(tipo, evidencia) {
    editando = evidencia || null;
    const docenteId = evidencia ? evidencia.docente_id : $("sel-docente").value;
    const anio = parseInt(evidencia ? evidencia.anio : $("sel-anio-form").value, 10);
    docentesForm = personasDelAnio(anio).filter(p => p.id !== docenteId);
    construirCampos(tipo, (evidencia && evidencia.datos) || {});
    construirArchivos(tipo, evidencia);
    construirAutoria(tipo, evidencia, docentesForm);
    $("titulo-form").textContent = (evidencia ? "Corregir: " : "Nueva evidencia: ") + tipo.nombre;
    $("aviso-nombre").textContent = `Se registrará a nombre de ${nombreDe(docenteId)} (${anio}). Quedará pendiente y la validará otra persona.`;
    $("btn-guardar").textContent = evidencia ? "Guardar cambios" : "Registrar evidencia";
    $("sel-tipo").value = tipo.id;
    $("sel-tipo").disabled = Boolean(evidencia);
    $("sel-docente").disabled = Boolean(evidencia);
    $("sel-anio-form").disabled = Boolean(evidencia);
    aviso("mensaje-form", "");
    $("formulario").hidden = false;
    $("formulario").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cerrarFormulario() {
    editando = null;
    $("formulario").hidden = true;
    for (const id of ["sel-tipo", "sel-docente", "sel-anio-form"]) $(id).disabled = false;
    $("sel-tipo").value = "";
    $("info-tipo").textContent = "";
}

function elegirTipo() {
    const t = tiposPorId[$("sel-tipo").value];
    if (!t) { cerrarFormulario(); return; }
    if (!$("sel-docente").value) {
        $("sel-tipo").value = "";
        return aviso("mensaje-lista", "Primero elija el docente a cuyo nombre se registrará.");
    }
    aviso("mensaje-lista", "");
    $("info-tipo").textContent = `${t.puntos} puntos por unidad` + (t.tope ? `. Se computan como máximo ${t.tope} por año en este bloque, priorizando los de mayor puntaje.` : ".");
    abrirFormulario(t, null);
}

async function guardar(ev) {
    ev.preventDefault();
    const tipo = tiposPorId[$("sel-tipo").value];
    if (!tipo) return aviso("mensaje-form", "Seleccione el tipo de actividad.");
    const lectura = await leerFormulario(tipo, { editando, docentes: docentesForm, maxBytes: CFG.MAX_PDF_BYTES });
    if (!lectura) return;
    const { datos, archivos, autoria, coautores } = lectura;
    const anio = parseInt(editando ? editando.anio : $("sel-anio-form").value, 10);

    $("btn-guardar").disabled = true;
    aviso("mensaje-form", "Guardando…", "ok");
    try {
        if (editando) await actualizarEvidencia(sb, CFG, { evidencia: editando, anio, datos, autoria, archivos, coautores });
        else await registrarPara(sb, CFG, { docenteId: $("sel-docente").value, tipoId: tipo.id, anio, datos, autoria, archivos, coautores: coautores || [] });
        const hecho = editando ? "Cambios guardados. La evidencia volvió a pendiente." : "Evidencia registrada a nombre del docente. Quedó pendiente de validación por otra persona.";
        cerrarFormulario();
        $("sel-anio").value = String(anio);
        await refrescarLista();
        aviso("mensaje-lista", hecho, "ok");
    } catch (e) {
        if (e.creada) {          // la evidencia se guardó; solo falló algo secundario (un coautor)
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
    const puedeEditar = e.estado !== "validada";
    const miGrupo = grupos[e.id] || [];
    const coautores = miGrupo.filter(m => !m.es_titular);
    const acciones = el("td", { class: "acciones" });
    if (puedeEditar) {
        acciones.append(
            el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => abrirFormulario(tiposPorId[e.tipo_id], conCoautores(e, miGrupo)) }, "Editar"),
            " ",
            el("button", { class: "boton boton-peligro boton-chico", type: "button", onclick: () => borrar(e) }, "Eliminar"));
    }
    const detalle = el("div", {}, resumenEvidencia(e.datos, e.tipo && e.tipo.esquema));
    if (coautores.length) detalle.append(el("div", { class: "nota" }, `Coautores: ${coautores.map(m => `${m.nombre} (${m.posicion || "—"})`).join(", ")}.`));
    const filas = [el("tr", {},
        el("td", {}, nombreDe(e.docente_id)),
        el("td", {}, e.tipo ? e.tipo.nombre : e.tipo_id),
        el("td", {}, detalle),
        el("td", {}, el("span", { class: "estado estado-" + e.estado }, ESTADOS[e.estado] || e.estado)),
        acciones)];
    if (e.archivos.length) {
        const caja = el("div", { class: "fila-botones" }, el("strong", {}, "Archivos: "));
        for (const a of e.archivos) {
            caja.append(el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => verArchivo(a) },
                (a.origen === "validador" ? "Comisión · " : "") + etiquetaDeRol(e, a) + (a.archivado_en ? " (archivado)" : "")));
        }
        filas.push(el("tr", { class: "comentario" }, el("td", { colspan: "5" }, caja)));
    }
    if (e.comentario) {
        filas.push(el("tr", { class: "comentario" }, el("td", { colspan: "5" }, el("strong", {}, "Comentario de la validación: "), e.comentario)));
    }
    return filas;
}

// Agrega a la evidencia los coautores guardados (para editarlos en el formulario).
const conCoautores = (e, miGrupo) => ({ ...e, coautores: miGrupo.filter(m => !m.es_titular)
    .map(m => ({ docente_id: m.docente_id, nombre: m.nombre, posicion: m.posicion, participacion: m.participacion })) });

async function refrescarLista() {
    const anio = parseInt($("sel-anio").value, 10);
    try {
        const [lista, coautorias] = await Promise.all([listarRegistradasPorMi(sb, perfil.id, anio), cargarCoautorias(sb, anio)]);
        grupos = agruparCoautorias(coautorias);
        $("filas").replaceChildren(...lista.flatMap(filaEvidencia));
        $("vacio").hidden = lista.length > 0;
        aviso("mensaje-lista", "");
    } catch (e) {
        aviso("mensaje-lista", "No se pudo cargar la lista. " + mensajeError(e));
    }
}

async function verArchivo(a) {
    if (a.archivado_en) return aviso("mensaje-lista", "Este archivo se archivó fuera del sistema para liberar espacio.");
    const ventana = window.open("", "_blank");
    try {
        const url = await urlFirmada(sb, CFG, a.ruta);
        if (ventana) { ventana.opener = null; ventana.location.href = url; } else window.location.href = url;
    } catch (err) {
        if (ventana) ventana.close();
        aviso("mensaje-lista", "No se pudo abrir el archivo. " + mensajeError(err));
    }
}

async function borrar(e) {
    if (!window.confirm(`¿Eliminar esta evidencia registrada a nombre de ${nombreDe(e.docente_id)} y sus archivos? Esta acción no se puede deshacer.`)) return;
    try {
        await eliminarEvidencia(sb, CFG, e);
        if (editando && editando.id === e.id) cerrarFormulario();
        await refrescarLista();
        aviso("mensaje-lista", "Evidencia eliminada.", "ok");
    } catch (err) {
        aviso("mensaje-lista", "No se pudo eliminar. " + mensajeError(err));
    }
}

// ---------- inicio ----------
async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    $("cargando").hidden = true;
    if (!ROLES_VALIDA.includes(perfil.rol)) { $("sin-permiso").hidden = false; return; }
    try {
        [catalogo, usuarios, participantes, aniosHab] = await Promise.all([
            cargarCatalogo(sb), cargarUsuariosCompleto(sb), cargarParticipantes(sb), cargarAniosHabilitados(sb)]);
        tiposPorId = Object.fromEntries(catalogo.map(t => [t.id, t]));
    } catch (e) {
        $("cargando").hidden = false;
        $("cargando").textContent = "No se pudo cargar la información. " + mensajeError(e);
        return;
    }
    const anios = aniosHab.map(a => a.anio);
    if (!anios.length) {
        $("cargando").hidden = false;
        $("cargando").textContent = "Aún no hay años habilitados. Habilite uno en Validación.";
        return;
    }
    for (const id of ["sel-anio-form", "sel-anio"]) $(id).replaceChildren(...anios.map(a => el("option", { value: a }, String(a))));
    construirMenuTipos($("sel-tipo"), catalogo);
    pintarDocentes();
    $("contenido").hidden = false;

    $("sel-anio-form").addEventListener("change", () => { pintarDocentes(); cerrarFormulario(); });
    $("sel-docente").addEventListener("change", () => { if (!editando && $("sel-tipo").value) elegirTipo(); });
    $("sel-tipo").addEventListener("change", elegirTipo);
    $("sel-anio").addEventListener("change", refrescarLista);
    $("formulario").addEventListener("submit", guardar);
    $("btn-cancelar").addEventListener("click", cerrarFormulario);
    $("btn-agregar-coautor").addEventListener("click", () => $("lista-coautores").append(filaCoautor(docentesForm)));
    await refrescarLista();
}

iniciar();
