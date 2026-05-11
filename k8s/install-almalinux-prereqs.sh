#!/bin/bash
# K8s Prerequisites for AlmaLinux - Run on ALL nodes (control + worker)
# Usage: sudo bash install-almalinux-prereqs.sh

set -e

echo "=== Installing K8s prerequisites on AlmaLinux ==="

# Detect AlmaLinux version
if ! grep -q "AlmaLinux" /etc/os-release; then
    echo "ERROR: This script requires AlmaLinux"
    exit 1
fi

echo "Step 1: Update system packages"
dnf update -y
dnf install -y curl wget vim git

echo "Step 2: Disable swap (required for K8s)"
swapoff -a
sed -i '/swap/d' /etc/fstab
echo "Swap disabled"

echo "Step 3: Load required kernel modules"
cat > /etc/modules-load.d/kubernetes.conf <<EOF
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

echo "Step 4: Configure kernel parameters for networking"
cat > /etc/sysctl.d/99-kubernetes-cri.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
net.bridge.bridge-nf-call-ip6tables = 1
EOF
sysctl --system

echo "Step 5: Configure firewall for K8s"
systemctl start firewalld
systemctl enable firewalld

# Control plane ports
firewall-cmd --permanent --add-port=6443/tcp    # API server
firewall-cmd --permanent --add-port=2379/tcp    # etcd server
firewall-cmd --permanent --add-port=2380/tcp    # etcd peer
firewall-cmd --permanent --add-port=10250/tcp   # kubelet
firewall-cmd --permanent --add-port=10251/tcp   # kube-scheduler
firewall-cmd --permanent --add-port=10252/tcp   # kube-controller-manager

# Worker ports
firewall-cmd --permanent --add-port=10250/tcp   # kubelet
firewall-cmd --permanent --add-port=30000:32767/tcp  # NodePort services

# Allow pod networking (Calico/Flannel)
firewall-cmd --permanent --add-masquerade
firewall-cmd --permanent --zone=public --add-port=179/tcp  # BGP for Calico

firewall-cmd --reload

echo "Step 6: Install containerd container runtime"
dnf install -y dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y containerd.io

echo "Step 7: Configure containerd"
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml > /dev/null

# Enable systemd cgroup driver for containerd
sed -i 's/\[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options\]/\[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options\]\n            SystemdCgroup = true/g' /etc/containerd/config.toml

# Ensure proper sandbox_image for compatibility
sed -i 's|sandbox_image = .*|sandbox_image = "registry.k8s.io/pause:3.9"|' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd

echo "Step 8: Install kubelet, kubeadm, kubectl"
cat > /etc/yum.repos.d/kubernetes.repo <<EOF
[kubernetes]
name=Kubernetes
baseurl=https://pkgs.k8s.io/core:/stable:/v1.30/rpm/
enabled=1
gpgcheck=1
gpgkey=https://pkgs.k8s.io/core:/stable:/v1.30/rpm/repodata/repomd.xml.key
EOF

dnf install -y kubelet kubeadm kubectl
systemctl enable kubelet

echo "Step 9: Verify installation"
containerd --version
kubelet --version
kubeadm version
kubectl version --client

echo ""
echo "=== Prerequisites installation complete ==="
echo "Next steps:"
echo "  - On CONTROL nodes: Run install-almalinux-controlplane.sh"
echo "  - On WORKER nodes: Run install-almalinux-worker.sh"
