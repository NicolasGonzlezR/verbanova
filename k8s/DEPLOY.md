# Guía de despliegue en Kubernetes

## Requisitos previos

- Cluster Kubernetes con `kubectl` configurado
- [nginx-ingress-controller](https://kubernetes.github.io/ingress-nginx/) instalado en el cluster
- Registro de imágenes Docker accesible desde el cluster (Docker Hub, GHCR, ECR, etc.)
- PostgreSQL accesible desde el cluster (RDS, CloudSQL, o StatefulSet propio)
- MinIO accesible desde el cluster (self-hosted o compatible S3)
- *(Opcional)* Nodo con GPU NVIDIA y [device plugin](https://github.com/NVIDIA/k8s-device-plugin) instalado

---

## Paso 1 — Construir y publicar las imágenes Docker

Desde la raíz del repositorio:

```bash
# Backend
docker build -f Dockerfile.backend -t YOUR_REGISTRY/translateapp-backend:latest .
docker push YOUR_REGISTRY/translateapp-backend:latest

# Frontend
docker build -f web/Dockerfile -t YOUR_REGISTRY/translateapp-frontend:latest ./web
docker push YOUR_REGISTRY/translateapp-frontend:latest
```

Sustituye `YOUR_REGISTRY` por tu registro real (ej. `ghcr.io/tu-usuario` o `tu-usuario` en Docker Hub).

---

## Paso 2 — Crear el namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

Verifica:

```bash
kubectl get namespace translateapp
```

---

## Paso 3 — Configurar Secrets

Edita `k8s/secrets.yaml` y rellena los valores reales **antes de aplicarlo**:

| Campo | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL |
| `JWT_SECRET` | Clave aleatoria larga (mín. 32 chars) |
| `MINIO_ACCESS_KEY` | Usuario MinIO |
| `MINIO_SECRET_KEY` | Contraseña MinIO |

```bash
kubectl apply -f k8s/secrets.yaml
```

> **Importante:** No subas `secrets.yaml` con valores reales al repositorio. Considera usar [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) o un gestor de secretos externo.

---

## Paso 4 — Configurar ConfigMap

Edita `k8s/configmap.yaml` y ajusta:

- `NEXT_PUBLIC_WS_URL` → `wss://TU_DOMINIO/ws`
- `MINIO_ENDPOINT` / `MINIO_PUBLIC_URL` → URL real de MinIO

```bash
kubectl apply -f k8s/configmap.yaml
```

---

## Paso 5 — Crear volúmenes persistentes

```bash
kubectl apply -f k8s/pvc.yaml
```

Verifica que los PVCs quedan en estado `Bound`:

```bash
kubectl get pvc -n translateapp
```

Si quedan en `Pending`, revisa que tu cluster tiene un `StorageClass` disponible:

```bash
kubectl get storageclass
```

Edita `k8s/pvc.yaml` y descomenta `storageClassName` con el nombre correcto.

---

## Paso 6 — Desplegar el backend

Edita `k8s/backend-deployment.yaml`:

1. Sustituye `YOUR_REGISTRY/translateapp-backend:latest` por tu imagen real
2. Si el nodo tiene GPU NVIDIA, descomenta:
   - El bloque `nvidia.com/gpu: "1"` en `resources.limits`
   - El bloque `affinity` al final del archivo

```bash
kubectl apply -f k8s/backend-deployment.yaml
```

Espera a que el pod arranque (puede tardar 1-2 minutos en primera ejecución):

```bash
kubectl rollout status deployment/backend -n translateapp
kubectl logs -f deployment/backend -n translateapp
```

Comprueba el health check:

```bash
kubectl exec -n translateapp deployment/backend -- \
  python3.11 -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

---

## Paso 7 — Desplegar el frontend

Edita `k8s/frontend-deployment.yaml` y sustituye `YOUR_REGISTRY/translateapp-frontend:latest`.

```bash
kubectl apply -f k8s/frontend-deployment.yaml
kubectl rollout status deployment/frontend -n translateapp
```

El frontend ejecuta las migraciones de Prisma en el primer arranque. Verifica los logs:

```bash
kubectl logs -f deployment/frontend -n translateapp
```

---

## Paso 8 — Configurar el Ingress

Edita `k8s/ingress.yaml`:

1. Sustituye `YOUR_DOMAIN` por tu dominio real (ej. `translate.miempresa.com`)
2. Si usas TLS con cert-manager, descomenta los bloques `tls` y la anotación `cert-manager.io/cluster-issuer`

```bash
kubectl apply -f k8s/ingress.yaml
```

Verifica que el Ingress tiene IP asignada:

```bash
kubectl get ingress -n translateapp
```

---

## Paso 9 — Ejecutar migraciones de base de datos

Si la base de datos es nueva, ejecuta las migraciones de Prisma desde el pod del frontend:

```bash
kubectl exec -n translateapp deployment/frontend -- \
  npx prisma migrate deploy
```

---

## Paso 10 — Verificar el despliegue completo

```bash
# Estado general
kubectl get all -n translateapp

# Logs en tiempo real
kubectl logs -f deployment/backend -n translateapp
kubectl logs -f deployment/frontend -n translateapp
```

Abre `https://TU_DOMINIO` en el navegador y comprueba que:

- [ ] La página de login carga correctamente
- [ ] Puedes registrar un usuario
- [ ] La sección Voice Cloning permite subir un perfil
- [ ] La página Translate conecta al WebSocket y carga modelos
- [ ] La traducción en tiempo real funciona con audio

---

## Actualizar una imagen (re-deploy)

```bash
# Construir nueva versión
docker build -f Dockerfile.backend -t YOUR_REGISTRY/translateapp-backend:v1.1 .
docker push YOUR_REGISTRY/translateapp-backend:v1.1

# Actualizar en el cluster
kubectl set image deployment/backend \
  backend=YOUR_REGISTRY/translateapp-backend:v1.1 \
  -n translateapp

kubectl rollout status deployment/backend -n translateapp
```

---

## Solución de problemas frecuentes

### Pod del backend en CrashLoopBackOff

```bash
kubectl describe pod -n translateapp -l app=backend
kubectl logs -n translateapp -l app=backend --previous
```

Causas comunes:
- PVC no montado correctamente (`.cache` vacío, modelos no descargados)
- GPU no disponible en el nodo y `nvidia.com/gpu` configurado

### WebSocket desconecta inmediatamente

Verifica que el Ingress tiene los timeouts correctos:

```bash
kubectl describe ingress translateapp-ingress -n translateapp
```

Las anotaciones `proxy-read-timeout` y `proxy-send-timeout` deben ser `3600`.

### Modelos se descargan cada vez que reinicia el pod

El PVC `model-cache-pvc` no se está montando en `/app/.cache`. Verifica:

```bash
kubectl describe pod -n translateapp -l app=backend | grep -A5 Mounts
kubectl get pvc model-cache-pvc -n translateapp
```

### Error de base de datos en el frontend

```bash
kubectl exec -n translateapp deployment/frontend -- \
  npx prisma db push --accept-data-loss
```
