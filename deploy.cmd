@echo off
rem Publish the app to Cloudflare Pages (https://rack-planner-acce.pages.dev).
rem Copies only the files the browser needs into "dist", then uploads them.
rem First time on a PC: run "npx.cmd wrangler login" once.
setlocal
cd /d "%~dp0"
if exist dist rmdir /s /q dist
mkdir dist
copy /y index.html dist\ >nul
copy /y style.css dist\ >nul
copy /y _headers dist\ >nul
copy /y *.js dist\ >nul
call npx.cmd wrangler pages deploy dist --project-name rack-planner-acce --branch main --commit-dirty=true
endlocal
