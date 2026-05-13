@echo off
start "" /B "C:\Program Files\USBPcap\USBPcapCMD.exe" -d \\.\USBPcap1 -A --inject-descriptors -o "C:\Users\hdcooper\Hardware-interface\hid-smoke\cap1.pcap"
start "" /B "C:\Program Files\USBPcap\USBPcapCMD.exe" -d \\.\USBPcap2 -A --inject-descriptors -o "C:\Users\hdcooper\Hardware-interface\hid-smoke\cap2.pcap"
timeout /t 20 /nobreak > nul
taskkill /F /IM USBPcapCMD.exe > nul 2>&1
