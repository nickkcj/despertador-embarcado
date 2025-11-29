#!/bin/bash

# Script para iniciar todos os serviços do Despertador Inteligente
# Uso: ./start-all.sh

echo "=========================================="
echo "  Despertador Inteligente - Backend"
echo "=========================================="
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Diretório base
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Função para verificar se uma porta está em uso
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Verificar se as portas estão disponíveis
echo "Verificando portas..."
for port in 3000 3001 3002; do
    if check_port $port; then
        echo -e "${RED}[ERRO] Porta $port já está em uso!${NC}"
        echo "Por favor, encerre o processo que está usando esta porta."
        exit 1
    fi
done
echo -e "${GREEN}Todas as portas disponíveis!${NC}"
echo ""

# Instalar dependências se necessário
echo "Verificando dependências..."

if [ ! -d "$BASE_DIR/services/controle/node_modules" ]; then
    echo "Instalando dependências do Serviço de Controle..."
    cd "$BASE_DIR/services/controle" && npm install
fi

if [ ! -d "$BASE_DIR/services/logging/node_modules" ]; then
    echo "Instalando dependências do Serviço de Logging..."
    cd "$BASE_DIR/services/logging" && npm install
fi

if [ ! -d "$BASE_DIR/gateway/node_modules" ]; then
    echo "Instalando dependências do Gateway..."
    cd "$BASE_DIR/gateway" && npm install
fi

echo -e "${GREEN}Dependências OK!${NC}"
echo ""

# Iniciar serviços em background
echo "Iniciando serviços..."

# Serviço de Controle (porta 3001)
cd "$BASE_DIR/services/controle"
node index.js &
CONTROLE_PID=$!
echo -e "${GREEN}[OK] Serviço de Controle iniciado (PID: $CONTROLE_PID)${NC}"

# Aguardar um pouco para o banco ser criado
sleep 1

# Serviço de Logging (porta 3002)
cd "$BASE_DIR/services/logging"
node index.js &
LOGGING_PID=$!
echo -e "${GREEN}[OK] Serviço de Logging iniciado (PID: $LOGGING_PID)${NC}"

# Aguardar serviços iniciarem
sleep 1

# API Gateway (porta 3000)
cd "$BASE_DIR/gateway"
node index.js &
GATEWAY_PID=$!
echo -e "${GREEN}[OK] API Gateway iniciado (PID: $GATEWAY_PID)${NC}"

echo ""
echo "=========================================="
echo "  Todos os serviços iniciados!"
echo "=========================================="
echo ""
echo "  API Gateway:        http://localhost:3000"
echo "  Serviço Controle:   http://localhost:3001"
echo "  Serviço Logging:    http://localhost:3002"
echo ""
echo "  Endpoints disponíveis:"
echo "    GET  /api/config/:deviceId"
echo "    PUT  /api/config/:deviceId"
echo "    POST /api/logs"
echo "    GET  /api/logs/:deviceId"
echo ""
echo -e "${YELLOW}Pressione Ctrl+C para encerrar todos os serviços${NC}"
echo ""

# Função para encerrar serviços ao receber SIGINT
cleanup() {
    echo ""
    echo "Encerrando serviços..."
    kill $CONTROLE_PID 2>/dev/null
    kill $LOGGING_PID 2>/dev/null
    kill $GATEWAY_PID 2>/dev/null
    echo -e "${GREEN}Todos os serviços encerrados!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Manter script rodando
wait
