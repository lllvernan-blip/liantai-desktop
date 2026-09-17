@echo off
chcp 936 >nul
cd /d "%~dp0"

echo.
echo   ==============================================
echo    综应练习台 - 打包
echo   ==============================================
echo.
echo   注意：打包前请先关掉正在运行的「综应练习台」程序，
echo         否则新包写不进去。
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo   [错误] 没找到 npm，请确认 Node.js 已安装。
  pause
  exit /b 1
)

rem 下载源走国内镜像：打包器要从网上拉组件，直连 GitHub 经常断
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

echo   正在打包，约 1-3 分钟，请别关这个窗口……
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo   [失败] 打包没成功，把上面的报错截给 Cola 即可。
  pause
  exit /b 1
)

echo.
echo   完成！成品在这里：dist\综应练习台.exe
start "" explorer "%~dp0dist"
exit /b 0