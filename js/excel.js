/* Generación de archivos Excel (.xlsx) con SheetJS, cargado solo al pedirlo.
   Versión fija con comprobación de integridad (SRI). Todo ocurre en el navegador:
   los datos no salen del equipo. */
const LIBRERIA = {
    src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    integrity: "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw",
};

function cargarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((ok, ko) => {
        const s = document.createElement("script");
        s.src = LIBRERIA.src; s.integrity = LIBRERIA.integrity; s.crossOrigin = "anonymous";
        s.onload = () => ok(window.XLSX);
        s.onerror = () => ko(new Error("No se pudo cargar el generador de Excel. Revise su conexión."));
        document.head.append(s);
    });
}

// Ancho de cada columna según su contenido (con un tope para no hacerlas enormes).
export function anchosDe(filas, tope = 60) {
    const n = Math.max(0, ...filas.map(f => f.length));
    return Array.from({ length: n }, (_, c) => ({
        wch: Math.min(tope, Math.max(8, ...filas.map(f => (f[c] instanceof Date ? 10 : String(f[c] ?? "").length)))),
    }));
}

/* hojas: [{ nombre, filas: matriz de celdas (texto, número o Date), merges?: [{s:{r,c}, e:{r,c}}], congelar?: nº de filas }] */
export async function descargarExcel(nombreArchivo, hojas) {
    const X = await cargarXlsx();
    const libro = X.utils.book_new();
    for (const h of hojas) {
        const hoja = X.utils.aoa_to_sheet(h.filas, { cellDates: true });
        for (const ref of Object.keys(hoja)) {
            if (ref[0] !== "!" && hoja[ref].t === "d") hoja[ref].z = "dd/mm/yyyy";   // día/mes/año
        }
        if (h.merges) hoja["!merges"] = h.merges;
        hoja["!cols"] = anchosDe(h.filas.slice(0, 200));
        X.utils.book_append_sheet(libro, hoja, h.nombre.slice(0, 31));
    }
    X.writeFile(libro, nombreArchivo, { cellDates: true });
}
