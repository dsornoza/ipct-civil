/* Informes: matrices de investigación (Excel), estadísticas del programa y CSV.
   Funciones puras (sin DOM ni red): se prueban con `node --test supabase/pruebas/js`.
   Las matrices replican los encabezados de los formatos que la Universidad pide a
   la carrera; solo salen evidencias VALIDADAS. */

const CODIGO_IES = 1025;

// ---------- utilidades ----------
const sinTildes = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "");
const vacio = v => v === undefined || v === null || String(v).trim() === "";
const texto = v => (vacio(v) ? "" : String(v).trim());
// Títulos: mayúsculas y sin tildes ni Ñ, como pide el formato.
export const mayusSinTildes = t => (vacio(t) ? "" : sinTildes(t).toUpperCase().replace(/\s+/g, " ").trim());
export const mayus = t => (vacio(t) ? "" : String(t).toUpperCase().replace(/\s+/g, " ").trim());
const siNo = b => (b ? "SI" : "NO");

// «2026-03-01» -> fecha (UTC) para la celda de Excel; vacío si no hay fecha.
export function fechaCelda(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : "";
}

export function doiUrl(doi) {
    const d = texto(doi);
    if (!d) return "";
    return /^https?:\/\//i.test(d) ? d : "https://doi.org/" + d.replace(/^doi:\s*/i, "");
}

// Apellidos y nombres como se reportan; si no se cargaron, el nombre con el que se muestra.
export const nombreMatriz = u => mayus((u && (u.apellidos_nombres || u.nombre)) || "");

// ---------- matrices de publicaciones ----------
export const ENCABEZADOS = {
    REVISTAS: ["CODIGO_IES", "TIPO_PUBLICACION", "TIPO_ARTICULO", "TITULO_PUBLICACION", "BASE_DATOS_INDEXADA", "CODIGO_ISSN", "NOMBRE_REVISTA", "NUMERO_REVISTA", "SJR", "FECHA_PUBLICACION", "código doi", "CAMPO_DETALLADO", "PUBLICADO", "LINK_PUBLICACION", "LINK_REVISTA", "FILIACION", "IDENTIFICACION_PARTICIPANTE", "PARTICIPACION", "CUARTIL", "LINEA_INVESTIGACION", "INTERCULTURALIDAD (SI o NO)", "APELLIDOS_NOMBRES", "POSICION", "PERIODO_ACADEMICO", "FACULTAD", "CARRERA", "RESULTADO DE PROYECTO DE INVESTIGACION", "RESULTADO DE PROYECTO DE VINCULACION", "TITULO_PROYECTO", "ESTADO_PROYECTO", "PDF_AVAL_CARTA_CERTIFICADO-PUBLICACION", "DOI"],
    LIBROS: ["CODIGO_IES", "TIPO_PUBLICACION", "TITULO_LIBRO", "CODIGO_ISBN", "FECHA_PUBLICACION", "CAMPO_DETALLADO", "REVISADO_PARES", "FILIACION", "IDENTIFICACION_PARTICIPANTE", "PARTICIPACION", "LINEA_INVESTIGACION", "APELLIDOS_NOMBRES", "POSICION", "ENLACE_LIBRO", "PERIODO_ACADEMICO", "FACULTAD", "CARRERA", "RESULTADO DE PROYECTO DE INVESTIGACION", "RESULTADO DE PROYECTO DE VINCULACION", "TITULO_PROYECTO", "ESTADO_PROYECTO", "PDF_AVAL_CARTA_CERTIFICADO-PUBLICACION"],
    CAPITULOS: ["CODIGO_IES", "TIPO_PUBLICACION", "TITULO_CAPITULO", "TITULO_LIBRO", "CODIGO_ISBN", "EDITOR_COMPILADOR", "PAGINAS (DESDE_23-45)", "FECHA_PUBLICACION", "CAMPO_DETALLADO", "FILIACION", "IDENTIFICACION_PARTICIPANTE", "PARTICIPACION", "LINEA_INVESTIGACION", "APELLIDOS_NOMBRES", "PERIODO_ACADEMICO", "FACULTAD", "CARRERA", "RESULTADO DE PROYECTO DE INVESTIGACION", "RESULTADO DE PROYECTO DE VINCULACION", "TITULO_PROYECTO", "ESTADO_PROYECTO", "PDF_AVAL_CARTA_CERTIFICADO-PUBLICACION"],
    PONENCIAS: ["CODIGO_IES", "TIPO_PUBLICACION", "TIPO_ARTICULO", "CODIGO_PUBLICACION", "NOMBRE_PONENCIA", "NOMBRE_EVENTOACION_PARTICIPANTE", "EDICION_EVENTO", "ORGANIZADOR_EVENTO", "COMITE_ORGANIZADOR", "PAIS", "CIUDAD", "FECHA_PUBLICACION (DÍA/MES/AÑO)", "CAMPO_DETALLADO", "IDENTIFICACION_PARTICIPANTE (NÚMERO DE CEDULA O PASAPORTE)", "APELLIDOS_NOMBRES", "PARTICIPACION", "LINEA_INVESTIGACION", "PERIODO ACADEMICO", "FACULTAD", "CARRERA", "RESULTADO DE PROYECTO DE INVESTIGACION", "RESULTADO DE PROYECTO DE VINCULACION", "TITULO DEL PROYECTO", "ESTADO DEL PROYECTO", "LINK DE EVIDENCIAS (GOOGLE DRIVE COMPARTIDO)", "CERTIFICADOS"],
};

// Qué grupo de tipos alimenta cada hoja.
export const HOJA_DE_GRUPO = { articulo: "REVISTAS", libro: "LIBROS", capitulo: "CAPITULOS", ponencia: "PONENCIAS" };

function contexto(e, usuario) {
    const d = e.datos || {}, v = e.datos_validacion || {}, a = e.autoria || {};
    return {
        d, v, a,
        cedula: texto(usuario && usuario.cedula),
        nombre: nombreMatriz(usuario),
        facultad: mayus(usuario && usuario.facultad),
        carrera: mayus(usuario && usuario.programa),
        resInv: siNo(v.resultado_de === "Proyecto de investigación"),
        resVinc: siNo(v.resultado_de === "Proyecto de vinculación"),
        proyecto: v.resultado_de && v.resultado_de !== "Ninguno" ? mayusSinTildes(v.proyecto_titulo) : "",
        estadoProyecto: v.resultado_de && v.resultado_de !== "Ninguno" ? mayus(v.proyecto_estado) : "",
        participacion: mayus(a.participacion),
        posicion: a.posicion === undefined || a.posicion === null || a.posicion === "" ? "" : Number(a.posicion),
    };
}

// Las columnas de enlaces a Drive («PDF_AVAL…», «CERTIFICADOS»…) las completa la Comisión:
// los archivos de este sistema son privados y no tienen enlace público.
const FILAS = {
    REVISTAS: c => [CODIGO_IES, "ARTICULO", "REVISTA", mayusSinTildes(c.d.titulo), texto(c.v.base), texto(c.v.issn), mayus(c.d.revista),
        texto(c.v.numero), texto(c.v.sjr), fechaCelda(c.v.fecha_publicacion), doiUrl(c.d.doi), texto(c.v.campo_detallado), "PUBLICADO",
        texto(c.d.url), texto(c.v.link_revista), "SI", c.cedula, c.participacion, texto(c.v.cuartil), mayus(c.v.linea),
        mayusSinTildes(c.v.interculturalidad) || "NO", c.nombre, c.posicion, texto(c.v.periodo), c.facultad, c.carrera, c.resInv, c.resVinc,
        c.proyecto, c.estadoProyecto, "", doiUrl(c.d.doi)],
    LIBROS: c => [CODIGO_IES, "LIBRO", mayusSinTildes(c.d.titulo), texto(c.d.isbn), fechaCelda(c.v.fecha_publicacion), texto(c.v.campo_detallado),
        mayusSinTildes(c.v.revisado_pares), "SI", c.cedula, c.participacion, mayus(c.v.linea), c.nombre, c.posicion, texto(c.d.url),
        texto(c.v.periodo), c.facultad, c.carrera, c.resInv, c.resVinc, c.proyecto, c.estadoProyecto, ""],
    // En capítulos y ponencias el formato usa la columna PARTICIPACION para la posición del autor.
    CAPITULOS: c => [CODIGO_IES, "CAPITULO", mayusSinTildes(c.d.titulo), mayusSinTildes(c.d.libro), texto(c.d.isbn), mayus(c.d.editor),
        texto(c.d.paginas), fechaCelda(c.v.fecha_publicacion), texto(c.v.campo_detallado), "SI", c.cedula, c.posicion, mayus(c.v.linea),
        c.nombre, texto(c.v.periodo), c.facultad, c.carrera, c.resInv, c.resVinc, c.proyecto, c.estadoProyecto, ""],
    PONENCIAS: c => [CODIGO_IES, "PONENCIA", "MEMORIA", texto(c.v.issn_isbn), mayusSinTildes(c.d.titulo), mayus(c.d.evento), mayus(c.d.edicion),
        mayus(c.d.organizador), mayus(c.d.comite), mayus(c.d.pais) || "ECUADOR", mayus(c.d.ciudad), fechaCelda(c.d.fecha_evento),
        texto(c.v.campo_detallado), c.cedula, c.nombre, c.posicion, mayus(c.v.linea), texto(c.v.periodo), c.facultad, c.carrera,
        c.resInv, c.resVinc, c.proyecto, c.estadoProyecto, "", ""],
};

// Devuelve { REVISTAS: {encabezados, filas}, LIBROS, CAPITULOS, PONENCIAS } con las evidencias validadas.
export function construirMatrices({ evidencias, usuarios, tipos }) {
    const usuario = Object.fromEntries(usuarios.map(u => [u.id, u]));
    const grupo = Object.fromEntries(tipos.map(t => [t.id, t.grupo_dedup]));
    const hojas = Object.fromEntries(Object.keys(ENCABEZADOS).map(k => [k, []]));
    for (const e of evidencias) {
        const hoja = HOJA_DE_GRUPO[grupo[e.tipo_id]];
        if (e.estado !== "validada" || !hoja) continue;
        const c = contexto(e, usuario[e.docente_id]);
        const orden = mayusSinTildes(c.d.titulo || c.d.nombre) + "|" + (c.posicion === "" ? 99 : String(c.posicion).padStart(3, "0")) + "|" + c.nombre;
        hojas[hoja].push({ orden, fila: FILAS[hoja](c) });
    }
    return Object.fromEntries(Object.entries(hojas).map(([k, lista]) => [k, {
        encabezados: ENCABEZADOS[k],
        filas: lista.sort((x, y) => x.orden.localeCompare(y.orden)).map(x => x.fila),
    }]));
}

// ---------- matriz de otras actividades de investigación ----------
const TIPO_TESIS = { tesis_doc: "Doctoral", tesis_mi: "Maestría de investigación", tesis_mp: "Maestría profesional" };
const DOC = "Documento de verificación";

export const CATEGORIAS = [
    { grupo: "comite", titulo: "Participación en comités o consejos académicos y editoriales de revistas científicas y académicas indexadas y de alto impacto.",
      sub: ["Institución y/o organización", "Nombre de revista", DOC], fila: (d) => [texto(d.institucion), texto(d.entidad), ""] },
    { grupo: "revisor", titulo: "Participación como  revisor de artículos indexados de una revista científica ",
      sub: ["Institución y/o organización", "Nombre de revista", DOC], fila: (d) => [texto(d.institucion), texto(d.revista), ""] },
    { grupo: "red", titulo: anio => `Miembro de alguna red  de investigación o asociación científica, durante el año ${anio}`,
      sub: ["Institución y/o organización", "Nombre de la Red a la que pertenece", DOC], fila: (d) => [texto(d.institucion), texto(d.nombre), ""] },
    { grupo: "premio", titulo: anio => `Haber recibido premios, distinciones o reconocimientos científicos nacional o internacional, durante el año ${anio}`,
      sub: ["Institución organizadora ", "Reconocimiento nacional o internacional", "Tipo de premio, distinción o reconocimiento científico", DOC],
      fila: (d) => [texto(d.entidad), texto(d.ambito), texto(d.nombre), ""] },
    { grupo: "tesis", titulo: anio => `Tutoría  de tesis doctorales o maestrías profesionales y de investigación durante  el año ${anio}`,
      sub: ["Título de tesis dirigida", "Tipo de tesis", DOC], fila: (d, tipoId) => [texto(d.titulo), TIPO_TESIS[tipoId] || "", ""] },
    { grupo: "patente", titulo: "Registro de la propiedad industrial y las obtenciones vegetales, producto de la investigación científica y tecnológica registradas en el SENADI",
      sub: ["Código o número", "Descripción", "Fecha de obtención"], fila: (d) => [texto(d.numero), texto(d.titulo), fechaCelda(d.fecha)] },
    { grupo: "software", titulo: "Registro de la propiedad de los prototipos y diseños, incluidos software, producto de la investigación científica y tecnológica registradas en el SENADI",
      sub: ["Código o número", "Descripción", "Fecha de obtención"], fila: (d) => [texto(d.numero), texto(d.titulo), fechaCelda(d.fecha)] },
];

const FIJAS = ["N°", "Apellidos y nombres", "Cédula de identidad", "Facultad", "Carrera"];

// Devuelve { filas: matriz de celdas, merges: [{s:{r,c}, e:{r,c}}] } con una fila de título,
// una de grupos, una de subcolumnas y, por docente, tantas filas como actividades tenga.
export function construirActividades({ evidencias, usuarios, tipos, anio }) {
    const usuario = Object.fromEntries(usuarios.map(u => [u.id, u]));
    const grupo = Object.fromEntries(tipos.map(t => [t.id, t.grupo_dedup]));
    const ancho = FIJAS.length + CATEGORIAS.reduce((n, c) => n + c.sub.length, 0);

    const filas = [Array(ancho).fill("")];
    filas[0][0] = `ACTIVIDADES DE INVESTIGACIÓN ${anio}`;
    const grupos = [...FIJAS], subs = Array(FIJAS.length).fill("");
    const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ancho - 1 } }];
    let col = FIJAS.length;
    for (const cat of CATEGORIAS) {
        grupos.push(typeof cat.titulo === "function" ? cat.titulo(anio) : cat.titulo, ...Array(cat.sub.length - 1).fill(""));
        subs.push(...cat.sub);
        merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + cat.sub.length - 1 } });
        col += cat.sub.length;
    }
    filas.push(grupos, subs);
    for (let c = 0; c < FIJAS.length; c++) merges.push({ s: { r: 1, c }, e: { r: 2, c } });

    // Actividades por docente y categoría
    const porDocente = {};
    for (const e of evidencias) {
        const g = grupo[e.tipo_id];
        const idx = CATEGORIAS.findIndex(c => c.grupo === g);
        if (e.estado !== "validada" || idx < 0 || !usuario[e.docente_id]) continue;
        const celdas = (porDocente[e.docente_id] ||= CATEGORIAS.map(() => []));
        celdas[idx].push(CATEGORIAS[idx].fila(e.datos || {}, e.tipo_id));
    }
    const ordenados = Object.keys(porDocente).sort((a, b) => nombreMatriz(usuario[a]).localeCompare(nombreMatriz(usuario[b])));
    ordenados.forEach((id, i) => {
        const u = usuario[id], listas = porDocente[id];
        const alto = Math.max(1, ...listas.map(l => l.length));
        const inicio = filas.length;
        for (let r = 0; r < alto; r++) {
            const fila = Array(ancho).fill("");
            if (r === 0) { fila[0] = i + 1; fila[1] = nombreMatriz(u); fila[2] = texto(u.cedula); fila[3] = texto(u.facultad); fila[4] = texto(u.programa); }
            let c = FIJAS.length;
            CATEGORIAS.forEach((cat, k) => {
                const item = listas[k][r];
                if (item) item.forEach((v, j) => { fila[c + j] = v; });
                c += cat.sub.length;
            });
            filas.push(fila);
        }
        if (alto > 1) for (let c = 0; c < FIJAS.length; c++) merges.push({ s: { r: inicio, c }, e: { r: inicio + alto - 1, c } });
    });
    return { filas, merges, docentes: ordenados.length };
}

// ---------- CSV ----------
export function aCsv(encabezados, filas) {
    const celda = v => {
        const t = v instanceof Date ? v.toISOString().slice(0, 10) : (v === undefined || v === null ? "" : String(v));
        return /[",\r\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    return [encabezados, ...filas].map(f => f.map(celda).join(",")).join("\r\n") + "\r\n";
}

const PRIMER_CAMPO = ["titulo", "nombre", "entidad", "revista", "estudiante"];
const resumen = d => { for (const k of PRIMER_CAMPO) if (!vacio(d && d[k])) return String(d[k]).trim(); return ""; };

// Un renglón por docente del ranking.
export function csvDocentes(ranking, detalle) {
    const por = {};
    for (const x of detalle) {
        const r = (por[x.docente_id] ||= { validadas: 0, noComputadas: 0 });
        r.validadas++;
        if (!x.computada) r.noComputadas++;
    }
    return {
        encabezados: ["Posición", "Docente", "Ii", "IiD", "IVs", "IPCT", "Nivel", "Evidencias validadas", "Evidencias no computadas por tope"],
        filas: ranking.map(r => [r.posicion, r.nombre, r.ii, r.iid, r.ivs, r.total, r.nivel,
            (por[r.usuario_id] || { validadas: 0 }).validadas, (por[r.usuario_id] || { noComputadas: 0 }).noComputadas]),
    };
}

// Un renglón por evidencia validada del programa.
export function csvEvidencias(detalle) {
    return {
        encabezados: ["Docente", "Indicador", "Actividad", "Detalle", "Puntos por unidad", "Computada"],
        filas: detalle.map(x => [x.docente, x.indicador, x.tipo_nombre, resumen(x.datos), x.puntos_unidad, x.computada ? "Sí" : "No (tope)"]),
    };
}

// ---------- estadísticas del programa ----------
const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function resumenNumerico(valores) {
    const n = valores.length;
    if (!n) return { n: 0, media: 0, mediana: 0, minimo: 0, maximo: 0, desviacion: 0 };
    const orden = [...valores].sort((a, b) => a - b);
    const media = valores.reduce((s, x) => s + x, 0) / n;
    const mediana = n % 2 ? orden[(n - 1) / 2] : (orden[n / 2 - 1] + orden[n / 2]) / 2;
    const varianza = n > 1 ? valores.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1) : 0;
    return { n, media: redondear(media), mediana: redondear(mediana), minimo: orden[0], maximo: orden[n - 1], desviacion: redondear(Math.sqrt(varianza)) };
}

// ranking: filas de ranking(anio); detalle: filas de reporte_detalle(anio); niveles: tabla niveles;
// rankingPrevio: ranking del año anterior (opcional).
export function estadisticas({ ranking, detalle, niveles, rankingPrevio = [] }) {
    const total = resumenNumerico(ranking.map(r => r.total));
    const ordenNiveles = [...niveles].sort((a, b) => b.min_puntos - a.min_puntos).map(n => n.nombre);
    const nombresNivel = [...ordenNiveles, ...new Set(ranking.map(r => r.nivel).filter(n => !ordenNiveles.includes(n)))];
    const porNivel = nombresNivel.map(nombre => {
        const n = ranking.filter(r => r.nivel === nombre).length;
        return { nivel: nombre, n, pct: ranking.length ? redondear((n / ranking.length) * 100) : 0 };
    });
    const media = campo => (ranking.length ? redondear(ranking.reduce((s, r) => s + r[campo], 0) / ranking.length) : 0);

    const bloques = {};
    for (const x of detalle) {
        const b = (bloques[x.bloque_titulo] ||= { titulo: x.bloque_titulo, indicador: x.indicador, evidencias: 0, computadas: 0, docentes: new Set() });
        b.evidencias++;
        if (x.computada) b.computadas++;
        b.docentes.add(x.docente_id);
    }
    const porBloque = Object.values(bloques).map(b => ({ ...b, docentes: b.docentes.size }))
        .sort((a, b) => b.evidencias - a.evidencias || a.titulo.localeCompare(b.titulo));

    const previo = rankingPrevio.length ? resumenNumerico(rankingPrevio.map(r => r.total)) : null;
    return {
        docentes: ranking.length,
        conPuntaje: ranking.filter(r => r.total > 0).length,
        total, porNivel,
        promedios: { ii: media("ii"), iid: media("iid"), ivs: media("ivs") },
        evidenciasValidadas: detalle.length,
        noComputadas: detalle.filter(x => !x.computada).length,
        porBloque,
        variacionPromedio: previo ? redondear(total.media - previo.media) : null,
    };
}

// Evolución del programa: un renglón por año con el promedio y cuántos tienen puntaje.
export function evolucionPrograma(rankingsPorAnio) {
    return Object.entries(rankingsPorAnio).map(([anio, ranking]) => {
        const r = resumenNumerico(ranking.map(x => x.total));
        return { anio: Number(anio), docentes: r.n, conPuntaje: ranking.filter(x => x.total > 0).length, media: r.media, maximo: r.maximo };
    }).sort((a, b) => b.anio - a.anio);
}

// ---------- firmas del informe ----------
export const CARGOS_FIRMA = ["Responsable del IPCT", "Responsable de la Comisión de Investigación", "Coordinadora de la Carrera"];

// Tres firmantes {cargo, nombre}: lo guardado como predeterminado (JSON) o, si no hay, las personas
// que ocupan esos roles (responsable del IPCT evaluada, superadmin y coordinadora). Todo es editable.
export function firmantesPorDefecto(usuarios, guardado) {
    try {
        const g = JSON.parse(guardado || "null");
        if (Array.isArray(g) && g.length === CARGOS_FIRMA.length && g.every(x => x && typeof x.cargo === "string" && typeof x.nombre === "string")) {
            return g.map(x => ({ cargo: x.cargo, nombre: x.nombre }));
        }
    } catch { /* se usan los valores por defecto */ }
    const primero = fn => (usuarios.filter(u => u.activo && fn(u)).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""))[0] || {}).nombre || "";
    return [
        { cargo: CARGOS_FIRMA[0], nombre: primero(u => u.rol === "responsable_ipct" && u.evaluado) },
        { cargo: CARGOS_FIRMA[1], nombre: primero(u => u.rol === "superadmin") },
        { cargo: CARGOS_FIRMA[2], nombre: primero(u => u.rol === "coordinadora") },
    ];
}

// «2026-11-05» -> mediodía local de ese día (evita que la zona horaria lo cambie de día).
export function fechaDeInput(valor, respaldo = new Date()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : respaldo;
}
