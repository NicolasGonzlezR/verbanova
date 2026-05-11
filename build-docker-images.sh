#!/bin/bash
# Script para construir imágenes Docker para VerbaNova
# Uso: bash build-docker-images.sh [REGISTRY]

set -e

REGISTRY="${1:-localhost:5000}"
VERSION="${VERSION:-latest}"

echo "=== Building VerbaNova Docker Images ==="
echo "Registry: $REGISTRY"
echo "Version: $VERSION"
echo ""

# Construir backend
echo ">>> Building backend image..."
docker build \
    -t "${REGISTRY}/translateapp-backend:${VERSION}" \
    -f Dockerfile.backend \
    .

echo "✓ Backend image built: ${REGISTRY}/translateapp-backend:${VERSION}"
echo ""

# Construir frontend
echo ">>> Building frontend image..."
docker build \
    -t "${REGISTRY}/translateapp-frontend:${VERSION}" \
    -f web/Dockerfile \
    .

echo "✓ Frontend image built: ${REGISTRY}/translateapp-frontend:${VERSION}"
echo ""

# Opcionalidad: push a registry si está disponible
if [ "${REGISTRY}" != "localhost:5000" ]; then
    echo ">>> Pushing images to registry..."
    docker push "${REGISTRY}/translateapp-backend:${VERSION}"
    docker push "${REGISTRY}/translateapp-frontend:${VERSION}"
    echo "✓ Images pushed to ${REGISTRY}"
else
    echo "Images built locally. To use in Kubernetes:"
    echo "  1. Configure Docker daemon to use local images"
    echo "  2. Or push to a local registry: docker push localhost:5000/..."
fi

echo ""
echo "=== Build complete ==="
