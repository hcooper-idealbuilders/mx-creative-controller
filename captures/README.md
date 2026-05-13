# Captures

USBPcap pcap files from the MX Creative Console reverse-engineering.

| File | What's in it |
|---|---|
| `02-binding-paint.pcap` | Options+ running normally. User assigned a binding to a keypad key mid-capture, causing Options+ to paint the new icon. Contains the 5 LCD-write packets we extracted (`14ff022d...` on endpoint 1) plus the 1Hz heartbeat (`11ff041d0bb8...`). |
| `03-options-plus-startup.pcap` | Cold start. Logi Options+ was fully killed, then launched. Captures the full HID++ feature-negotiation handshake — ~15 distinct command types — plus the eventual LCD paints. This is where the display-claim sequence lives. |

## Derived data

`derived/` — extracted from the captures for replay experiments.

- `frame521.hex` — the first 4095-byte LCD-write packet from `02-binding-paint.pcap`, as a hex string. Used by `experiments/replay-hid.mjs`.
- `binding-paint-frames.tsv` — all five 4095-byte LCD-write packets from `02-binding-paint.pcap` (tab-separated `frame_number, time, hex_payload`). Used by `experiments/replay-all.mjs` and friends.

## Recapturing

Capture script: `experiments/scripts/dual-capture.bat`. Must run elevated (USBPcap requires admin).

```sh
powershell -Command "Start-Process 'experiments/scripts/dual-capture.bat' -Verb RunAs -Wait"
```

Output filenames are hardcoded inside the .bat — adjust paths as needed.

Analyzing a fresh capture:

```sh
# Find which USB address the MX has (it changes on every replug)
"C:/Program Files/Wireshark/tshark.exe" -r capture.pcap -Y 'usb.idProduct == 0xc354' \
  -T fields -e usb.device_address | sort -u

# Filter to host→device traffic on the MX, group by report ID
"C:/Program Files/Wireshark/tshark.exe" -r capture.pcap \
  -Y 'usb.device_address == <N> && usb.src == "host" && usb.data_len > 0' \
  -T fields -e usb.data_len -e usbhid.data | awk '{print $1, substr($2,1,8)}' | sort | uniq -c
```
