@echo off
chcp 65001 >nul
if "%~1"=="hidden" goto HIDDEN_MODE

echo ===================================================
echo   SwingDJ 서버를 백그라운드(숨김) 모드로 시작합니다.
echo ===================================================
echo.
echo 검은색 콘솔 창이 잠시 후 사라지고 백그라운드에서 실행됩니다.
echo 나중에 서버를 끄시려면 반드시 'stop.bat' 파일을 실행해주세요!
echo.
timeout /t 3 >nul

set "SCRIPT_PATH=%~f0"
powershell -WindowStyle Hidden -Command "Start-Process cmd -ArgumentList '/c', '""%SCRIPT_PATH%""', 'hidden' -WindowStyle Hidden"
exit /b

:HIDDEN_MODE
start http://localhost:8080

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python -m http.server 8080
    exit /b
)

where npx >nul 2>nul
if %ERRORLEVEL% equ 0 (
    npx -y http-server -p 8080 -c-1
    exit /b
)
