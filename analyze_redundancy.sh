#!/bin/bash
echo "=== ANÁLISIS DE REDUNDANCIA Y ARCHIVOS SOBRANTES ===" 
echo ""

echo "1. DUPLICADOS (web/ vs frontend/)"
echo "   Files en web/ que también están en frontend/:"
for file in src package.json Dockerfile jest.config.js jest.env.setup.js public; do
  if [ -e "web/$file" ] && [ -e "frontend/$file" ]; then
    echo "   ✓ $file (DUPLICADO)"
  fi
done

echo ""
echo "2. ARCHIVOS QUE NO DEBERÍAN ESTAR EN GIT"
echo "   Directorios de build/cache:"
[ -d "web/.next" ] && echo "   ✓ web/.next/ (BUILD OUTPUT - debería estar en .gitignore)"
[ -d "web/node_modules" ] && echo "   ✓ web/node_modules/ (DEPENDENCIAS - debería estar en .gitignore)"
[ -d "frontend/.next" ] && echo "   ✓ frontend/.next/ (BUILD OUTPUT - debería estar en .gitignore)" || echo "   - frontend/.next/ (no existe)"
[ -d "frontend/node_modules" ] && echo "   ✓ frontend/node_modules/ (DEPENDENCIAS - debería estar en .gitignore)" || echo "   - frontend/node_modules/ (no existe)"
[ -d "__pycache__" ] && echo "   ✓ __pycache__/ (PYTHON CACHE - debería estar en .gitignore)"
[ -d ".pytest_cache" ] && echo "   ✓ .pytest_cache/ (PYTEST CACHE - debería estar en .gitignore)"
[ -d ".venv" ] && echo "   ✓ .venv/ (VENV LOCAL - debería estar en .gitignore)"
[ -d ".cache" ] && echo "   ✓ .cache/ (MODEL CACHE - debería estar en .gitignore)"

echo ""
echo "3. ARCHIVOS DEPRECADOS"
[ -f "web/DEPRECATED.md" ] && echo "   ✓ web/DEPRECATED.md (INFORMATIVO - puede mantenerse)"

echo ""
echo "4. ARCHIVOS NO VERSIONADOS QUE ESTÁN EN GIT"
echo "   Archivos que git está trackeando pero no deberían:"
git ls-files | grep -E "\.next/|node_modules|__pycache__|\.pytest_cache|\.venv|\.cache" | head -20

echo ""
echo "5. DIRECTORIOS GENERADOS"
[ -d "docs/reports" ] && echo "   ✓ docs/reports/ (REPORTES GENERADOS)"
[ -d "web/uploads" ] && echo "   ✓ web/uploads/ (DATOS DEL USUARIO)"
[ -d "frontend/uploads" ] && echo "   - frontend/uploads/ (no existe)" 

echo ""
echo "6. ARCHIVOS TEMPORALES"
find . -maxdepth 1 -name "*.tmp" -o -name "*.bak" 2>/dev/null | head -10 && echo "   (encontrados temporales)" || echo "   - Sin archivos temporales"

echo ""
echo "7. .gitignore - VERIFICAR COBERTURA"
echo "   Contenido actual:"
cat .gitignore | grep -v "^#" | grep -v "^$"

echo ""
echo "=== FIN DE ANÁLISIS ==="
