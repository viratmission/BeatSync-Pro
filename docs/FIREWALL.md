# Windows Firewall Setup & LAN Troubleshooting Guide

When running BeatSync-Pro on Windows, the Windows Defender Firewall must allow incoming TCP connections on port **8080** so phones connected to your Wi-Fi or mobile hotspot can access the laptop.

---

## 1. Automated Setup (Recommended)

Run the included batch script as Administrator:
1. Locate `scripts\firewall-setup.bat`.
2. Right-click and choose **"Run as administrator"**.
3. The script will automatically add an inbound firewall rule named `BeatSync-Pro LAN` for TCP port `8080`.

---

## 2. Manual PowerShell Command

Open an Administrator PowerShell window and execute:

```powershell
netsh advfirewall firewall add rule name="BeatSync-Pro LAN" dir=in action=allow protocol=TCP localport=8080
```

To remove the rule later if desired:
```powershell
netsh advfirewall firewall delete rule name="BeatSync-Pro LAN"
```

---

## 3. Finding Your Laptop's Local IP Address

To manually check your laptop's Wi-Fi IP address:

1. Open PowerShell or Command Prompt.
2. Run:
   ```powershell
   ipconfig
   ```
3. Locate your active network adapter:
   - **Wireless LAN adapter Wi-Fi** (if connected to home/office router)
   - **Wireless LAN adapter Local Area Connection\* #** (if using Windows Mobile Hotspot)
4. Note the **IPv4 Address**, usually:
   - `192.168.1.xxx`
   - `192.168.137.xxx` (Windows Mobile Hotspot default)
   - `10.0.0.xxx`

---

## 4. Mobile Hotspot Mode (Zero Router Required)

You do **not** need an external Wi-Fi router or internet access to use BeatSync-Pro:

1. Turn on **Mobile Hotspot** on your Windows laptop (Settings > Network & internet > Mobile hotspot).
2. Connect your phones to the laptop's hotspot network.
3. Start BeatSync-Pro (`run-host.bat`).
4. Phones scan the QR code and connect immediately.

---

## 5. Troubleshooting Connection Issues

| Symptom | Root Cause | Solution |
|---|---|---|
| Phone browser says *"Site cannot be reached"* | Firewall blocking port 8080 | Run `scripts\firewall-setup.bat` as Administrator |
| Phone browser connects but video doesn't play | Mobile browser autoplay restriction | Tap the screen overlay to unlock audio & video |
| Phone connected to cellular data instead of LAN | Wi-Fi Assist switched to mobile data | Turn off Cellular Data on phone while connected to offline Wi-Fi |
| Laptop network adapter set to "Public" | Windows Firewall blocks public networks | Switch network profile to "Private" in Windows Settings |
