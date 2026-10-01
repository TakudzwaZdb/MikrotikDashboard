> **Only for RouterOS 7+.** On RouterOS 6 use SSH-TUNNEL.md instead.

# Private WireGuard tunnel: server <-> MikroTik

Tunnel addresses: **server 10.10.10.1**, **router 10.10.10.2**. The router connects OUT to the server (works behind NAT). Requires **RouterOS 7+** (check: `/system resource print`). RouterOS 6 has no WireGuard — upgrade first.

## A. On the server (Ubuntu)
```
sudo apt update && sudo apt install -y wireguard
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
sudo cat /etc/wireguard/server.pub      # note this: SERVER_PUBLIC_KEY
```
Create `/etc/wireguard/wg0.conf` (paste the private key from `server.key`; add the router's public key after step B):
```
[Interface]
Address = 10.10.10.1/24
ListenPort = 51820
PrivateKey = <contents of server.key>

[Peer]
PublicKey = <ROUTER_PUBLIC_KEY>
AllowedIPs = 10.10.10.2/32
```
Open **UDP 51820** (Oracle: VCN security list ingress UDP 51820; and `sudo iptables -I INPUT -p udp --dport 51820 -j ACCEPT && sudo netfilter-persistent save`). Then `sudo systemctl enable --now wg-quick@wg0`.

## B. On the MikroTik (Winbox > New Terminal)
```
/interface wireguard add name=wg-vps listen-port=13231
/interface wireguard print                        # copy public-key = ROUTER_PUBLIC_KEY -> put in server wg0.conf
/ip address add address=10.10.10.2/24 interface=wg-vps
/interface wireguard peers add interface=wg-vps public-key="SERVER_PUBLIC_KEY" \
    endpoint-address=SERVER_PUBLIC_IP endpoint-port=51820 \
    allowed-address=10.10.10.1/32 persistent-keepalive=25s
```
Restart the server side after adding the router key: `sudo systemctl restart wg-quick@wg0`.

## C. Lock the API to the tunnel only
```
/ip firewall filter add chain=input in-interface=wg-vps src-address=10.10.10.1 protocol=tcp dst-port=8728 action=accept place-before=0 comment="dashboard API via WireGuard"
/ip service set api address=10.10.10.1/32 disabled=no
/ip service set api-ssl disabled=yes
/user group add name=dashboard policy=read,write,api,test,sensitive
/user add name=dashboard group=dashboard password="STRONG_PASSWORD" address=10.10.10.1/32
```
(Do not expose 8728/8729 on the WAN interface. The dedicated `dashboard` user only works from the tunnel.)

## D. Verify (on the server)
```
sudo wg show                 # "latest handshake" should be a few seconds ago
ping -c3 10.10.10.2
nc -zv 10.10.10.2 8728       # succeeded
```
Then in the project `.env`: `MIKROTIK_HOST=10.10.10.2`, `MIKROTIK_PORT=8728`, `MIKROTIK_USE_TLS=false`, `MIKROTIK_USERNAME=dashboard`, `MIKROTIK_PASSWORD=<the password above>`, and run `docker compose up -d --build`. Docker containers reach the tunnel through the server automatically.

## Troubleshooting
- No handshake: UDP 51820 blocked (cloud firewall + iptables), wrong endpoint IP, or swapped keys.
- Handshake OK but API refused: check `/ip service print` (api enabled, address includes 10.10.10.1) and the firewall rule order (accept rule above any drop rule).
- Dashboard says MIKROTIK OFFLINE: `docker compose logs app`, and test `nc -zv 10.10.10.2 8728` from the server.
