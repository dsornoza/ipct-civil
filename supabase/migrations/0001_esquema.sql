-- =====================================================================
-- 0001 · Esquema base del IPCT (Ingeniería Civil · UNESUM)
-- Ejecutar completo en Supabase > SQL Editor. Es idempotente en lo posible.
-- Orden de ejecución: 0001, 0002, 0003, 0004, 0005.
-- =====================================================================

-- Ajustes generales editables (clave/valor).
create table if not exists public.ajustes (
    clave text primary key,
    valor text not null
);

-- Niveles del IPCT (Art. 5). Se ordenan por min_puntos descendente.
create table if not exists public.niveles (
    min_puntos integer primary key check (min_puntos >= 0),
    nombre     text not null unique,
    estimulos  jsonb not null default '[]'::jsonb   -- lista de textos (Art. 8)
);

-- Catálogo: equivale al objeto CONFIG del simulador.
-- Un tipo = un criterio puntuable (p. ej. «Artículos Q1»). La función en un
-- proyecto (director, investigador...) es un tipo distinto, porque el puntaje
-- depende de ella.
create table if not exists public.tipos_evidencia (
    id            text primary key,                 -- identificador corto: q1, pe_dir...
    indicador     text not null check (indicador in ('Ii','IiD','IVs')),
    bloque        text not null,                    -- identificador del bloque (agrupa topes)
    bloque_titulo text not null,
    nombre        text not null,
    puntos        integer not null check (puntos > 0),
    tope          integer check (tope > 0),         -- máximo de evidencias que computan por bloque y año
    grupo_dedup   text not null,                    -- tipos del mismo grupo comparten claves anti-duplicado
    esquema       jsonb not null,                   -- campos del formulario (ver 0005)
    orden         integer not null default 0,
    activo        boolean not null default true
);

-- Lista blanca de usuarios y roles.
create table if not exists public.usuarios (
    id           uuid primary key default gen_random_uuid(),
    email        text not null,
    nombre       text not null,
    rol          text not null default 'docente'
                 check (rol in ('docente','responsable_ipct','calidad','coordinadora','superadmin')),
    programa     text not null default 'Ingeniería Civil',
    activo       boolean not null default true,
    auth_user_id uuid references auth.users(id) on delete set null,
    creado_en    timestamptz not null default now(),
    constraint usuarios_email_minusculas check (email = lower(btrim(email)))
);
create unique index if not exists usuarios_email_uq on public.usuarios (email);

-- Evidencias: una por actividad (un proyecto = una evidencia con su función).
create table if not exists public.evidencias (
    id            uuid primary key default gen_random_uuid(),
    docente_id    uuid not null references public.usuarios(id),
    tipo_id       text not null references public.tipos_evidencia(id),
    anio          integer not null,                 -- año de evaluación
    datos         jsonb not null default '{}'::jsonb,
    dedup_key     text,                             -- calculada por trigger
    estado        text not null default 'pendiente'
                  check (estado in ('pendiente','observada','rechazada','validada')),
    validado_por  uuid references public.usuarios(id),
    validado_en   timestamptz,
    comentario    text,
    creado_en     timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);
create index if not exists evidencias_docente_anio_idx on public.evidencias (docente_id, anio);
create index if not exists evidencias_estado_idx on public.evidencias (estado);
-- Evita duplicados por docente (dos coautores sí pueden registrar el mismo DOI).
create unique index if not exists evidencias_dedup_uq
    on public.evidencias (docente_id, dedup_key) where dedup_key is not null;

-- Un PDF por evidencia.
create table if not exists public.archivos (
    id           uuid primary key default gen_random_uuid(),
    evidencia_id uuid not null unique references public.evidencias(id) on delete cascade,
    ruta         text not null,                     -- ruta en el bucket «evidencias»
    nombre       text not null,
    tamano       bigint not null check (tamano > 0 and tamano <= 5242880),  -- 5 MB
    sha256       text,                              -- opcional, para detectar el mismo PDF repetido
    creado_en    timestamptz not null default now()
);
create index if not exists archivos_sha_idx on public.archivos (sha256);

-- Auditoría. Sin clave foránea a propósito: se conserva aunque se borre la evidencia.
create table if not exists public.historial (
    id              bigint generated always as identity primary key,
    evidencia_id    uuid not null,
    docente_id      uuid,
    tipo_id         text,
    estado_anterior text,
    estado_nuevo    text not null,                  -- incluye 'eliminada'
    actor_id        uuid,
    fecha           timestamptz not null default now(),
    comentario      text
);
create index if not exists historial_evidencia_idx on public.historial (evidencia_id);
