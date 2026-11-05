@echo off
rem Double-click launcher for Windows. The kit runs from a copy in %LOCALAPPDATA%, never from the
rem downloaded folder: a OneDrive-synced Desktop would sync node_modules and stall the cleanup.
rem Labels and goto instead of ( ) blocks: a path holding ")" (a user name like "Tim (IESE)") breaks a block.
setlocal EnableExtensions DisableDelayedExpansion

set "HERE=%~dp0"
rem Without the trailing backslash: robocopy reads \" at the end of a quoted path as an escaped quote.
set "HERE=%HERE:~0,-1%"
set "WORK=%LOCALAPPDATA%\iese-alexandria"
set "ALX_STATUS=%HERE%\STATUS.txt"
set "NODE=%WORK%\.node\node.exe"
set "RC=0"
set "CODE="

echo IESE Alexandria kit
echo.
if "%ALX_DRY%"=="1" goto copy

if exist "%HERE%\code.txt" for /f "usebackq tokens=1" %%A in ("%HERE%\code.txt") do if not defined CODE set "CODE=%%A"
if not defined CODE set /p "CODE=Paste your upload code (from the message Radu sent) and press Enter: "
if defined CODE for /f "tokens=1" %%A in ("%CODE%") do set "CODE=%%A"
if defined CODE goto copy
> "%ALX_STATUS%" echo Stopped: no upload code was given; double-click Start again to continue
echo No upload code was given.
set "RC=1"
goto end

:copy
rem PowerShell writes this line because cmd cannot write the ellipsis character portably.
powershell -NoProfile -Command "[IO.File]::WriteAllText($env:ALX_STATUS, 'Setting up' + [char]0x2026 + [Environment]::NewLine)"
echo Copying the kit to %WORK% ...
robocopy "%HERE%" "%WORK%" /E /XD .git .node .node-download node_modules output .browsers /XF .state.json *.tmp progress.json receipt.txt code.txt STATUS.txt /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copyfail

echo Setting up (a few minutes the first time) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%WORK%\setup.ps1"
if errorlevel 1 goto setupfail
if not exist "%NODE%" goto setupfail

echo.
echo A browser window will open: sign in to Blackboard there. Leave this window open; it shows the progress.
echo.
if "%ALX_DRY%"=="1" goto dryrun
"%NODE%" "%WORK%\kit.mjs" run --code "%CODE%"
set "RC=%ERRORLEVEL%"
goto afterrun
:dryrun
"%NODE%" "%WORK%\kit.mjs" collect --dry
set "RC=%ERRORLEVEL%"
:afterrun

set "ALL=0"
if "%ALX_DRY%"=="1" if "%RC%"=="0" set "ALL=1"
if not "%ALX_DRY%"=="1" findstr /r /c:"all_uploaded.: true" "%WORK%\progress.json" >nul 2>&1 && set "ALL=1"

if not exist "%WORK%\receipt.txt" goto noreceipt
copy /y "%WORK%\receipt.txt" "%HERE%\receipt.txt" >nul
echo.
echo Receipt (a copy is saved as receipt.txt in this folder):
rem Course names in the receipt are UTF-8.
chcp 65001 >nul
type "%WORK%\receipt.txt"
echo.
:noreceipt

if "%ALL%"=="1" goto finished
echo.
echo Not everything is uploaded yet. Your progress is kept in %WORK%.
echo Double-click Start again tomorrow or after fixing the problem; it continues where it stopped.
if "%RC%"=="0" set "RC=1"
goto end

:finished
> "%ALX_STATUS%" echo Done: all uploaded
rmdir /s /q "%WORK%" 2>nul
if not exist "%WORK%\" goto cleaned
rem A virus scanner can hold a just-closed file for a moment; one more try. ping waits where timeout needs a keyboard.
ping -n 3 127.0.0.1 >nul
rmdir /s /q "%WORK%" 2>nul
if not exist "%WORK%\" goto cleaned
echo.
echo Everything is uploaded, but this folder could not be fully deleted: %WORK%
echo Close any window using it, then delete that folder by hand.
echo After that you can delete this folder (%HERE%) and the zip you downloaded.
set "RC=1"
goto end
:cleaned
echo.
echo Everything is uploaded, and the kit's working copy in %WORK% is deleted.
echo You can now delete this folder (%HERE%) and the zip you downloaded.
goto end

:copyfail
> "%ALX_STATUS%" echo Stopped: could not copy the kit to %WORK%; double-click Start again to continue
echo Could not copy the kit to %WORK%.
set "RC=1"
goto end

:setupfail
> "%ALX_STATUS%" echo Stopped: setup did not finish (this window shows why); double-click Start again to continue
echo Setup did not finish. Double-click Start again to retry.
set "RC=1"
goto end

:end
echo.
if not "%ALX_DRY%"=="1" pause
exit /b %RC%
