# Guía Completa de Despliegue de VerbaNova en Laboratorio

Este documento describe los pasos **exactos** a seguir en el laboratorio para desplegar VerbaNova en 2 clusters Kubernetes en AlmaLinux.

## Requisitos Previos

- Git clonado: `git clone <repo> && cd translateapp`
- Acceso SSH key-based a todos los nodos
- Docker instalado en la máquina de gestión (para construir imágenes)

## Fase 1: Bootstrap Kubernetes (30-45 minutos)

### Paso 1.1: Configurar acceso SSH

```bash
# En tu máquina de gestión
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# Para CADA VM de ambos clusters (6 en total si tienes 2 clusters con 3 nodos):
for ip in 192.168.A.10 192.168.A.11 192.168.A.12 \
          192.168.B.10 192.168.B.11 192.168.B.12; do
  ssh-copy-id -i ~/.ssh/id_ed25519.pub root@$ip
done

# Verificar acceso
ssh root@192.168.A.10 "echo OK"
```

### Paso 1.2: Preparar scripts de instalación

```bash
# Editar setup-clusters.sh con tus IPs reales
nano k8s/setup-clusters.sh

# Actualizar estas líneas con tus direcciones IP reales:
declare -A CLUSTER1=(
    [name]="cluster1"
    [control_plane]="192.168.A.10"        # ← Tu control plane
    [workers]="192.168.A.11 192.168.A.12" # ← Tus workers
)

declare -A CLUSTER2=(
    [name]="cluster2"
    [control_plane]="192.168.B.10"
    [workers]="192.168.B.11 192.168.B.12"
)
```

### Paso 1.3: Ejecutar bootstrap de Kubernetes

```bash
# ESTO TOMA 30-45 MINUTOS - TODO AUTOMÁTICO
bash infrastructure/k8s/scripts/setup-clusters.sh
```

Durante la ejecución:
- Instala prerequisites en todas las VMs
- Inicializa ambos control planes
- Une todos los workers
- Instala Calico CNI

### Paso 1.4: Verificar Kubernetes está listo

```bash
# Cluster 1
ssh root@192.168.A.10 \
  "export KUBECONFIG=/etc/kubernetes/admin.conf && kubectl get nodes"

# Debería mostrar 3 nodos en estado "Ready"
# NAME                STATUS   ROLES           
# cluster1-control    Ready    control-plane   
# cluster1-worker-11  Ready    <none>          
# cluster1-worker-12  Ready    <none>          

# Cluster 2
ssh root@192.168.B.10 \
  "export KUBECONFIG=/etc/kubernetes/admin.conf && kubectl get nodes"
```

---

## Fase 2: Construir Imágenes Docker (15-20 minutos)

### Paso 2.1: Compilar imágenes localmente

En tu máquina de gestión (que tiene Docker):

```bash
cd translateapp

# Construir ambas imágenes (backend y frontend)
bash build-docker-images.sh
```

Esto construye:
- `translateapp-backend:latest` (imagen CUDA de FastAPI)
- `translateapp-frontend:latest` (imagen Node.js de Next.js)

### Paso 2.2: OPCIÓN A - Si tienes un registro privado

Si tu laboratorio tiene un Docker registry (ej: Harbor, registry local):

```bash
# Retagguear con URL del registry
docker tag translateapp-backend:latest my-registry:5000/translateapp-backend:latest
docker tag translateapp-frontend:latest my-registry:5000/translateapp-frontend:latest

# Hacer push
docker push my-registry:5000/translateapp-backend:latest
docker push my-registry:5000/translateapp-frontend:latest

# Actualizar verbanota-stack.yaml con el registry correcto:
# image: my-registry:5000/translateapp-backend:latest
# image: my-registry:5000/translateapp-frontend:latest
```

### Paso 2.3: OPCIÓN B - Sin registry (cargar en nodos)

Si no tienes registry, carga las imágenes directamente en los nodos:

```bash
# Para CADA nodo worker de ambos clusters:
for node_ip in 192.168.A.11 192.168.A.12 192.168.B.11 192.168.B.12; do
  docker save translateapp-backend:latest | \
    ssh root@$node_ip "docker load"
  
  docker save translateapp-frontend:latest | \
    ssh root@$node_ip "docker load"
done

# En verbanota-stack.yaml, cambiar imagePullPolicy a IfNotPresent:
# imagePullPolicy: IfNotPresent
```

---

## Fase 3: Desplegar VerbaNova (15-20 minutos)

### Paso 3.1: Obtener kubeconfigs

```bash
# Descargar kubeconfigs a tu máquina de gestión
bash infrastructure/k8s/scripts/k8s-manage.sh fetch-kubeconfig cluster1 192.168.A.10
bash infrastructure/k8s/scripts/k8s-manage.sh fetch-kubeconfig cluster2 192.168.B.10

# Verificar que se descargaron
bash infrastructure/k8s/scripts/k8s-manage.sh list-clusters
```

### Paso 3.2: Desplegar a Cluster 1

```bash
# Usar kubeconfig de cluster1
export KUBECONFIG=~/.kube/clusters/cluster1-config

# Crear namespace
kubectl create namespace verbanota

# Desplegar MinIO (almacenamiento S3)
kubectl apply -f infrastructure/k8s/manifests/minio.yaml -n verbanota

# Esperar a que MinIO esté listo (2-3 minutos)
kubectl wait --for=condition=Ready pod -l app=minio -n verbanota --timeout=300s

# Desplegar backend + frontend + servicios
kubectl apply -f infrastructure/k8s/manifests/verbanota-stack.yaml -n verbanota

# Esperar a que los pods estén en Running (5-10 minutos)
kubectl wait --for=condition=Ready pod -l app=backend -n verbanota --timeout=600s
kubectl wait --for=condition=Ready pod -l app=frontend -n verbanota --timeout=300s

# Desplegar HPA (autoscaling)
kubectl apply -f infrastructure/k8s/manifests/hpa.yaml -n verbanota
```

### Paso 3.3: Desplegar a Cluster 2

```bash
# Cambiar a kubeconfig de cluster2
export KUBECONFIG=~/.kube/clusters/cluster2-config

# Repetir los mismos comandos:
kubectl create namespace verbanota
kubectl apply -f infrastructure/k8s/manifests/minio.yaml -n verbanota
kubectl wait --for=condition=Ready pod -l app=minio -n verbanota --timeout=300s
kubectl apply -f infrastructure/k8s/manifests/verbanota-stack.yaml -n verbanota
kubectl wait --for=condition=Ready pod -l app=backend -n verbanota --timeout=600s
kubectl wait --for=condition=Ready pod -l app=frontend -n verbanota --timeout=300s
kubectl apply -f infrastructure/k8s/manifests/hpa.yaml -n verbanota
```

---

## Fase 4: Verificar que Todo Funciona (10 minutos)

### Paso 4.1: Revisar estado de los pods

```bash
# Cluster 1
export KUBECONFIG=~/.kube/clusters/cluster1-config
kubectl get pods -n verbanota -o wide

# Debería mostrar:
# NAME                        READY   STATUS    RESTARTS
# backend-xxx                 1/1     Running   0
# frontend-xxx                1/1     Running   0
# frontend-yyy                1/1     Running   0
# minio-0                     1/1     Running   0
```

### Paso 4.2: Acceder a la aplicación (sin Ingress)

```bash
# Cluster 1
export KUBECONFIG=~/.kube/clusters/cluster1-config

# Port-forward al frontend
kubectl port-forward -n verbanota svc/frontend 3000:3000 &
# Abrir navegador: http://localhost:3000

# Port-forward al backend (para testing)
kubectl port-forward -n verbanota svc/backend 8000:8000 &
# Ver OpenAPI docs: http://localhost:8000/docs
```

### Paso 4.3: Probar MinIO

```bash
# Acceder a MinIO console
kubectl port-forward -n verbanota svc/minio 9001:9001 &

# Abrir navegador: http://localhost:9001
# Credentials: minioadmin / minioadmin
```

### Paso 4.4: Ver logs si algo falla

```bash
# Logs del backend
kubectl logs -n verbanota deployment/backend --follow

# Logs del frontend
kubectl logs -n verbanota deployment/frontend --follow

# Descri del pod si está en CrashLoopBackOff
kubectl describe pod -n verbanota -l app=backend
```

---

## Fase 5: Opcional - Configurar Ingress (para acceso externo)

Si necesitas acceder desde fuera del cluster:

```bash
# Instalar NGINX Ingress Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/baremetal/deploy.yaml

# Crear recurso Ingress
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: verbanota
  namespace: verbanota
spec:
  rules:
  - host: verbanota.lab.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 3000
EOF

# Acceder: http://verbanota.lab.local (requiere actualizar /etc/hosts)
```

---

## Checklist Final

- [ ] SSH sin contraseña funciona a todos los nodos
- [ ] `setup-clusters.sh` completó sin errores
- [ ] `kubectl get nodes` muestra todos los nodos en "Ready"
- [ ] Imágenes Docker construidas: `docker images | grep translateapp`
- [ ] Imágenes cargadas en nodos O pusheadas a registry
- [ ] Kubeconfigs descargados: `ls ~/.kube/clusters/`
- [ ] Namespace creado: `kubectl get ns | grep verbanota`
- [ ] Todos los pods en "Running": `kubectl get pods -n verbanota`
- [ ] MinIO accesible: `kubectl port-forward svc/minio 9001:9001`
- [ ] Frontend accesible: `kubectl port-forward svc/frontend 3000:3000`
- [ ] Backend respondiendo: `curl http://localhost:8000/health`

---

## Troubleshooting Rápido

### "Image pull failed"
- Verificar que la imagen está en Docker: `docker images`
- Opción A: Hacer `docker push` a registry
- Opción B: Cargar en nodos: `docker load < image.tar`

### "Pod en CrashLoopBackOff"
```bash
kubectl describe pod <pod-name> -n verbanota
kubectl logs <pod-name> -n verbanota --previous
```

### "Nodos en NotReady"
```bash
# Esperar a que Calico se inicie (2-3 minutos)
kubectl get pods -n calico-system
```

### "WebSocket connection refused"
- Verificar que backend está en "Running": `kubectl get pods -n verbanota`
- Verificar health: `kubectl logs -n verbanota deployment/backend`

---

## Tiempo Total Estimado

- Fase 1 (K8s bootstrap): **30-45 minutos**
- Fase 2 (Construir imágenes): **15-20 minutos**
- Fase 3 (Desplegar): **15-20 minutos**
- Fase 4 (Verificar): **10 minutos**

**Total: 1.5-2 horas para ambos clusters funcionando**
