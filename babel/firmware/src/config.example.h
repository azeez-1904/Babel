#pragma once

// ── WiFi ────────────────────────────────────────────────────────────────────
#define WIFI_SSID     "YourNetworkName"
#define WIFI_PASSWORD "YourNetworkPassword"

// ── Babel server ────────────────────────────────────────────────────────────
// Local dev: your laptop's LAN IP, port 8080
// Example: "192.168.1.42"
#define SERVER_HOST   "192.168.1.42"
#define SERVER_PORT   8080
#define SERVER_PATH   "/"

// ── Room code ───────────────────────────────────────────────────────────────
// Hardcode for demo, or leave empty to prompt via Serial
#define ROOM_CODE     "ABCD"

// ── Display pins (change to match your wiring) ──────────────────────────────
// OLED I2C address (usually 0x3C or 0x3D)
#define OLED_I2C_ADDR 0x3C
#define OLED_SDA      21
#define OLED_SCL      22
