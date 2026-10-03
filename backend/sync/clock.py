"""
BeatSync-Pro High-Resolution Authoritative Clock.

The server exposes an epoch-compatible clock that is derived from a
monotonic process clock.

Why this matters:

    time.time()
        can jump when the operating system adjusts the system clock.

    time.monotonic()
        never moves backwards during the lifetime of the process.

We capture the wall-clock value once at startup and then advance it
using the monotonic clock.

This gives us:

    epoch-compatible timestamps
        +
    monotonic progression
        +
    compatibility with browser performance.timeOrigin + performance.now()

All values are milliseconds.
"""

import time
from typing import Tuple


class MasterClock:
    """
    Authoritative server clock provider.

    The returned timestamp is epoch-compatible, but its progression is
    driven by a monotonic clock so normal OS wall-clock adjustments do
    not move the playback timeline backwards or forwards.
    """

    # ------------------------------------------------------------
    # Process startup reference points
    # ------------------------------------------------------------

    _wall_start_ms = time.time() * 1000.0

    _monotonic_start_ns = time.monotonic_ns()


    # ------------------------------------------------------------
    # Authoritative time
    # ------------------------------------------------------------

    @classmethod
    def now_ms(cls) -> float:
        """
        Return authoritative server time in epoch milliseconds.

        The epoch value is established once when the process starts.
        Subsequent time progression comes from time.monotonic_ns().
        """

        elapsed_ms = (
            time.monotonic_ns() -
            cls._monotonic_start_ns
        ) / 1_000_000.0

        return cls._wall_start_ms + elapsed_ms


    # ------------------------------------------------------------
    # Monotonic-only time
    # ------------------------------------------------------------

    @classmethod
    def monotonic_ms(cls) -> float:
        """
        Return monotonic elapsed milliseconds since process startup.

        This is useful internally when a true monotonic duration is
        required rather than an epoch-compatible timestamp.
        """

        return (
            time.monotonic_ns() -
            cls._monotonic_start_ns
        ) / 1_000_000.0


    # ------------------------------------------------------------
    # NTP-style offset calculation
    # ------------------------------------------------------------

    @staticmethod
    def compute_ntp_offset(
        t0: float,
        t1: float,
        t2: float
    ) -> Tuple[float, float]:
        """
        Calculate NTP-style clock offset.

        Parameters
        ----------
        t0:
            Client timestamp when the ping was sent.

        t1:
            Server timestamp when the ping was received / pong was
            generated.

        t2:
            Client timestamp when the pong was received.

        Returns
        -------
        Tuple[float, float]
            (offset_ms, rtt_ms)

        Formula
        -------

            RTT = t2 - t0

            One-way delay ≈ RTT / 2

            offset =
                t1 - (t0 + RTT / 2)

        Client-side interpretation:

            estimatedServerTime =
                clientTime + offset_ms
        """

        rtt = float(t2) - float(t0)

        offset = (
            float(t1) -
            (
                float(t0) +
                (rtt / 2.0)
            )
        )

        return offset, rtt


    # ------------------------------------------------------------
    # Debug/reference helpers
    # ------------------------------------------------------------

    @classmethod
    def wall_start_ms(cls) -> float:
        """
        Return the epoch timestamp captured when the process started.
        """

        return cls._wall_start_ms


    @classmethod
    def reset_reference(cls) -> None:
        """
        Reset the clock reference.

        This is primarily useful for tests.

        Normal application code should NOT call this while a playback
        session is active because doing so would redefine the
        authoritative timeline.
        """

        cls._wall_start_ms = time.time() * 1000.0
        cls._monotonic_start_ns = time.monotonic_ns()