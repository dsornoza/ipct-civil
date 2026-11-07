/* Aval de la Comisión de Investigación para obras que son resultado de un proyecto
   (artículos, libros, capítulos, ponencias, patentes y software/propiedad intelectual).
   Se genera al validar la evidencia, se imprime, se firma, se escanea y se adjunta con la función «aval».
   La lógica es pura (se prueba con node); el PDF usa jsPDF cargado bajo demanda. */
import { cargarLibrerias } from "./pdf.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Cómo se nombra la obra en el texto del aval, según el tipo de evidencia.
const OBRAS = {
    articulo: { obj: "artículo", art: "el", mencionado: "mencionado" },
    libro: { obj: "libro", art: "el", mencionado: "mencionado" },
    capitulo: { obj: "capítulo de libro", art: "el", mencionado: "mencionado" },
    ponencia: { obj: "ponencia", art: "la", mencionado: "mencionada" },
    registro: { obj: "registro de propiedad intelectual", art: "el", mencionado: "mencionado" },
};

export function obraDe(tipo) {
    const g = (tipo && tipo.grupo_dedup) || "";
    if (tipo && tipo.id === "lib_inv") return OBRAS.libro;
    if (g === "capitulo") return OBRAS.capitulo;
    if (g === "ponencia") return OBRAS.ponencia;
    if (g === "patente" || g === "software") return OBRAS.registro;
    return OBRAS.articulo;
}

// ¿Esta evidencia lleva aval? Solo validadas, del autor titular, que el docente declaró derivadas de un proyecto.
export function llevaAval(e) {
    return Boolean(e && e.estado === "validada" && !e.titular_id && e.datos && e.datos.deriva_proyecto === "Sí");
}

const sinTildes = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const mayusSeguro = t => sinTildes(t).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Firmantes propuestos: los miembros de la Comisión salvo los que son autores o coautores de la obra.
   miembros: ids de usuario guardados en el ajuste «comision_miembros»; autores: ids de los autores de la obra. */
export function firmantesPropuestos(miembros, autores, usuarios) {
    const porId = new Map(usuarios.map(u => [u.id, u]));
    const propuestos = [], excluidos = [];
    for (const id of miembros) {
        const u = porId.get(id);
        if (!u || u.activo === false) continue;
        (autores.includes(id) ? excluidos : propuestos).push(u);
    }
    return { propuestos, excluidos };
}

export function leerMiembros(valor) {
    try {
        const v = JSON.parse(valor || "[]");
        return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
    } catch { return []; }
}

/* Datos del aval a partir de la evidencia titular y su grupo de coautoría.
   grupo: [{nombre, posicion}] (autor titular y coautores). */
export function datosAval(e, tipo, grupo, firmantes, fecha) {
    const d = e.datos || {};
    const autores = [...(grupo || [])].sort((a, b) => (a.posicion || 99) - (b.posicion || 99)).map(m => m.nombre).filter(Boolean);
    return {
        obra: obraDe(tipo),
        titulo: String(d.titulo || d.nombre || "").trim(),
        autores,
        tipoProyecto: d.tipo_proyecto || "",
        proyecto: String(d.proyecto_titulo || "").trim(),
        // Cada firmante lleva su cargo: «Revisor» o «Responsable de la Comisión».
        firmantes: firmantes.map(f => (typeof f === "string" ? { nombre: f, cargo: CARGO_REVISOR } : { nombre: f.nombre, cargo: f.cargo || CARGO_REVISOR })).filter(f => f.nombre),
        fecha,
    };
}

export function fraseFecha(fecha) {
    const dia = fecha.getDate();
    return `${dia === 1 ? "al primer día" : `a los ${dia} días`} del mes de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
}

// Texto completo del aval (se separa del dibujo para poder probarlo).
export function textoAval(a) {
    const { obj, art, mencionado } = a.obra;
    return {
        titulo: "AVAL CIENTÍFICO",
        intro: `La Comisión de Investigación de la Carrera de Ingeniería Civil de la Universidad Estatal del Sur de Manabí, en ejercicio de sus atribuciones y en verificación de sus proyectos de investigación y vinculación institucionales, emite el presente aval científico respecto del siguiente ${obj}:`,
        obra: `“${a.titulo}”`,
        datosObra: `Datos del ${obj}:`,
        datosProyecto: "Datos del proyecto de investigación o vinculación:",
        certifica: `Que, tras el análisis correspondiente, ${art} ${obj} antes ${mencionado} ES resultado del proyecto de investigación o de vinculación institucional arriba señalado.`,
        alcance: `El presente aval certifica exclusivamente la relación ${art === "el" ? "del" : "de la"} ${obj} con el proyecto señalado y no constituye un juicio sobre la calidad científica ni el contenido de la obra. Se emite para constancia y archivo de la Comisión, y podrá entregarse a quien acredite interés legítimo sobre ${art} ${obj} en mención.`,
        emision: `Se emite el presente aval en la ciudad de Jipijapa, ${fraseFecha(a.fecha)}.`,
    };
}

export const nombreArchivoAval = (a, anio) => `AVAL-${mayusSeguro(a.obra.obj)}-${anio}-${mayusSeguro(a.autores[0] || "autor")}.pdf`;

function cargarImagen(ruta, formato) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext("2d").drawImage(img, 0, 0);
                resolve(formato === "PNG" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92));
            } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = ruta;
    });
}

export const CARGO_REVISOR = "Revisor", CARGO_RESPONSABLE = "Responsable de la Comisión";

/* Dibuja el aval sobre el membrete de la carrera (hoja A4) y lo descarga.
   Siempre una sola hoja: si el texto es largo, se reduce la letra hasta que quepa.
   Las firmas (3 revisores y el responsable de la Comisión) van en dos filas a una altura fija,
   para poder firmar un lote de avales de forma electrónica. */
export async function generarAval(a, { rutaMembrete, rutaLogo, anio } = {}) {
    await cargarLibrerias();
    const { jsPDF } = window.jspdf;
    const W = 210, H = 297, M = 28, ANCHO = W - 2 * M;
    const t = textoAval(a);
    const fondo = rutaMembrete ? await cargarImagen(rutaMembrete, "JPEG") : null;
    const logo = rutaLogo ? await cargarImagen(rutaLogo, "PNG") : null;     // logo de la Comisión, arriba a la derecha (como en el Word)
    const INICIO = 56;
    const FIRMAS_Y = [222, 240];                           // altura fija de la línea de cada fila de firmas
    const LIMITE = FIRMAS_Y[0] - 8;                        // el texto nunca invade la zona de firmas
    const NEGRO = [0, 0, 0];

    // Dibuja todo menos las firmas; devuelve la altura final. «f» reduce letra e interlineado.
    const cuerpo = (doc, f) => {
        let y = INICIO;
        const lh = 5 * f;
        const parrafo = (txt, { negrita = false, centrado = false, tam = 10.5, sep = 2.5, justificado = true } = {}) => {
            doc.setFont("helvetica", negrita ? "bold" : "normal").setFontSize(tam * f).setTextColor(...NEGRO);
            const lineas = doc.splitTextToSize(txt, ANCHO);
            if (centrado) doc.text(lineas, W / 2, y, { align: "center" });
            else if (justificado && lineas.length > 1) doc.text(txt, M, y, { maxWidth: ANCHO, align: "justify" });
            else doc.text(lineas, M, y);
            y += lineas.length * lh + sep * f;
        };
        const fila = (k, v) => {
            doc.setFont("helvetica", "normal").setFontSize(10 * f);
            const lineas = doc.splitTextToSize(v || "", ANCHO - 54);
            const h = Math.max(8 * f, lineas.length * lh + 3 * f);
            doc.setDrawColor(120, 120, 120).setLineWidth(0.2).rect(M, y, 50, h).rect(M + 50, y, ANCHO - 50, h);
            doc.setFont("helvetica", "bold").text(k, M + 2, y + 5.3 * f);
            doc.setFont("helvetica", "normal").text(lineas, M + 52, y + 5.3 * f);
            y += h;
        };
        parrafo(t.titulo, { negrita: true, centrado: true, tam: 14, sep: 5 });
        parrafo(t.intro);
        parrafo(t.obra, { negrita: true, centrado: true, sep: 5 });
        parrafo(t.datosObra, { negrita: true, justificado: false, sep: 2 });
        fila("Autor(es) UNESUM:", a.autores.join("; "));
        y += 6 * f;
        parrafo(t.datosProyecto, { negrita: true, justificado: false, sep: 2 });
        fila("Tipo de proyecto:", `(${a.tipoProyecto === "Investigación" ? "X" : "  "}) Investigación      (${a.tipoProyecto === "Vinculación" ? "X" : "  "}) Vinculación`);
        fila("Nombre del proyecto:", a.proyecto);
        y += 6 * f;
        parrafo("CERTIFICA:", { negrita: true, centrado: true, sep: 4 });
        parrafo(t.certifica);
        parrafo(t.alcance);
        parrafo(t.emision, { sep: 0 });
        return y;
    };

    // Se elige la letra más grande con la que todo el texto cabe sobre la zona de firmas.
    const prueba = new jsPDF({ unit: "mm", format: "a4" });
    let factor = 1;
    while (factor > 0.6 && cuerpo(prueba, factor) > LIMITE) factor = Math.round((factor - 0.03) * 100) / 100;

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    if (fondo) doc.addImage(fondo, "JPEG", 0, 0, W, H);
    if (logo) doc.addImage(logo, "PNG", W - 20 - 66.85, 22, 66.85, 19.76);
    cuerpo(doc, factor);

    // Firmas: dos por fila (la última, si queda sola, centrada); los revisores primero y el responsable al final.
    const orden = [...a.firmantes.filter(f => f.cargo !== CARGO_RESPONSABLE), ...a.firmantes.filter(f => f.cargo === CARGO_RESPONSABLE)];
    const colAncho = (ANCHO - 8) / 2;
    for (let i = 0; i < orden.length && i < 4; i += 2) {
        const ly = FIRMAS_Y[i / 2];
        const grupo = orden.slice(i, i + 2);
        grupo.forEach((f, j) => {
            const x = grupo.length === 1 ? W / 2 - colAncho / 2 : M + j * (colAncho + 8);
            doc.setDrawColor(0, 0, 0).setLineWidth(0.3).line(x, ly, x + colAncho, ly);
            doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...NEGRO)
                .text(doc.splitTextToSize(f.nombre, colAncho), x + colAncho / 2, ly + 5, { align: "center" });
            doc.setFont("helvetica", "normal").setFontSize(9).text(f.cargo || CARGO_REVISOR, x + colAncho / 2, ly + 9.5, { align: "center" });
        });
    }
    doc.save(nombreArchivoAval(a, anio || a.fecha.getFullYear()));
}
