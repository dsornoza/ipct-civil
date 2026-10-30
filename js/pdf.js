/* Reporte PDF del IPCT. Reutiliza el estilo del simulador: logo de la Comisión,
   cabeceras verdes y filas alternas grises. jsPDF se carga solo al pedir el PDF. */

// Versiones fijadas con comprobación de integridad (SRI).
const LIBRERIAS = [
    { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
      integrity: "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk" },
    { src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js",
      integrity: "sha384-vuyrTV5nkscLp1knFvt+FIHfKKzmROBq5reruhMRslauj54mW+l2B8b6szMN6lCL" },
];

function cargarScript({ src, integrity }) {
    return new Promise((ok, ko) => {
        const s = document.createElement("script");
        s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous";
        s.onload = ok; s.onerror = () => ko(new Error("No se pudo cargar el generador de PDF. Revise su conexión."));
        document.head.append(s);
    });
}

async function cargarLibrerias() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return;
    for (const lib of LIBRERIAS) await cargarScript(lib);   // en orden: el plugin necesita jsPDF
}

function cargarLogo(ruta) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            try {
                // Se reduce a 600 px de ancho: basta para el PDF y evita archivos de varios MB.
                const escala = Math.min(1, 600 / img.naturalWidth);
                const c = document.createElement("canvas");
                c.width = Math.round(img.naturalWidth * escala); c.height = Math.round(img.naturalHeight * escala);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                resolve({ data: c.toDataURL("image/png"), w: c.width, h: c.height });
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = ruta;
    });
}

const VERDE = [0, 104, 48], VERDE_OSC = [0, 80, 32], TEXTO = [51, 51, 51], GRIS = [88, 91, 90], BORDE = [201, 204, 203], SUAVE = [236, 237, 238];

const quitarTildes = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const nombreArchivo = nombre => "IPCT-" + (nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "docente");

/* datos: { nombre, anio, fecha: Date, total, nivel, ii, iid, ivs,
            indicadores: salida de agruparDetalle, estimulos: [texto], fuente: texto,
            minimoNivel: número, rutaLogo } */
export async function generarReporteDocente(datos) {
    await cargarLibrerias();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 15;
    const fecha = datos.fecha.toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric" });

    const logo = await cargarLogo(datos.rutaLogo);
    if (logo) { const h = 14; doc.addImage(logo.data, "PNG", M, 10, h * logo.w / logo.h, h); }
    doc.setDrawColor(...VERDE).setLineWidth(0.8).line(M, 30, W - M, 30);

    doc.setTextColor(...VERDE_OSC).setFont("helvetica", "bold").setFontSize(16).text("Reporte del IPCT", M, 40);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...GRIS)
        .text("Índice de Producción Científica y Tecnológica — UNESUM · Solo evidencias validadas", M, 46);

    doc.setTextColor(...TEXTO).setFontSize(10);
    [["Docente:", datos.nombre], ["Año de evaluación:", String(datos.anio)], ["Fecha del reporte:", fecha]].forEach(([k, v], i) => {
        doc.setFont("helvetica", "bold").text(k, M, 56 + i * 6);
        doc.setFont("helvetica", "normal").text(v, M + 38, 56 + i * 6);
    });

    doc.setFillColor(...SUAVE).rect(M, 74, W - 2 * M, 22, "F");
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...GRIS).text("IPCT VALIDADO", M + 6, 82);
    doc.setFontSize(24).setTextColor(...VERDE_OSC).text(String(datos.total), M + 6, 92);
    doc.setFontSize(10).setTextColor(...GRIS).text("NIVEL", M + 60, 82);
    doc.setFontSize(18).setTextColor(...TEXTO).text(datos.nivel, M + 60, 92);
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(...GRIS)
        .text(`Ii: ${datos.ii}   |   IiD: ${datos.iid}   |   IVs: ${datos.ivs}`, W - M - 6, 92, { align: "right" });

    let y = 104;
    for (const ind of datos.indicadores) {
        const body = [];
        for (const b of ind.bloques) {
            for (const f of b.filas) {
                body.push([f.tipo_nombre, f.detalle, String(f.puntos_unidad), f.computada ? "Sí" : "No (tope)", String(f.puntos)]);
            }
        }
        body.push([{ content: ind.total, colSpan: 4, styles: { fontStyle: "bold", halign: "right" } },
                   { content: String(ind.puntos), styles: { fontStyle: "bold" } }]);
        doc.autoTable({
            startY: y, margin: { left: M, right: M, bottom: 24 },
            head: [[ind.nombre, "Detalle", "Pts/unidad", "Computa", "Puntos"]], body, theme: "grid",
            styles: { font: "helvetica", fontSize: 9, cellPadding: 2, lineColor: BORDE, textColor: TEXTO },
            alternateRowStyles: { fillColor: SUAVE },
            headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" },
            columnStyles: { 2: { halign: "center", cellWidth: 20 }, 3: { halign: "center", cellWidth: 22 }, 4: { halign: "center", cellWidth: 18 } },
            didParseCell: d => { if (d.section === "head" && d.column.index > 1) d.cell.styles.halign = "center"; },
        });
        y = doc.lastAutoTable.finalY + 3;
        for (const b of ind.bloques.filter(x => x.nota)) {
            const lineas = doc.splitTextToSize("Nota — " + b.nota, W - 2 * M);
            if (y + lineas.length * 4 > H - 24) { doc.addPage(); y = 20; }
            doc.setFont("helvetica", "italic").setFontSize(8.5).setTextColor(...TEXTO).text(lineas, M, y + 3);
            y += lineas.length * 4 + 3;
        }
        y += 5;
    }
    if (!datos.indicadores.length) {
        doc.setFont("helvetica", "italic").setFontSize(10).setTextColor(...GRIS).text("Aún no hay evidencias validadas en este año.", M, y);
        y += 10;
    }

    const titulo = datos.nivel === "Sin nivel" ? "Estímulos (ningún nivel alcanzado)" : `Estímulos del ${datos.nivel} (Art. 8)`;
    if (y + 12 + datos.estimulos.length * 12 > H - 24) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...TEXTO).text(titulo, M, y);
    y += 6;
    doc.setFont("helvetica", "normal").setFontSize(9.5);
    const lineasEst = datos.estimulos.length ? datos.estimulos.map(e => "• " + e)
        : [`Se requieren al menos ${datos.minimoNivel} puntos para acceder a un nivel.`];
    for (const t of lineasEst) {
        const l = doc.splitTextToSize(t, W - 2 * M - 4);
        doc.text(l, M + 2, y);
        y += l.length * 5 + 1;
    }

    const paginas = doc.internal.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
        doc.setPage(p);
        doc.setDrawColor(...BORDE).setLineWidth(0.3).line(M, H - 20, W - M, H - 20);
        doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GRIS);
        doc.text(doc.splitTextToSize("Reporte generado por el sistema del IPCT de la Carrera de Ingeniería Civil con evidencias validadas por la Comisión de Investigación. Fuente: " + datos.fuente + ".", W - 2 * M - 20), M, H - 16);
        doc.text(`Página ${p} de ${paginas}`, W - M, H - 16, { align: "right" });
    }
    doc.save(nombreArchivo(datos.nombre) + `-${datos.anio}.pdf`);
}

/* Informe estadístico del programa para coordinación y aseguramiento de la calidad.
   datos: { programa, anio, fecha: Date, est: salida de estadisticas(), evolucion: salida de evolucionPrograma(),
            ranking: filas de ranking(), fuente, rutaLogo, firmas: [{nombre, cargo}] (opcional) } */
export async function generarInformePrograma(datos) {
    await cargarLibrerias();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 15;
    const { est } = datos;
    const fecha = datos.fecha.toLocaleDateString("es-EC", { year: "numeric", month: "long", day: "numeric" });
    const tabla = (startY, head, body, extra = {}) => doc.autoTable({
        startY, margin: { left: M, right: M, bottom: 24 }, head: [head], body, theme: "grid",
        styles: { font: "helvetica", fontSize: 9, cellPadding: 2, lineColor: BORDE, textColor: TEXTO },
        alternateRowStyles: { fillColor: SUAVE }, headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold" }, ...extra });
    const titulo = (t, y) => { doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...VERDE_OSC).text(t, M, y); return y + 4; };
    const espacio = (y, alto) => { if (y + alto > H - 24) { doc.addPage(); return 20; } return y; };

    const logo = await cargarLogo(datos.rutaLogo);
    if (logo) { const h = 14; doc.addImage(logo.data, "PNG", M, 10, h * logo.w / logo.h, h); }
    doc.setDrawColor(...VERDE).setLineWidth(0.8).line(M, 30, W - M, 30);
    doc.setTextColor(...VERDE_OSC).setFont("helvetica", "bold").setFontSize(16).text("Informe del IPCT del programa", M, 40);
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...GRIS)
        .text(`${datos.programa} · Año de evaluación ${datos.anio} · Solo evidencias validadas · ${fecha}`, M, 46);

    // Resumen en cifras
    doc.setFillColor(...SUAVE).rect(M, 52, W - 2 * M, 22, "F");
    const cifras = [["DOCENTES", est.docentes], ["CON PUNTAJE", est.conPuntaje], ["IPCT PROMEDIO", est.total.media], ["MEDIANA", est.total.mediana], ["MÁXIMO", est.total.maximo]];
    cifras.forEach(([k, v], i) => {
        const x = M + 5 + i * ((W - 2 * M - 10) / cifras.length);
        doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(...GRIS).text(k, x, 60);
        doc.setFontSize(18).setTextColor(...VERDE_OSC).text(String(v), x, 70);
    });
    let y = 80;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...TEXTO);
    const notas = [`Desviación estándar: ${est.total.desviacion}. Mínimo: ${est.total.minimo}.`,
        `Promedio por indicador — Ii: ${est.promedios.ii}, IiD: ${est.promedios.iid}, IVs: ${est.promedios.ivs}.`,
        `Evidencias validadas: ${est.evidenciasValidadas}; no computadas por tope: ${est.noComputadas}.`];
    if (est.variacionPromedio !== null) notas.push(`Variación del promedio respecto al año anterior: ${est.variacionPromedio > 0 ? "+" : ""}${est.variacionPromedio}.`);
    for (const n of notas) { doc.text(n, M, y); y += 5; }
    y += 3;

    // Distribución por nivel con barras
    y = titulo("Distribución por nivel", y);
    for (const n of est.porNivel) {
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...TEXTO).text(n.nivel, M, y + 4);
        doc.setFillColor(...SUAVE).rect(M + 30, y, 100, 5, "F");
        if (n.pct > 0) doc.setFillColor(...VERDE).rect(M + 30, y, n.pct, 5, "F");
        doc.text(`${n.n} (${n.pct} %)`, M + 134, y + 4);
        y += 7;
    }
    y += 4;

    y = espacio(y, 30);
    y = titulo("Producción validada por actividad", y);
    tabla(y, ["Actividad", "Indicador", "Evidencias", "Computadas", "Docentes"],
        est.porBloque.map(b => [b.titulo, b.indicador, String(b.evidencias), String(b.computadas), String(b.docentes)]),
        { columnStyles: { 1: { halign: "center", cellWidth: 20 }, 2: { halign: "center", cellWidth: 22 }, 3: { halign: "center", cellWidth: 24 }, 4: { halign: "center", cellWidth: 20 } } });
    y = doc.lastAutoTable.finalY + 8;

    if (datos.evolucion && datos.evolucion.length) {
        y = espacio(y, 30);
        y = titulo("Evolución por año", y);
        tabla(y, ["Año", "Docentes", "Con puntaje", "IPCT promedio", "Máximo"],
            datos.evolucion.map(e => [String(e.anio), String(e.docentes), String(e.conPuntaje), String(e.media), String(e.maximo)]),
            { columnStyles: { 0: { cellWidth: 20 } } });
        y = doc.lastAutoTable.finalY + 8;
    }

    y = espacio(y, 30);
    y = titulo("Docentes", y);
    tabla(y, ["Pos.", "Docente", "Ii", "IiD", "IVs", "IPCT", "Nivel"],
        datos.ranking.map(r => [String(r.posicion), r.nombre, String(r.ii), String(r.iid), String(r.ivs), String(r.total), r.nivel]),
        { columnStyles: { 0: { cellWidth: 12, halign: "center" }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } } });

    // Bloque de firmas (se imprime y se firma, o se firma electrónicamente)
    const firmas = (datos.firmas || []).filter(f => f.nombre || f.cargo);
    if (firmas.length) {
        let fy = doc.lastAutoTable.finalY + 16;
        if (fy + 50 > H - 24) { doc.addPage(); fy = 30; }
        doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...VERDE_OSC).text("Firmas", M, fy);
        doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...GRIS).text(`Fecha: ${fecha}`, W - M, fy, { align: "right" });
        const ancho = (W - 2 * M - (firmas.length - 1) * 8) / firmas.length;
        firmas.forEach((f, i) => {
            const x = M + i * (ancho + 8), cx = x + ancho / 2, ly = fy + 28;
            doc.setDrawColor(...TEXTO).setLineWidth(0.3).line(x, ly, x + ancho, ly);
            doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...TEXTO).text(doc.splitTextToSize(f.nombre || "", ancho), cx, ly + 5, { align: "center" });
            doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...GRIS).text(doc.splitTextToSize(f.cargo || "", ancho), cx, ly + 10, { align: "center" });
        });
    }

    const paginas = doc.internal.getNumberOfPages();
    for (let p = 1; p <= paginas; p++) {
        doc.setPage(p);
        doc.setDrawColor(...BORDE).setLineWidth(0.3).line(M, H - 20, W - M, H - 20);
        doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...GRIS);
        doc.text(doc.splitTextToSize("Informe generado por el sistema del IPCT de la Carrera de Ingeniería Civil con evidencias validadas por la Comisión de Investigación. Fuente: " + datos.fuente + ".", W - 2 * M - 20), M, H - 16);
        doc.text(`Página ${p} de ${paginas}`, W - M, H - 16, { align: "right" });
    }
    doc.save(`IPCT-informe-programa-${quitarTildes(datos.programa).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${datos.anio}.pdf`);
}
