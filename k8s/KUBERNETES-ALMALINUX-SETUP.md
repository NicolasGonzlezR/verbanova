# Kubernetes Installation Scripts for AlmaLinux

Automated scripts to bootstrap Kubernetes clusters on fresh AlmaLinux installations. Designed for multi-cluster deployments with multiple control and worker nodes.

## Overview

- **install-almalinux-prereqs.sh**: System preparation (all nodes)
- **install-almalinux-controlplane.sh**: Control plane initialization
- **install-almalinux-worker.sh**: Worker node joining
- **setup-clusters.sh**: Orchestrates multi-cluster setup with SSH

## Prerequisites

- AlmaLinux 9.x fresh installation on all VMs
- root or sudo access on all nodes
- Network connectivity between all nodes
- At least 2 CPUs and 2GB RAM per node
- VMs have internet access (for package downloads)

## Quick Start (Single Cluster)

### 1. Setup all nodes

On each node (control and worker):
```bash
sudo bash install-almalinux-prereqs.sh
```

This script:
- Updates system packages
- Disables swap (K8s requirement)
- Loads kernel modules (overlay, br_netfilter)
- Configures firewall (TCP ports 6443, 2379, 2380, 10250, etc)
- Installs containerd as container runtime
- Installs kubeadm, kubelet, kubectl

### 2. Initialize control plane

On the control plane node:
```bash
sudo bash install-almalinux-controlplane.sh mycluster 192.168.1.100
```

Replace:
- `mycluster` = your cluster name
- `192.168.1.100` = the control plane's IP address

This script:
- Initializes K8s control plane with kubeadm
- Sets up kubeconfig for the current user
- Installs Calico CNI for pod networking
- Optionally untaints control plane to allow pods

Output will include join command:
```
kubeadm join 192.168.1.100:6443 \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash sha256:<HASH>
```

### 3. Join worker nodes

On each worker node:
```bash
sudo bash install-almalinux-worker.sh 192.168.1.100 <TOKEN> sha256:<HASH>
```

Replace with values from control plane join command above.

### 4. Verify

On control plane:
```bash
kubectl get nodes -o wide
kubectl get pods -A
```

Wait 2-3 minutes for all nodes to reach "Ready" status and all pods to be "Running".

## Advanced: Multi-Cluster Setup

For automated setup of multiple clusters across 2 equipment sets:

### 1. Edit setup-clusters.sh

Define your clusters and node IPs:
```bash
declare -A CLUSTER1=(
    [name]="cluster1"
    [control_plane]="192.168.1.10"
    [workers]="192.168.1.11 192.168.1.12"
)

declare -A CLUSTER2=(
    [name]="cluster2"
    [control_plane]="192.168.1.20"
    [workers]="192.168.1.21 192.168.1.22"
)
```

### 2. Ensure SSH access

Verify SSH connectivity without password (use SSH keys):
```bash
ssh root@192.168.1.10 "echo OK"
ssh root@192.168.1.20 "echo OK"
# etc for all nodes
```

If you don't have key-based SSH configured, you'll need to set it up:
```bash
ssh-keygen -t ed25519
ssh-copy-id root@192.168.1.10
# etc for all nodes
```

### 3. Run orchestration script

```bash
bash setup-clusters.sh
```

This will automatically:
- Install prerequisites on all nodes
- Initialize both control planes
- Join all worker nodes to their respective clusters
- Verify both clusters

## Network Configuration

### Firewall Rules

The scripts automatically configure firewalld with these K8s ports:

**Control Plane:**
- 6443: Kubernetes API server
- 2379: etcd server
- 2380: etcd peer communication
- 10250: kubelet API
- 10251: kube-scheduler
- 10252: kube-controller-manager

**Worker Nodes:**
- 10250: kubelet API
- 30000-32767: NodePort service range

**Pod Networking:**
- 179: BGP for Calico

### Pod CIDR

Pods are assigned from `10.244.0.0/16` using Calico with VXLan encapsulation.

### Service CIDR

Services are assigned from `10.96.0.0/12`.

## Container Runtime

Uses **containerd** (Docker-compatible, smaller footprint). Configured with:
- systemd cgroup driver (required for K8s)
- Pause image: registry.k8s.io/pause:3.9

## CNI Plugin

Uses **Calico** v3.26.0 for pod networking with:
- VXLan encapsulation for cross-node communication
- NAT outgoing for external traffic
- BGP for advanced networking

## Troubleshooting

### Nodes stuck in "NotReady"

Check node logs:
```bash
kubectl describe node <node-name>
kubectl logs -n kube-system -l component=kubelet
```

Check CNI plugin:
```bash
kubectl get pods -n tigera-operator
kubectl get pods -n calico-system
```

Wait 2-3 minutes for Calico pods to start.

### kubeadm join fails

Verify firewall is open on control plane:
```bash
sudo firewall-cmd --list-ports
```

Check kubeadm token is valid (expires after 24h):
```bash
kubeadm token create --print-join-command
```

### containerd errors

Check containerd status:
```bash
systemctl status containerd
journalctl -u containerd -n 50
```

Restart if needed:
```bash
systemctl restart containerd
```

### Swap still enabled

Verify swap is disabled:
```bash
swapon --show
free -h
```

If still showing swap, reboot and check `/etc/fstab`.

## Kubernetes Versions

Scripts install Kubernetes v1.28 (stable). To use a different version, modify the repo URL in **install-almalinux-prereqs.sh**:

```bash
# Change this:
baseurl=https://pkgs.k8s.io/core:/stable:/v1.28/rpm/

# To your version:
baseurl=https://pkgs.k8s.io/core:/stable:/v1.30/rpm/
```

## Post-Installation

After clusters are ready:

1. **Install metrics server** for pod resource usage:
   ```bash
   kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
   ```

2. **Setup ingress controller**:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/baremetal/deploy.yaml
   ```

3. **Configure persistent storage** (MinIO recommended):
   ```bash
   kubectl apply -f k8s/minio.yaml
   ```

4. **Setup monitoring**:
   ```bash
   # Install Prometheus/Grafana for cluster monitoring
   ```

## Cleanup

To reset a node back to pre-K8s state (destructive):

```bash
# On the node to reset:
kubeadm reset -f
systemctl stop kubelet
dnf remove -y kubelet kubeadm kubectl containerd.io
```

## Notes

- Scripts are **idempotent** - safe to run multiple times
- Uses `/etc/kubernetes/admin.conf` as kubeconfig
- Each cluster is independent - can have different K8s versions
- Calico automatically discovers nodes via Kubernetes API
- Production deployments should add RBAC policies and network policies
