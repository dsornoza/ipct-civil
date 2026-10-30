/* Utilidades de interfaz compartidas. Los textos siempre se insertan como
   texto (nunca como HTML) para evitar inyección de código. */

// Crea un elemento: el("button", { class: "boton", onclick: fn }, "Texto")
export function el(tag, props = {}, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "class") e.className = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
    }
    for (const h of hijos) e.append(h);
    return e;
}

// Muestra un mensaje en el párrafo con el id dado ("ok" en verde; si no, error). Texto vacío lo oculta.
export function aviso(id, texto, tipo) {
    const p = document.getElementById(id);
    p.textContent = texto || "";
    p.hidden = !texto;
    p.className = tipo === "ok" ? "aviso aviso-ok" : "aviso aviso-error";
}

// Llena un selector de años, del más reciente al más antiguo.
export function llenarAnios(select, desde, valor, hasta = new Date().getFullYear()) {
    select.replaceChildren();
    for (let a = hasta; a >= desde; a--) select.append(el("option", { value: a }, String(a)));
    select.value = String(valor);
}

export const fechaCorta = iso => new Date(iso).toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric" });
export const fechaHora = iso => new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" });

// Campo de formulario según su definición {nombre, etiqueta, tipo, requerido, opciones, ayuda}.
// El id es «prefijo + nombre» (por defecto «campo-»).
export function campoFormulario(c, valor, prefijo = "campo-") {
    const id = prefijo + c.nombre;
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
