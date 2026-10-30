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

function construirLibro(X, hojas) {
    const libro = X.utils.book_new();
    for (const h of hojas) {
        const hoja = X.utils.aoa_to_sheet(h.filas, { cellDates: true });
        for (const ref of Object.keys(hoja)) {
            if (ref[0] !== "!" && hoja[ref].t === "d") hoja[ref].z = "dd/mm/yyyy";   // día/mes/año
        }
        // Columnas de texto (p. ej. cédulas): se fuerza el formato texto hasta «filasTexto» para que Excel
        // no quite el cero inicial al escribir un número.
        for (const c of h.textoCols || []) {
            for (let r = 0; r < Math.max(h.filas.length, h.filasTexto || 0); r++) {
                const ref = X.utils.encode_cell({ r, c });
                if (!hoja[ref]) hoja[ref] = { t: "s", v: "" };
                hoja[ref].z = "@";
            }
            const fin = X.utils.decode_range(hoja["!ref"]);
            fin.e.r = Math.max(fin.e.r, (h.filasTexto || 0) - 1);
            hoja["!ref"] = X.utils.encode_range(fin);
        }
        if (h.merges) hoja["!merges"] = h.merges;
        hoja["!cols"] = anchosDe(h.filas.slice(0, 200));
        X.utils.book_append_sheet(libro, hoja, h.nombre.slice(0, 31));
    }
    return libro;
}

/* hojas: [{ nombre, filas: matriz de celdas (texto, número o Date), merges?: [{s:{r,c}, e:{r,c}}], textoCols?, filasTexto? }] */
export async function descargarExcel(nombreArchivo, hojas) {
    const X = await cargarXlsx();
    X.writeFile(construirLibro(X, hojas), nombreArchivo, { cellDates: true });
}

// Igual que descargarExcel, pero devuelve los bytes del .xlsx (para incluirlos en un ZIP).
export async function generarExcel(hojas) {
    const X = await cargarXlsx();
    return X.write(construirLibro(X, hojas), { type: "array", bookType: "xlsx", cellDates: true });
}

// Lee la primera hoja de un .xlsx y la devuelve como texto separado por tabulaciones
// (el mismo formato que se pega desde Excel). Las celdas vacías quedan vacías.
export async function leerExcel(archivo) {
    const X = await cargarXlsx();
    const libro = X.read(await archivo.arrayBuffer(), { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = X.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" });
    return filas.filter(f => f.some(c => String(c).trim() !== "")).map(f => f.map(c => String(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}
