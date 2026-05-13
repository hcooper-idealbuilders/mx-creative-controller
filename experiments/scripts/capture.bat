@echo off
"C:\Program Files\Wireshark\tshark.exe" -i \\.\USBPcap1 -i \\.\USBPcap2 -a duration:20 -w "C:\Users\hdcooper\Hardware-interface\hid-smoke\usb-capture.pcapng" 2> "C:\Users\hdcooper\Hardware-interface\hid-smoke\capture.err"
