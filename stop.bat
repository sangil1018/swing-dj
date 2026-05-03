@echo off
chcp 65001 >nul
title SwingDJ Server 종료
echo ===================================================
echo   SwingDJ 서버를 종료합니다 (포트 8080 해제)
echo ===================================================
echo.

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080') do (
    echo [종료 처리 중] 프로세스 ID: %%a
    taskkill /F /PID %%a >nul 2>nul
)

echo.
echo 정상적으로 종료되었습니다.
pause