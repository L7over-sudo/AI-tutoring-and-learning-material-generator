@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI自动作图工具 - 激活码发卡后台
npm run license:admin
if errorlevel 1 pause
