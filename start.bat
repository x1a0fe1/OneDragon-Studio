@echo off
chcp 65001 >nul
title OneDragon Studio
cd /d "%~dp0"

if not exist "backend\venv\Scripts\python.exe" (
    echo [首次运行] 创建 Python 虚拟环境并安装后端依赖...
    python -m venv backend\venv || goto :fail
    backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt || goto :fail
)
if not exist "frontend\dist\index.html" (
    echo [首次运行] 安装前端依赖并打包...
    pushd frontend
    call npm install || goto :fail
    call npm run build || goto :fail
    popd
)

echo.
echo  OneDragon Studio 已启动：http://127.0.0.1:8100
echo  关闭这个窗口即停止服务
echo.
start "" http://127.0.0.1:8100
cd backend
venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8100
pause
exit /b 0

:fail
echo.
echo [失败] 安装出错，请把上面的报错发给开发者
pause
exit /b 1
