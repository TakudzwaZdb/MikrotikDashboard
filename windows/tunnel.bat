@echo off
REM Keeps an SSH reverse tunnel to the server alive (auto-reconnects). Edit the 3 values below.
set SERVER=ubuntu@YOUR_SERVER_PUBLIC_IP
set ROUTER_LAN_IP=192.168.88.1
set KEY=%USERPROFILE%\.ssh\id_tunnel

:loop
echo [%date% %time%] connecting...
ssh -N -i "%KEY%" -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -R 172.28.0.1:8728:%ROUTER_LAN_IP%:8728 %SERVER%
echo [%date% %time%] tunnel dropped, retrying in 10s...
timeout /t 10 /nobreak >nul
goto loop
