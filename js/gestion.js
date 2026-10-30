/* Página «Gestión»: personas (alta, edición, cédulas, roles), carga desde tabla,
   uso del almacenamiento y respaldo. La usan la responsable del IPCT y el superadmin;
   los permisos reales están en la base de datos. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, aviso, descargarTexto, descargarBlob } from "./ui.js";
import { ROLES_VALIDA, mensajeError } from "./catalogo.js";
import { cargarUsuariosCompleto } from "./evidencias.js";
import { ETIQUETAS_ROL, rolesAsignables, puedeGestionar, validarUsuario, normalizarCorreo, parsearTabla, planImportacion,
         guardarUsuario, aplicarImportacion, usoAlmacenamiento, exportarRespaldo, textoTamano, mensajeUsuario,
         filasPlantilla, INSTRUCCIONES_PLANTILLA, evaluables, cargarAniosHabilitados, cargarParticipantes, aniosPorUsuario,
         anioAnterior, fijarParticipacion, copiarParticipantes }
    from "./usuarios.js";
import { descargarExcel, leerExcel, generarExcel } from "./excel.js";
import { crearZip } from "./zip.js";
import { exportarAnio, liberarEspacio, resumenAnio, cargarArchivosAnio } from "./archivo_anio.js";
import { cargarRanking, cargarReporteDetalle } from "./puntaje.js";
import { cargarCatalogo, listarPorAnio } from "./evidencias.js";
import { construirMatrices, construirActividades, aCsv, csvDocentes, csvEvidencias, ENCABEZADOS } from "./informes.js";

const $ = id => document.getElementById(id);
const CFG = window.IPCT_CONFIG;
let perfil, usuarios = [], dominio = "", editando = null, plan = null;
let aniosHab = [], participantes = [];   // años habilitados y filas (usuario, año)

// ---------- lista ----------
function filtradas() {
    const q = $("f-texto").value.trim().toLowerCase();
    return usuarios.filter(u => !q || [u.nombre, u.apellidos_nombres, u.email, u.cedula].some(v => (v || "").toLowerCase().includes(q)));
}

function pintarLista() {
    const lista = filtradas();
    $("filas").replaceChildren(...lista.map(u => {
        const accion = puedeGestionar(perfil, u)
            ? el("button", { class: "boton boton-secundario boton-chico", type: "button", onclick: () => abrirFormulario(u) }, "Editar")
            : el("span", { class: "nota" }, "Solo el superadmin");
        const estado = [u.activo ? "Activo" : "Inactivo", u.evaluado ? "evaluado" : "no evaluado"].join(" · ");
        return el("tr", {},
            el("td", {}, el("strong", {}, u.nombre), el("div", { class: "nota" }, u.email),
                u.apellidos_nombres ? el("div", { class: "nota" }, u.apellidos_nombres) : ""),
            el("td", {}, ETIQUETAS_ROL[u.rol] || u.rol),
            el("td", {}, u.cedula || el("span", { class: "nota" }, "falta")),
            el("td", {}, `${u.facultad || "—"} · ${u.programa || "—"}`),
            el("td", {}, el("span", { class: "estado " + (u.activo ? "estado-validada" : "estado-pendiente") }, estado)),
            el("td", { class: "acciones" }, accion));
    }));
    $("vacio").hidden = lista.length > 0;
}

// ---------- participantes por año ----------
function pintarAnios() {
    const sel = $("p-anio");
    const previo = sel.value;
    sel.replaceChildren(...aniosHab.map(a => el("option", { value: a.anio }, String(a.anio) + (a.abierto ? "" : " (cerrado)"))));
    $("vacio-anios").hidden = aniosHab.length > 0;
    if (!aniosHab.length) { $("filas-anios").replaceChildren(); $("btn-copiar").disabled = true; $("p-conteo").textContent = ""; return; }
    sel.value = aniosHab.some(a => String(a.anio) === previo) ? previo : String(aniosHab[0].anio);
    const anio = parseInt(sel.value, 10);
    const porUsuario = aniosPorUsuario(participantes);
    const personas = evaluables(usuarios);
    const prev = anioAnterior(aniosHab, anio);
    $("btn-copiar").textContent = prev ? `Copiar participantes de ${prev}` : "Copiar participantes";
    $("btn-copiar").disabled = !prev;
    $("p-conteo").textContent = `${personas.filter(u => (porUsuario[u.id] || []).includes(anio)).length} de ${personas.length} personas figuran en ${anio}.`;
    $("filas-anios").replaceChildren(...personas.map(u => {
        const marca = el("input", { type: "checkbox", "aria-label": `${u.nombre} participa en ${anio}` });
        marca.checked = (porUsuario[u.id] || []).includes(anio);
        marca.addEventListener("change", () => cambiarParticipacion(u, anio, marca));
        return el("tr", {}, el("td", {}, marca),
            el("td", {}, u.nombre, u.activo ? "" : el("span", { class: "nota" }, " (inactivo)")),
            el("td", {}, (porUsuario[u.id] || []).join(", ") || "—"));
    }));
}

async function cambiarParticipacion(u, anio, marca) {
    marca.disabled = true;
    try {
        await fijarParticipacion(sb, u.id, anio, marca.checked);
        participantes = await cargarParticipantes(sb);
        aviso("mensaje-anios", `${u.nombre} ${marca.checked ? "ahora figura" : "ya no figura"} en ${anio}.`, "ok");
        pintarAnios();
    } catch (e) {
        marca.checked = !marca.checked;
        marca.disabled = false;
        aviso("mensaje-anios", mensajeUsuario(e));
    }
}

async function copiar() {
    const anio = parseInt($("p-anio").value, 10);
    const prev = anioAnterior(aniosHab, anio);
    if (!prev) return;
    $("btn-copiar").disabled = true;
    try {
        const n = await copiarParticipantes(sb, prev, anio);
        participantes = await cargarParticipantes(sb);
        aviso("mensaje-anios", n ? `Se agregaron ${n} persona(s) de ${prev}. Desmarque a quienes ya no están.` : `No había personas nuevas que copiar de ${prev}.`, "ok");
    } catch (e) {
        aviso("mensaje-anios", mensajeUsuario(e));
    }
    pintarAnios();
}

async function recargar() {
    try {
        [usuarios, aniosHab, participantes] = await Promise.all([cargarUsuariosCompleto(sb), cargarAniosHabilitados(sb), cargarParticipantes(sb)]);
        pintarLista();
        pintarAnios();
        if (perfil.rol === "superadmin") await pintarArchivar();
        aviso("mensaje-personas", "");
    } catch (e) {
        aviso("mensaje-personas", "No se pudo cargar la lista. " + mensajeError(e));
    }
}

// ---------- formulario ----------
function abrirFormulario(u) {
    editando = u || null;
    $("t-form").textContent = u ? `Editar: ${u.nombre}` : "Agregar persona";
    $("p-email").value = u ? u.email : "";
    $("p-email").readOnly = Boolean(u);          // el correo enlaza con el inicio de sesión: no se cambia
    $("p-nombre").value = u ? u.nombre : "";
    $("p-apellidos").value = (u && u.apellidos_nombres) || "";
    $("p-cedula").value = (u && u.cedula) || "";
    $("p-facultad").value = u ? (u.facultad || "") : "Ciencias Técnicas";
    $("p-programa").value = u ? (u.programa || "") : "Ingeniería Civil";
    const roles = rolesAsignables(perfil);
    $("p-rol").replaceChildren(...roles.map(r => el("option", { value: r }, ETIQUETAS_ROL[r])));
    $("p-rol").value = u ? u.rol : "docente";
    $("p-evaluado").checked = u ? u.evaluado : true;
    $("p-activo").checked = u ? u.activo : true;
    aviso("mensaje-form", "");
    $("formulario").hidden = false;
    $("formulario").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cerrarFormulario() { editando = null; $("formulario").hidden = true; }

async function guardar(ev) {
    ev.preventDefault();
    const v = {
        email: normalizarCorreo($("p-email").value), nombre: $("p-nombre").value.trim(),
        apellidos_nombres: $("p-apellidos").value.trim() || null, cedula: $("p-cedula").value.trim() || null,
        facultad: $("p-facultad").value.trim(), programa: $("p-programa").value.trim(),
        rol: $("p-rol").value, evaluado: $("p-evaluado").checked, activo: $("p-activo").checked,
    };
    const problema = validarUsuario(v, { dominio, esNuevo: !editando });
    if (problema) return aviso("mensaje-form", problema);
    if (editando && editando.id === perfil.id && !v.activo) return aviso("mensaje-form", "No puede desactivar su propia cuenta.");
    $("btn-guardar").disabled = true;
    aviso("mensaje-form", "Guardando…", "ok");
    try {
        if (editando) { const { email, ...cambios } = v; await guardarUsuario(sb, { id: editando.id, ...cambios }); }
        else await guardarUsuario(sb, v);
        const nombre = v.nombre;
        cerrarFormulario();
        await recargar();
        aviso("mensaje-personas", `Se guardaron los datos de ${nombre}.`, "ok");
    } catch (e) {
        aviso("mensaje-form", mensajeUsuario(e));
    } finally {
        $("btn-guardar").disabled = false;
    }
}

// ---------- importación desde tabla ----------
function resumenPlan(p) {
    const partes = [el("p", {}, `Se crearán ${p.crear.length} persona(s), se actualizarán ${p.actualizar.length} y ${p.sinCambios} ya tienen esos datos.`)];
    if (p.actualizar.length) {
        partes.push(el("ul", { class: "historial" }, ...p.actualizar.slice(0, 50).map(a =>
            el("li", {}, `${a.nombre}: ${Object.entries(a.cambios).map(([k, v]) => `${k} = ${v}`).join(", ")}`))));
    }
    if (p.errores.length) {
        partes.push(el("p", { class: "aviso aviso-error" }, `${p.errores.length} fila(s) no se aplicarán:`),
            el("ul", { class: "historial" }, ...p.errores.map(e => el("li", {}, `Línea ${e.linea}${e.correo ? ` (${e.correo})` : ""}: ${e.mensaje}`))));
    }
    return partes;
}

async function descargarPlantilla() {
    $("btn-plantilla").disabled = true;
    try {
        await descargarExcel("plantilla-personas-ipct.xlsx", [
            { nombre: "Personas", filas: filasPlantilla(usuarios.filter(u => puedeGestionar(perfil, u))), textoCols: [2], filasTexto: 300 },
            { nombre: "Instrucciones", filas: INSTRUCCIONES_PLANTILLA },
        ]);
    } catch (e) {
        $("resumen-importacion").replaceChildren(el("p", { class: "aviso aviso-error" }, "No se pudo generar la plantilla. " + mensajeError(e)));
    } finally {
        $("btn-plantilla").disabled = false;
    }
}

// Lee un archivo .xlsx/.xls o .csv y lo deja en el cuadro de texto para revisarlo.
async function subirArchivo(ev) {
    const archivo = ev.target.files[0];
    ev.target.value = "";
    if (!archivo) return;
    try {
        $("t-pegado").value = /\.(xlsx|xls)$/i.test(archivo.name) ? await leerExcel(archivo) : await archivo.text();
        revisar();
    } catch (e) {
        $("resumen-importacion").replaceChildren(el("p", { class: "aviso aviso-error" }, "No se pudo leer el archivo. " + mensajeError(e)));
    }
}

function revisar() {
    const t = parsearTabla($("t-pegado").value);
    plan = null;
    $("btn-aplicar").hidden = true;
    if (t.error) return $("resumen-importacion").replaceChildren(el("p", { class: "aviso aviso-error" }, t.error));
    plan = planImportacion(t.filas, usuarios, perfil, { dominio });
    $("resumen-importacion").replaceChildren(...resumenPlan(plan));
    $("btn-aplicar").hidden = plan.crear.length + plan.actualizar.length === 0;
}

async function aplicar() {
    if (!plan) return;
    $("btn-aplicar").disabled = true;
    try {
        const { hechos, fallos } = await aplicarImportacion(sb, plan);
        await recargar();
        plan = null;
        $("btn-aplicar").hidden = true;
        $("resumen-importacion").replaceChildren(
            el("p", { class: fallos.length ? "aviso aviso-error" : "aviso aviso-ok" }, `Se aplicaron ${hechos} cambio(s).` + (fallos.length ? ` ${fallos.length} fallaron:` : "")),
            ...(fallos.length ? [el("ul", { class: "historial" }, ...fallos.map(f => el("li", {}, `${f.correo}: ${f.mensaje}`)))] : []));
        if (!fallos.length) $("t-pegado").value = "";
    } finally {
        $("btn-aplicar").disabled = false;
    }
}

// ---------- archivar un año ----------
let copia = null;            // {anio, verificados} de la última copia completa y verificada de esta sesión

// ¿Cerrado a mano o con la fecha de cierre vencida? (la base de datos hace la comprobación definitiva)
const estaCerrado = a => !a.abierto || Boolean(a.cierra_el && new Date().toISOString().slice(0, 10) > a.cierra_el);
const textoMB = bytes => (bytes / 1048576).toFixed(1) + " MB";

async function pintarArchivar() {
    const cerrados = aniosHab.filter(estaCerrado);
    const sel = $("a-anio"), previo = sel.value;
    sel.replaceChildren(...cerrados.map(a => el("option", { value: a.anio }, String(a.anio))));
    $("btn-copia").disabled = cerrados.length === 0;
    if (!cerrados.length) { $("a-resumen").textContent = "Aún no hay años cerrados. Cierre un año en Validación para poder archivarlo."; return; }
    if (cerrados.some(a => String(a.anio) === previo)) sel.value = previo;
    await pintarResumenAnio();
}

async function pintarResumenAnio() {
    const anio = parseInt($("a-anio").value, 10);
    if (copia && copia.anio !== anio) reiniciarPaso2();
    try {
        const r = resumenAnio(await cargarArchivosAnio(sb, anio));
        $("a-resumen").textContent = r.pendientes
            ? `${anio}: ${r.pendientes} archivo(s) en el sistema (${textoMB(r.bytes)}).` + (r.archivados ? ` Ya archivados: ${r.archivados}.` : "")
            : `${anio}: no quedan archivos por archivar` + (r.archivados ? ` (${r.archivados} ya archivados).` : " (el año no tiene archivos).");
        $("btn-copia").disabled = r.pendientes === 0 && r.archivados > 0;
    } catch (e) {
        $("a-resumen").textContent = "No se pudo consultar el año. " + mensajeError(e);
    }
}

function reiniciarPaso2() {
    copia = null;
    $("a-paso2").hidden = true;
    $("a-confirma").value = "";
    $("btn-liberar").disabled = true;
    $("a-resultado").replaceChildren();
}

// Informes del año que van dentro de la copia (los que se puedan generar).
async function informesDelAnio(anio) {
    const [ranking, detalle, evidencias, usuariosAll, tipos] = await Promise.all([
        cargarRanking(sb, anio), cargarReporteDetalle(sb, anio), listarPorAnio(sb, anio), cargarUsuariosCompleto(sb), cargarCatalogo(sb)]);
    const extras = [];
    const d = csvDocentes(ranking, detalle), e = csvEvidencias(detalle);
    extras.push({ ruta: `informes/docentes-${anio}.csv`, contenido: aCsv(d.encabezados, d.filas) },
                { ruta: `informes/evidencias-validadas-${anio}.csv`, contenido: aCsv(e.encabezados, e.filas) });
    const m = construirMatrices({ evidencias, usuarios: usuariosAll, tipos });
    const hojas = Object.keys(ENCABEZADOS).map(nombre => ({ nombre, filas: [m[nombre].encabezados, ...m[nombre].filas] }));
    if (hojas.some(h => h.filas.length > 1)) extras.push({ ruta: `informes/Publicaciones-investigacion-${anio}.xlsx`, contenido: await generarExcel(hojas) });
    const a = construirActividades({ evidencias, usuarios: usuariosAll, tipos, anio });
    if (a.docentes) extras.push({ ruta: `informes/Actividades-investigacion-${anio}.xlsx`, contenido: await generarExcel([{ nombre: "BASE DE DATOS", filas: a.filas, merges: a.merges }]) });
    return extras;
}

async function descargarCopia() {
    const anio = parseInt($("a-anio").value, 10);
    reiniciarPaso2();
    $("btn-copia").disabled = true;
    aviso("mensaje-archivar", "");
    try {
        $("a-progreso").textContent = "Preparando los informes del año…";
        const extras = await informesDelAnio(anio);
        const r = await exportarAnio(sb, CFG, anio, {
            crearZip, extras, entregar: async (nombre, blob) => descargarBlob(nombre, blob),
            onProgreso: p => {
                $("a-progreso").textContent = `${p.texto} ${p.total ? `${p.actual} de ${p.total} archivos` : ""}`;
                $("a-barra").style.width = (p.total ? (p.actual / p.total) * 100 : 100) + "%";
            },
        });
        $("a-barra").style.width = "100%";
        if (r.completo) {
            $("a-progreso").textContent = "";
            $("a-resultado").replaceChildren(el("p", { class: "aviso aviso-ok" },
                `Copia completa y verificada: ${r.archivos} archivo(s), ${textoMB(r.bytes)}, en ${r.partes} ZIP. Revise que se hayan descargado todas las partes.`));
            copia = { anio, verificados: r.verificados };
            $("a-frase").textContent = `ARCHIVAR ${anio}`;
            $("a-paso2").hidden = false;
        } else {
            $("a-progreso").textContent = "";
            $("a-resultado").replaceChildren(
                el("p", { class: "aviso aviso-error" }, `La copia NO está completa: ${r.fallos.length} archivo(s) no se pudieron verificar. No se puede liberar espacio.`),
                el("ul", { class: "historial" }, ...r.fallos.slice(0, 20).map(f => el("li", {}, `${f.archivo.docente} · ${f.archivo.nombre}: ${f.motivo}`))));
        }
    } catch (e) {
        $("a-progreso").textContent = "";
        aviso("mensaje-archivar", "No se pudo generar la copia. " + mensajeError(e));
    } finally {
        $("btn-copia").disabled = false;
    }
}

async function liberar() {
    if (!copia) return;
    if ($("a-confirma").value.trim() !== `ARCHIVAR ${copia.anio}`) return;
    if (!window.confirm(`Se borrarán del sistema ${copia.verificados.length} archivo(s) de ${copia.anio}. Solo quedará la copia que descargó. ¿Continuar?`)) return;
    $("btn-liberar").disabled = true;
    $("btn-copia").disabled = true;
    try {
        const r = await liberarEspacio(sb, CFG, copia.verificados, {
            onProgreso: p => { $("a-progreso").textContent = `${p.texto} ${p.actual} de ${p.total}`; $("a-barra").style.width = (p.actual / p.total) * 100 + "%"; } });
        const anio = copia.anio;
        reiniciarPaso2();
        $("a-progreso").textContent = "";
        $("a-resultado").replaceChildren(el("p", { class: r.noBorrados.length ? "aviso aviso-error" : "aviso aviso-ok" },
            `Se liberó el espacio de ${r.borrados} archivo(s) de ${anio}.` + (r.noBorrados.length ? ` ${r.noBorrados.length} no se pudieron borrar; repita el proceso.` : "")));
        await Promise.all([pintarUso(), pintarResumenAnio()]);
    } catch (e) {
        aviso("mensaje-archivar", "No se pudo completar. " + mensajeError(e) + " Lo ya borrado quedó marcado; repita el proceso para terminar.");
        $("btn-liberar").disabled = false;
    } finally {
        $("btn-copia").disabled = false;
    }
}

// ---------- almacenamiento y respaldo ----------
async function pintarUso() {
    try {
        const u = await usoAlmacenamiento(sb);
        const pct = u.cuota ? Math.min(100, (u.usado / u.cuota) * 100) : 0;
        $("uso-barra").style.width = pct + "%";
        $("uso-texto").textContent = `${textoTamano(u.usado)} de ${textoTamano(u.cuota)} (${pct.toFixed(1)} %) · ${u.archivos} archivo(s).` +
            (pct >= 80 ? " Se acerca al límite del plan gratuito: vea las alternativas en el README." : "");
    } catch (e) {
        $("uso-texto").textContent = "No se pudo consultar el uso. " + mensajeError(e);
    }
}

async function respaldo() {
    $("btn-respaldo").disabled = true;
    aviso("mensaje-respaldo", "Generando…", "ok");
    try {
        const datos = await exportarRespaldo(sb);
        const fecha = new Date().toISOString().slice(0, 10);
        descargarTexto(`respaldo-ipct-${fecha}.json`, JSON.stringify(datos, null, 2), "application/json");
        aviso("mensaje-respaldo", "Respaldo descargado. Guárdelo fuera de este sistema; contiene cédulas y evidencias, trátelo como confidencial.", "ok");
    } catch (e) {
        aviso("mensaje-respaldo", "No se pudo generar el respaldo. " + mensajeError(e));
    } finally {
        $("btn-respaldo").disabled = false;
    }
}

// ---------- inicio ----------
async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    $("cargando").hidden = true;
    if (!ROLES_VALIDA.includes(perfil.rol)) { $("sin-permiso").hidden = false; return; }
    try {
        const { data, error } = await sb.from("ajustes").select("valor").eq("clave", "dominio_permitido");
        if (error) throw error;
        dominio = (data && data[0] && data[0].valor) || "";
    } catch (e) {
        $("cargando").hidden = false;
        $("cargando").textContent = "No se pudo cargar la información. " + mensajeError(e);
        return;
    }
    $("contenido").hidden = false;
    $("seccion-respaldo").hidden = perfil.rol !== "superadmin";
    $("seccion-archivar").hidden = perfil.rol !== "superadmin";
    $("a-anio").addEventListener("change", pintarResumenAnio);
    $("btn-copia").addEventListener("click", descargarCopia);
    $("btn-liberar").addEventListener("click", liberar);
    $("a-confirma").addEventListener("input", () => { $("btn-liberar").disabled = !copia || $("a-confirma").value.trim() !== `ARCHIVAR ${copia.anio}`; });
    $("f-texto").addEventListener("input", pintarLista);
    $("btn-nueva").addEventListener("click", () => abrirFormulario(null));
    $("btn-cancelar").addEventListener("click", cerrarFormulario);
    $("form-persona").addEventListener("submit", guardar);
    $("p-anio").addEventListener("change", pintarAnios);
    $("btn-copiar").addEventListener("click", copiar);
    $("btn-revisar").addEventListener("click", revisar);
    $("btn-plantilla").addEventListener("click", descargarPlantilla);
    $("t-archivo").addEventListener("change", subirArchivo);
    $("btn-aplicar").addEventListener("click", aplicar);
    $("btn-respaldo").addEventListener("click", respaldo);
    await Promise.all([recargar(), pintarUso()]);
}

iniciar();
