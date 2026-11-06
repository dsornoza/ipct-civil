/* Formulario de una evidencia (campos del tipo, archivos por función, autoría y coautores).
   Lo comparten «Mis evidencias» (el docente) y «Registrar para un docente» (la Comisión): ambas
   páginas usan los mismos elementos (#campos, #bloque-archivos, #bloque-autoria, #lista-coautores…). */
import { el, aviso, campoFormulario } from "./ui.js";
import { agruparCatalogo, normalizarDatos, validarArchivo, archivosDe, archivosFaltantes, camposVisibles } from "./catalogo.js";

const $ = id => document.getElementById(id);

// Una etiqueta de archivo sin el detalle entre paréntesis: «Artículo completo en PDF».
export const etiquetaCorta = etiqueta => etiqueta.split("(")[0].trim();

// Menú de tipos de actividad agrupado por indicador y bloque.
export function construirMenuTipos(sel, catalogo) {
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

export function construirArchivos(tipo, evidencia) {
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

export function filaCoautor(docentes, c = {}) {
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

// Autoría (posición y coautores). `evidencia.coautores` trae los coautores guardados al editar.
export function construirAutoria(tipo, evidencia, docentes) {
    const admite = Boolean(tipo.esquema.coautores);
    $("bloque-autoria").hidden = !admite;
    if (!admite) return;
    const aut = (evidencia && evidencia.autoria) || {};
    $("aut-posicion").value = aut.posicion || "";
    $("aut-participacion").value = aut.participacion || "Autor";
    $("lista-coautores").replaceChildren(...((evidencia && evidencia.coautores) || []).map(c => filaCoautor(docentes, c)));
}

// Campos del formulario. Los que dependen de otra respuesta («mostrar_si», p. ej. el nombre del
// proyecto) aparecen y desaparecen al cambiar esa respuesta.
export const valoresActuales = campos => Object.fromEntries(campos.map(c => [c.nombre, ($("campo-" + c.nombre) || {}).value || ""]));

export function construirCampos(tipo, datos) {
    const campos = tipo.esquema.campos;
    const cajas = campos.map(c => {
        const caja = campoFormulario(c, datos[c.nombre]);
        caja.dataset.campo = c.nombre;
        return caja;
    });
    $("campos").replaceChildren(...cajas);
    const actualizar = () => {
        const visibles = new Set(camposVisibles(campos, valoresActuales(campos)).map(c => c.nombre));
        cajas.forEach(caja => { caja.hidden = !visibles.has(caja.dataset.campo); });
    };
    $("campos").onchange = actualizar;
    actualizar();
}

// Solo los campos visibles: lo que quedó oculto (p. ej. el proyecto si respondió «No») no se guarda.
export function leerValores(tipo) {
    const todos = valoresActuales(tipo.esquema.campos);
    const valores = {};
    for (const c of camposVisibles(tipo.esquema.campos, todos)) valores[c.nombre] = todos[c.nombre];
    return valores;
}

// Coautores del formulario; null si hay un error (ya mostrado).
export function leerCoautores(docentes) {
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

/* Valida y lee todo el formulario. Devuelve { datos, archivos, autoria, coautores } o null si hay un
   error (ya mostrado en #mensaje-form). editando: la evidencia en edición (sus archivos ya cuentan). */
export async function leerFormulario(tipo, { editando = null, docentes = [], maxBytes }) {
    const datos = normalizarDatos(leerValores(tipo));
    for (const c of camposVisibles(tipo.esquema.campos, datos)) {
        if (c.requerido && !datos[c.nombre]) { aviso("mensaje-form", `Falta el campo obligatorio: ${c.etiqueta}.`); return null; }
    }
    // Un archivo por función: obligatorios y formato.
    const archivos = {};
    for (const a of archivosDe(tipo, "docente")) {
        const f = $("archivo-" + a.rol).files[0] || null;
        if (f) {
            const err = await validarArchivo(f, maxBytes);
            if (err) { aviso("mensaje-form", `${etiquetaCorta(a.etiqueta)}: ${err}`); return null; }
            archivos[a.rol] = f;
        }
    }
    const presentes = ((editando && editando.archivos) || []).concat(Object.keys(archivos).map(rol => ({ rol, origen: "docente" })));
    const faltan = archivosFaltantes(tipo, presentes, "docente");
    if (faltan.length) { aviso("mensaje-form", `Falta adjuntar: ${faltan.map(a => etiquetaCorta(a.etiqueta)).join("; ")}.`); return null; }

    let autoria, coautores = null;
    if (tipo.esquema.coautores) {
        const posicion = parseInt($("aut-posicion").value, 10);
        if (!posicion) { aviso("mensaje-form", "Indique la posición entre los autores."); return null; }
        autoria = { posicion, participacion: $("aut-participacion").value };
        coautores = leerCoautores(docentes);
        if (coautores === null) return null;
    }
    return { datos, archivos, autoria, coautores };
}
