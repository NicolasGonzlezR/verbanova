# Documentacion de TranslateApp

## 1. Descripcion general

TranslateApp es una aplicacion web para traduccion de voz en tiempo real con clonacion de voz. El usuario habla por el microfono del navegador y escucha la traduccion con su propia voz (o cualquier voz de referencia registrada).

El sistema tiene dos modos principales:

- **Translate**: traduccion en tiempo real frase a frase desde el microfono.
- **Subtitle**: sube un archivo de audio o video y genera subtitulos traducidos descargables.

## 2. Flujo funcional (pipeline — modo Translate)

1. Captura de audio en el navegador mediante Web Audio API (`ScriptProcessorNode`).
2. El audio se envía por WebSocket al backend como chunks PCM16 en base64.
3. `PhraseSegmenter` acumula muestras y aplica Silero VAD para detectar frases completas.
4. Cada frase detectada es transcrita por Whisper.
5. El texto transcrito es traducido por NLLB-200.
6. XTTS v2 sintetiza la traduccion usando el perfil de voz del usuario.
7. El audio sintetizado se devuelve por WebSocket y se reproduce en el navegador.

## 3. Arquitectura del proyecto

```
Navegador (Next.js)  ←→  FastAPI WebSocket (server_ws.py)  →  ModelManager (models.py)
        ↓                                                              ↓
  API Routes (Next.js)                                        pipeline.py / vad.py
        ↓                        ↓
  PostgreSQL (Prisma)       MinIO (S3)
                         [perfiles de voz]
```

### 3.1 Frontend — Next.js (web/)

Archivo base: `web/src/app/`

Paginas principales:

| Ruta | Funcion |
|---|---|
| `/translate` | Captura microfono, conecta WebSocket, reproduce audio traducido |
| `/subtitle` | Sube archivo, conecta WebSocket `/ws/subtitle`, descarga SRT |
| `/voice-cloning` | Graba o sube WAV de referencia, gestiona perfiles de voz |
| `/login`, `/register` | Autenticacion JWT |

Componentes de infraestructura:

- `lib/prisma.ts` — cliente Prisma (acceso a base de datos)
- `lib/s3.ts` — cliente AWS SDK compatible con MinIO (almacenamiento de archivos)
- `lib/auth.ts` — utilidades JWT
- `api/profiles/` — endpoints REST para CRUD de perfiles de voz
- `api/auth/` — endpoints de login, registro y sesion

### 3.2 Backend — FastAPI WebSocket (server_ws.py)

Endpoints:

| Endpoint | Tipo | Funcion |
|---|---|---|
| `GET /health` | HTTP | Estado del servidor y si los modelos estan cargados |
| `WS /ws` | WebSocket | Traduccion en tiempo real |
| `WS /ws/subtitle` | WebSocket | Procesamiento de archivos de subtitulos |

El servidor es un singleton de modelos compartido entre conexiones. Los modelos se cargan la primera vez que un cliente conecta.

La carga de modelos se ejecuta en un executor separado (`run_in_executor`) para no bloquear el event loop. Un heartbeat cada 2s mantiene informado al cliente durante la carga.

El servidor se lanza con `ws_ping_interval=None` para evitar que uvicorn cierre la conexion durante la carga inicial de modelos (que puede durar 40-120 s).

### 3.3 Segmentacion de frases (vad.py)

`PhraseSegmenter` recibe muestras de audio continuas y:

- Acumula muestras mientras detecta voz (probabilidad Silero VAD).
- Cierra frase cuando detecta silencio suficiente (`silence_ms_to_split`) o se supera duracion maxima (`max_phrase_seconds`).
- Descarta segmentos demasiado cortos (`min_phrase_ms`) para reducir falsos positivos.

### 3.4 Procesamiento NLP/TTS (pipeline.py)

`ProcessingWorker` consume frases detectadas por VAD y ejecuta en orden:

1. `transcribe()` — Whisper (STT)
2. `translate()` — NLLB-200 (MT)
3. `synthesize()` — XTTS v2 (TTS con perfil de voz)

Los resultados de texto se envian por WebSocket al cliente. El audio sintetizado se codifica en base64 y se envía como mensaje `{"type": "audio", ...}`.

### 3.5 Gestion de modelos (models.py)

`ModelManager` centraliza la carga, configuracion y uso de todos los modelos:

| Modelo | Funcion |
|---|---|
| Silero VAD | Deteccion de voz/silencio |
| Whisper | Transcripcion (STT) |
| NLLB-200 | Traduccion de texto (MT) |
| XTTS v2 | Sintesis de voz clonada (TTS) |

Caracteristicas:

- Seleccion automatica de dispositivo: `auto` (CUDA si disponible), `gpu`, `cpu`.
- Recarga de Whisper en caliente al cambiar de tamano de modelo.
- Conversion automatica de perfiles WebM/MP3 a WAV mediante `imageio-ffmpeg`.
- Glosario de nombres (`config/names.txt`): protege nombres propios durante la traduccion.
- `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` para reducir fragmentacion CUDA.
- Resolucion automatica del speaker WAV desde MinIO: si el archivo no esta en `.cache/speakers/`, se descarga de MinIO usando `boto3` antes de la sintesis.

## 4. Idiomas soportados

Configurados en `server_ws.py` (`_LANG_CODES`):

| Idioma | Whisper | NLLB | XTTS |
|---|---|---|---|
| English | `en` | `eng_Latn` | `en` |
| Spanish | `es` | `spa_Latn` | `es` |
| Japanese | `ja` | `jpn_Jpan` | `ja` |
| Chinese | `zh` | `zho_Hans` | `zh-cn` |

## 5. Requisitos del entorno

- Python 3.10+.
- Node.js 18+.
- PostgreSQL (local o remoto).
- Microfono y navegador moderno (Chrome/Edge recomendado).
- Conexion a internet en primer arranque (descarga de modelos ~3-5 GB).
- CUDA 12+ (opcional, mejora rendimiento significativamente).
- SO: Windows 10/11 o Linux (AlmaLinux 9 / RHEL 9 / Ubuntu 22.04+).

Dependencias clave Python (`requirements.txt`):

- `torch==2.5.1`, `torchaudio==2.5.1`
- `openai-whisper`
- `transformers==4.41.2`, `sentencepiece`
- `TTS>=0.22.0` (Coqui XTTS)
- `fastapi`, `uvicorn`
- `imageio-ffmpeg` (conversion de formatos de audio)
- `boto3>=1.34.0` (acceso a MinIO / S3 desde el backend)

Servicios adicionales requeridos en produccion:

- **MinIO** — almacenamiento de objetos S3-compatible para perfiles de voz (ver seccion 14).
- **Kubernetes** — orquestacion de contenedores (ver seccion 12).

## 6. Instalacion (Windows)

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1
```

Para instalar con soporte CUDA (NVIDIA):

```powershell
.\scripts\setup_windows.ps1 -UseCuda
```

El script:

- Crea `.venv`.
- Instala dependencias Python.
- Crea `.cache/` local y redirige todas las caches del sistema a ese directorio.

Configuracion del frontend:

```powershell
cd web
npm install
npx prisma migrate deploy
```

## 6b. Instalacion en Linux (AlmaLinux 9 / RHEL 9)

### Dependencias del sistema

```bash
# Herramientas base
sudo dnf install -y git python3.11 python3.11-devel python3-pip libsndfile

# Node.js 20 (via NodeSource)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# PostgreSQL
sudo dnf install -y postgresql-server postgresql
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql

# ffmpeg (requiere EPEL + RPM Fusion)
sudo dnf install -y epel-release
sudo dnf install -y --nogpgcheck \
  https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-$(rpm -E %rhel).noarch.rpm
sudo dnf install -y ffmpeg
```

### Entorno Python

```bash
python3.11 -m venv .venv
source .venv/bin/activate

# PyTorch con CUDA 12.4 (GPU NVIDIA)
pip install torch==2.5.1 torchaudio==2.5.1 \
  --index-url https://download.pytorch.org/whl/cu124

# Sin GPU (solo CPU)
pip install torch==2.5.1 torchaudio==2.5.1

# Resto de dependencias
pip install -r requirements.txt
```

### CUDA en AlmaLinux (opcional)

Si el servidor tiene GPU NVIDIA, instala el driver y CUDA toolkit desde el repositorio oficial de NVIDIA para RHEL 9:

```bash
# Repositorio NVIDIA
sudo dnf config-manager --add-repo \
  https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo
sudo dnf install -y cuda-toolkit-12-4 nvidia-driver
sudo reboot
```

Verifica tras el reinicio:

```bash
nvidia-smi
python3.11 -c "import torch; print(torch.cuda.is_available())"
```

### Variables de entorno para caches locales

Añade al fichero `~/.bashrc` (o ejecuta en la sesion antes de arrancar):

```bash
export PIP_CACHE_DIR="$(pwd)/.cache/pip"
export HF_HOME="$(pwd)/.cache/huggingface"
export TORCH_HOME="$(pwd)/.cache/torch"
export TTS_HOME="$(pwd)/.cache/tts"
export XDG_CACHE_HOME="$(pwd)/.cache"
export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"
```

### Frontend

```bash
cd web
npm install
npx prisma migrate deploy
```

### Ejecucion en Linux

```bash
# Terminal 1 — Backend
source .venv/bin/activate
python server_ws.py

# Terminal 2 — Frontend
cd web
npm run dev
```

Para ejecutar en segundo plano con `systemd`, ver la seccion de despliegue K8s ([k8s/DEPLOY.md](../k8s/DEPLOY.md)) o usar `screen`/`tmux`.

## 7. Perfiles de voz

Los perfiles de voz se gestionan desde la pagina `/voice-cloning` de la aplicacion web.

El usuario puede:
- Grabar su voz directamente en el navegador (recomendado: 5-15 segundos de voz clara).
- Subir un archivo WAV, MP3, WebM u OGG.

Los archivos de voz se almacenan en **MinIO** bajo la clave `profiles/{userId}/{timestamp}-{name}.{ext}` y su metadata en la base de datos (`VoiceProfile`). En desarrollo local sin MinIO configurado, la aplicacion devuelve error 500 al intentar subir o reproducir perfiles — es necesario levantar MinIO o usar el despliegue en Kubernetes.

**La seleccion de un perfil de voz es obligatoria** para iniciar la traduccion en tiempo real. Sin perfil, el boton Start permanece deshabilitado.

Los archivos en formatos distintos a WAV (WebM, MP3, etc.) se convierten automaticamente al cargarlos para su uso con XTTS.

## 8. Ejecucion

Ver [LAUNCH.md](LAUNCH.md) para instrucciones completas.

Resumen:

```powershell
# Terminal 1 — Backend
.\.venv\Scripts\activate
python server_ws.py
```

```powershell
# Terminal 2 — Frontend
cd web
npm run dev
```

Abre `http://localhost:3000`.

Flujo de uso recomendado:

1. Registrar usuario y hacer login.
2. Ir a **Voice Cloning** y crear al menos un perfil de voz.
3. Ir a **Translate**, seleccionar idiomas y perfil de voz.
4. Pulsar **Start** y hablar. Esperar el estado "Ready" (carga de modelos ~40-120 s la primera vez).
5. Pulsar **Stop** para finalizar.

## 9. Protocolo WebSocket

### /ws — Traduccion en tiempo real

**Cliente → Servidor:**

```json
{"type": "start", "config": {"input_lang": "English", "target_lang": "Spanish", "whisper_model_size": "medium", "device_preference": "auto", "speaker_profile": "profiles/{userId}/{timestamp}-{name}.wav"}}
{"type": "audio", "data": "<base64 PCM16>"}
{"type": "stop"}
```

**Servidor → Cliente:**

```json
{"type": "status", "state": "loading|ready|error", "message": "..."}
{"type": "text", "transcribed": "...", "translated": "..."}
{"type": "audio", "data": "<base64 PCM16>", "sample_rate": 24000}
{"type": "metrics", "stt_ms": 120, "translate_ms": 80, "tts_ms": 400, "total_ms": 600}
```

### /ws/subtitle — Subtitulos desde archivo

**Cliente → Servidor:**

```json
{"type": "start", "filename": "video.mkv", "source_lang": "English", "target_lang": "Spanish"}
{"type": "chunk", "data": "<base64>"}
{"type": "end"}
```

**Servidor → Cliente:**

```json
{"type": "progress", "percent": 45}
{"type": "segment", "start": 1.2, "end": 3.8, "text": "...", "translated": "..."}
{"type": "done"}
```

## 10. Rendimiento y latencia esperada

- Primer arranque: descarga + carga de modelos 2-5 minutos.
- Reinicios posteriores: 40-120 s (modelos en cache local).
- Latencia por frase: 1-5 s segun hardware y tamano de modelos.
- Con GPU NVIDIA: latencia significativamente menor, especialmente en XTTS.
- Modelos recomendados segun RAM disponible:
  - <8 GB RAM: `tiny` o `small`
  - 8-16 GB RAM: `medium`
  - 16+ GB RAM o GPU: `turbo` o `medium`

## 11. Problemas comunes

### No aparece audio traducido en el navegador

- Verifica que has seleccionado un perfil de voz en `/voice-cloning`.
- Comprueba los logs del backend — si dice "Speaker WAV not found locally or in MinIO", el perfil esta corrupto o MinIO no esta accesible; elimina el perfil y vuelve a crearlo.
- El navegador puede bloquear la reproduccion automatica; comprueba la consola del navegador.

### WebSocket se desconecta durante la carga de modelos

- Asegurate de lanzar el backend con `python server_ws.py` (no con `uvicorn` directamente).
- El `__main__` del servidor configura `ws_ping_interval=None` para evitar timeouts durante la carga.

### MemoryError al cargar modelos

- Usa un modelo Whisper mas pequeno (`tiny` o `small`).
- Fuerza CPU desde el selector de dispositivo en el frontend.
- Cierra otras aplicaciones pesadas antes de iniciar.

### Error al subir perfil de voz (formato WebM/MP3)

- La conversion es automatica mediante `imageio-ffmpeg`. Si falla, instala `imageio-ffmpeg`:
  ```powershell
  pip install imageio-ffmpeg
  ```

### Base de datos no conecta

- Verifica que PostgreSQL este corriendo y que `DATABASE_URL` en `web/.env` sea correcto.
- Ejecuta las migraciones: `cd web && npx prisma migrate deploy`.

## 12. Despliegue en Kubernetes

Los manifiestos de Kubernetes se encuentran en `k8s/`. El namespace de la aplicacion es `translateapp`.

| Fichero | Recurso |
|---|---|
| `namespace.yaml` | Namespace `translateapp` |
| `secrets.yaml` | Credenciales DB, JWT, MinIO |
| `configmap.yaml` | Variables de entorno no secretas |
| `pvc.yaml` | PersistentVolumeClaim para modelos ML |
| `backend-deployment.yaml` | Deployment del backend FastAPI |
| `frontend-deployment.yaml` | Deployment del frontend Next.js |
| `ingress.yaml` | Ingress HTTP/HTTPS |
| `hpa.yaml` | HorizontalPodAutoscaler del frontend |
| `minio.yaml` | StatefulSet MinIO + Service + PVC |

### Aplicar todos los manifiestos

```bash
kubectl apply -f k8s/ --namespace translateapp
```

### Autoescalado (HPA)

El frontend escala automaticamente entre 2 y 6 replicas segun carga:

- CPU media > 70% → aumenta replicas (max +2 por minuto).
- Memoria media > 80% → aumenta replicas.
- Baja cuando la carga desaparece durante 5 minutos consecutivos (max -1 replica por minuto).

```bash
kubectl get hpa -n translateapp
```

Ver [k8s/DEPLOY.md](../k8s/DEPLOY.md) para la guia completa de instalacion de k3s y el runner de CI/CD.

## 13. Pipeline CI/CD (GitHub Actions)

El fichero `.github/workflows/ci.yml` define 4 jobs que se ejecutan en orden:

| Job | Runner | Cuando se ejecuta |
|---|---|---|
| `test-backend` | ubuntu-latest | Push y PR a `main` |
| `test-frontend` | ubuntu-latest | Push y PR a `main` |
| `build-push` | ubuntu-latest | Solo push a `main` (tras tests) |
| `deploy` | self-hosted (AlmaLinux VM) | Solo push a `main` (tras build) |

**test-backend**: instala `libsndfile` + `ffmpeg`, instala `requirements-test.txt` (torch CPU desde PyPI) y ejecuta `pytest tests/ -v`.

**test-frontend**: instala dependencias npm y ejecuta `npm test` con variables de entorno de prueba.

**build-push**: construye imagenes Docker y las publica en GitHub Container Registry (`ghcr.io`):
- `ghcr.io/{repo}-backend:{sha}` y `:latest`
- `ghcr.io/{repo}-frontend:{sha}` y `:latest`

**deploy**: se ejecuta en un runner auto-hospedado instalado en una de las VMs AlmaLinux (necesario porque las VMs tienen IPs privadas `192.x.x.x` no accesibles desde la nube de GitHub). El job parchea las imagenes en los manifiestos y ejecuta `kubectl apply`.

### Instalar el runner en AlmaLinux

```
GitHub → Settings → Actions → Runners → New self-hosted runner → Linux x64
```
Sigue los comandos generados por GitHub (descarga + configure + run como servicio).

## 14. Almacenamiento de objetos — MinIO

MinIO proporciona almacenamiento S3-compatible para los archivos de audio de los perfiles de voz (Big Data storage tier del proyecto).

Se despliega como `StatefulSet` en Kubernetes (`k8s/minio.yaml`) con un PVC de 10 Gi.

| Variable de entorno | Descripcion |
|---|---|
| `MINIO_ENDPOINT` | URL interna del servicio, p.ej. `http://minio-service:9000` |
| `MINIO_ACCESS_KEY` | Usuario/clave de acceso |
| `MINIO_SECRET_KEY` | Clave secreta |
| `MINIO_BUCKET` | Nombre del bucket, por defecto `voice-profiles` |

El bucket se crea automaticamente la primera vez que se sube un perfil (`ensureBucket()`).

**Frontend** (`lib/s3.ts`): usa `@aws-sdk/client-s3` con cliente lazy (no falla al importar si MinIO no esta configurado). Funciones exportadas: `putObject`, `getObjectBuffer`, `deleteObject`, `ensureBucket`, `isConfigured`.

**Backend** (`models.py`): descarga el speaker WAV desde MinIO a `.cache/speakers/` usando `boto3` si el archivo no esta en disco local.

### Levantar MinIO en local (desarrollo)

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address :9001
```

Configura `MINIO_ENDPOINT=http://localhost:9000`, `MINIO_ACCESS_KEY=minioadmin`, `MINIO_SECRET_KEY=minioadmin` en `web/.env`.

## 15. Seguridad y datos

- Todo el procesamiento de audio y modelos se ejecuta localmente en el servidor.
- Los perfiles de voz se almacenan en MinIO (self-hosted, no salen a terceros).
- Los modelos se descargan de Hugging Face y repositorios oficiales en el primer uso.
- Las contrasenas se almacenan con hash bcrypt.
- La autenticacion usa JWT con secreto configurable via `JWT_SECRET`.
