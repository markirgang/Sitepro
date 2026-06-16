@echo off
:: Navigate to the directory where this batch file is located
cd /d "%~dp0"

echo Starting nyc-zoning-massing-viewer dev server...
echo.

:: Check if node_modules exists, if not suggest installing dependencies
if not exist "node_modules\" (
    echo [WARNING] node_modules folder not found.
    echo Running npm install first...
    call npm install
    echo.
)

:: Run the dev server
call npm run dev

:: Keep window open if the command exits or fails
pause
