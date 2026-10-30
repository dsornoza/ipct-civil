/* Gestión de personas: reglas puras (qué roles puede asignar cada quien, lectura de tablas
   pegadas desde Excel, plan de importación) y acceso a datos con el cliente inyectado.
   Los permisos reales están en la base de datos (RLS); aquí solo se reflejan para no
   ofrecer acciones que serían rechazadas. */
import { mensajeError } from "./catalogo.js";

export const ETIQUETAS_ROL = {
    docente: "Docente", responsable_ipct: "Responsable del IPCT", calidad: "Calidad",
    coordinadora: "Coordinadora", director_investigacion: "Director de Investigación", superadmin: "Superadministrador",
};
const ROLES_DE_LA_RESPONSABLE = ["docente", "calidad", "coordinadora", "director_investigacion"];

// Qué puede hacer cada rol (se muestra junto al selector de roles).
export const DESCRIPCION_ROLES = {
    docente: "Registra sus propias evidencias, ve su puntaje, el ranking y descarga su reporte. Es la única persona que puede cargar sus evidencias (si es evaluada).",
    responsable_ipct: "Valida, observa o rechaza las evidencias, completa los datos de la matriz de investigación, habilita años y administra participantes y personas (docentes, calidad, coordinadora y director). No valida sus propias evidencias.",
    calidad: "Solo lectura: ve todas las evidencias, archivos, ranking e informes, y puede descargar informes y la copia ZIP de un año. No carga ni modifica nada.",
    coordinadora: "Solo lectura, con el mismo acceso que Calidad. Identifica a la coordinadora de la Carrera.",
    director_investigacion: "Solo lectura, con el mismo acceso que Calidad. Identifica al Director de Investigación; conviene fijarle «acceso hasta» si la revisión es temporal.",
    superadmin: "Todo lo de la responsable, y además crea responsables y superadministradores, descarga el respaldo completo y archiva años para liberar espacio.",
};

// Roles que la persona puede asignar: la responsable no nombra responsables ni superadmins.
export const rolesAsignables = perfil =>
    perfil.rol === "superadmin" ? Object.keys(ETIQUETAS_ROL) : perfil.rol === "responsable_ipct" ? ROLES_DE_LA_RESPONSABLE : [];

// ¿Puede crear o modificar a esta persona? (el superadmin a todos; la responsable solo a sus roles)
export const puedeGestionar = (perfil, usuario) =>
    perfil.rol === "superadmin" || (perfil.rol === "responsable_ipct" && ROLES_DE_LA_RESPONSABLE.includes(usuario.rol));

export const normalizarCorreo = c => String(c || "").trim().toLowerCase();
const limpio = v => (v === undefined || v === null ? "" : String(v).trim());
const sinTildes = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "");

// «SORNOZA PARRALES DIEGO» -> «Sornoza Parrales Diego»
export const aTitulo = t => limpio(t).toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

// Devuelve un mensaje de error o null.
export function validarUsuario(v, { dominio = "", esNuevo = true, hoy = new Date().toISOString().slice(0, 10) } = {}) {
    if (!limpio(v.nombre)) return "Escriba el nombre con el que se mostrará la persona.";
    const correo = normalizarCorreo(v.email);
    if (esNuevo) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return "El correo no es válido.";
        if (dominio && correo.split("@")[1] !== dominio) return `El correo debe ser institucional (@${dominio}); con otro dominio la persona no podrá ingresar.`;
    }
    if (limpio(v.acceso_hasta) && !/^\d{4}-\d{2}-\d{2}$/.test(limpio(v.acceso_hasta))) return "La fecha de «acceso hasta» no es válida.";
    if (limpio(v.cedula) && !/^[A-Za-z0-9]{5,20}$/.test(limpio(v.cedula))) return "La cédula o el pasaporte debe tener solo letras y números (sin guiones ni espacios).";
    return null;
}

export function mensajeUsuario(error) {
    if (error && error.code === "23505") return "Ya existe una persona con ese correo o esa cédula.";
    if (error && (error.code === "42501" || error.code === "PGRST116" || /row-level security/i.test(error.message || ""))) {
        return "No tiene permiso para esta acción. La responsable no puede crear ni modificar responsables ni superadministradores.";
    }
    return mensajeError(error);
}

// ---------- tablas pegadas desde Excel o CSV ----------
const ALIAS = {
    correo: "correo", email: "correo", "correo institucional": "correo",
    nombre: "nombre", "nombre para mostrar": "nombre",
    apellidosnombres: "apellidos_nombres", "apellidos y nombres": "apellidos_nombres", "apellidos nombres": "apellidos_nombres",
    cedula: "cedula", "cedula de identidad": "cedula", identificacion: "cedula",
    facultad: "facultad", carrera: "programa", programa: "programa", rol: "rol",
};
const clave = h => ALIAS[sinTildes(String(h).toLowerCase()).replace(/_/g, " ").replace(/\s+/g, " ").trim()] ||
                   ALIAS[sinTildes(String(h).toLowerCase()).replace(/[^a-z]/g, "")] || null;

function partir(linea, sep) {
    const celdas = []; let actual = "", comillas = false;
    for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (c === '"') { if (comillas && linea[i + 1] === '"') { actual += '"'; i++; } else comillas = !comillas; }
        else if (c === sep && !comillas) { celdas.push(actual); actual = ""; }
        else actual += c;
    }
    celdas.push(actual);
    return celdas.map(x => x.trim());
}

// Primera línea = encabezados. Separador: tabulación (pegado desde Excel), punto y coma o coma.
export function parsearTabla(texto) {
    const lineas = String(texto || "").split(/\r?\n/).filter(l => l.trim());
    if (lineas.length < 2) return { columnas: [], filas: [], error: "Pegue una tabla con una fila de encabezados y al menos una persona." };
    const sep = ["\t", ";", ","].find(s => lineas[0].includes(s)) || ",";
    const columnas = partir(lineas[0], sep).map(clave);
    if (!columnas.includes("correo")) return { columnas, filas: [], error: "Falta la columna «correo» en los encabezados." };
    const filas = lineas.slice(1).map((l, i) => {
        const celdas = partir(l, sep), fila = { _linea: i + 2 };
        columnas.forEach((c, j) => { if (c) fila[c] = c === "cedula" ? normalizarCedula(celdas[j]) : limpio(celdas[j]); });
        return fila;
    });
    return { columnas: columnas.filter(Boolean), filas, error: null };
}

// Excel quita el cero inicial de las cédulas escritas como número: 9 dígitos -> se repone.
export const normalizarCedula = c => { const t = limpio(c).replace(/\.0$/, ""); return /^\d{9}$/.test(t) ? "0" + t : t; };

const CAMPOS_ACTUALIZABLES = ["nombre", "apellidos_nombres", "cedula", "facultad", "programa"];

// existentes: usuarios actuales. Devuelve qué crear, qué actualizar y qué filas tienen error.
export function planImportacion(filas, existentes, perfil, { dominio = "" } = {}) {
    const porCorreo = Object.fromEntries(existentes.map(u => [normalizarCorreo(u.email), u]));
    const cedulaDe = Object.fromEntries(existentes.filter(u => u.cedula).map(u => [u.cedula, u.id]));
    const vistos = new Set();
    const plan = { crear: [], actualizar: [], sinCambios: 0, errores: [] };
    for (const f of filas) {
        const error = mensaje => plan.errores.push({ linea: f._linea, correo: f.correo || "", mensaje });
        const correo = normalizarCorreo(f.correo);
        const problema = validarUsuario({ nombre: f.nombre || f.apellidos_nombres || "x", email: correo, cedula: f.cedula }, { dominio, esNuevo: true });
        if (problema && !problema.startsWith("Escriba")) { error(problema); continue; }
        if (vistos.has(correo)) { error("El correo está repetido en la tabla."); continue; }
        vistos.add(correo);

        const actual = porCorreo[correo];
        const cedula = limpio(f.cedula);
        if (cedula && cedulaDe[cedula] && (!actual || cedulaDe[cedula] !== actual.id)) { error(`La cédula ${cedula} ya pertenece a otra persona.`); continue; }
        if (actual) {
            const cambios = {};
            for (const c of CAMPOS_ACTUALIZABLES) if (limpio(f[c]) && limpio(f[c]) !== limpio(actual[c])) cambios[c] = limpio(f[c]);
            if (!Object.keys(cambios).length) { plan.sinCambios++; continue; }
            // Solo es un error si se intenta cambiar a alguien que esta persona no puede gestionar.
            if (!puedeGestionar(perfil, actual)) { error(`Solo el superadministrador puede modificar a ${actual.nombre}.`); continue; }
            plan.actualizar.push({ id: actual.id, correo, nombre: actual.nombre, cambios });
        } else {
            const rol = limpio(f.rol).toLowerCase() || "docente";
            if (!rolesAsignables(perfil).includes(rol)) { error(`No puede crear personas con el rol «${rol}».`); continue; }
            const nombre = limpio(f.nombre) || aTitulo(f.apellidos_nombres);
            if (!nombre) { error("Falta el nombre o los apellidos y nombres."); continue; }
            if (cedula) cedulaDe[cedula] = correo;
            plan.crear.push({ email: correo, nombre, apellidos_nombres: limpio(f.apellidos_nombres) || null, cedula: cedula || null,
                facultad: limpio(f.facultad) || "Ciencias Técnicas", programa: limpio(f.programa) || "Ingeniería Civil", rol, evaluado: true, activo: true });
        }
    }
    return plan;
}

// ---------- acceso a datos (sb inyectado) ----------
function lanzar(error) { if (error) throw error; }

export async function guardarUsuario(sb, { id, ...campos }) {
    const consulta = id ? sb.from("usuarios").update(campos).eq("id", id) : sb.from("usuarios").insert(campos);
    const { data, error } = await consulta.select().single();
    lanzar(error);
    return data;
}

// Aplica un plan de importación. Devuelve cuántos cambió y los errores que tuvo cada fila.
export async function aplicarImportacion(sb, plan) {
    const fallos = [];
    let hechos = 0;
    for (const c of plan.crear) {
        try { await guardarUsuario(sb, c); hechos++; } catch (e) { fallos.push({ correo: c.email, mensaje: mensajeUsuario(e) }); }
    }
    for (const a of plan.actualizar) {
        try { await guardarUsuario(sb, { id: a.id, ...a.cambios }); hechos++; } catch (e) { fallos.push({ correo: a.correo, mensaje: mensajeUsuario(e) }); }
    }
    return { hechos, fallos };
}

// ---------- participantes por año ----------
export const ROLES_EVALUABLES = ["docente", "responsable_ipct", "superadmin"];
export const evaluables = usuarios => usuarios.filter(u => u.evaluado && ROLES_EVALUABLES.includes(u.rol));

// Años habilitados (con su estado), del más reciente al más antiguo.
export async function cargarAniosHabilitados(sb) {
    const { data, error } = await sb.from("periodos").select("anio, abierto, cierra_el").order("anio", { ascending: false });
    lanzar(error);
    return [...data].sort((a, b) => b.anio - a.anio);
}

export async function cargarParticipantes(sb) {
    const { data, error } = await sb.from("usuarios_anios").select("usuario_id, anio");
    lanzar(error);
    return data;
}

// { usuario_id: [2027, 2026, ...] }
export function aniosPorUsuario(filas) {
    const r = {};
    for (const f of filas) (r[f.usuario_id] ||= []).push(f.anio);
    for (const a of Object.values(r)) a.sort((x, y) => y - x);
    return r;
}

// Año anterior al indicado entre los habilitados (o null): de ahí se copia la lista.
export const anioAnterior = (anios, anio) => {
    const previos = anios.filter(a => a.anio < anio).map(a => a.anio);
    return previos.length ? Math.max(...previos) : null;
};

export async function fijarParticipacion(sb, usuarioId, anio, participa) {
    const { error } = await sb.rpc("fijar_participacion", { p_usuario: usuarioId, p_anio: anio, p_participa: participa });
    lanzar(error);
}

// Copia al año las personas activas del año anterior; devuelve cuántas agregó.
export async function copiarParticipantes(sb, desde, hacia) {
    const { data, error } = await sb.rpc("copiar_participantes", { p_desde: desde, p_hacia: hacia });
    lanzar(error);
    return Number(data) || 0;
}

export async function usoAlmacenamiento(sb) {
    const { data, error } = await sb.rpc("uso_almacenamiento");
    lanzar(error);
    return (Array.isArray(data) ? data[0] : data) || { usado: 0, cuota: 0, archivos: 0 };
}

// Respaldo completo de los datos en JSON (solo superadmin). Los archivos se respaldan aparte.
export async function exportarRespaldo(sb) {
    const { data, error } = await sb.rpc("exportar_respaldo");
    lanzar(error);
    return data;
}

export const textoTamano = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

// Plantilla de carga masiva: encabezados + las personas actuales (para completar lo que falta)
// y, debajo, filas libres para agregar personas nuevas.
export const ENCABEZADOS_PLANTILLA = ["correo", "apellidos y nombres", "cédula", "facultad", "carrera", "nombre"];

export function filasPlantilla(usuarios) {
    return [ENCABEZADOS_PLANTILLA, ...usuarios.map(u =>
        [u.email, u.apellidos_nombres || "", u.cedula || "", u.facultad || "", u.programa || "", u.nombre || ""])];
}

export const INSTRUCCIONES_PLANTILLA = [
    ["Cómo usar esta plantilla"],
    [""],
    ["1. En la hoja «Personas» ya están las personas actuales del sistema. Complete lo que falte (cédula, apellidos y nombres)."],
    ["2. Para agregar a alguien nuevo, escriba una fila debajo: solo el correo es obligatorio. Las personas nuevas se crean como docentes."],
    ["3. «Apellidos y nombres»: primero los apellidos, como se reporta a investigación. Ejemplo: SORNOZA PARRALES DIEGO RENATO."],
    ["4. «Cédula»: sin guiones ni espacios. La columna está en formato texto para conservar el cero inicial."],
    ["5. «Nombre» es como se ve en el ranking (p. ej. Diego Sornoza). Si lo deja vacío en una persona nueva, se arma con sus apellidos y nombres."],
    ["6. No cambie los encabezados ni el orden de las columnas. Los correos existentes no se modifican: sirven para encontrar a la persona."],
    ["7. Guarde el archivo y súbalo en Gestión > Cargar datos desde una tabla, o copie las filas y péguelas. Antes de guardar verá un resumen."],
];
