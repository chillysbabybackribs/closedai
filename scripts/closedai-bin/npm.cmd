@echo off
if "%CLOSEDAI_REAL_NODE%"=="" (
  echo CLOSEDAI_REAL_NODE is unset >&2
  exit /b 1
)
"%CLOSEDAI_REAL_NODE%" "%~dp0run-shim.mjs" npm %*
