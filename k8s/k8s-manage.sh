#!/bin/bash
# Kubernetes Cluster Management Utilities
# Usage: bash k8s-manage.sh [COMMAND] [OPTIONS]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default cluster kubeconfig locations
CLUSTERS_DIR="${CLUSTERS_DIR:-$HOME/.kube/clusters}"

show_help() {
    cat << EOF
Kubernetes Cluster Management Utilities

Usage: bash k8s-manage.sh [COMMAND] [OPTIONS]

Commands:
  fetch-kubeconfig CLUSTER_NAME CONTROL_IP    Fetch kubeconfig from control plane
  switch-context CLUSTER_NAME                 Switch kubectl context to cluster
  list-clusters                               List available cluster kubeconfigs
  check-status CLUSTER_NAME                   Check cluster node status
  check-pods CLUSTER_NAME                     Check cluster pod status
  apply-manifest CLUSTER_NAME FILE            Apply K8s manifest to cluster
  get-nodes CLUSTER_NAME                      List nodes in cluster
  get-pods CLUSTER_NAME                       List pods in cluster
  ssh-node IP [COMMAND]                       SSH to a node
  save-config CLUSTER_NAME                    Save current KUBECONFIG as named cluster

Examples:
  # Fetch kubeconfig from cluster1 control plane
  bash k8s-manage.sh fetch-kubeconfig cluster1 192.168.1.10

  # Check cluster2 status
  bash k8s-manage.sh check-status cluster2

  # Apply manifest to cluster1
  bash k8s-manage.sh apply-manifest cluster1 minio.yaml

  # Switch to cluster2 context
  bash k8s-manage.sh switch-context cluster2
EOF
}

fetch_kubeconfig() {
    local cluster_name=$1
    local control_ip=$2

    if [ -z "$cluster_name" ] || [ -z "$control_ip" ]; then
        echo "ERROR: Missing arguments"
        echo "Usage: fetch-kubeconfig CLUSTER_NAME CONTROL_IP"
        exit 1
    fi

    mkdir -p "$CLUSTERS_DIR"

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"
    echo "Fetching kubeconfig from $control_ip..."

    scp -o StrictHostKeyChecking=no "root@$control_ip:/etc/kubernetes/admin.conf" "$config_file"

    # Update cluster name in kubeconfig
    sed -i "s/kubernetes/${cluster_name}/g" "$config_file"

    echo "✓ Kubeconfig saved to: $config_file"
    echo ""
    echo "To use this cluster:"
    echo "  export KUBECONFIG=$config_file"
    echo "  kubectl get nodes"
    echo ""
    echo "Or add to your ~/.bashrc:"
    echo "  export KUBECONFIG=\$KUBECONFIG:$config_file"
}

switch_context() {
    local cluster_name=$1

    if [ -z "$cluster_name" ]; then
        echo "ERROR: Missing cluster name"
        echo "Usage: switch-context CLUSTER_NAME"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        echo "Run 'fetch-kubeconfig' first"
        exit 1
    fi

    export KUBECONFIG="$config_file"
    echo "✓ Switched to cluster: $cluster_name"
    kubectl cluster-info
}

list_clusters() {
    mkdir -p "$CLUSTERS_DIR"

    if [ ! "$(ls -A $CLUSTERS_DIR)" ]; then
        echo "No clusters configured yet."
        echo "Run 'fetch-kubeconfig' to add a cluster."
        exit 0
    fi

    echo "Available clusters:"
    for config in "$CLUSTERS_DIR"/*-config; do
        if [ -f "$config" ]; then
            cluster_name=$(basename "$config" "-config")
            echo "  - $cluster_name"
        fi
    done
}

check_status() {
    local cluster_name=$1

    if [ -z "$cluster_name" ]; then
        echo "ERROR: Missing cluster name"
        echo "Usage: check-status CLUSTER_NAME"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        exit 1
    fi

    echo "=== Cluster: $cluster_name ==="
    KUBECONFIG="$config_file" kubectl cluster-info
    echo ""
    KUBECONFIG="$config_file" kubectl get nodes -o wide
    echo ""
    KUBECONFIG="$config_file" kubectl top nodes || echo "(metrics-server not installed)"
}

check_pods() {
    local cluster_name=$1

    if [ -z "$cluster_name" ]; then
        echo "ERROR: Missing cluster name"
        echo "Usage: check-pods CLUSTER_NAME"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        exit 1
    fi

    echo "=== Cluster: $cluster_name - System Pods ==="
    KUBECONFIG="$config_file" kubectl get pods -A --field-selector=metadata.namespace!=default
    echo ""
    echo "=== Application Pods (verbanota) ==="
    KUBECONFIG="$config_file" kubectl get pods -n verbanota -o wide
}

apply_manifest() {
    local cluster_name=$1
    local manifest_file=$2

    if [ -z "$cluster_name" ] || [ -z "$manifest_file" ]; then
        echo "ERROR: Missing arguments"
        echo "Usage: apply-manifest CLUSTER_NAME FILE"
        exit 1
    fi

    if [ ! -f "$manifest_file" ]; then
        echo "ERROR: Manifest file not found: $manifest_file"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        exit 1
    fi

    echo "Applying $manifest_file to cluster: $cluster_name"
    KUBECONFIG="$config_file" kubectl apply -f "$manifest_file"
    echo "✓ Applied"
}

get_nodes() {
    local cluster_name=$1

    if [ -z "$cluster_name" ]; then
        echo "ERROR: Missing cluster name"
        echo "Usage: get-nodes CLUSTER_NAME"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        exit 1
    fi

    KUBECONFIG="$config_file" kubectl get nodes -o wide
}

get_pods() {
    local cluster_name=$1

    if [ -z "$cluster_name" ]; then
        echo "ERROR: Missing cluster name"
        echo "Usage: get-pods CLUSTER_NAME"
        exit 1
    fi

    local config_file="$CLUSTERS_DIR/${cluster_name}-config"

    if [ ! -f "$config_file" ]; then
        echo "ERROR: Kubeconfig not found: $config_file"
        exit 1
    fi

    KUBECONFIG="$config_file" kubectl get pods -A -o wide
}

ssh_node() {
    local node_ip=$1
    shift
    local cmd="$@"

    if [ -z "$node_ip" ]; then
        echo "ERROR: Missing node IP"
        echo "Usage: ssh-node IP [COMMAND]"
        exit 1
    fi

    echo "Connecting to $node_ip..."
    if [ -z "$cmd" ]; then
        ssh -o StrictHostKeyChecking=no "root@$node_ip"
    else
        ssh -o StrictHostKeyChecking=no "root@$node_ip" "$cmd"
    fi
}

# Main
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

COMMAND=$1
shift

case "$COMMAND" in
    fetch-kubeconfig)
        fetch_kubeconfig "$@"
        ;;
    switch-context)
        switch_context "$@"
        ;;
    list-clusters)
        list_clusters "$@"
        ;;
    check-status)
        check_status "$@"
        ;;
    check-pods)
        check_pods "$@"
        ;;
    apply-manifest)
        apply_manifest "$@"
        ;;
    get-nodes)
        get_nodes "$@"
        ;;
    get-pods)
        get_pods "$@"
        ;;
    ssh-node)
        ssh_node "$@"
        ;;
    save-config)
        _sc_name=$1
        if [ -z "$_sc_name" ]; then
            echo "ERROR: Missing cluster name"
            echo "Usage: save-config CLUSTER_NAME"
            exit 1
        fi
        if [ -z "$KUBECONFIG" ]; then
            echo "ERROR: KUBECONFIG environment variable is not set"
            exit 1
        fi
        mkdir -p "$CLUSTERS_DIR"
        cp "$KUBECONFIG" "$CLUSTERS_DIR/${_sc_name}-config"
        echo "✓ Saved current kubeconfig as cluster: $_sc_name"
        ;;
    -h|--help|help)
        show_help
        ;;
    *)
        echo "ERROR: Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
