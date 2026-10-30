/* Cliente de Supabase falso, en memoria, solo con lo que usa js/evidencias.js.
   Permite inyectar fallos: fallos["evidencias.insert"] = { code: "23505", message: "..." } */
export function crearSbFalso({ fallos = {}, tablas = {}, rpcs = {} } = {}) {
    const t = { evidencias: [], archivos: [], tipos_evidencia: [], ajustes: [], usuarios: [], historial: [], ...tablas };
    const llamadas = [];
    const objetos = new Set();

    function ejecutar(q) {
        llamadas.push(`${q.nombre}.${q.op}`);
        const fallo = fallos[`${q.nombre}.${q.op}`];
        if (fallo) return { data: null, error: fallo };
        const filas = t[q.nombre];
        const coincide = f => q.filtros.every(([c, v, op]) => (op === "neq" ? f[c] !== v : op === "in" ? v.includes(f[c]) : f[c] === v));
        let res = [];
        if (q.op === "insert") {
            const fila = { id: crypto.randomUUID(), estado: "pendiente", ...q.datos };
            filas.push(fila); res = [fila];
        } else if (q.op === "update") {
            res = filas.filter(coincide); res.forEach(f => Object.assign(f, q.datos, q.nombre === "evidencias" && !("estado" in q.datos) ? { estado: "pendiente" } : {}));
        } else if (q.op === "delete") {
            res = filas.filter(coincide);
            t[q.nombre] = filas.filter(f => !coincide(f));
            if (q.nombre === "evidencias") t.archivos = t.archivos.filter(a => !res.some(e => e.id === a.evidencia_id));
        } else {
            res = filas.filter(coincide);
            if (q.nombre === "evidencias") {   // simula los joins de PostgREST
                res = res.map(e => ({ ...e,
                    tipos_evidencia: e.tipos_evidencia ?? (t.tipos_evidencia.find(x => x.id === e.tipo_id) || null),
                    archivos: e.archivos ?? t.archivos.filter(a => a.evidencia_id === e.id) }));
            }
        }
        if (q.unico) return res.length ? { data: res[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } };
        return { data: res, error: null };
    }

    const sb = {
        llamadas, tablas: t, objetos,
        async rpc(nombre, args) {
            llamadas.push("rpc." + nombre);
            if (fallos["rpc." + nombre]) return { data: null, error: fallos["rpc." + nombre] };
            const r = rpcs[nombre];
            return { data: typeof r === "function" ? r(args) : (r ?? []), error: null };
        },
        from(nombre) {
            const q = {
                nombre, op: null, datos: null, filtros: [], unico: false,
                select() { if (!this.op) this.op = "select"; return this; },
                insert(d) { this.op = "insert"; this.datos = d; return this; },
                update(d) { this.op = "update"; this.datos = d; return this; },
                delete() { this.op = "delete"; return this; },
                eq(c, v) { this.filtros.push([c, v, "eq"]); return this; },
                neq(c, v) { this.filtros.push([c, v, "neq"]); return this; },
                in(c, v) { this.filtros.push([c, v, "in"]); return this; },
                order() { return this; },
                single() { this.unico = true; return this; },
                then(ok, ko) { return Promise.resolve(ejecutar(this)).then(ok, ko); },
            };
            return q;
        },
        storage: {
            from() {
                return {
                    async upload(ruta) {
                        llamadas.push("storage.upload");
                        if (fallos["storage.upload"]) return { data: null, error: fallos["storage.upload"] };
                        objetos.add(ruta); return { data: { path: ruta }, error: null };
                    },
                    async remove(rutas) {
                        llamadas.push("storage.remove");
                        rutas.forEach(r => objetos.delete(r)); return { data: [], error: null };
                    },
                    async createSignedUrl(ruta) {
                        return { data: { signedUrl: "https://ejemplo.test/firmada/" + ruta }, error: null };
                    },
                };
            },
        },
    };
    return sb;
}
