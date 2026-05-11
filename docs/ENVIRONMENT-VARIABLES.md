# Variables de Entorno — Guía de Configuración

Este documento describe todas las variables de entorno necesarias para ejecutar VerbaNota en los tres entornos posibles: desarrollo local, Docker Compose y Kubernetes.

---

## Estructura de configuración

```
translateapp/
├── backend/.env              # Backend Python (cargado automáticamente por load_dotenv)
├── frontend/.env.local       # Frontend Next.js (cargado por Next.js)
└── .env.example              # Referencia completa de todas las variables
```

En Kubernetes las variables se inyectan mediante **ConfigMaps** y **Secrets** definidos en `k8s/verbanota-stack.yaml`, sin necesidad de archivos `.env` en los contenedores.

---

## 1. Backend — `backend/.env`

Cargado automáticamente al arrancar el servidor mediante `python-dotenv`.

```env
# ── MinIO (almacenamiento de perfiles de voz) ─────────────────────────────
# URL completa incluyendo protocolo y puerto
MINIO_ENDPOINT=http://localhost:9000

# Nombre del bucket donde se guardan los archivos de audio
MINIO_BUCKET=voice-profiles

# Credenciales de acceso a MinIO
# Deben coincidir con MINIO_ROOT_USER / MINIO_ROOT_PASSWORD del contenedor MinIO
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

**Notas:**
- `MINIO_ACCESS_KEY` y `MINIO_SECRET_KEY` son los nombres exactos que lee `backend/app/models.py`. No usar `AWS_ACCESS_KEY_ID` aquí.
- Si MinIO corre en Docker con `--name minio`, el endpoint desde el host es `http://localhost:9000`. Desde otro contenedor Docker sería `http://minio:9000`.
- El backend descarga los perfiles de voz desde MinIO a una caché local en `backend/.cache/speakers/` cuando son necesarios para el TTS.

---

## 2. Frontend — `frontend/.env.local`

Next.js carga este archivo automáticamente. No se sube al repositorio (está en `.gitignore`).

```env
# ── Base de datos (Prisma ORM) ────────────────────────────────────────────
# PostgreSQL con usuarios, sesiones y metadata de perfiles de voz
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/translateapp

# ── Autenticación JWT ─────────────────────────────────────────────────────
# Secreto para firmar los tokens JWT. Cambiar en producción.
JWT_SECRET=replace-me

# ── MinIO (server-side, usado por las API routes de Next.js) ─────────────
# Las API routes de Next.js suben y eliminan archivos de MinIO directamente.
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_URL=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=voice-profiles
MINIO_REGION=us-east-1

# ── WebSocket del backend (client-side) ───────────────────────────────────
# NEXT_PUBLIC_* se inyecta en el bundle del cliente en tiempo de BUILD.
# En desarrollo apunta a localhost. En producción/K8s se debe rebuildar la imagen.
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

**Notas importantes sobre `NEXT_PUBLIC_*`:**
- Las variables con prefijo `NEXT_PUBLIC_` se incrustan en el bundle JavaScript **en tiempo de build**, no en runtime. Cambiarlas como env vars en K8s después de construir la imagen **no tiene efecto** en componentes cliente.
- Para cambiar la URL del WebSocket en producción es necesario rebuildar la imagen con el valor correcto como ARG de Docker.
- Las variables sin `NEXT_PUBLIC_` (como `DATABASE_URL`, `JWT_SECRET`, `MINIO_*`) sí funcionan en runtime porque las usan las API Routes del servidor.

---

## 3. Kubernetes — ConfigMap y Secrets

En K8s no se usan archivos `.env`. Las variables se definen en `k8s/verbanota-stack.yaml`.

### ConfigMap `verbanota-config` (valores no sensibles)

```yaml
data:
  MINIO_ENDPOINT: "http://minio:9000"   # Servicio MinIO dentro del cluster
  MINIO_BUCKET: "voice-profiles"
  BACKEND_HOST: "backend"
  BACKEND_PORT: "8000"
  FRONTEND_HOST: "frontend"
  FRONTEND_PORT: "3000"
```

### Secret `minio-credentials` (credenciales MinIO)

```yaml
stringData:
  MINIO_ROOT_USER: "minioadmin"         # Para el contenedor MinIO
  MINIO_ROOT_PASSWORD: "minioadmin"     # Para el contenedor MinIO
  MINIO_ACCESS_KEY: "minioadmin"        # Para backend (models.py) y frontend (s3.ts)
  MINIO_SECRET_KEY: "minioadmin"        # Para backend (models.py) y frontend (s3.ts)
```

> En producción generar credenciales seguras:
> ```bash
> kubectl create secret generic minio-credentials -n verbanota \
>   --from-literal=MINIO_ROOT_USER=adminuser \
>   --from-literal=MINIO_ROOT_PASSWORD=$(openssl rand -base64 32) \
>   --from-literal=MINIO_ACCESS_KEY=adminuser \
>   --from-literal=MINIO_SECRET_KEY=$(openssl rand -base64 32)
> ```

### Secret `app-credentials` (base de datos y JWT)

```yaml
stringData:
  JWT_SECRET: "change-me-in-production"
  DATABASE_URL: "postgresql://verbanota:verbanota@postgres:5432/verbanota"
```

> En producción:
> ```bash
> kubectl create secret generic app-credentials -n verbanota \
>   --from-literal=JWT_SECRET=$(openssl rand -base64 48) \
>   --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db"
> ```

### Variables inyectadas por componente en K8s

| Variable | Backend | Frontend | Fuente |
|---|:---:|:---:|---|
| `MINIO_ENDPOINT` | ✓ | ✓ | ConfigMap `verbanota-config` |
| `MINIO_BUCKET` | ✓ | ✓ | ConfigMap `verbanota-config` |
| `MINIO_ACCESS_KEY` | ✓ | ✓ | Secret `minio-credentials` |
| `MINIO_SECRET_KEY` | ✓ | ✓ | Secret `minio-credentials` |
| `DATABASE_URL` | — | ✓ | Secret `app-credentials` |
| `JWT_SECRET` | — | ✓ | Secret `app-credentials` |
| `HF_HOME` | ✓ | — | Literal `/app/.cache` |
| `PYTORCH_CUDA_ALLOC_CONF` | ✓ | — | Literal |
| `NEXT_PUBLIC_WS_URL` | — | ✓ | Literal (solo Server Components) |

---

## 4. Tabla comparativa por entorno

| Variable | Desarrollo local | Docker/K8s |
|---|---|---|
| `MINIO_ENDPOINT` | `http://localhost:9000` | `http://minio:9000` |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/translateapp` | `postgresql://user:pass@postgres:5432/verbanota` |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8000/ws` | Baked en build (ver nota) |

---

## 5. Arranque en desarrollo local

### Requisitos previos

1. **PostgreSQL** corriendo en `localhost:5432`
2. **MinIO** corriendo en `localhost:9000`:
   ```bash
   docker run -d --name minio \
     -p 9000:9000 -p 9001:9001 \
     -e MINIO_ROOT_USER=minioadmin \
     -e MINIO_ROOT_PASSWORD=minioadmin \
     minio/minio server /data --console-address :9001
   ```

### Backend

```bash
cd backend

# Crear .env si no existe (copiar del ejemplo)
cp ../.env.example .env
# Ajustar MINIO_ENDPOINT=http://localhost:9000

# Instalar dependencias
d:\translateapp\.venv\Scripts\pip install -r requirements.txt

# Arrancar (ejecutar desde backend/ para que python -m funcione)
d:\translateapp\.venv\Scripts\python -m app.server
```

### Frontend

```bash
cd frontend

# Crear .env.local si no existe
cp .env.local.example .env.local   # o crear manualmente
# Ajustar DATABASE_URL y JWT_SECRET

# Instalar y arrancar
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

---

## 6. Variables que NO se deben comitear

Los siguientes archivos están (y deben estar) en `.gitignore`:

```
backend/.env
frontend/.env.local
```

El archivo `k8s/verbanota-stack.yaml` contiene valores de ejemplo en los Secrets (`stringData`). En un repositorio público o de producción, los Secrets deben crearse con `kubectl create secret` o con una herramienta de gestión de secretos (Sealed Secrets, Vault, etc.) y **no** mantener los valores en el YAML comiteado.
