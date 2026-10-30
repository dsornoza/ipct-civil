# Guía: Supabase y Google Cloud

Tiempo estimado: 30–45 minutos. Todo es gratuito. URL del sitio (piloto): `https://dsornoza.github.io/ipct-civil/`

El orden importa: primero Supabase (para conocer su URL), luego Google, luego volver a Supabase.

## Parte A · Proyecto en Supabase

1. Entre a <https://supabase.com>, inicie sesión (puede usar GitHub) y pulse **New project**.
2. Nombre: `ipct-civil`. Región: la más cercana (por ejemplo *East US*). Genere una contraseña de base de datos y **guárdela en su gestor de contraseñas**; no se la pase a nadie ni la ponga en el repositorio.
3. Espere a que termine de crearse. En **Project Settings > API** anote:
   - **Project URL** (`https://<ref>.supabase.co`). `<ref>` es el identificador del proyecto.
   - Clave **anon** / *publishable* (pública). **No** use ni copie la clave `service_role`.
4. **Authentication > Providers > Email**: desactive el inicio con correo y contraseña (solo se usará Google).
5. **Authentication > URL Configuration**:
   - *Site URL*: `https://dsornoza.github.io/ipct-civil/`
   - *Redirect URLs*: añada `https://dsornoza.github.io/ipct-civil/` y, para pruebas locales, `http://localhost:8000/**`.

## Parte B · Credenciales OAuth en Google Cloud

Use su cuenta personal de Google. Consola: <https://console.cloud.google.com>

1. Cree un proyecto nuevo (nombre sugerido: `ipct-civil`).
2. Menú **APIs y servicios > Pantalla de consentimiento de OAuth** (en la consola nueva: *Google Auth Platform*) y configure:
   - Nombre de la aplicación: `IPCT Ingeniería Civil UNESUM`. Correo de asistencia: el suyo.
   - Público/tipo de usuario: **Externo** (su cuenta personal no pertenece a la organización de UNESUM).
   - Alcances: solo `openid`, `email` y `profile` (son los básicos; no requieren verificación).
   - Estado de publicación: pase de *Pruebas* a **En producción**. En *Pruebas* solo entrarían los correos añadidos como «usuarios de prueba» y la sesión caduca a los 7 días.
3. **Credenciales > Crear credenciales > ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - *URI de redireccionamiento autorizadas*: `https://<ref>.supabase.co/auth/v1/callback` (la URL de Supabase de la Parte A, **no** la del sitio).
   - Orígenes de JavaScript autorizados: no son necesarios para este flujo.
4. Copie el **ID de cliente** y el **Secreto de cliente**. El secreto es privado: póngalo solo en Supabase, no en el repositorio.

## Parte C · Conectar Google con Supabase

1. Supabase > **Authentication > Providers > Google**: active, pegue ID y secreto, guarde.
2. Anote los valores para `config.js`: `SUPABASE_URL` y `SUPABASE_ANON_KEY`.

## Parte D · Base de datos

En Supabase > **SQL Editor**, abra cada archivo de `supabase/migrations/` **en orden** (`0001` a `0007`), péguelo y pulse *Run*.

Después, copie `supabase/semilla_usuarios.sql`, reemplace los correos y ejecútelo. El correo del superadmin debe ser el de la cuenta de Google con la que iniciará sesión y terminar en el dominio permitido (`public.ajustes.dominio_permitido`, hoy `unesum.edu.ec`).

Si la ejecución de `0004` muestra un error de permisos sobre `storage.objects`, cree las cuatro políticas desde **Storage > Policies** con las mismas expresiones.

## Parte E · Publicar

1. Edite `config.js` con la URL y la clave `anon`.
2. En GitHub: **Settings > Secrets and variables > Actions > Variables**: cree `SUPABASE_URL` y `SUPABASE_ANON_KEY` (para la acción diaria).
3. Haga *commit* y *push*; GitHub Pages publica desde `main`.

## Posibles problemas

- **«redirect_uri_mismatch» de Google:** la URI de la Parte B no coincide exactamente con `https://<ref>.supabase.co/auth/v1/callback`.
- **Entra pero no ve nada:** su correo no está en `usuarios`, está inactivo o no termina en el dominio permitido.
- **Google bloquea la aplicación:** la administración de Google Workspace de UNESUM puede restringir aplicaciones de terceros; en ese caso la persona administradora debe permitir el ID de cliente.
