#!/usr/bin/env bash
set -euo pipefail

# Aether OS - Setup Script
# Checks dependencies, installs packages, and prepares the environment.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║        Aether OS Setup             ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════╝${NC}"
echo ""

ERRORS=0

# --- Check Node.js ---
echo -n "  Checking Node.js... "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 22 ]; then
        echo -e "${GREEN}v${NODE_VERSION} ✓${NC}"
    else
        echo -e "${RED}v${NODE_VERSION} (requires >= 22)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# --- Check npm ---
echo -n "  Checking npm...     "
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "${GREEN}v${NPM_VERSION} ✓${NC}"
else
    echo -e "${RED}not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# --- Check Docker (optional) ---
echo -n "  Checking Docker...  "
if command -v docker &> /dev/null; then
    if docker info &> /dev/null; then
        DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
        echo -e "${GREEN}v${DOCKER_VERSION} ✓ (running)${NC}"
    else
        echo -e "${YELLOW}installed but not running (optional)${NC}"
    fi
else
    echo -e "${YELLOW}not installed (optional - agents will use process fallback)${NC}"
fi

# --- Check nvidia-smi (optional) ---
echo -n "  Checking GPU...     "
if command -v nvidia-smi &> /dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
    echo -e "${GREEN}${GPU_NAME} ✓${NC}"
else
    echo -e "${YELLOW}no GPU detected (optional)${NC}"
fi

echo ""

if [ "$ERRORS" -gt 0 ]; then
    echo -e "${RED}  ✗ ${ERRORS} required dependency missing. Please install Node.js >= 22 and npm.${NC}"
    exit 1
fi

# --- Install dependencies ---
echo -e "  ${CYAN}Installing dependencies...${NC}"
echo ""

echo "  [1/4] Root packages..."
npm install --legacy-peer-deps --silent 2>&1 | tail -1

echo "  [2/4] Kernel packages..."
cd kernel && npm install --silent 2>&1 | tail -1 && cd ..

echo "  [3/4] Runtime packages..."
cd runtime && npm install --silent 2>&1 | tail -1 && cd ..

echo "  [4/4] Server packages..."
cd server && npm install --silent 2>&1 | tail -1 && cd ..

echo ""
echo "  [5/5] Installing Playwright browsers..."
cd kernel && npx playwright install chromium 2>/dev/null || echo -e "  ${YELLOW}Playwright browser install skipped (optional)${NC}"
cd ..

echo ""

# --- Create .env if not exists ---
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "  ${GREEN}Created .env from .env.example${NC}"
    echo -e "  ${YELLOW}→ Edit .env and add your GEMINI_API_KEY${NC}"
else
    echo -e "  ${GREEN}.env already exists, skipping${NC}"
fi

echo ""
echo -e "${GREEN}  ╔═══════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║        Setup Complete ✓            ║${NC}"
echo -e "${GREEN}  ╚═══════════════════════════════════╝${NC}"
echo ""
echo "  Next steps:"
echo "    1. Edit .env and add your GEMINI_API_KEY"
echo "    2. npm run dev          → Start UI (mock mode)"
echo "    3. npm run dev:kernel   → Start kernel backend"
echo "    4. npm run dev:full     → Start both"
echo "    5. npm test             → Run test suite"
echo ""
