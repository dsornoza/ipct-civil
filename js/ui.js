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
