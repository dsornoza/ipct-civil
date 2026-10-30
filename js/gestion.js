/* Página «Gestión»: personas (alta, edición, cédulas, roles), carga desde tabla,
   uso del almacenamiento y respaldo. La usan la responsable del IPCT y el superadmin;
   los permisos reales están en la base de datos. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, aviso, descargarTexto } from "./ui.js";
import { ROLES_VALIDA, mensajeError } from "./catalogo.js";
import { cargarUsuariosCompleto } from "./evidencias.js";
import { ETIQUETAS_ROL, rolesAsignables, puedeGestionar, validarUsuario, normalizarCorreo, parsearTabla, planImportacion,
         guardarUsuario, aplicarImportacion, usoAlmacenamiento, exportarRespaldo, textoTamano, mensajeUsuario,
         filasPlantilla, INSTRUCCIONES_PLANTILLA }
    from "./usuarios.js";
import { descargarExcel, leerExcel } from "./excel.js";

const $ = id => document.getElementById(id);
let perfil, usuarios = [], dominio = "", editando = null, plan = null;

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

async function recargar() {
    try {
        usuarios = await cargarUsuariosCompleto(sb);
        pintarLista();
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
    $("f-texto").addEventListener("input", pintarLista);
    $("btn-nueva").addEventListener("click", () => abrirFormulario(null));
    $("btn-cancelar").addEventListener("click", cerrarFormulario);
    $("form-persona").addEventListener("submit", guardar);
    $("btn-revisar").addEventListener("click", revisar);
    $("btn-plantilla").addEventListener("click", descargarPlantilla);
    $("t-archivo").addEventListener("change", subirArchivo);
    $("btn-aplicar").addEventListener("click", aplicar);
    $("btn-respaldo").addEventListener("click", respaldo);
    await Promise.all([recargar(), pintarUso()]);
}

iniciar();
