@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 (
  echo Cannot enter the VV project directory.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on PATH. Install Node.js 24 and retry.
  pause
  popd
  exit /b 1
)
node "scripts\manual-acceptance.mjs"
set "VV_EXIT=%ERRORLEVEL%"
echo.
if not "%VV_EXIT%"=="0" (
  echo VV acceptance recorder failed with exit code %VV_EXIT%.
) else (
  echo VV acceptance recorder stopped normally.
)
echo This window will stay open until you press a key.
pause
popd
exit /b %VV_EXIT%
