@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI自动作图工具 - 手机发卡后台
echo 正在启动手机发卡后台...
echo 启动后请复制窗口中显示的“手机端”地址到手机浏览器。
echo 手机与电脑需要连接同一个 Wi-Fi，管理地址不要发给客户。
echo.
npm run license:admin
if errorlevel 1 pause
