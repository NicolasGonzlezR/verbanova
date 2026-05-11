#!/bin/bash
# K8s Control Plane Setup for AlmaLinux
# Usage: sudo bash install-almalinux-controlplane.sh [CLUSTER_NAME] [ADVERTISE_IP]
# Example: sudo bash install-almalinux-controlplane.sh cluster1 192.168.1.100

set -e

CLUSTER_NAME=${1:-"kubernetes"}
ADVERTISE_IP=${2:-"$(hostname -I | awk '{print $1}')"}

if [ -z "$ADVERTISE_IP" ]; then
    echo "ERROR: Could not determine ADVERTISE_IP. Please provide as second argument."
    echo "Usage: sudo bash install-almalinux-controlplane.sh CLUSTER_NAME ADVERTISE_IP"
    exit 1
fi

echo "=== Setting up K8s Control Plane ==="
echo "Cluster name: $CLUSTER_NAME"
echo "Advertise IP: $ADVERTISE_IP"

# Check if already initialized
if [ -d "/etc/kubernetes/manifests" ] && [ "$(ls -A /etc/kubernetes/manifests)" ]; then
    echo "WARNING: This node appears to already have K8s initialized."
    echo "Aborting to prevent overwriting existing cluster."
    exit 1
fi

echo "Step 1: Pull required images"
kubeadm config images pull --kubernetes-version v1.30

echo "Step 2: Initialize control plane"
# Using pod-network-cidr for Calico
kubeadm init \
    --apiserver-advertise-address="$ADVERTISE_IP" \
    --node-name="$(hostname)" \
    --pod-network-cidr=10.244.0.0/16 \
    --service-cidr=10.96.0.0/12 \
    --ignore-preflight-errors=Swap

echo "Step 3: Setup kubeconfig for current user"
mkdir -p "$HOME/.kube"
cp -i /etc/kubernetes/admin.conf "$HOME/.kube/config"
chown "$(id -u):$(id -g)" "$HOME/.kube/config"

# For root user
export KUBECONFIG=/etc/kubernetes/admin.conf

echo "Step 4: Install CNI plugin (Calico)"
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/tigera-operator.yaml

# Wait for tigera operator to be ready
echo "Waiting for tigera-operator to be ready..."
kubectl -n tigera-operator wait --for=condition=available --timeout=300s deployment/tigera-operator || true

# Apply Calico network
kubectl apply -f - <<EOF
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  calicoNetwork:
    ipPools:
    - blockSize: 26
      cidr: 10.244.0.0/16
      encapsulation: VXLan
      natOutgoing: Enabled
      nodeSelector: all()
  registry: quay.io
  imagePath: calico
  variant: Calico
EOF

echo "Step 5: Untaint control plane (allows pods on control node — suitable for lab clusters)"
# Pass --no-untaint as third argument to skip this in production multi-node setups
if [ "${3}" != "--no-untaint" ]; then
    kubectl taint nodes --all node-role.kubernetes.io/control-plane- || true
fi

echo "Step 6: Verify cluster status"
echo "Waiting for control plane components..."
kubectl wait --for=condition=Ready node "$(hostname)" --timeout=300s || true

kubectl get nodes -o wide
kubectl get pods -A

echo ""
echo "=== Control plane setup complete ==="
echo ""
echo "To add worker nodes to this cluster, run on each worker:"
echo ""
echo "  sudo kubeadm join $ADVERTISE_IP:6443 \\"
echo "    --token <TOKEN> \\"
echo "    --discovery-token-ca-cert-hash sha256:<HASH>"
echo ""
echo "To get the join command with token, run:"
echo "  kubeadm token create --print-join-command"
echo ""
