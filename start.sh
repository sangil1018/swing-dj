#!/bin/bash
echo "==================================================="
echo "  🎷 SwingDJ 로컬 서버 시작"
echo "==================================================="
echo ""

# 브라우저 자동 실행 함수
open_browser() {
    echo "브라우저에서 http://localhost:8080 을 엽니다..."
    if command -v xdg-open &> /dev/null; then
        xdg-open http://localhost:8080 &
    elif command -v open &> /dev/null; then
        open http://localhost:8080 &
    fi
}

# Python3 확인
if command -v python3 &> /dev/null; then
    echo "Python3 환경이 감지되었습니다. (python3 -m http.server 실행)"
    open_browser
    python3 -m http.server 8080 --bind 127.0.0.1
    exit 0
fi

# Python 확인
if command -v python &> /dev/null; then
    echo "Python 환경이 감지되었습니다. (python -m http.server 실행)"
    open_browser
    python -m http.server 8080 --bind 127.0.0.1
    exit 0
fi

# Node.js (npx) 확인
if command -v npx &> /dev/null; then
    echo "Node.js 환경이 감지되었습니다. (npx http-server 실행)"
    open_browser
    npx -y http-server -p 8080 -a 127.0.0.1 -c-1
    exit 0
fi

echo "[오류] 이 시스템에 Node.js나 Python이 설치되어 있지 않습니다."
echo "SwingDJ를 실행하려면 둘 중 하나를 설치해주세요."
