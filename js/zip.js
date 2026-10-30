/* Generación de archivos ZIP con JSZip, cargado solo al pedirlo (versión fija con SRI).
   Todo ocurre en el navegador: los archivos no pasan por ningún otro servidor. */
const LIBRERIA = {
    src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    integrity: "sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG",
};

function cargarJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise((ok, ko) => {
        const s = document.createElement("script");
        s.src = LIBRERIA.src; s.integrity = LIBRERIA.integrity; s.crossOrigin = "anonymous";
        s.onload = () => ok(window.JSZip);
        s.onerror = () => ko(new Error("No se pudo cargar el generador de ZIP. Revise su conexión."));
        document.head.append(s);
    });
}

const COMPRIMIBLE = /\.(json|csv|txt)$/i;     // los PDF e imágenes ya vienen comprimidos: se guardan tal cual

// Devuelve { agregar(ruta, contenido), generar() -> Promise<Blob> }.
export async function crearZip() {
    const JSZip = await cargarJSZip();
    const zip = new JSZip();
    return {
        agregar(ruta, contenido) {
            zip.file(ruta, contenido, { compression: COMPRIMIBLE.test(ruta) ? "DEFLATE" : "STORE", createFolders: false });
        },
        generar: () => zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: true }),
    };
}
