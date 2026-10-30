/* Pruebas de js/informes.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { mayusSinTildes, mayus, fechaCelda, doiUrl, nombreMatriz, ENCABEZADOS, construirMatrices, construirActividades, CATEGORIAS,
         aCsv, csvDocentes, csvEvidencias, resumenNumerico, estadisticas, evolucionPrograma } from "../../../js/informes.js";
import { anchosDe } from "../../../js/excel.js";

const USUARIOS = [
    { id: "u1", nombre: "Diego Sornoza", apellidos_nombres: "Sornoza Parrales Diego Renato", cedula: "1309205720", facultad: "Ciencias Técnicas", programa: "Ingeniería Civil" },
    { id: "u2", nombre: "Dayana Castro", apellidos_nombres: null, cedula: "1300000002", facultad: "Ciencias Técnicas", programa: "Ingeniería Civil" },
];
const TIPOS = [
    { id: "q1", grupo_dedup: "articulo" }, { id: "lib_inv", grupo_dedup: "libro" }, { id: "capitulo", grupo_dedup: "capitulo" },
    { id: "pon_mem", grupo_dedup: "ponencia" }, { id: "comites", grupo_dedup: "comite" }, { id: "premios", grupo_dedup: "premio" },
    { id: "tesis_mp", grupo_dedup: "tesis" }, { id: "patentes", grupo_dedup: "patente" }, { id: "software", grupo_dedup: "software" },
    { id: "red", grupo_dedup: "red" }, { id: "revisor", grupo_dedup: "revisor" },
];
const ev = (id, docente, tipo, datos, extra = {}) => ({ id, docente_id: docente, tipo_id: tipo, estado: "validada", datos, datos_validacion: {}, autoria: {}, ...extra });

test("textos: mayúsculas sin tildes ni Ñ en títulos; nombres conservan tildes", () => {
    assert.equal(mayusSinTildes("  Análisis   de la  Ñoñería  "), "ANALISIS DE LA NONERIA");
    assert.equal(mayusSinTildes(null), "");
    assert.equal(mayus("Cañarte  Baque"), "CAÑARTE BAQUE");
    assert.equal(nombreMatriz(USUARIOS[0]), "SORNOZA PARRALES DIEGO RENATO");
    assert.equal(nombreMatriz(USUARIOS[1]), "DAYANA CASTRO");        // sin apellidos cargados: usa el nombre
});

test("fechas y DOI", () => {
    assert.equal(fechaCelda("2026-03-01").toISOString().slice(0, 10), "2026-03-01");
    assert.equal(fechaCelda(""), "");
    assert.equal(fechaCelda("no es fecha"), "");
    assert.equal(doiUrl("10.1000/xyz"), "https://doi.org/10.1000/xyz");
    assert.equal(doiUrl("https://doi.org/10.1000/xyz"), "https://doi.org/10.1000/xyz");
    assert.equal(doiUrl("doi: 10.1000/xyz"), "https://doi.org/10.1000/xyz");
    assert.equal(doiUrl(undefined), "");
});

test("matriz REVISTAS: encabezados del formato, una fila por docente y solo validadas", () => {
    const evidencias = [
        ev("1", "u1", "q1", { titulo: "Pavimentos permeables", revista: "Revista Ingeniar", doi: "10.46296/ig.1", url: "https://j.org/a" },
           { datos_validacion: { base: "SCOPUS", issn: "2737-6249", numero: "Vol. 8, N° 15", cuartil: "Q3", fecha_publicacion: "2026-06-16", linea: "Estructuras e ingeniería de materiales",
               resultado_de: "Proyecto de investigación", proyecto_titulo: "Diagnóstico", proyecto_estado: "En ejecución", periodo: "PI-2026" },
             autoria: { posicion: 1, participacion: "Autor" } }),
        ev("2", "u2", "q1", { titulo: "Pavimentos permeables", revista: "Revista Ingeniar", doi: "10.46296/ig.1" }, { autoria: { posicion: 2, participacion: "Coautor" } }),
        ev("3", "u1", "q1", { titulo: "Pendiente", revista: "X" }, { estado: "pendiente" }),
    ];
    const m = construirMatrices({ evidencias, usuarios: USUARIOS, tipos: TIPOS });
    const R = m.REVISTAS;
    assert.deepEqual(R.encabezados, ENCABEZADOS.REVISTAS);
    assert.equal(R.filas.length, 2);
    const col = nombre => ENCABEZADOS.REVISTAS.indexOf(nombre);
    const f = R.filas[0];
    assert.equal(f.length, ENCABEZADOS.REVISTAS.length);
    assert.equal(f[col("CODIGO_IES")], 1025);
    assert.equal(f[col("TITULO_PUBLICACION")], "PAVIMENTOS PERMEABLES");
    assert.equal(f[col("BASE_DATOS_INDEXADA")], "SCOPUS");
    assert.equal(f[col("IDENTIFICACION_PARTICIPANTE")], "1309205720");
    assert.equal(f[col("PARTICIPACION")], "AUTOR");
    assert.equal(f[col("POSICION")], 1);
    assert.equal(f[col("APELLIDOS_NOMBRES")], "SORNOZA PARRALES DIEGO RENATO");
    assert.equal(f[col("CUARTIL")], "Q3");
    assert.equal(f[col("RESULTADO DE PROYECTO DE INVESTIGACION")], "SI");
    assert.equal(f[col("RESULTADO DE PROYECTO DE VINCULACION")], "NO");
    assert.equal(f[col("TITULO_PROYECTO")], "DIAGNOSTICO");
    assert.equal(f[col("ESTADO_PROYECTO")], "EN EJECUCIÓN");
    assert.equal(f[col("DOI")], "https://doi.org/10.46296/ig.1");
    assert.ok(f[col("FECHA_PUBLICACION")] instanceof Date);
    assert.equal(f[col("INTERCULTURALIDAD (SI o NO)")], "NO");
    assert.equal(R.filas[1][col("PARTICIPACION")], "COAUTOR");     // la coautora tiene su propia fila
    assert.equal(R.filas[1][col("RESULTADO DE PROYECTO DE INVESTIGACION")], "NO");
    assert.equal(R.filas[1][col("TITULO_PROYECTO")], "");
});

test("matrices de libros, capítulos y ponencias: columnas y posición en PARTICIPACION donde el formato lo usa", () => {
    const evidencias = [
        ev("l", "u1", "lib_inv", { titulo: "Libro", isbn: "978-1" }, { datos_validacion: { revisado_pares: "Sí" }, autoria: { posicion: 2, participacion: "Autor" } }),
        ev("c", "u1", "capitulo", { titulo: "Capítulo", libro: "Ingeniería en acción", isbn: "978-2", editor: "Saberec", paginas: "49-62" }, { autoria: { posicion: 3, participacion: "Coautor" } }),
        ev("p", "u2", "pon_mem", { titulo: "Ponencia", evento: "III Jornada", ciudad: "Jipijapa", fecha_evento: "2026-08-23" }, { autoria: { posicion: 4, participacion: "Coautor" } }),
    ];
    const m = construirMatrices({ evidencias, usuarios: USUARIOS, tipos: TIPOS });
    for (const k of ["LIBROS", "CAPITULOS", "PONENCIAS"]) {
        assert.deepEqual(m[k].encabezados, ENCABEZADOS[k]);
        assert.equal(m[k].filas.length, 1);
        assert.equal(m[k].filas[0].length, ENCABEZADOS[k].length, `${k}: tantas celdas como encabezados`);
    }
    const col = (h, n) => ENCABEZADOS[h].indexOf(n);
    assert.equal(m.LIBROS.filas[0][col("LIBROS", "REVISADO_PARES")], "SI");
    assert.equal(m.LIBROS.filas[0][col("LIBROS", "PARTICIPACION")], "AUTOR");
    assert.equal(m.LIBROS.filas[0][col("LIBROS", "POSICION")], 2);
    assert.equal(m.CAPITULOS.filas[0][col("CAPITULOS", "TITULO_LIBRO")], "INGENIERIA EN ACCION");
    assert.equal(m.CAPITULOS.filas[0][col("CAPITULOS", "PARTICIPACION")], 3);
    assert.equal(m.PONENCIAS.filas[0][col("PONENCIAS", "TIPO_ARTICULO")], "MEMORIA");
    assert.equal(m.PONENCIAS.filas[0][col("PONENCIAS", "PAIS")], "ECUADOR");
    assert.equal(m.PONENCIAS.filas[0][col("PONENCIAS", "PARTICIPACION")], 4);
    assert.equal(m.PONENCIAS.filas[0][col("PONENCIAS", "CIUDAD")], "JIPIJAPA");
});

test("matriz de otras actividades: grupos, merges y filas apiladas por docente", () => {
    const evidencias = [
        ev("1", "u1", "comites", { institucion: "Sociedad Académica", entidad: "Revista YACHASUN", cargo: "Editor" }),
        ev("2", "u1", "comites", { institucion: "UNESUM", entidad: "Revista Alcance" }),
        ev("3", "u1", "premios", { entidad: "Red FUJA", ambito: "Internacional", nombre: "Investigador Destacado" }),
        ev("4", "u1", "tesis_mp", { titulo: "Comprensión lectora" }, { tipo_id: "tesis_mp" }),
        ev("5", "u1", "software", { numero: "QUI-068533", titulo: "Software QRASISTENCIA", fecha: "2025-08-27" }),
        ev("6", "u2", "red", { institucion: "ICALC", nombre: "Red ICALC" }),
        ev("7", "u2", "revisor", { institucion: "Frontiers", revista: "Frontiers in Environmental Science", referencia: "x" }, { estado: "pendiente" }),
    ];
    const a = construirActividades({ evidencias, usuarios: USUARIOS, tipos: TIPOS, anio: 2026 });
    const ancho = 5 + CATEGORIAS.reduce((n, c) => n + c.sub.length, 0);
    assert.equal(ancho, 27);
    assert.ok(a.filas.every(f => f.length === ancho));
    assert.equal(a.docentes, 2);                                   // la pendiente no cuenta
    assert.match(a.filas[0][0], /ACTIVIDADES DE INVESTIGACIÓN 2026/);
    assert.match(a.filas[1][FIJAS_N()], /comités o consejos/);
    assert.match(a.filas[1][FIJAS_N() + 3], /revisor/);
    assert.match(a.filas[1][FIJAS_N() + 9], /durante el año 2026/);
    assert.equal(a.filas[2][FIJAS_N()], "Institución y/o organización");
    // Docente de Dayana primero (orden alfabético de «DAYANA CASTRO» < «SORNOZA…»)
    assert.equal(a.filas[3][1], "DAYANA CASTRO");
    assert.equal(a.filas[3][0], 1);
    const filaDiego = a.filas.findIndex(f => f[1] === "SORNOZA PARRALES DIEGO RENATO");
    assert.equal(a.filas[filaDiego][0], 2);
    assert.equal(a.filas[filaDiego][2], "1309205720");
    // Dos comités: la segunda actividad va en la fila siguiente, sin repetir los datos del docente
    assert.equal(a.filas[filaDiego][5], "Sociedad Académica");
    assert.equal(a.filas[filaDiego + 1][5], "UNESUM");
    assert.equal(a.filas[filaDiego + 1][1], "");
    assert.ok(a.merges.some(m => m.s.r === filaDiego && m.e.r === filaDiego + 1 && m.s.c === 1), "nombre combinado en las filas del docente");
    assert.ok(a.merges.some(m => m.s.r === 0 && m.e.c === ancho - 1), "título combinado");
    // Tesis: el tipo de tesis sale del tipo de evidencia
    const iTesis = 5 + CATEGORIAS.slice(0, 4).reduce((n, c) => n + c.sub.length, 0);
    assert.equal(a.filas[filaDiego][iTesis], "Comprensión lectora");
    assert.equal(a.filas[filaDiego][iTesis + 1], "Maestría profesional");
    const iSoft = 5 + CATEGORIAS.slice(0, 6).reduce((n, c) => n + c.sub.length, 0);
    assert.equal(a.filas[filaDiego][iSoft], "QUI-068533");
    assert.ok(a.filas[filaDiego][iSoft + 2] instanceof Date);
});
const FIJAS_N = () => 5;

test("CSV: comillas, comas, saltos de línea y fechas", () => {
    const csv = aCsv(["A", "B"], [["x,y", 'dice "hola"'], ["línea\nnueva", new Date(Date.UTC(2026, 0, 5))], [undefined, 3]]);
    assert.equal(csv, 'A,B\r\n"x,y","dice ""hola"""\r\n"línea\nnueva",2026-01-05\r\n,3\r\n');
});

const RANKING = [
    { posicion: 1, usuario_id: "u1", nombre: "Diego", ii: 30, iid: 6, ivs: 6, total: 42, nivel: "Nivel 2" },
    { posicion: 2, usuario_id: "u2", nombre: "Dayana", ii: 12, iid: 0, ivs: 0, total: 12, nivel: "Sin nivel" },
    { posicion: 3, usuario_id: "u3", nombre: "Luis", ii: 0, iid: 0, ivs: 0, total: 0, nivel: "Sin nivel" },
    { posicion: 3, usuario_id: "u4", nombre: "Ana", ii: 21, iid: 0, ivs: 0, total: 21, nivel: "Nivel 4" },
];
const DETALLE = [
    { docente_id: "u1", docente: "Diego", indicador: "Ii", bloque_titulo: "Artículos", tipo_nombre: "Artículos Q1", puntos_unidad: 6, computada: true, datos: { titulo: "IA for net zero" } },
    { docente_id: "u1", docente: "Diego", indicador: "Ii", bloque_titulo: "Proyectos externos", tipo_nombre: "Director", puntos_unidad: 4, computada: false, datos: { nombre: "Proyecto A" } },
    { docente_id: "u2", docente: "Dayana", indicador: "Ii", bloque_titulo: "Artículos", tipo_nombre: "Artículos Q3", puntos_unidad: 4, computada: true, datos: { titulo: "Otro" } },
];
const NIVELES = [{ min_puntos: 20, nombre: "Nivel 4" }, { min_puntos: 50, nombre: "Nivel 1" }, { min_puntos: 40, nombre: "Nivel 2" }, { min_puntos: 30, nombre: "Nivel 3" }];

test("resumenNumerico: media, mediana, desviación (muestral), mínimo y máximo", () => {
    assert.deepEqual(resumenNumerico([]), { n: 0, media: 0, mediana: 0, minimo: 0, maximo: 0, desviacion: 0 });
    assert.deepEqual(resumenNumerico([42, 12, 0, 21]), { n: 4, media: 18.8, mediana: 16.5, minimo: 0, maximo: 42, desviacion: 17.7 });
    assert.equal(resumenNumerico([5]).desviacion, 0);
    assert.equal(resumenNumerico([1, 2, 9]).mediana, 2);
});

test("estadisticas: niveles en orden (con «Sin nivel»), promedios, bloques y variación", () => {
    const e = estadisticas({ ranking: RANKING, detalle: DETALLE, niveles: NIVELES, rankingPrevio: [{ total: 10 }, { total: 14 }] });
    assert.equal(e.docentes, 4);
    assert.equal(e.conPuntaje, 3);
    assert.equal(e.total.media, 18.8);
    assert.deepEqual(e.porNivel.map(n => [n.nivel, n.n]), [["Nivel 1", 0], ["Nivel 2", 1], ["Nivel 3", 0], ["Nivel 4", 1], ["Sin nivel", 2]]);
    assert.equal(e.porNivel.find(n => n.nivel === "Sin nivel").pct, 50);
    assert.deepEqual(e.promedios, { ii: 15.8, iid: 1.5, ivs: 1.5 });
    assert.equal(e.evidenciasValidadas, 3);
    assert.equal(e.noComputadas, 1);
    assert.deepEqual(e.porBloque[0], { titulo: "Artículos", indicador: "Ii", evidencias: 2, computadas: 2, docentes: 2 });
    assert.equal(e.variacionPromedio, 6.8);
    assert.equal(estadisticas({ ranking: RANKING, detalle: [], niveles: NIVELES }).variacionPromedio, null);
    assert.equal(estadisticas({ ranking: [], detalle: [], niveles: NIVELES }).docentes, 0);
});

test("csvDocentes y csvEvidencias", () => {
    const d = csvDocentes(RANKING, DETALLE);
    assert.equal(d.filas[0][7], 2);       // Diego: 2 validadas
    assert.equal(d.filas[0][8], 1);       // y una no computada
    assert.equal(d.filas[2][7], 0);
    const e = csvEvidencias(DETALLE);
    assert.deepEqual(e.filas[0], ["Diego", "Ii", "Artículos Q1", "IA for net zero", 6, "Sí"]);
    assert.equal(e.filas[1][5], "No (tope)");
    assert.equal(e.filas[1][3], "Proyecto A");
});

test("evolucionPrograma: un renglón por año, del más reciente al más antiguo", () => {
    const ev2 = evolucionPrograma({ 2025: [{ total: 10 }], 2026: RANKING });
    assert.deepEqual(ev2.map(x => x.anio), [2026, 2025]);
    assert.deepEqual(ev2[0], { anio: 2026, docentes: 4, conPuntaje: 3, media: 18.8, maximo: 42 });
});

test("anchosDe: según el contenido, con mínimo y tope", () => {
    const a = anchosDe([["a", "texto largo de ejemplo"], ["bb", "x".repeat(200)], [new Date(), 5]]);
    assert.equal(a[0].wch, 10);
    assert.equal(a[1].wch, 60);
});
