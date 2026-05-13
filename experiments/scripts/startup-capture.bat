@echo off
start "" /B "C:\Program Files\USBPcap\USBPcapCMD.exe" -d \\.\USBPcap2 -A --inject-descriptors -o "C:\Users\hdcooper\Hardware-interface\hid-smoke\startup-cap.pcap"
timeout /t 30 /nobreak > nul
taskkill /F /IM USBPcapCMD.exe > nul 2>&1
