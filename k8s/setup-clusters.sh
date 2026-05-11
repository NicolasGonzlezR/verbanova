#!/bin/bash
# K8s Multi-Cluster Setup for AlmaLinux
# This script orchestrates the setup of multiple K8s clusters across different VMs
# Usage: bash setup-clusters.sh

set -e

echo "=== Kubernetes Multi-Cluster Setup for AlmaLinux ==="
echo ""

# Define clusters and nodes
# Modify these for your environment
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

# SSH user (modify if different)
SSH_USER="root"

setup_prereqs_on_node() {
    local ip=$1
    local node_name=$2
    echo "[Prerequisites] Setting up $node_name ($ip)"

    ssh -o StrictHostKeyChecking=no "$SSH_USER@$ip" 'bash -s' < ./install-almalinux-prereqs.sh
    echo "✓ Prerequisites installed on $node_name"
}

setup_controlplane_on_node() {
    local ip=$1
    local cluster_name=$2
    local node_name=$3
    echo "[Control Plane] Setting up $node_name ($ip) for cluster $cluster_name"

    ssh -o StrictHostKeyChecking=no "$SSH_USER@$ip" "bash -s" < ./install-almalinux-controlplane.sh -- "$cluster_name" "$ip"
    echo "✓ Control plane initialized on $node_name"
}

setup_worker_on_node() {
    local ip=$1
    local control_ip=$2
    local token=$3
    local ca_hash=$4
    local node_name=$5
    echo "[Worker] Joining $node_name ($ip) to control plane at $control_ip"

    ssh -o StrictHostKeyChecking=no "$SSH_USER@$ip" "bash -s" < ./install-almalinux-worker.sh -- "$control_ip" "$token" "$ca_hash"
    echo "✓ Worker node joined"
}

get_join_command() {
    local control_ip=$1
    echo "[Cluster Setup] Getting join command from control plane"

    ssh -o StrictHostKeyChecking=no "$SSH_USER@$control_ip" \
        "export KUBECONFIG=/etc/kubernetes/admin.conf && kubeadm token create --print-join-command" \
        2>/dev/null || echo ""
}

setup_cluster() {
    local cluster_name=$1
    local control_ip=$2
    local worker_ips=$3

    echo ""
    echo "========================================"
    echo "Setting up cluster: $cluster_name"
    echo "========================================"

    echo ""
    echo ">>> Phase 1: Install prerequisites on all nodes"
    setup_prereqs_on_node "$control_ip" "$cluster_name-control"
    for worker_ip in $worker_ips; do
        setup_prereqs_on_node "$worker_ip" "$cluster_name-worker-$worker_ip"
    done

    echo ""
    echo ">>> Phase 2: Initialize control plane"
    setup_controlplane_on_node "$control_ip" "$cluster_name" "$cluster_name-control"

    echo ""
    echo ">>> Phase 3: Get join command for workers"
    sleep 30  # Give control plane time to fully initialize
    join_cmd=$(get_join_command "$control_ip")

    if [ -z "$join_cmd" ]; then
        echo "ERROR: Could not get join command from control plane"
        echo "Please run manually on control plane: kubeadm token create --print-join-command"
        exit 1
    fi

    echo "Join command: $join_cmd"

    # Extract token and ca-cert-hash
    token=$(echo "$join_cmd" | awk '{print $5}')
    ca_hash=$(echo "$join_cmd" | awk '{print $7}')

    echo ""
    echo ">>> Phase 4: Join worker nodes"
    for worker_ip in $worker_ips; do
        setup_worker_on_node "$worker_ip" "$control_ip" "$token" "$ca_hash" "$cluster_name-worker-$worker_ip"
        sleep 10
    done

    echo ""
    echo ">>> Phase 5: Verify cluster"
    ssh -o StrictHostKeyChecking=no "$SSH_USER@$control_ip" \
        'export KUBECONFIG=/etc/kubernetes/admin.conf && kubectl get nodes -o wide'
}

# Main execution
echo "Starting multi-cluster setup..."
echo ""

# Setup Cluster 1
setup_cluster "${CLUSTER1[name]}" "${CLUSTER1[control_plane]}" "${CLUSTER1[workers]}"

# Setup Cluster 2
setup_cluster "${CLUSTER2[name]}" "${CLUSTER2[control_plane]}" "${CLUSTER2[workers]}"

echo ""
echo "========================================"
echo "✓ All clusters setup complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Deploy your application with: kubectl apply -f ..."
echo "2. Monitor cluster health: kubectl get nodes, kubectl get pods -A"
echo "3. Setup ingress controller (nginx-ingress recommended)"
echo "4. Configure persistent storage backend (MinIO, etc)"
