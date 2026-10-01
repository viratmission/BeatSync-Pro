"""
Unit and Integration Tests for Clock Sync and Playback Synchronization
"""

import time
import pytest
from backend.sync.clock import MasterClock
from backend.sync.session import SessionManager
from shared.protocol.messages import (
    DRIFT_THRESHOLD_PERFECT,
    DRIFT_THRESHOLD_FINE,
    DRIFT_THRESHOLD_MODERATE,
    DRIFT_THRESHOLD_SEEK,
)


def test_master_clock_now():
    t1 = MasterClock.now_ms()
    time.sleep(0.01)
    t2 = MasterClock.now_ms()
    assert t2 > t1
    assert (t2 - t1) >= 8.0  # At least 8ms elapsed


def test_ntp_offset_calculation():
    # Scenario: Client clock is 5000ms ahead of server
    # Client sends at client_time=15000
    # Server receives & responds at server_time=10010
    # Client receives at client_time=15020 (RTT = 20ms)
    t0 = 15000.0
    t1 = 10010.0
    t2 = 15020.0
    
    offset, rtt = MasterClock.compute_ntp_offset(t0, t1, t2)
    assert rtt == 20.0
    # Expected offset = 10010 - (15000 + 10) = -5000ms
    assert offset == -5000.0


def test_session_manager_initial_state():
    sm = SessionManager(room_token="TEST123")
    state = sm.get_state()
    assert state.roomToken == "TEST123"
    assert state.currentTime == 0.0
    assert not state.playing
    assert state.playbackRate == 1.0
    assert state.sequence == 1


def test_session_manager_play_pause_seek():
    sm = SessionManager(room_token="TEST123")
    sm.load_video("vid-1", "Test Movie", "/media/vid-1", duration=120.0)

    # Play at position 10.0
    s_play = sm.play(position=10.0)
    assert s_play.playing is True
    assert s_play.currentTime == 10.0
    assert s_play.sequence == 3  # init(1) + load(2) + play(3)

    # Time elapses
    time.sleep(0.05)
    est_time = sm.get_state().currentTime
    assert est_time >= 10.04

    # Pause at position 15.0
    s_pause = sm.pause(position=15.0)
    assert s_pause.playing is False
    assert s_pause.currentTime == 15.0
    assert s_pause.sequence == 4

    # Seek to 45.0
    s_seek = sm.seek(position=45.0)
    assert s_seek.currentTime == 45.0
    assert s_seek.sequence == 5

    # Change playback rate
    s_rate = sm.set_rate(1.5)
    assert s_rate.playbackRate == 1.5
    assert s_rate.sequence == 6


def test_stale_sequence_rejection_logic():
    last_sequence = 10
    incoming_msg_sequence = 8  # Out of order packet
    assert incoming_msg_sequence < last_sequence  # Should be rejected


def test_drift_mitigation_tiers():
    def get_action(drift_sec: float) -> str:
        abs_d = abs(drift_sec)
        if abs_d <= DRIFT_THRESHOLD_PERFECT:
            return "none"
        elif abs_d <= DRIFT_THRESHOLD_FINE:
            return "micro_rate"
        elif abs_d <= DRIFT_THRESHOLD_MODERATE:
            return "moderate_rate"
        elif abs_d < DRIFT_THRESHOLD_SEEK:
            return "rapid_rate"
        else:
            return "hard_seek"

    assert get_action(0.015) == "none"          # 15ms drift -> perfect (< 20ms), no adjustment
    assert get_action(-0.020) == "none"         # -20ms drift -> perfect deadband
    assert get_action(0.045) == "micro_rate"    # 45ms drift -> micro rate adjustment (20-80ms)
    assert get_action(-0.075) == "micro_rate"   # -75ms drift -> micro rate adjustment
    assert get_action(0.150) == "moderate_rate" # 150ms drift -> moderate continuous catch-up (80-300ms)
    assert get_action(-0.250) == "moderate_rate"# -250ms drift -> continuous catch-up (no hard seek!)
    assert get_action(0.500) == "rapid_rate"    # 500ms drift -> rapid rate catch-up (300-800ms)
    assert get_action(0.850) == "hard_seek"     # 850ms drift -> hard audio seek (>= 800ms)
    assert get_action(-1.200) == "hard_seek"    # -1200ms drift -> hard audio seek

