# Reporte de Redundancia y Archivos Sobrantes

## 🔴 CRÍTICO - Duplicados que Deben Eliminarse

### web/ vs frontend/ (DUPLICADO COMPLETO)
```
web/src/                  ← ELIMINAR (duplicado en frontend/)
web/public/               ← ELIMINAR (duplicado en frontend/)
web/package.json          ← ELIMINAR (duplicado en frontend/)
web/package-lock.json     ← ELIMINAR (duplicado en frontend/)
web/Dockerfile            ← ELIMINAR (duplicado en frontend/)
web/jest.config.js        ← ELIMINAR (duplicado en frontend/)
web/jest.env.setup.js     ← ELIMINAR (duplicado en frontend/)
web/tsconfig.json         ← ELIMINAR (duplicado en frontend/)
```

**Conservar**:
- `web/DEPRECATED.md` ← Mantener (explica migración)

---

## 🟠 ALTO IMPACTO - Build/Cache que NO deberían estar en Git

```
web/.next/                ← BUILD OUTPUT (debería estar en .gitignore)
web/node_modules/         ← DEPENDENCIAS (debería estar en .gitignore)
frontend/.next/           ← BUILD OUTPUT (debería estar en .gitignore)
frontend/node_modules/    ← DEPENDENCIAS (debería estar en .gitignore)
__pycache__/              ← PYTHON CACHE (debería estar en .gitignore)
.pytest_cache/            ← PYTEST CACHE (debería estar en .gitignore)
.venv/                    ← VIRTUAL ENV (debería estar en .gitignore)
.cache/                   ← MODEL CACHE (debería estar en .gitignore)
```

---

## 🟡 MEDIO - Datos Generados en Runtime

```
web/uploads/              ← DATOS DEL USUARIO (ignorar en .gitignore)
docs/reports/             ← REPORTES GENERADOS (ignorar en .gitignore)
web/.next/                ← BUILD NEXT.JS (ignorar en .gitignore)
```

---

## 🟢 INFO - Archivos que Sí Pertenecen

```
.claude/                  ← Configuración Claude Code (local)
.github/workflows/        ← CI/CD (MANTENER)
frontend/                 ← CÓDIGO PRINCIPAL
backend/                  ← CÓDIGO PRINCIPAL
```

---

## 📋 Plan de Limpieza

### Fase 1: Mejorar .gitignore (SIN ELIMINAR ARCHIVOS)
```bash
# Agregar cobertura para:
- web/.next/
- web/node_modules/
- frontend/.next/
- frontend/node_modules/
- __pycache__/
- .pytest_cache/
- .venv/
- .cache/
- web/uploads/
- docs/reports/
- *.egg-info/
- build/
- dist/
- .DS_Store
```

### Fase 2: Eliminar Duplicados en web/
```bash
# MANTENER SOLO:
- web/DEPRECATED.md

# ELIMINAR:
- web/src/
- web/public/
- web/package.json
- web/package-lock.json
- web/Dockerfile
- web/tsconfig.json
- web/jest.config.js
- web/jest.env.setup.js
- web/middleware.ts
- web/next.config.ts
```

---

## 💾 Impacto en Git

**Archivos que están en Git pero NO DEBERÍAN**:
- .next/ builds (frontend + web)
- node_modules (frontend + web)
- __pycache__ (root + backend/app)
- .pytest_cache
- .venv
- .cache (Models)
- web/uploads/*
- docs/reports/*

**Tamaño estimado a recuperar**: ~500MB+

---

## ✅ Resultado Final Esperado

```
translateapp/
├── frontend/              # Código actual
│   ├── src/
│   ├── public/
│   ├── Dockerfile
│   ├── package.json
│   └── ... (ÚNICO LUGAR)
│
├── web/                   # SOLO web/DEPRECATED.md
│   └── DEPRECATED.md
│
├── backend/
│   ├── app/
│   ├── Dockerfile
│   └── requirements.txt
│
└── ... (resto igual)
```

---

## 🔧 Comandos para Ejecutar

```bash
# 1. Actualizar .gitignore
# (Ver sección abajo)

# 2. Eliminar contenido duplicado de web/
rm -rf web/src web/public web/.next web/node_modules web/uploads
rm -f web/package.json web/package-lock.json web/Dockerfile
rm -f web/tsconfig.json web/jest.config.js web/jest.env.setup.js
rm -f web/middleware.ts web/next.config.ts

# 3. Remover archivos de git (pero no del disco)
git rm --cached web/src web/public web/package.json ... (ver abajo)

# 4. Commit
git commit -m "Eliminar duplicados web/ y mejorar .gitignore"
```

