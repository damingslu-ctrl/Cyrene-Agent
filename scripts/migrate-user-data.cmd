@echo off
rem Mochi user data migration entry point. Double-click to run.
rem Keep this file ASCII-only: cmd.exe reads BOM-less files with the system
rem ANSI codepage, and non-ASCII bytes here can break parsing on some machines.
rem Extra arguments are forwarded to the ps1. To override the completion-marker
rem gate, call migrate-user-data.cmd -Force from a command prompt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-user-data.ps1" %*
pause
