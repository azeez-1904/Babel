#include "mascot.h"

MascotState stateFromString(const char* s) {
  if (strcmp(s, "listening") == 0) return MascotState::LISTENING;
  if (strcmp(s, "thinking")  == 0) return MascotState::THINKING;
  if (strcmp(s, "speaking")  == 0) return MascotState::SPEAKING;
  if (strcmp(s, "error")     == 0) return MascotState::ERROR_STATE;
  return MascotState::IDLE;
}

// ─── OLED implementation ─────────────────────────────────────────────────────
#ifdef USE_OLED
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Wire.h>
#include "config.h"

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);

// Body geometry (128x64 screen)
constexpr int BODY_W  = 44;
constexpr int BODY_H  = 36;
constexpr int BODY_X  = (128 - BODY_W) / 2;  // 42
constexpr int BODY_Y  = 10;
constexpr int EYE_R   = 4;
constexpr int EYE_LX  = BODY_X + BODY_W / 3;
constexpr int EYE_RX  = BODY_X + BODY_W * 2 / 3;
constexpr int EYE_Y   = BODY_Y + BODY_H / 3 + 2;
constexpr int MOUTH_X = BODY_X + BODY_W / 2;
constexpr int MOUTH_Y = BODY_Y + BODY_H * 2 / 3 + 2;

void mascot_init() {
  Wire.begin(OLED_SDA, OLED_SCL);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("SSD1306 not found");
    return;
  }
  oled.clearDisplay();
  oled.display();
}

void mascot_clear() {
  oled.clearDisplay();
}

static void drawBody(int x_offset, int y_offset, float scale = 1.0f) {
  int w = (int)(BODY_W * scale);
  int h = (int)(BODY_H * scale);
  int x = BODY_X + (BODY_W - w) / 2 + x_offset;
  int y = BODY_Y + (BODY_H - h) / 2 + y_offset;
  oled.fillRoundRect(x, y, w, h, 8, SSD1306_WHITE);
}

static void eraseBody() {
  // erase a bit wider to cover animation jitter
  oled.fillRect(BODY_X - 4, BODY_Y - 4, BODY_W + 8, BODY_H + 8, SSD1306_BLACK);
}

void mascot_draw(const AnimCtx& ctx) {
  oled.clearDisplay();

  const float t = (millis() - ctx.state_ms) / 1000.0f;

  switch (ctx.state) {

    case MascotState::IDLE: {
      // Breathe: scale 1.0 → 1.03 → 1.0 over 2s
      float breathe = 1.0f + 0.03f * sinf01(t / 2.0f);
      int bw = (int)(BODY_W * breathe);
      int bh = (int)(BODY_H * breathe);
      int bx = BODY_X + (BODY_W - bw) / 2;
      int by = BODY_Y + (BODY_H - bh) / 2;
      oled.fillRoundRect(bx, by, bw, bh, 8, SSD1306_WHITE);

      // Blink: eyes closed for 0.12s every ~3.5s
      float cycle = fmodf(t, 3.5f);
      bool blinked = cycle > 3.3f;
      // Left eye
      if (!blinked) oled.fillCircle(EYE_LX, EYE_Y, EYE_R, SSD1306_BLACK);
      else          oled.drawFastHLine(EYE_LX - EYE_R, EYE_Y, EYE_R * 2, SSD1306_BLACK);
      // Right eye
      if (!blinked) oled.fillCircle(EYE_RX, EYE_Y, EYE_R, SSD1306_BLACK);
      else          oled.drawFastHLine(EYE_RX - EYE_R, EYE_Y, EYE_R * 2, SSD1306_BLACK);
      break;
    }

    case MascotState::LISTENING: {
      drawBody(0, 0);
      // Eyes slightly wider
      oled.fillCircle(EYE_LX, EYE_Y, EYE_R + 1, SSD1306_BLACK);
      oled.fillCircle(EYE_RX, EYE_Y, EYE_R + 1, SSD1306_BLACK);
      // Ripple lines from sides
      float ripple = fmodf(t * 1.2f, 1.0f);
      int   ramp   = (int)(ripple * 12);
      oled.drawLine(BODY_X - 6 - ramp, EYE_Y - 3, BODY_X - 2 - ramp, EYE_Y,     SSD1306_WHITE);
      oled.drawLine(BODY_X - 6 - ramp, EYE_Y + 3, BODY_X - 2 - ramp, EYE_Y,     SSD1306_WHITE);
      oled.drawLine(BODY_X + BODY_W + 2 + ramp, EYE_Y - 3, BODY_X + BODY_W + 6 + ramp, EYE_Y, SSD1306_WHITE);
      oled.drawLine(BODY_X + BODY_W + 2 + ramp, EYE_Y + 3, BODY_X + BODY_W + 6 + ramp, EYE_Y, SSD1306_WHITE);
      break;
    }

    case MascotState::THINKING: {
      // Bobble: vertical sine, ~2Hz, ±6px
      float bobble_y = -6.0f * sinf(t * 2.0f * TWO_PI_F * 2.0f);
      int by = (int)bobble_y;
      drawBody(0, by);
      oled.fillCircle(EYE_LX, EYE_Y + by, EYE_R, SSD1306_BLACK);
      oled.fillCircle(EYE_RX, EYE_Y + by, EYE_R, SSD1306_BLACK);
      // Cycling dots below
      uint8_t dots = 1 + (uint8_t)(fmodf(t * 2.0f, 3.0f));
      int dot_x = 128/2 - 10;
      int dot_y = BODY_Y + BODY_H + 12;
      for (uint8_t i = 0; i < 3; i++) {
        if (i < dots) oled.fillCircle(dot_x + i * 10, dot_y, 2, SSD1306_WHITE);
        else          oled.drawCircle(dot_x + i * 10, dot_y, 2, SSD1306_WHITE);
      }
      break;
    }

    case MascotState::SPEAKING: {
      drawBody(0, 0);
      // Happy curved eyes (arcs instead of filled circles)
      oled.drawCircle(EYE_LX, EYE_Y + 1, EYE_R, SSD1306_BLACK);
      oled.fillRect(EYE_LX - EYE_R - 1, EYE_Y + 1, EYE_R * 2 + 2, EYE_R + 2, SSD1306_WHITE);
      oled.drawCircle(EYE_RX, EYE_Y + 1, EYE_R, SSD1306_BLACK);
      oled.fillRect(EYE_RX - EYE_R - 1, EYE_Y + 1, EYE_R * 2 + 2, EYE_R + 2, SSD1306_WHITE);
      // Mouth open/close on sine
      float mouth = fabsf(sinf(t * TWO_PI_F * 3.0f));
      int mh = 2 + (int)(mouth * 6);
      int mw = 10;
      oled.drawRoundRect(MOUTH_X - mw/2, MOUTH_Y - mh/2, mw, mh, 2, SSD1306_BLACK);
      break;
    }

    case MascotState::ERROR_STATE: {
      // Shake: happens once on entry, then stays static with X eyes
      float shake_t = (millis() - ctx.state_ms) / 1000.0f;
      int   sx = 0;
      if (shake_t < 0.5f) {
        int step = (int)(shake_t / 0.07f);
        const int8_t shakes[] = {0, -8, 8, -6, 6, -3, 3, 0};
        sx = shakes[min((int)step, 7)];
      }
      drawBody(sx, 0);
      // X eyes
      oled.drawLine(EYE_LX+sx-3, EYE_Y-3, EYE_LX+sx+3, EYE_Y+3, SSD1306_BLACK);
      oled.drawLine(EYE_LX+sx+3, EYE_Y-3, EYE_LX+sx-3, EYE_Y+3, SSD1306_BLACK);
      oled.drawLine(EYE_RX+sx-3, EYE_Y-3, EYE_RX+sx+3, EYE_Y+3, SSD1306_BLACK);
      oled.drawLine(EYE_RX+sx+3, EYE_Y-3, EYE_RX+sx-3, EYE_Y+3, SSD1306_BLACK);
      break;
    }
  }

  oled.display();
}

// ─── TFT implementation ──────────────────────────────────────────────────────
#elif defined(USE_TFT)
#include <TFT_eSPI.h>

static TFT_eSPI tft;
static TFT_eSprite sprite = TFT_eSprite(&tft);

// Palette (match web UI)
constexpr uint32_t C_BG      = 0xFDF5EC; // parchment — note: TFT_eSPI uses 16-bit
constexpr uint16_t C_CORAL   = tft.color565(0xE8, 0x74, 0x4C);
constexpr uint16_t C_CHARCOAL= tft.color565(0x2A, 0x2A, 0x2A);
constexpr uint16_t C_PARCHMENT= tft.color565(0xFA, 0xF7, 0xF2);

constexpr int SCR_W = 240;
constexpr int SCR_H = 240;
constexpr int BODY_W = 80;
constexpr int BODY_H = 68;
constexpr int BODY_X = (SCR_W - BODY_W) / 2;
constexpr int BODY_Y = 70;
constexpr int EYE_R  = 8;
constexpr int EYE_LX = BODY_X + BODY_W / 3;
constexpr int EYE_RX = BODY_X + BODY_W * 2 / 3;
constexpr int EYE_Y  = BODY_Y + BODY_H / 3 + 4;
constexpr int MOUTH_X= BODY_X + BODY_W / 2;
constexpr int MOUTH_Y= BODY_Y + BODY_H * 2 / 3 + 4;

void mascot_init() {
  tft.init();
  tft.setRotation(0);
  tft.fillScreen(C_PARCHMENT);
  // Create full-screen sprite for flicker-free rendering
  sprite.createSprite(SCR_W, SCR_H);
}

void mascot_clear() {
  sprite.fillSprite(C_PARCHMENT);
}

static void drawBodyTFT(int x_offset, int y_offset, float scale = 1.0f) {
  int w = (int)(BODY_W * scale);
  int h = (int)(BODY_H * scale);
  int x = BODY_X + (BODY_W - w) / 2 + x_offset;
  int y = BODY_Y + (BODY_H - h) / 2 + y_offset;
  sprite.fillRoundRect(x, y, w, h, 14, C_CORAL);
}

void mascot_draw(const AnimCtx& ctx) {
  sprite.fillSprite(C_PARCHMENT);

  const float t = (millis() - ctx.state_ms) / 1000.0f;

  switch (ctx.state) {

    case MascotState::IDLE: {
      float breathe = 1.0f + 0.025f * sinf01(t / 2.0f);
      drawBodyTFT(0, 0, breathe);
      bool blinked = fmodf(t, 3.5f) > 3.3f;
      if (!blinked) {
        sprite.fillCircle(EYE_LX, EYE_Y, EYE_R, C_CHARCOAL);
        sprite.fillCircle(EYE_RX, EYE_Y, EYE_R, C_CHARCOAL);
      } else {
        sprite.drawFastHLine(EYE_LX - EYE_R, EYE_Y, EYE_R * 2, C_CHARCOAL);
        sprite.drawFastHLine(EYE_RX - EYE_R, EYE_Y, EYE_R * 2, C_CHARCOAL);
      }
      break;
    }

    case MascotState::LISTENING: {
      drawBodyTFT(0, 0);
      sprite.fillCircle(EYE_LX, EYE_Y, EYE_R + 2, C_CHARCOAL);
      sprite.fillCircle(EYE_RX, EYE_Y, EYE_R + 2, C_CHARCOAL);
      float rp = fmodf(t * 1.5f, 1.0f);
      int r1 = BODY_W/2 + (int)(rp * 30);
      int r2 = BODY_W/2 + (int)(fmodf(rp + 0.5f, 1.0f) * 30);
      uint8_t a1 = (uint8_t)((1.0f - rp) * 120);
      uint8_t a2 = (uint8_t)((1.0f - fmodf(rp + 0.5f, 1.0f)) * 120);
      (void)a1; (void)a2; // alpha not directly supported; draw lighter ring
      sprite.drawCircle(BODY_X + BODY_W/2, BODY_Y + BODY_H/2, r1, C_CORAL);
      sprite.drawCircle(BODY_X + BODY_W/2, BODY_Y + BODY_H/2, r2, C_CORAL);
      break;
    }

    case MascotState::THINKING: {
      float bobble_y = -10.0f * sinf(t * TWO_PI_F * 2.0f);
      int by = (int)bobble_y;
      drawBodyTFT(0, by);
      sprite.fillCircle(EYE_LX, EYE_Y + by, EYE_R, C_CHARCOAL);
      sprite.fillCircle(EYE_RX, EYE_Y + by, EYE_R, C_CHARCOAL);
      // Dots
      uint8_t dots = 1 + (uint8_t)(fmodf(t * 2.0f, 3.0f));
      for (uint8_t i = 0; i < 3; i++) {
        uint16_t dc = (i < dots) ? C_CHARCOAL : tft.color565(0xC0, 0xB8, 0xA8);
        sprite.fillCircle(SCR_W/2 - 14 + i * 14, BODY_Y + BODY_H + 20, 5, dc);
      }
      break;
    }

    case MascotState::SPEAKING: {
      drawBodyTFT(0, 0);
      // Happy arc eyes
      for (int dy = 0; dy <= EYE_R; dy++) {
        int dx = (int)sqrtf((float)(EYE_R * EYE_R - dy * dy));
        sprite.drawPixel(EYE_LX - dx, EYE_Y - dy, C_CHARCOAL);
        sprite.drawPixel(EYE_LX + dx, EYE_Y - dy, C_CHARCOAL);
        sprite.drawPixel(EYE_RX - dx, EYE_Y - dy, C_CHARCOAL);
        sprite.drawPixel(EYE_RX + dx, EYE_Y - dy, C_CHARCOAL);
      }
      float mouth = fabsf(sinf(t * TWO_PI_F * 3.0f));
      int mh = 4 + (int)(mouth * 12);
      sprite.drawRoundRect(MOUTH_X - 10, MOUTH_Y - mh/2, 20, mh, 4, C_CHARCOAL);
      break;
    }

    case MascotState::ERROR_STATE: {
      float shake_t = (millis() - ctx.state_ms) / 1000.0f;
      int sx = 0;
      if (shake_t < 0.5f) {
        int step = (int)(shake_t / 0.07f);
        const int8_t shakes[] = {0, -10, 10, -8, 8, -4, 4, 0};
        sx = shakes[min((int)step, 7)];
      }
      drawBodyTFT(sx, 0);
      uint16_t xc = tft.color565(0xC0, 0x39, 0x2B);
      sprite.drawLine(EYE_LX+sx-6, EYE_Y-6, EYE_LX+sx+6, EYE_Y+6, xc);
      sprite.drawLine(EYE_LX+sx+6, EYE_Y-6, EYE_LX+sx-6, EYE_Y+6, xc);
      sprite.drawLine(EYE_RX+sx-6, EYE_Y-6, EYE_RX+sx+6, EYE_Y+6, xc);
      sprite.drawLine(EYE_RX+sx+6, EYE_Y-6, EYE_RX+sx-6, EYE_Y+6, xc);
      break;
    }
  }

  sprite.pushSprite(0, 0);
}

#else
#error "Define USE_OLED or USE_TFT in platformio.ini build_flags"
#endif
