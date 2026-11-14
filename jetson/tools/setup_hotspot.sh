#!/bin/bash
# Create the MARSWALK Wi-Fi hotspot on the Jetson (auto-starts on boot). Run with sudo.
#   sudo tools/setup_hotspot.sh '<password>' [a|bg]
set -euo pipefail
PSK="${1:?usage: sudo $0 <password (8+ chars)> [a|bg]}"
BAND="${2:-a}"
IFACE="${IFACE:-wlP1p1s0}"
nmcli con delete marswalk >/dev/null 2>&1 || true
nmcli con add type wifi ifname "$IFACE" con-name marswalk autoconnect yes ssid MARSWALK \
  802-11-wireless.mode ap 802-11-wireless.band "$BAND" \
  ipv4.method shared ipv4.addresses 10.42.0.1/24 \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK"
nmcli con up marswalk
ip -br addr show "$IFACE"
echo "If it failed on band a: sudo iw reg set KR, or rerun with band bg."
