import os
import subprocess
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import packet_gen

app = FastAPI(title="ClabPktGen")

_static = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static), name="static")


@app.get("/")
async def index():
    return FileResponse(os.path.join(_static, "index.html"))


# ─── Packet models ────────────────────────────────────────────────────────────

class PacketConfig(BaseModel):
    src_mac: str = "de:ad:be:ef:00:01"
    dst_mac: str = "ff:ff:ff:ff:ff:ff"
    src_ip: str = "192.168.1.100"
    dst_ip: str = "192.168.1.1"
    vlan_id: Optional[int] = None
    vlan_pcp: int = 0
    dscp: int = 0
    protocol: str = "udp"
    src_port: int = 12345
    dst_port: int = 80
    payload: str = "ClabPktGen"


class SendRequest(PacketConfig):
    count: int = 1
    interface: str = "eth1"


class StreamRequest(PacketConfig):
    rate: float = 10.0
    interface: str = "eth1"


def _cfg(req: PacketConfig) -> dict:
    return req.model_dump()


# ─── Interface models ─────────────────────────────────────────────────────────

class InterfaceUp(BaseModel):
    interface: str = "eth1"
    ip: str  # e.g. "10.1.1.2/24"


class InterfaceDown(BaseModel):
    interface: str = "eth1"


# ─── Route models ─────────────────────────────────────────────────────────────

class RouteEntry(BaseModel):
    prefix: str        # e.g. "10.0.0.0/8"
    nexthop: str       # e.g. "10.1.1.1"
    interface: str = "eth1"


class RouteFlush(BaseModel):
    interface: str = "eth1"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ipcmd(*args: str) -> None:
    result = subprocess.run(["ip"] + list(args), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


# ─── Packet endpoints ─────────────────────────────────────────────────────────

@app.post("/api/send")
async def send(req: SendRequest):
    cfg = _cfg(req)
    iface = cfg.pop("interface")
    count = cfg.pop("count")
    try:
        sent = packet_gen.send_fixed(cfg, count, iface)
        return {"status": "ok", "sent": sent, "interface": iface}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/start")
async def start(req: StreamRequest):
    cfg = _cfg(req)
    iface = cfg.pop("interface")
    rate = cfg.pop("rate")
    try:
        ok, msg = packet_gen.start_continuous(cfg, rate, iface)
        if not ok:
            raise HTTPException(status_code=409, detail=msg)
        return {"status": "ok", "message": msg, "interface": iface, "rate": rate}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stop")
async def stop():
    sent = packet_gen.stop_continuous()
    return {"status": "ok", "sent": sent}


@app.get("/api/status")
async def status():
    return {
        "sending": packet_gen.is_sending(),
        "sent": packet_gen.sent_count(),
    }


@app.get("/api/interfaces")
async def interfaces():
    return {"interfaces": packet_gen.get_interfaces()}


# ─── Interface endpoints ──────────────────────────────────────────────────────

@app.post("/api/interface/up")
async def interface_up(req: InterfaceUp):
    try:
        _ipcmd("addr", "add", req.ip, "dev", req.interface)
        _ipcmd("link", "set", req.interface, "up")
        return {"status": "ok", "interface": req.interface, "ip": req.ip}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/interface/down")
async def interface_down(req: InterfaceDown):
    errors = []
    for args in [
        ("route", "flush", "dev", req.interface),
        ("addr", "flush", "dev", req.interface),
    ]:
        result = subprocess.run(["ip"] + list(args), capture_output=True, text=True)
        if result.returncode != 0:
            errors.append(result.stderr.strip())
    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))
    return {"status": "ok", "interface": req.interface}


# ─── Route endpoints ──────────────────────────────────────────────────────────

@app.post("/api/routes/add")
async def route_add(req: RouteEntry):
    try:
        _ipcmd("route", "add", req.prefix, "via", req.nexthop, "dev", req.interface)
        return {"status": "ok", "prefix": req.prefix, "nexthop": req.nexthop, "interface": req.interface}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/routes/del")
async def route_del(req: RouteEntry):
    try:
        _ipcmd("route", "del", req.prefix, "via", req.nexthop, "dev", req.interface)
        return {"status": "ok"}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/routes/flush")
async def route_flush(req: RouteFlush):
    try:
        _ipcmd("route", "flush", "dev", req.interface)
        return {"status": "ok", "interface": req.interface}
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
