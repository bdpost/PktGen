# ClabPktGen

A Docker-based packet generator designed for use in [Containerlab](https://containerlab.dev) topologies. Built for testing QoS features on Arista EOS — craft and inject raw Ethernet frames with full control over L2 headers, 802.1Q VLAN tags, IP/DSCP markings, and L4 protocol fields, all from a web GUI.

---

## How It Works

```
  ┌─────────────────────────┐          ┌──────────────────────────┐
  │       clabpktgen        │          │         cEOS node        │
  │                         │          │                          │
  │  eth0 ─── mgmt (clab)  │          │  eth0 ─── mgmt (clab)   │
  │                         │   veth   │                          │
  │  eth1 ─────────────────────────── │  Ethernet1 (trunk)      │
  │         data plane      │          │                          │
  │                         │          │  VLAN classification     │
  │  GUI on :8080 (eth0)   │          │  DSCP / QoS policy       │
  └─────────────────────────┘          └──────────────────────────┘
```

- **eth0** — management interface, managed by Containerlab. Default route and static management routes live here. The web GUI is served on port 8080 via this interface.
- **eth1** — data plane interface, stitched to the cEOS node via a veth pair. All crafted packets go out here.

---

## GUI Features

| Layer | Fields |
|---|---|
| L2 Ethernet | Source MAC, Destination MAC |
| 802.1Q | VLAN ID (1–4094), PCP/CoS (0–7), toggle on/off |
| L3 IP | Source IP, Destination IP, DSCP (0–63 with named quick-select) |
| L4 Transport | Protocol (UDP / TCP / ICMP), Source Port, Destination Port |
| Transmission | Interface picker, Fixed count or Continuous stream (pps rate) |
| Payload | Custom ASCII string |

DSCP quick-select includes all named values: CS0–CS7, AF11–AF43, EF (46).

---

## Build & Push to GHCR

### 1. Authenticate to GitHub Container Registry

```bash
echo "<YOUR_GITHUB_PAT>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
```

Your PAT needs the `write:packages` scope. Create one at **GitHub → Settings → Developer settings → Personal access tokens**.

### 2. Build the image

```bash
docker build -t ghcr.io/bdpost/clabpktgen:latest .
```

### 3. Push

```bash
docker push ghcr.io/bdpost/clabpktgen:latest
```

### 4. Make the package public (optional but recommended for clab machines)

**GitHub → Your profile → Packages → clabpktgen → Package settings → Change visibility → Public**

This lets your clab machine pull without authentication.

---

## Adding to a Containerlab Topology

### Minimal example

```yaml
name: qos-lab

topology:
  nodes:
    pktgen:
      kind: linux
      image: ghcr.io/bdpost/clabpktgen:latest
      mgmt-ipv4: 172.20.20.10
      cap-add:
        - NET_ADMIN
        - NET_RAW
      ports:
        - "8080:8080/tcp"

    ceos1:
      kind: arista_ceos
      image: ceos:4.32.0F
      mgmt-ipv4: 172.20.20.11
      startup-config: ceos1.cfg

  links:
    - endpoints: ["pktgen:eth1", "ceos1:eth1"]
```

### Full example with multiple VLANs

```yaml
name: qos-lab

topology:
  nodes:
    pktgen:
      kind: linux
      image: ghcr.io/bdpost/clabpktgen:latest
      mgmt-ipv4: 172.20.20.10
      cap-add:
        - NET_ADMIN
        - NET_RAW
      ports:
        - "8080:8080/tcp"
      # Optional: override entrypoint env vars
      env:
        PYTHONUNBUFFERED: "1"

    ceos1:
      kind: arista_ceos
      image: ceos:4.32.0F
      mgmt-ipv4: 172.20.20.11
      startup-config: ceos1.cfg

  links:
    - endpoints: ["pktgen:eth1", "ceos1:eth1"]
```

> **Note on `privileged`:** Containerlab does not expose a `privileged: true` flag in the topology file. The `NET_ADMIN` + `NET_RAW` capabilities cover everything Scapy needs for raw packet injection. If you hit permission errors, add `SYS_ADMIN` to `cap-add`.

---

## Configuring the cEOS Trunk Port

ClabPktGen sends 802.1Q-tagged frames out `eth1`. The connected cEOS interface must be a trunk. VLAN and QoS policy configuration cannot be set in the Containerlab topology file — it must live in the cEOS `startup-config`.

**`ceos1.cfg` example:**

```
! hostname
hostname ceos1

! Ethernet1 is connected to clabpktgen eth1
interface Ethernet1
   switchport mode trunk
   switchport trunk allowed vlan 1-4094
!

! VLANs
vlan 100
   name DSCP-TEST-EF
vlan 200
   name DSCP-TEST-AF41
!

! QoS — classify inbound DSCP and map to traffic class
qos map dscp 46 to traffic-class 5        ! EF → TC5
qos map dscp 34 to traffic-class 4        ! AF41 → TC4
qos map dscp 0  to traffic-class 0        ! BE → TC0
!

! Apply inbound QoS on the trunk
interface Ethernet1
   qos trust dscp
!
```

---

## Static Management Routes

The container installs these routes on `eth0` at startup (via `entrypoint.sh`):

| Prefix | Next-hop |
|---|---|
| 10.0.2.0/24 | 10.64.254.1 |
| 10.77.7.0/24 | 10.64.254.1 |
| 10.255.2.0/24 | 10.64.254.1 |

To change these, edit `entrypoint.sh` before building:

```bash
ip route add 10.0.2.0/24   via 10.64.254.1 dev eth0 2>/dev/null || true
ip route add 10.77.7.0/24  via 10.64.254.1 dev eth0 2>/dev/null || true
ip route add 10.255.2.0/24 via 10.64.254.1 dev eth0 2>/dev/null || true
```

---

## Deploying in Containerlab

```bash
# Deploy the topology
clab deploy -t qos-lab.clab.yml

# Check node status and management IPs
clab inspect -t qos-lab.clab.yml

# Tear down
clab destroy -t qos-lab.clab.yml

# Tear down and wipe the clab directory
clab destroy -t qos-lab.clab.yml --cleanup
```

Once deployed, open the GUI at:
```
http://<mgmt-ipv4-of-pktgen>:8080
```

---

## Importing the cEOS Image

cEOS must be obtained from [arista.com](https://www.arista.com) (requires a free account) and imported manually:

```bash
docker import cEOS64-lab-4.32.0F.tar.xz ceos:4.32.0F
```

The image name (`ceos:4.32.0F`) must match what you put in the topology file.

---

## Verifying Packets on the Wire

Inside the container (tcpdump is pre-installed):

```bash
docker exec -it clab-<lab-name>-pktgen tcpdump -i eth1 -n -e -v
```

Or from the cEOS side using EOS CLI:

```
ceos1# bash sudo tcpdump -i eth1 -n -e -v
```

What you'll see for a VLAN-tagged EF packet:

```
de:ad:be:ef:00:01 > ff:ff:ff:ff:ff:ff, ethertype 802.1Q (0x8100), vlan 100, p 0, ...
  IP (tos 0xb8, ...) 10.0.0.1.12345 > 10.0.0.2.80: UDP
```

`tos 0xb8` = `0b10111000` = DSCP 46 (EF) shifted left by 2.

---

## Local Development

Run locally without Containerlab:

```bash
docker compose up -d
```

The container gets its own network namespace (`eth0` + `lo`). Use `lo` as the send interface for smoke-testing the API — no real frames will go anywhere useful, but it confirms the stack works. Access the GUI at `http://localhost:8080`.

```bash
# Tail logs
docker logs -f clabpktgen-dev

# Shell into the container
docker exec -it clabpktgen-dev bash

# Stop
docker compose down
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/send` | Send a fixed number of packets |
| `POST` | `/api/start` | Start a continuous packet stream |
| `POST` | `/api/stop` | Stop the running stream |
| `GET` | `/api/status` | Stream status + total sent count |
| `GET` | `/api/interfaces` | List available network interfaces |

**Send example:**
```bash
curl -X POST http://localhost:8080/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "src_mac": "de:ad:be:ef:00:01",
    "dst_mac": "ff:ff:ff:ff:ff:ff",
    "src_ip": "10.0.0.1",
    "dst_ip": "10.0.0.2",
    "vlan_id": 100,
    "vlan_pcp": 5,
    "dscp": 46,
    "protocol": "udp",
    "src_port": 1234,
    "dst_port": 5000,
    "count": 10,
    "interface": "eth1"
  }'
```

---

## Project Structure

```
ClabPktGen/
├── Dockerfile
├── docker-compose.yml        # Local dev
├── entrypoint.sh             # Route injection + uvicorn start
├── app/
│   ├── main.py               # FastAPI app + API routes
│   ├── packet_gen.py         # Scapy packet engine
│   └── requirements.txt
└── static/
    ├── index.html
    ├── style.css
    └── app.js
```
