@echo off
chcp 65001 >nul
title SwingDJ Server 종료
echo ===================================================
echo   SwingDJ 서버를 종료합니다 (포트 8080 해제)
echo ===================================================
echo.

set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /R /C:":8080 .*LISTENING"') do (
    if not "%%a"=="0" (
        echo [종료 처리 중] 서버 프로세스 ID: %%a
        taskkill /F /PID %%a >nul 2>nul
        set "FOUND=1"
    )
)

echo.
if "%FOUND%"=="1" (
    echo 정상적으로 종료되었습니다.
) else (
    echo 포트 8080에서 실행 중인 서버를 찾을 수 없습니다.
)
pause
