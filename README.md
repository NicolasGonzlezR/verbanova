# TranslateApp — Traducción de voz en tiempo real con clonación de voz

Aplicación web para traducción de voz en tiempo real con clonación de voz. Captura audio del micrófono en el navegador, transcribe, traduce y reproduce la voz sintetizada con el timbre de un perfil de voz elegido por el usuario.

## Funcionalidades

- **Traducción en tiempo real** — micrófono → VAD → Whisper → NLLB → XTTS → audio en el navegador
- **Generación de subtítulos** — sube un archivo (MKV, MP4, MP3, WAV) y descarga el SRT traducido
- **Gestión de perfiles de voz** — graba o sube un clip de voz para usarlo como timbre en la síntesis
- **Autenticación** — registro e inicio de sesión con JWT; cada usuario gestiona sus propios perfiles

## Pipeline

```
Micrófono (Web Audio API)
  → Silero VAD          — segmentación de frases
  → Whisper             — transcripción (tiny / small / medium / turbo)
  → NLLB-200            — traducción
  → XTTS v2             — síntesis con clonación de voz
  → Reproducción en el navegador
```

## Arquitectura

| Componente | Tecnología | Puerto |
|---|---|---|
| Frontend | Next.js (App Router) + Prisma ORM | 3000 |
| Backend | FastAPI + Uvicorn (WebSocket) | 8000 |
| Base de datos | PostgreSQL | 5432 |
| Almacenamiento | MinIO (perfiles de voz) | 9000 |

## Requisitos

- Python 3.10+
- Node.js 18+
- PostgreSQL
- MinIO (almacenamiento de perfiles de voz)
- CUDA 12+ (opcional — CPU funciona con modelos `tiny` / `small`)

## Instalación

### 0. MinIO

MinIO almacena los clips de voz. Levántalo con Docker antes de arrancar la aplicación:

```powershell
docker run -d --name minio `
  -p 9000:9000 -p 9001:9001 `
  -e MINIO_ROOT_USER=minioadmin `
  -e MINIO_ROOT_PASSWORD=minioadmin `
  minio/minio server /data --console-address :9001
```

### 1. Entorno Python

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1
```

Para GPU NVIDIA:

```powershell
.\scripts\setup_windows.ps1 -UseCuda
```

El script crea `.venv` y redirige todas las cachés (`HF_HOME`, `TORCH_HOME`, `TTS_HOME`, etc.) a `.cache/` dentro de este directorio.

### 2. Variables de entorno

```powershell
# Backend
copy .env.example backend\.env

# Frontend
copy frontend\.env.local.example frontend\.env.local
```

Ver [`docs/ENVIRONMENT-VARIABLES.md`](docs/ENVIRONMENT-VARIABLES.md) para la descripción completa de todas las variables.

### 3. Dependencias del frontend

```powershell
cd frontend
npm install
```

### 4. Base de datos

```powershell
cd frontend
npx prisma migrate deploy
```

Configura la cadena de conexión en `frontend/.env.local`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/translateapp
```

## Ejecución

Ver [`docs/LAUNCH.md`](docs/LAUNCH.md) para instrucciones detalladas.

```powershell
# Terminal 1 — Backend (ejecutar desde backend/)
cd backend
d:\translateapp\.venv\Scripts\python -m app.server
```

```powershell
# Terminal 2 — Frontend
cd frontend
npm run dev
```

Abre `http://localhost:3000` en el navegador. En el primer inicio regístrate con email y contraseña.

## Tests

El proyecto incluye tests de backend (pytest) y frontend (Jest):

```powershell
# Backend
d:\translateapp\.venv\Scripts\python -m pytest tests/ -v

# Frontend
cd frontend && npm test

# Reporte HTML combinado (docs/reports/test_report.html)
d:\translateapp\.venv\Scripts\python scripts\generate_test_report.py --md
```

## CI/CD

GitHub Actions ejecuta en cada push a `main`:

1. **Backend — pytest** — tests Python sobre el servidor y los modelos
2. **Frontend — Jest** — tests de API routes y utilidades TypeScript
3. **Build & push** — construye y sube imágenes Docker a GHCR (solo si los tests pasan)
4. **Deploy** — aplica los manifiestos en Kubernetes vía self-hosted runner (requiere runner en la VM)

## Estructura del proyecto

```
translateapp/
├── backend/                    # Servidor FastAPI WebSocket
│   ├── app/
│   │   ├── server.py           # WebSocket: traducción en tiempo real y subtítulos
│   │   ├── models.py           # Carga y gestión de modelos ML (Whisper, NLLB, XTTS, VAD)
│   │   ├── pipeline.py         # Worker de procesamiento
│   │   └── vad.py              # Segmentador de frases con Silero VAD
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/                   # Aplicación Next.js
│   ├── src/app/
│   │   ├── translate/          # Traducción en tiempo real (micrófono)
│   │   ├── subtitle/           # Generación de subtítulos desde archivo
│   │   ├── voice-cloning/      # Gestión de perfiles de voz
│   │   └── api/                # API Routes: auth (login/register) y perfiles
│   ├── prisma/schema.prisma    # Esquema PostgreSQL (User, VoiceProfile)
│   ├── Dockerfile
│   └── package.json
│
├── k8s/                        # Kubernetes
│   ├── verbanota-stack.yaml    # Manifesto principal (backend + frontend + servicios)
│   ├── minio.yaml              # Despliegue MinIO
│   ├── hpa.yaml                # Horizontal Pod Autoscaler
│   ├── setup-clusters.sh       # Bootstrap automático de 2 clusters AlmaLinux
│   └── *.sh                    # Scripts de instalación de nodos
│
├── tests/                      # Tests del backend (pytest)
├── scripts/
│   ├── generate_test_report.py # Genera docs/reports/test_report.html
│   └── setup_windows.ps1       # Crea .venv con dependencias Python
│
├── docs/
│   ├── LAUNCH.md               # Instrucciones de arranque detalladas
│   ├── ENVIRONMENT-VARIABLES.md # Guía de variables de entorno
│   ├── LAB-DEPLOYMENT-GUIDE.md # Despliegue K8s paso a paso
│   └── DOCUMENTACION.md        # Documentación técnica completa
│
└── config/
    └── names.txt               # Glosario de nombres propios para Whisper
```

## Idiomas soportados

| Idioma | Whisper | NLLB | XTTS |
|---|---|---|---|
| Inglés | `en` | `eng_Latn` | `en` |
| Español | `es` | `spa_Latn` | `es` |
| Japonés | `ja` | `jpn_Jpan` | `ja` |
| Chino | `zh` | `zho_Hans` | `zh-cn` |

## Glosario de nombres propios

Añade nombres a `config/names.txt` (uno por línea) para mejorar el reconocimiento:

```
Nicolas
Maria
Takeshi
王伟
```

Whisper los usa como prompt inicial y se protegen durante la traducción para no ser alterados.

## Despliegue en Kubernetes

Ver [`docs/LAB-DEPLOYMENT-GUIDE.md`](docs/LAB-DEPLOYMENT-GUIDE.md) para la guía completa de despliegue en 2 clusters AlmaLinux.

Resumen del orden obligatorio de `kubectl apply`:

```bash
kubectl apply -f k8s/verbanota-stack.yaml   # namespace + configmap + secrets + backend + frontend
kubectl apply -f k8s/minio.yaml             # MinIO (requiere el Secret del paso anterior)
kubectl apply -f k8s/hpa.yaml               # Autoscaling (requiere metrics-server)
```

## Notas

- La primera ejecución descarga ~3-5 GB de modelos (Whisper, NLLB, XTTS, VAD). Los modelos se cachean en `.cache/` — reinicios posteriores son inmediatos.
- El backend tarda 40-120 s en cargar los modelos; la barra de estado del navegador muestra el progreso.
- `torch` está fijado a 2.5.1 por compatibilidad con los checkpoints de XTTS v2.
- Lanzar siempre el backend con `python -m app.server` desde `backend/` — no con `uvicorn` directamente, ya que el `__main__` configura `ws_ping_interval=None` para evitar desconexiones durante la carga.
