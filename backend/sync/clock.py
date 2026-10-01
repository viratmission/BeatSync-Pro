"""
High-resolution clock service for Master Timeline Synchronization.
"""

import time
from typing import Tuple


class MasterClock:
    """
    Authoritative server clock provider.
    Returns timestamps in milliseconds (compatible with JavaScript Date.now() / performance.now()).
    """

    @staticmethod
    def now_ms() -> float:
        """Returns the current server time in epoch milliseconds with sub-millisecond precision."""
        return time.time() * 1000.0

    @staticmethod
    def compute_ntp_offset(t0: float, t1: float, t2: float) -> Tuple[float, float]:
        """
        NTP offset calculation:
        t0 = client ping send time
        t1 = server pong time
        t2 = client pong receive time
        
        Round Trip Time (RTT) = (t2 - t0)
        One-way delay estimate = RTT / 2
        Clock Offset = t1 - (t0 + RTT / 2)
        
        Returns (offset_ms, rtt_ms).
        Client should adjust: estimatedServerTime = clientTime + offset_ms.
        """
        rtt = t2 - t0
        offset = t1 - (t0 + (rtt / 2.0))
        return offset, rtt
