# ⚠️ DEPRECATED - Frontend moved to `/frontend`

This directory (`web/`) is **deprecated** and kept only for backward compatibility.

## Migration Complete ✅

The frontend code has been reorganized:

- **Old location**: `web/`  
- **New location**: `frontend/`

All official documentation and build scripts now point to `frontend/`.

## What to do:

1. **Use `frontend/` for development**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

2. **Use `frontend/` in scripts**:
   - `build-docker-images.sh` → builds `frontend/Dockerfile`
   - `LAB-DEPLOYMENT-GUIDE.md` → references `frontend/`

3. **Update your workflow**:
   - Replace `cd web` with `cd frontend`
   - Replace `web/.env` with `frontend/.env`
   - Replace `web/Dockerfile` with `frontend/Dockerfile`

## Why the change?

The project structure was reorganized for clarity:

```
✅ New: translateapp/
├── backend/          # FastAPI code
├── frontend/         # Next.js code (canonical location)
├── infrastructure/   # K8s & Docker
├── docs/
├── tests/
└── scripts/
```

## Can I still use `web/`?

Technically yes, but:
- It won't receive updates
- Build scripts point to `frontend/`
- Documentation references `frontend/`
- Future versions may remove `web/`

**Recommendation**: Migrate your local setup to use `frontend/` now.

---

**Migration date**: May 11, 2025  
**Scope**: Frontend code only (no breaking changes to functionality)
