# Connect the online server to a RouterOS 6 router (Windows laptop + SSH tunnel)

How it works: a Windows laptop on the router's LAN opens an **encrypted SSH connection out** to the server and forwards the router's API port through it. The router is never exposed to the internet. The laptop must stay **on, awake and on the router's network**; if it is off, the dashboard shows MIKROTIK OFFLINE and pauses polling (the router/hotspot itself keeps working; the app just isn't enforcing data caps or logging until the laptop is back).

Names used below: `SERVER_IP` = server public IP, `ROUTER_LAN_IP` = router address on your LAN (often 192.168.88.1), `LAPTOP_LAN_IP` = the laptop's LAN address.

## 1. Router (Winbox > New Terminal)
Give the laptop a fixed address first (IP > DHCP Server > Leases > right-click the laptop > Make Static). Then:
```
/ip service set api address=LAPTOP_LAN_IP/32 disabled=no port=8728
/ip service set api-ssl disabled=yes
/user group add name=dashboard policy=read,write,api,test,sensitive
/user add name=dashboard group=dashboard password="STRONG_PASSWORD" address=LAPTOP_LAN_IP/32
```
Do not open 8728 on the WAN. (The traffic laptop -> router stays on your LAN; laptop -> server is inside SSH.)

## 2. Server (Ubuntu) - once
```
sudo nano /etc/ssh/sshd_config      # add this line at the end:
GatewayPorts clientspecified
sudo systemctl restart ssh
sudo iptables -I INPUT -i br+ -p tcp --dport 8728 -j ACCEPT && sudo netfilter-persistent save
```
The `iptables` line lets the app container (on the docker network) reach the tunnel port.

## 3. Laptop (Windows 10/11, PowerShell)
Create a key used only for the tunnel:
```
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_tunnel -N '""'
type $env:USERPROFILE\.ssh\id_tunnel.pub
```
On the **server**, add that one line to `~/.ssh/authorized_keys`, restricted so the key can do nothing but this tunnel:
```
restrict,port-forwarding,permitlisten="172.28.0.1:8728" ssh-ed25519 AAAA...yourkey... laptop-tunnel
```
Copy `windows\tunnel.bat` from the project to the laptop, edit `SERVER`, `ROUTER_LAN_IP`, `KEY`. (Oracle's default user is `ubuntu`; the Oracle VM's own login key stays separate.)

## 4. Start order matters
1. On the server first: `docker compose up -d --build` (this creates the docker network whose gateway 172.28.0.1 the tunnel binds to).
2. Then on the laptop: double-click `tunnel.bat`. Leave the window open (minimise it).
3. Check on the server: `ss -ltn | grep 8728` (should show 172.28.0.1:8728) and `nc -zv 172.28.0.1 8728`.
4. In the project `.env` on the server: `MIKROTIK_HOST=172.28.0.1`, `MIKROTIK_PORT=8728`, `MIKROTIK_USE_TLS=false`, `MIKROTIK_USERNAME=dashboard`, `MIKROTIK_PASSWORD=<password from step 1>`. Then `docker compose up -d` again. The dashboard should turn LIVE.

## 5. Keep it running on the laptop
- Task Scheduler > Create Task > Trigger "At log on" > Action: start `tunnel.bat` (tick "Run whether user is logged on or not" only if you store the password).
- Settings > System > Power: set sleep to **Never** (plugged in), and keep the lid-close action to "Do nothing".
- `tunnel.bat` reconnects automatically every 10 s if the link drops.

## Troubleshooting
- `remote port forwarding failed` / tunnel exits: the docker network doesn't exist yet (run `docker compose up -d` first), or `GatewayPorts clientspecified` is missing.
- Tunnel is up but the dashboard says OFFLINE: check the router user/password, the `api` service address includes the laptop's LAN IP, and `docker compose logs app`.
- Permission denied: the public key line in `authorized_keys` was pasted wrongly (must be a single line).
