# 🚀 Cómo Lanzar TranslateApp

## Requisitos Previos
- Python 3.10+ con virtualenv activado (`.venv`)
- Node.js 18+ 
- CUDA 12+ (opcional, CPU funciona)
- Puerto 8000 (backend) y 3000 (frontend) libres

---

## Requisito previo — MinIO

MinIO es necesario para almacenar y recuperar los perfiles de voz. Levántalo con Docker antes de arrancar la aplicación:

```powershell
docker run -d --name minio `
  -p 9000:9000 -p 9001:9001 `
  -e MINIO_ROOT_USER=minioadmin `
  -e MINIO_ROOT_PASSWORD=minioadmin `
  minio/minio server /data --console-address :9001
```

Si ya lo tienes corriendo: `docker start minio`

---

## Opción A: Lanzamiento Manual (Recomendado para desarrollo)

### 1️⃣ Terminal 1 - Backend (FastAPI + WebSocket)
```powershell
cd D:\translateapp\backend
d:\translateapp\.venv\Scripts\python -m app.server
```

> **Importante**: ejecuta desde `backend/` y usa `python -m app.server` (no `uvicorn` directamente).
> El `__main__` configura `ws_ping_interval=None` para evitar que uvicorn
> cierre la conexión WebSocket durante la carga de modelos (~40 s).

**Espera hasta ver:**
```
Uvicorn running on http://0.0.0.0:8000
```

✅ Backend listo

---

### 2️⃣ Terminal 2 - Frontend (Next.js)
```powershell
cd D:\translateapp\frontend
npm run dev
```

**Espera hasta ver:**
```
> next dev
  ▲ Next.js 16.2.4
  - Local:        http://localhost:3000
```

✅ Frontend listo

---

## Opción B: Script de Lanzamiento Automático (Windows)

Crea archivo `LAUNCH.bat` en `D:\translateapp\`:

```batch
@echo off
REM Terminal 1 - Backend
start "TranslateApp Backend" cmd /k "cd D:\translateapp\backend && d:\translateapp\.venv\Scripts\python -m app.server"

REM Espera 3 segundos para que cargue
timeout /t 3 /nobreak

REM Terminal 2 - Frontend
start "TranslateApp Frontend" cmd /k "cd D:\translateapp\frontend && npm run dev"

echo ✓ TranslateApp lanzado
echo   Backend: http://localhost:8000
echo   Frontend: http://localhost:3000
pause
```

**Uso:**
```powershell
D:\translateapp\LAUNCH.bat
```

---

## 📱 Acceso a la App

Abre tu navegador en:
```
http://localhost:3000
```

### Primera vez:
1. Haz clic en **"Register"** 
2. Crea usuario con email y contraseña
3. Inicia sesión
4. Elige entre:
   - **Translate** → Micrófono en tiempo real
   - **Subtitle** → Sube archivo (MKV, MP4, MP3, WAV)

---

## 🔍 Logs en Vivo

Ambas páginas ahora muestran un **panel de logs** al final:

### En `/translate`:
- ✓ Conexión WebSocket
- 📨 Mensajes del servidor
- 🎯 Configuración enviada
- ❌ Errores de conexión

### En `/subtitle`:
- ✓ WebSocket conectado
- 📨 Status de procesamiento
- ⏳ Progreso de traducción
- ✅ Subtítulos generados
- 🔌 Desconexión

---

## 🛠️ Troubleshooting

### ❌ "Port 8000 already in use"
```powershell
# Busca qué proceso usa 8000
netstat -ano | findstr :8000

# Mata el proceso (ej: PID 1234)
taskkill /PID 1234 /F
```

### ❌ "WebSocket Disconnected"
Mira el **panel de logs** en la app para ver el error exacto:
- Si dice CUDA error → reinicia con CPU
- Si dice "connection refused" → backend no está corriendo
- Si dice "timeout" → firewall bloqueando (prueba localhost)

### ❌ "ModuleNotFoundError: No module named 'app'"
Estás ejecutando el backend desde el directorio raíz. Entra en `backend/` primero:
```powershell
cd D:\translateapp\backend
d:\translateapp\.venv\Scripts\python -m app.server
```

### ❌ "ModuleNotFoundError" (dependencias)
```powershell
d:\translateapp\.venv\Scripts\pip install -r backend/requirements.txt
```

### ❌ Models loading muy lentamente (primera vez)
Normal, descarga ~3GB de modelos. Espera.
- Whisper (~2GB)
- NLLB (~1GB)
- XTTS (~200MB)

---

## 🎯 Variables de Entorno (opcional)

En la Terminal del backend, puedes usar:

```powershell
# Forzar CPU (evita CUDA)
$env:PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Luego ejecuta el backend normalmente
python -m app.server
```

> **Importante**: usa siempre `python -m app.server`. El `__main__` configura
> `ws_ping_interval=None` — si lanzas con `uvicorn` directamente perderás esa
> configuración y el WebSocket se desconectará durante la carga de modelos.

---

## 📊 Verificación Final

✅ Backend responde:
```
curl http://localhost:8000/docs
```

✅ Frontend responde:
```
curl http://localhost:3000
```

✅ WebSocket conecta (abre app, mira logs)

---

## 🚨 Emergencia

Para matar todo y empezar:
```powershell
# Mata todos los Python
taskkill /F /IM python.exe

# Mata Node.js
taskkill /F /IM node.exe

# Limpia cache de Next
cd D:\translateapp\frontend
rm -r .next -Force
```

Luego relanza desde la opción A o B.
