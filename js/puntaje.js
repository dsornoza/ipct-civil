/* Puntaje, nivel y ranking. El cálculo oficial vive en la base de datos
   (funciones SQL ranking, evolucion y detalle_docente); aquí solo se piden
   los resultados y se preparan para mostrarlos o imprimirlos. */
import { resumenEvidencia } from "./catalogo.js";

function lanzar(error) { if (error) throw error; }

export const INDICADORES = {
    Ii: { nombre: "Indicador de Investigación (Ii)", total: "Total Ii" },
    IiD: { nombre: "Indicador de Innovación y Desarrollo (IiD)", total: "Total IiD" },
    IVs: { nombre: "Indicador de Vinculación (IVs)", total: "Total IVs" },
};

// ---------- acceso a datos (sb inyectado) ----------
export async function cargarRanking(sb, anio) {
    const { data, error } = await sb.rpc("ranking", { p_anio: anio });
    lanzar(error);
    return data;
}

export async function cargarEvolucion(sb, usuarioId) {
    const { data, error } = await sb.rpc("evolucion", { p_usuario: usuarioId });
    lanzar(error);
    return data;
}

export async function cargarDetalle(sb, usuarioId, anio) {
    const { data, error } = await sb.rpc("detalle_docente", { p_usuario: usuarioId, p_anio: anio });
    lanzar(error);
    return data;
}

// Niveles ordenados de mayor a menor umbral, con sus estímulos.
export async function cargarNiveles(sb) {
    const { data, error } = await sb.from("niveles").select("*").order("min_puntos", { ascending: false });
    lanzar(error);
    return data;
}

export async function cargarFuente(sb) {
    const { data, error } = await sb.from("ajustes").select("valor").eq("clave", "fuente_normativa");
    lanzar(error);
    return (data && data[0] && data[0].valor) || "";
}

// ---------- lógica pura ----------

// Menor nivel que aún no se alcanza, o null si ya tiene el máximo.
// niveles: [{ min_puntos, nombre }] en cualquier orden.
export function siguienteNivel(total, niveles) {
    const faltan = niveles.filter(n => total < n.min_puntos).sort((a, b) => a.min_puntos - b.min_puntos);
    if (!faltan.length) return null;
    return { nombre: faltan[0].nombre, min: faltan[0].min_puntos, faltan: faltan[0].min_puntos - total };
}

// Estímulos del nivel alcanzado (lista de textos) o [] si no hay nivel.
export function estimulosDe(nombreNivel, niveles) {
    const n = niveles.find(x => x.nombre === nombreNivel);
    return n && Array.isArray(n.estimulos) ? n.estimulos : [];
}

// Ancho (0-100) de las barras de evolución: la escala llega al umbral del nivel máximo.
export function porcentajeBarra(total, niveles, totales = []) {
    const tope = Math.max(...niveles.map(n => n.min_puntos), ...totales, 1);
    return Math.max(0, Math.min(100, (total / tope) * 100));
}

// Texto que explica qué se computó y qué quedó fuera cuando se supera el tope de un bloque.
export function explicarTope(tope, filas) {
    const rol = nombre => { const m = nombre.match(/\(([^)]+)\)/); return m ? m[1] : nombre; };
    const lista = predicado => {
        const cuenta = new Map();
        for (const f of filas.filter(predicado)) {
            const k = `${f.tipo_nombre}|${f.puntos_unidad}`;
            cuenta.set(k, (cuenta.get(k) || 0) + 1);
        }
        return [...cuenta.entries()].sort((a, b) => Number(b[0].split("|")[1]) - Number(a[0].split("|")[1]))
            .map(([k, n]) => { const [nombre, pts] = k.split("|"); return `${n} como ${rol(nombre)} (${pts} pts c/u)`; }).join(", ");
    };
    return `Se registraron ${filas.length} evidencias validadas, pero el instructivo reconoce un máximo de ${tope}. ` +
        `Se priorizaron las de mayor puntaje: ${lista(f => f.computada)}. ` +
        `No se computaron: ${lista(f => !f.computada)}.`;
}

// Organiza el detalle plano (detalle_docente) en indicador > bloque > filas,
// con los puntos que aporta cada evidencia y la nota de tope si corresponde.
export function agruparDetalle(detalle, tiposPorId = {}) {
    const res = [];
    for (const d of detalle) {
        let ind = res.find(i => i.id === d.indicador);
        if (!ind) { ind = { id: d.indicador, ...INDICADORES[d.indicador], puntos: 0, bloques: [] }; res.push(ind); }
        let blo = ind.bloques.find(b => b.bloque === d.bloque);
        if (!blo) { blo = { bloque: d.bloque, titulo: d.bloque_titulo, tope: d.tope, filas: [], nota: "" }; ind.bloques.push(blo); }
        const tipo = tiposPorId[d.tipo_id];
        blo.filas.push({
            tipo_nombre: d.tipo_nombre, puntos_unidad: d.puntos_unidad, computada: d.computada,
            detalle: resumenEvidencia(d.datos, tipo && tipo.esquema),
            puntos: d.computada ? d.puntos_unidad : 0,
        });
        if (d.computada) ind.puntos += d.puntos_unidad;
    }
    for (const ind of res) {
        for (const b of ind.bloques) {
            if (b.tope && b.filas.length > b.tope) b.nota = `${b.titulo}: ${explicarTope(b.tope, b.filas)}`;
        }
    }
    const orden = Object.keys(INDICADORES);
    return res.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id));
}
