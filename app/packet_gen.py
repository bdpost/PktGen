import threading
from scapy.all import Ether, Dot1Q, IP, UDP, TCP, ICMP, Raw, sendp, get_if_list

_send_thread: threading.Thread | None = None
_stop_event = threading.Event()
_sent_count = 0


def get_interfaces() -> list[str]:
    return get_if_list()


def _build_packet(cfg: dict):
    eth = Ether(src=cfg["src_mac"], dst=cfg["dst_mac"])

    if cfg.get("vlan_id") is not None:
        eth = eth / Dot1Q(vlan=cfg["vlan_id"], prio=cfg.get("vlan_pcp", 0))

    # DSCP occupies the high 6 bits of the ToS/DSCP byte
    ip = IP(src=cfg["src_ip"], dst=cfg["dst_ip"], tos=cfg.get("dscp", 0) << 2)

    proto = cfg.get("protocol", "udp").lower()
    if proto == "tcp":
        transport = TCP(sport=cfg.get("src_port", 12345), dport=cfg.get("dst_port", 80), flags="S")
    elif proto == "icmp":
        transport = ICMP()
    else:
        transport = UDP(sport=cfg.get("src_port", 12345), dport=cfg.get("dst_port", 80))

    payload = cfg.get("payload", "ClabPktGen")
    return eth / ip / transport / Raw(load=payload.encode())


def send_fixed(cfg: dict, count: int, iface: str) -> int:
    pkt = _build_packet(cfg)
    sendp(pkt, iface=iface, count=count, inter=0, verbose=False)
    return count


def _continuous_worker(cfg: dict, rate: float, iface: str):
    global _sent_count
    _sent_count = 0
    pkt = _build_packet(cfg)
    interval = 1.0 / rate if rate > 0 else 0
    while not _stop_event.is_set():
        sendp(pkt, iface=iface, count=1, verbose=False)
        _sent_count += 1
        if interval > 0:
            _stop_event.wait(interval)


def start_continuous(cfg: dict, rate: float, iface: str) -> tuple[bool, str]:
    global _send_thread
    if _send_thread and _send_thread.is_alive():
        return False, "Already sending"
    _stop_event.clear()
    _send_thread = threading.Thread(
        target=_continuous_worker, args=(cfg, rate, iface), daemon=True
    )
    _send_thread.start()
    return True, "Stream started"


def stop_continuous() -> int:
    global _sent_count
    _stop_event.set()
    if _send_thread:
        _send_thread.join(timeout=3.0)
    return _sent_count


def is_sending() -> bool:
    return _send_thread is not None and _send_thread.is_alive()


def sent_count() -> int:
    return _sent_count
