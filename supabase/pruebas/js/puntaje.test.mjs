/* Pruebas de js/puntaje.js. Ejecutar: node --test supabase/pruebas/js */
import test from "node:test";
import assert from "node:assert/strict";
import { siguienteNivel, estimulosDe, porcentajeBarra, explicarTope, agruparDetalle, cargarRanking, cargarEvolucion, cargarDetalle, cargarNiveles }
    from "../../../js/puntaje.js";
import { crearSbFalso } from "./sb_falso.mjs";

const NIVELES = [
    { min_puntos: 20, nombre: "Nivel 4", estimulos: ["Reconocimiento público"] },
    { min_puntos: 50, nombre: "Nivel 1", estimulos: ["A", "B"] },
    { min_puntos: 30, nombre: "Nivel 3", estimulos: [] },
    { min_puntos: 40, nombre: "Nivel 2", estimulos: ["C"] },
];

test("siguienteNivel: puntos que faltan y nivel máximo", () => {
    assert.deepEqual(siguienteNivel(0, NIVELES), { nombre: "Nivel 4", min: 20, faltan: 20 });
    assert.deepEqual(siguienteNivel(28, NIVELES), { nombre: "Nivel 3", min: 30, faltan: 2 });
    assert.deepEqual(siguienteNivel(40, NIVELES), { nombre: "Nivel 1", min: 50, faltan: 10 });
    assert.equal(siguienteNivel(50, NIVELES), null);
    assert.equal(siguienteNivel(70, NIVELES), null);
});

test("estimulosDe devuelve la lista del nivel o vacío", () => {
    assert.deepEqual(estimulosDe("Nivel 2", NIVELES), ["C"]);
    assert.deepEqual(estimulosDe("Sin nivel", NIVELES), []);
});

test("porcentajeBarra se limita a 0-100 y usa el umbral máximo como escala", () => {
    assert.equal(porcentajeBarra(25, NIVELES), 50);
    assert.equal(porcentajeBarra(80, NIVELES), 100);
    assert.equal(porcentajeBarra(0, NIVELES), 0);
    assert.equal(porcentajeBarra(100, NIVELES, [100]), 100);
});

const fila = (tipo, pts, computada, extra = {}) => ({
    evidencia_id: crypto.randomUUID(), indicador: "Ii", bloque: "proy_ext", bloque_titulo: "Proyectos externos", tipo_id: "t",
    tipo_nombre: tipo, puntos_unidad: pts, tope: 3, datos: { nombre: tipo + " " + pts }, computada, orden: 1, ...extra,
});

test("explicarTope describe lo computado y lo omitido, priorizando mayor puntaje", () => {
    const filas = [fila("Proyectos externos (director)", 10, true), fila("Proyectos externos (director)", 10, true),
                   fila("Proyectos externos (investigador principal)", 8, true), fila("Proyectos externos (investigador)", 4, false)];
    const t = explicarTope(3, filas);
    assert.match(t, /Se registraron 4 evidencias validadas/);
    assert.match(t, /máximo de 3/);
    assert.match(t, /2 como director \(10 pts c\/u\), 1 como investigador principal \(8 pts c\/u\)/);
    assert.match(t, /No se computaron: 1 como investigador \(4 pts c\/u\)\./);
});

test("agruparDetalle: suma solo lo computado, ordena indicadores y anota el tope", () => {
    const detalle = [
        fila("Proyectos externos (director)", 10, true), fila("Proyectos externos (director)", 10, true),
        fila("Proyectos externos (investigador principal)", 8, true), fila("Proyectos externos (investigador)", 4, false),
        { ...fila("Proyectos de vinculación (director)", 3, true), indicador: "IVs", bloque: "vinc", bloque_titulo: "Vinculación", tope: 2 },
        { ...fila("Patentes registradas en el SENADI", 6, true), indicador: "IiD", bloque: "pat", bloque_titulo: "Patentes", tope: null },
    ];
    const g = agruparDetalle(detalle);
    assert.deepEqual(g.map(i => i.id), ["Ii", "IiD", "IVs"]);
    assert.equal(g[0].puntos, 28);
    assert.equal(g[1].puntos, 6);
    assert.equal(g[2].puntos, 3);
    assert.match(g[0].bloques[0].nota, /^Proyectos externos: Se registraron 4/);
    assert.equal(g[1].bloques[0].nota, "");
    assert.equal(g[0].bloques[0].filas.find(f => !f.computada).puntos, 0);
    assert.equal(g[0].nombre, "Indicador de Investigación (Ii)");
});

test("agruparDetalle usa el esquema del tipo para describir cada evidencia", () => {
    const g = agruparDetalle([{ ...fila("Artículos Q1", 6, true, { tope: null, tipo_id: "q1", datos: { titulo: "Hormigón" } }), bloque: "art", bloque_titulo: "Artículos" }],
        { q1: { esquema: { campos: [{ nombre: "titulo", requerido: true }] } } });
    assert.equal(g[0].bloques[0].filas[0].detalle, "Hormigón");
});

test("funciones de datos llaman a las RPC con los parámetros correctos", async () => {
    const llamadas = [];
    const sb = crearSbFalso({
        rpcs: { ranking: a => { llamadas.push(["ranking", a]); return [{ nombre: "Ana", total: 40 }]; },
                evolucion: a => { llamadas.push(["evolucion", a]); return [{ anio: 2026, total: 40 }]; },
                detalle_docente: a => { llamadas.push(["detalle", a]); return []; } },
        tablas: { niveles: [{ min_puntos: 20, nombre: "Nivel 4" }, { min_puntos: 50, nombre: "Nivel 1" }] },
    });
    assert.equal((await cargarRanking(sb, 2026))[0].total, 40);
    assert.equal((await cargarEvolucion(sb, "u1"))[0].anio, 2026);
    await cargarDetalle(sb, "u1", 2026);
    assert.deepEqual(llamadas, [["ranking", { p_anio: 2026 }], ["evolucion", { p_usuario: "u1" }], ["detalle", { p_usuario: "u1", p_anio: 2026 }]]);
    assert.equal((await cargarNiveles(sb)).length, 2);
});

test("los errores de RPC se propagan", async () => {
    const sb = crearSbFalso({ fallos: { "rpc.ranking": { message: "boom" } } });
    await assert.rejects(cargarRanking(sb, 2026), e => e.message === "boom");
});
