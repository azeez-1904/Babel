#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "mascot.h"

// ─── Globals ──────────────────────────────────────────────────────────────────
static WebSocketsClient ws;
static AnimCtx          animCtx;
static uint32_t         lastFrameMs = 0;
static bool             wsConnected = false;
static char             roomCode[16] = ROOM_CODE;

// ─── WebSocket event handler ──────────────────────────────────────────────────
void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      wsConnected = false;
      animCtx.state = MascotState::ERROR_STATE;
      animCtx.state_ms = millis();
      break;

    case WStype_CONNECTED:
      Serial.printf("[WS] Connected to %s\n", SERVER_HOST);
      wsConnected = true;
      {
        // Send join_room immediately
        JsonDocument doc;
        doc["type"]      = "join_room";
        doc["room_code"] = roomCode;
        doc["user_lang"] = "device";
        doc["is_device"] = true;
        String msg;
        serializeJson(doc, msg);
        ws.sendTXT(msg);
        Serial.printf("[WS] Joined room %s\n", roomCode);
      }
      animCtx.state    = MascotState::IDLE;
      animCtx.state_ms = millis();
      break;

    case WStype_TEXT: {
      payload[length] = 0; // null-terminate
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, (char*)payload);
      if (err) { Serial.printf("[JSON] parse error: %s\n", err.c_str()); break; }

      const char* msgType = doc["type"];
      if (!msgType) break;

      if (strcmp(msgType, "state_change") == 0) {
        const char* stateStr = doc["state"];
        if (stateStr) {
          MascotState newState = stateFromString(stateStr);
          if (newState != animCtx.state) {
            animCtx.prev_state = animCtx.state;
            animCtx.state      = newState;
            animCtx.state_ms   = millis();
            Serial.printf("[State] → %s\n", stateStr);
          }
        }
      } else if (strcmp(msgType, "pong") == 0) {
        // keepalive acknowledged
      } else if (strcmp(msgType, "error") == 0) {
        animCtx.state    = MascotState::ERROR_STATE;
        animCtx.state_ms = millis();
      }
      break;
    }

    case WStype_PING:
    case WStype_PONG:
      break;

    default:
      break;
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== Babel ESP32 Companion ===");

  // Init display and show connecting state
  mascot_init();
  animCtx.state    = MascotState::THINKING; // show "waiting" while connecting
  animCtx.state_ms = millis();

  // WiFi
  Serial.printf("Connecting to %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  // Room code: use ROOM_CODE define, or prompt via serial
#ifdef ROOM_CODE
  if (strlen(ROOM_CODE) == 0) {
    Serial.print("Enter room code: ");
    while (Serial.available() == 0) {
      // Let animation run while waiting
      if (millis() - lastFrameMs >= FRAME_MS) {
        mascot_draw(animCtx);
        lastFrameMs = millis();
      }
    }
    String input = Serial.readStringUntil('\n');
    input.trim();
    input.toUpperCase();
    strncpy(roomCode, input.c_str(), sizeof(roomCode) - 1);
  }
#endif
  Serial.printf("Room: %s\n", roomCode);

  // WebSocket
  ws.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 3000, 2);

  animCtx.state    = MascotState::IDLE;
  animCtx.state_ms = millis();
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  ws.loop();

  uint32_t now = millis();
  if (now - lastFrameMs >= FRAME_MS) {
    mascot_draw(animCtx);
    lastFrameMs = now;
    animCtx.frame++;
  }

  // After ERROR_STATE has shown for 2.5s, return to IDLE
  if (animCtx.state == MascotState::ERROR_STATE &&
      wsConnected &&
      (millis() - animCtx.state_ms) > 2500) {
    animCtx.state    = MascotState::IDLE;
    animCtx.state_ms = millis();
  }
}
