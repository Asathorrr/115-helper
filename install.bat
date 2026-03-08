@echo off

echo ============================================
echo   115helper Install
echo ============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "PY_SCRIPT=%SCRIPT_DIR%\115helper.py"

where pythonw >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pythonw.exe not found. Please install Python and check "Add to PATH".
    pause
    exit /b 1
)

for /f "delims=" %%i in ('where pythonw') do set "PYTHONW=%%i"
echo [OK] pythonw: %PYTHONW%

if not exist "%PY_SCRIPT%" (
    echo [ERROR] 115helper.py not found. Make sure install.bat and 115helper.py are in the same folder.
    pause
    exit /b 1
)

schtasks /create ^
  /tn "115helper" ^
  /tr "\"%PYTHONW%\" \"%PY_SCRIPT%\"" ^
  /sc onlogon ^
  /ru "%USERNAME%" ^
  /rl highest ^
  /f >nul 2>&1

if errorlevel 1 (
    echo [ERROR] Failed to create scheduled task. Please run as Administrator.
    pause
    exit /b 1
)

echo [OK] Scheduled task created.
echo.

echo Starting 115helper now...
start "" "%PYTHONW%" "%PY_SCRIPT%"
ping 127.0.0.1 -n 3 >nul

netstat -an | find "19190" | find "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Port 19190 not detected. Check 115helper.log for errors.
) else (
    echo [OK] 115helper is running on port 19190.
)

echo.
echo ============================================
echo   Done! 115helper will auto-start on login.
echo   Log: %SCRIPT_DIR%\115helper.log
echo   To uninstall: run uninstall.bat
echo ============================================
pause
