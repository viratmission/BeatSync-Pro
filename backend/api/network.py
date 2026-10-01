"""
LAN Network Discovery and IP Address Resolution for BeatSync-Pro.
Detects local network adapters without requiring internet access.
"""

import socket
import logging
from typing import List, Dict, Any

logger = logging.getLogger("BeatSync.Network")


def get_lan_ip_addresses() -> List[Dict[str, str]]:
    """
    Detects all active IPv4 LAN addresses on the local machine.
    Filters out loopback (127.0.0.1) and link-local (169.254.x.x).
    """
    detected_ips: List[Dict[str, str]] = []
    seen = set()

    # Method 1: Connect dummy UDP socket to find default route interface
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        # Using a dummy private IP or standard router IP without sending actual packets
        s.connect(("192.168.1.1", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip and primary_ip not in seen and not primary_ip.startswith("127."):
            detected_ips.append({"ip": primary_ip, "type": "primary"})
            seen.add(primary_ip)
    except Exception:
        pass

    # Method 2: Inspect host name addresses
    try:
        hostname = socket.gethostname()
        _, _, ip_list = socket.gethostbyname_ex(hostname)
        for ip in ip_list:
            if ip in seen:
                continue
            # Filter private LAN IPv4 ranges
            if ip.startswith("192.168.") or ip.startswith("10.") or (ip.startswith("172.") and 16 <= int(ip.split(".")[1]) <= 31):
                detected_ips.append({"ip": ip, "type": "lan"})
                seen.add(ip)
    except Exception as e:
        logger.debug(f"gethostbyname_ex failed: {e}")

    # Fallback if no private IP detected
    if not detected_ips:
        detected_ips.append({"ip": "127.0.0.1", "type": "loopback"})

    return detected_ips


def get_primary_lan_ip() -> str:
    """Returns the primary recommended LAN IP address for phones to connect."""
    ips = get_lan_ip_addresses()
    for item in ips:
        if item.get("type") == "primary":
            return item["ip"]
    for item in ips:
        if item.get("type") == "lan":
            return item["ip"]
    return "127.0.0.1"
