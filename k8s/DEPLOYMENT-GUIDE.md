#!/bin/bash
# VerbaNova Deployment Guide for AlmaLinux K8s Clusters
# For the TranslateApp academic project

## Environment Setup

Your deployment environment:
- 2 clusters (Cluster1 @ equipment A, Cluster2 @ equipment B)
- Each cluster: 1 control plane + N worker nodes
- OS: AlmaLinux 9.x (fresh installation)
- Network: Internal VMs with internet access

## Deployment Timeline

### Phase 1: Bootstrap Kubernetes (30-45 minutes)

1. **Prepare your equipment inventory**
   ```
   CLUSTER 1 (Equipment A):
   - Control: 192.168.A.X
   - Worker1: 192.168.A.Y
   - Worker2: 192.168.A.Z
   
   CLUSTER 2 (Equipment B):
   - Control: 192.168.B.X
   - Worker1: 192.168.B.Y
   - Worker2: 192.168.B.Z
   ```

2. **Copy scripts to management machine**
   ```bash
   # From your local machine where you cloned translateapp:
   scp k8s/install-almalinux-*.sh root@<your-jumphost>:/tmp/
   scp k8s/setup-clusters.sh root@<your-jumphost>:/tmp/
   ```

3. **On the management machine:**
   
   a) Configure SSH key-based auth to all nodes:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
   for ip in 192.168.A.X 192.168.A.Y 192.168.A.Z \
             192.168.B.X 192.168.B.Y 192.168.B.Z; do
     ssh-copy-id -i ~/.ssh/id_ed25519.pub root@$ip
   done
   ```

   b) Edit setup-clusters.sh with your IPs and run:
   ```bash
   # Modify the CLUSTER1 and CLUSTER2 declarations at the top
   nano setup-clusters.sh
   
   # Then run (will take 30-45 minutes):
   bash setup-clusters.sh
   ```

4. **Verify both clusters are ready**
   ```bash
   # Check Cluster1
   ssh root@192.168.A.X \
     "export KUBECONFIG=/etc/kubernetes/admin.conf && \
      kubectl get nodes"
   
   # Check Cluster2
   ssh root@192.168.B.X \
     "export KUBECONFIG=/etc/kubernetes/admin.conf && \
      kubectl get nodes"
   ```

### Phase 2: Fetch Kubeconfigs to Management Machine

Use the management utility to pull kubeconfigs from both clusters:

```bash
bash k8s-manage.sh fetch-kubeconfig cluster1 192.168.A.X
bash k8s-manage.sh fetch-kubeconfig cluster2 192.168.B.X

# Verify
bash k8s-manage.sh list-clusters
```

Kubeconfigs are saved to `~/.kube/clusters/` and can be used independently.

### Phase 3: Deploy VerbaNova Application (15-20 minutes)

On each cluster, deploy the application stack:

```bash
# Deploy to Cluster1
export KUBECONFIG=~/.kube/clusters/cluster1-config

# Create namespace
kubectl create namespace verbanota

# Deploy MinIO (object storage)
kubectl apply -f k8s/minio.yaml -n verbanota

# Deploy backend (FastAPI WebSocket server)
kubectl apply -f k8s/backend.yaml -n verbanota

# Deploy frontend (Next.js)
kubectl apply -f k8s/frontend.yaml -n verbanota

# Deploy HPA (horizontal pod autoscaling)
kubectl apply -f k8s/hpa.yaml -n verbanota

# Repeat for Cluster2:
export KUBECONFIG=~/.kube/clusters/cluster2-config
# ... same commands ...
```

### Phase 4: Setup Ingress (optional, for external access)

If you want external access to the application:

```bash
# Install NGINX Ingress Controller (on each cluster)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/baremetal/deploy.yaml

# Create ingress resource
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: verbanota
  namespace: verbanota
spec:
  rules:
  - host: verbanota.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 3000
  - host: api.verbanota.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: backend
            port:
              number: 8000
EOF
```

### Phase 5: Verify Application Health

```bash
# Check all pods are running
bash k8s-manage.sh check-pods cluster1
bash k8s-manage.sh check-pods cluster2

# Check logs if any pod fails
kubectl logs -n verbanota deployment/backend
kubectl logs -n verbanota deployment/frontend

# Port-forward to test locally (without ingress)
kubectl -n verbanota port-forward svc/frontend 3000:3000
kubectl -n verbanota port-forward svc/backend 8000:8000

# Then access:
# - Frontend: http://localhost:3000
# - Backend: http://localhost:8000/docs
```

## Common Operations

### Monitor cluster health

```bash
# Node status
bash k8s-manage.sh get-nodes cluster1

# Pod status and resource usage
bash k8s-manage.sh check-pods cluster1
bash k8s-manage.sh check-status cluster1

# Resource consumption (requires metrics-server)
export KUBECONFIG=~/.kube/clusters/cluster1-config
kubectl top nodes
kubectl top pods -A
```

### Access a node directly

```bash
# SSH to a specific node
bash k8s-manage.sh ssh-node 192.168.A.X

# Run a command on a node
bash k8s-manage.sh ssh-node 192.168.A.X "systemctl status kubelet"
```

### Deploy updates to your application

```bash
# Update the image in your deployment manifest
nano k8s/backend.yaml  # Update image: tag

# Apply changes
export KUBECONFIG=~/.kube/clusters/cluster1-config
bash k8s-manage.sh apply-manifest cluster1 k8s/backend.yaml
```

### Troubleshooting

**Nodes showing as NotReady:**
```bash
# Check node status
kubectl describe node <node-name>

# Wait for CNI (Calico) to initialize (2-3 minutes)
# Check if Calico pods are running
kubectl get pods -n calico-system
```

**Pod fails to start:**
```bash
# Get pod status
kubectl describe pod <pod-name> -n verbanota

# Check logs
kubectl logs <pod-name> -n verbanota

# Get previous logs if crashed
kubectl logs <pod-name> -n verbanota --previous
```

**No internet access from pods:**
```bash
# Verify Calico networking
kubectl get pods -n tigera-operator
kubectl get pods -n calico-system

# Check node networking
kubectl exec -it <pod-name> -n verbanota -- /bin/bash
# Inside pod: ping 8.8.8.8
```

**Storage (MinIO) not accessible:**
```bash
# Check MinIO pod
kubectl get pods -n verbanota | grep minio

# Get MinIO credentials
kubectl get secret -n verbanota minio-secret -o yaml

# Port-forward to MinIO admin UI
kubectl port-forward -n verbanota svc/minio 9001:9001
# Access http://localhost:9001
```

## Disaster Recovery

### Backup etcd on control plane

```bash
# SSH to control node
bash k8s-manage.sh ssh-node 192.168.A.X

# Backup etcd
ETCDCTL_API=3 etcdctl \
  --endpoints=127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /tmp/etcd-backup-$(date +%Y%m%d).db

# Copy backup to management machine
scp root@192.168.A.X:/tmp/etcd-backup-*.db ~/etcd-backups/
```

### Complete cluster reset (destructive)

```bash
# On control plane
bash k8s-manage.sh ssh-node 192.168.A.X "kubeadm reset -f"

# On each worker
bash k8s-manage.sh ssh-node 192.168.A.Y "kubeadm reset -f"
bash k8s-manage.sh ssh-node 192.168.A.Z "kubeadm reset -f"

# Then re-initialize:
bash install-almalinux-controlplane.sh cluster1 192.168.A.X
```

## Performance Tuning

### Enable metrics server for resource monitoring

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Wait a few minutes, then check:
kubectl top nodes
```

### Configure HPA (horizontal pod autoscaling)

Your hpa.yaml is already configured - it will automatically scale based on CPU/memory usage.

### Adjust Calico network performance

For high-traffic scenarios, modify Calico to use direct routing instead of VXLan:

```bash
kubectl patch installation default --type merge \
  -p '{"spec":{"calicoNetwork":{"ipPools":[{"cidr":"10.244.0.0/16","encapsulation":"None"}]}}}'
```

## Next Steps

1. **Setup CI/CD pipelines** (.github/workflows) for automatic deployments
2. **Setup monitoring** (Prometheus/Grafana)
3. **Configure persistent volumes** (etcd snapshots, MinIO daily backups)
4. **Implement blue-green deployments** for zero-downtime updates
5. **Document your cluster IPs** and access procedures for team members

## Support

For issues:
1. Check KUBERNETES-ALMALINUX-SETUP.md troubleshooting section
2. Review cluster logs: `kubectl logs -n verbanota <pod>`
3. Check node health: `bash k8s-manage.sh check-status cluster1`
4. SSH to nodes for deeper investigation: `bash k8s-manage.sh ssh-node <ip>`
