/* Ranking del IPCT: lo ven todos los usuarios autorizados (nunca el público).
   Solo cuentan evidencias validadas; el cálculo lo hace la base de datos. */
import { sb } from "./cliente.js";
import { iniciarPagina } from "./comun.js";
import { el, llenarAnios } from "./ui.js";
import { mensajeError } from "./catalogo.js";
import { cargarAnioInicio } from "./evidencias.js";
import { cargarRanking, cargarNiveles } from "./puntaje.js";

const $ = id => document.getElementById(id);
const anioActual = new Date().getFullYear();
const REFRESCO_MS = 60_000;          // el ranking se actualiza solo cada minuto

let perfil;

// «Nivel 1: 50 o más · Nivel 2: 40 a 49 · … · Sin nivel: menos de 20»
function textoLeyenda(niveles) {
    const orden = [...niveles].sort((a, b) => b.min_puntos - a.min_puntos);
    const partes = orden.map((n, i) => i === 0 ? `${n.nombre}: ${n.min_puntos} o más`
        : `${n.nombre}: ${n.min_puntos} a ${orden[i - 1].min_puntos - 1}`);
    const menor = orden[orden.length - 1];
    if (menor) partes.push(`Sin nivel: menos de ${menor.min_puntos}`);
    return partes.join(" · ");
}

async function actualizar() {
    const anio = parseInt($("f-anio").value, 10);
    try {
        const filas = await cargarRanking(sb, anio);
        $("filas").replaceChildren(...filas.map(f => el("tr", f.usuario_id === perfil.id ? { class: "fila-propia" } : {},
            el("td", {}, String(f.posicion)),
            el("td", {}, f.nombre, f.usuario_id === perfil.id ? " (usted)" : ""),
            el("td", {}, String(f.ii)), el("td", {}, String(f.iid)), el("td", {}, String(f.ivs)),
            el("td", {}, el("strong", {}, String(f.total))),
            el("td", {}, el("span", { class: "estado " + (f.nivel === "Sin nivel" ? "estado-pendiente" : "estado-validada") }, f.nivel)))));
        $("vacio").hidden = filas.length > 0;
        $("mensaje").hidden = true;
        $("actualizado").textContent = "Actualizado a las " + new Date().toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
        $("mensaje").textContent = "No se pudo cargar el ranking. " + mensajeError(e);
        $("mensaje").className = "aviso aviso-error";
        $("mensaje").hidden = false;
    }
}

async function iniciar() {
    perfil = await iniciarPagina();
    if (!perfil) return;
    try {
        const [desde, niveles] = await Promise.all([cargarAnioInicio(sb, anioActual), cargarNiveles(sb)]);
        llenarAnios($("f-anio"), desde, anioActual);
        $("leyenda").textContent = textoLeyenda(niveles);
    } catch (e) {
        $("cargando").textContent = "No se pudo cargar la información. " + mensajeError(e);
        return;
    }
    $("cargando").hidden = true;
    $("contenido").hidden = false;
    $("f-anio").addEventListener("change", actualizar);
    $("btn-actualizar").addEventListener("click", actualizar);
    // Se actualiza cada minuto y al volver a la pestaña, sin gastar consultas con la pestaña oculta.
    setInterval(() => { if (document.visibilityState === "visible") actualizar(); }, REFRESCO_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") actualizar(); });
    await actualizar();
}

iniciar();
