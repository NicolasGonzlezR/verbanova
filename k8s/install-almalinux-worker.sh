#!/bin/bash
# K8s Worker Node Setup for AlmaLinux
# Usage: sudo bash install-almalinux-worker.sh CONTROL_PLANE_IP TOKEN CA_CERT_HASH
# Example: sudo bash install-almalinux-worker.sh 192.168.1.100 <TOKEN> sha256:<HASH>

set -e

CONTROL_PLANE_IP=$1
TOKEN=$2
CA_CERT_HASH=$3

if [ -z "$CONTROL_PLANE_IP" ] || [ -z "$TOKEN" ] || [ -z "$CA_CERT_HASH" ]; then
    echo "ERROR: Missing arguments"
    echo "Usage: sudo bash install-almalinux-worker.sh CONTROL_PLANE_IP TOKEN CA_CERT_HASH"
    echo ""
    echo "Get TOKEN and CA_CERT_HASH by running on control node:"
    echo "  kubeadm token create --print-join-command"
    exit 1
fi

echo "=== Setting up K8s Worker Node ==="
echo "Control plane: $CONTROL_PLANE_IP:6443"

# Check if already joined
if [ -d "/etc/kubernetes/pki" ] && [ -f "/etc/kubernetes/kubelet.conf" ]; then
    echo "WARNING: This node appears to already be joined to a cluster."
    echo "Aborting to prevent corruption."
    exit 1
fi

echo "Step 1: Pull required images"
kubeadm config images pull --kubernetes-version v1.30

echo "Step 2: Join cluster"
kubeadm join "$CONTROL_PLANE_IP:6443" \
    --token "$TOKEN" \
    --discovery-token-ca-cert-hash "$CA_CERT_HASH" \
    --ignore-preflight-errors=Swap

echo "Step 3: Verify node joined"
echo "Node is joining cluster. Check status on control plane with:"
echo "  kubectl get nodes"

echo ""
echo "=== Worker node setup complete ==="
