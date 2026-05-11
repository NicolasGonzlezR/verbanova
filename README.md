# TranslateApp — Traducción de voz en tiempo real con clonación de voz

Aplicación web para traducción de voz en tiempo real con clonación de voz. Captura audio del micrófono en el navegador, transcribe, traduce y reproduce la voz sintentizada con el timbre de un perfil de voz elegido por el usuario.

## Pipeline

1. Captura de micrófono en el navegador (Web Audio API)
2. Segmentación de frases mediante Silero VAD
3. Transcripción con Whisper
4. Traducción con NLLB-200
5. Síntesis de voz clonada con XTTS v2
6. Reproducción del audio en el navegador

## Arquitectura

| Componente | Tecnología | Puerto |
|---|---|---|
| Frontend | Next.js 16 (App Router) | 3000 |
| Backend | FastAPI + Uvicorn (WebSocket) | 8000 |
| Base de datos | PostgreSQL (Prisma ORM) | 5432 |

## Requisitos

- Python 3.10+
- Node.js 18+
- PostgreSQL
- MinIO (almacenamiento de perfiles de voz — ver `docs/ENVIRONMENT-VARIABLES.md`)
- CUDA 12+ (opcional — CPU funciona con modelos pequeños)

## Instalación

### 0. MinIO (almacenamiento de perfiles de voz)

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
# Copiar y editar el .env del backend
copy .env.example backend\.env

# Crear el .env.local del frontend
copy frontend\.env.local.example frontend\.env.local  # o crear manualmente
```

Ver [`docs/ENVIRONMENT-VARIABLES.md`](docs/ENVIRONMENT-VARIABLES.md) para descripción completa de todas las variables.

### 3. Dependencias del frontend

```powershell
cd frontend
npm install
```

### 4. Base de datos

Crea la base de datos y ejecuta las migraciones:

```powershell
cd frontend
npx prisma migrate deploy
```

Configura la cadena de conexión en `frontend/.env.local`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/translateapp
```

### 5. Variables de entorno del frontend

Edita `frontend/.env.local` con los valores reales:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=clave-secreta-larga
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
```

## Ejecución

Ver [LAUNCH.md](docs/LAUNCH.md) para instrucciones detalladas.

Resumen rápido (dos terminales):

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

Abre `http://localhost:3000` en el navegador.

## Estructura del proyecto

```
translateapp/
├── backend/                    # Servidor FastAPI WebSocket
│   ├── app/
│   │   ├── server.py           # WebSocket: traducción en tiempo real y subtítulos
│   │   ├── models.py           # Carga y gestión de modelos ML
│   │   ├── pipeline.py         # Worker de procesamiento
│   │   └── vad.py              # Segmentador de frases con Silero VAD
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/                   # Aplicación Next.js
│   ├── src/app/
│   │   ├── translate/          # Traducción en tiempo real (micrófono)
│   │   ├── subtitle/           # Generación de subtítulos desde archivo
│   │   └── voice-cloning/      # Gestión de perfiles de voz
│   ├── Dockerfile
│   └── package.json
│
├── k8s/                        # Kubernetes
│   ├── verbanota-stack.yaml    # Manifesto principal (backend + frontend + servicios)
│   ├── hpa.yaml                # Horizontal Pod Autoscaler
│   ├── minio.yaml              # Despliegue MinIO
│   ├── *.sh                    # Scripts de instalación del cluster (AlmaLinux)
│   └── *.md                    # Guías de despliegue K8s
│
├── docs/                       # Documentación
│   ├── DOCUMENTACION.md
│   ├── LAUNCH.md
│   ├── LAB-DEPLOYMENT-GUIDE.md
│   └── ENVIRONMENT-VARIABLES.md
│
├── config/
│   └── names.txt               # Glosario de nombres propios
│
├── tests/                      # Tests del backend (pytest)
└── scripts/                    # Utilidades (generador de reportes, setup, etc.)
```

## Idiomas soportados

| Idioma | Whisper | NLLB | XTTS |
|---|---|---|---|
| Inglés | `en` | `eng_Latn` | `en` |
| Español | `es` | `spa_Latn` | `es` |
| Japonés | `ja` | `jpn_Jpan` | `ja` |
| Chino | `zh` | `zho_Hans` | `zh-cn` |

## Mejora de reconocimiento de nombres

Añade nombres a `config/names.txt` (uno por línea):

```
Nicolas
Maria
Takeshi
王伟
```

Whisper usa esta lista como prompt inicial y los nombres se protegen durante la traducción para no ser alterados.

## Configuración avanzada del backend

Los parámetros del modelo se controlan desde el frontend al conectar. Los valores por defecto están en `ModelConfig` en [backend/app/models.py](backend/app/models.py):

- `whisper_model_size` — `tiny`, `small`, `medium`, `turbo`
- `source_lang_nllb` / `target_lang_nllb` — par de idiomas NLLB
- `device_preference` — `auto`, `gpu`, `cpu`

## Notas

- La primera ejecución descarga ~3-5 GB de modelos (Whisper, NLLB, XTTS, VAD).
- Los modelos se cachean en `.cache/` — reinicios posteriores son rápidos.
- La carga de modelos tarda 40-120 s; la barra de estado inferior del navegador muestra el progreso.
- `torch` está fijado a 2.5.1 por compatibilidad con los checkpoints de XTTS v2.
