@echo off

echo ============================================
echo   115helper Uninstall
echo ============================================
echo.

echo Stopping 115helper process...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| find "19190" ^| find "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    echo [OK] Killed PID %%a
)

schtasks /delete /tn "115helper" /f >nul 2>&1
if errorlevel 1 (
    echo [INFO] Scheduled task not found or already removed.
) else (
    echo [OK] Scheduled task removed.
)

echo.
echo ============================================
echo   Done! 115helper has been uninstalled.
echo   You may delete 115helper.py and this folder manually.
echo ============================================
pause
