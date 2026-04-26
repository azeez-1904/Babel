#pragma once
#include <Arduino.h>

// ─── State enum shared across all display drivers ───────────────────────────
enum class MascotState : uint8_t {
  IDLE      = 0,
  LISTENING = 1,
  THINKING  = 2,
  SPEAKING  = 3,
  ERROR_STATE = 4,
};

MascotState stateFromString(const char* s);

// ─── Animation context (display-agnostic) ───────────────────────────────────
struct AnimCtx {
  MascotState state      = MascotState::IDLE;
  MascotState prev_state = MascotState::IDLE;
  uint32_t    state_ms   = 0;   // millis() when state last changed
  uint32_t    frame      = 0;   // increments each draw call
  float       blink_t    = 0;   // 0-1 blink phase (IDLE)
  float       breathe_t  = 0;   // 0-1 breathe phase (IDLE)
  float       bobble_y   = 0;   // px offset (THINKING)
  float       mouth_open = 0;   // 0-1 (SPEAKING)
  uint8_t     dot_phase  = 0;   // 0-2 thinking dots cycle
  bool        error_shook = false;
  float       error_x    = 0;   // px shake offset (ERROR)
};

// ─── Per-display draw implementations ───────────────────────────────────────
// Each .cpp file implements these for its own display type.
// main.cpp calls the right one depending on USE_OLED / USE_TFT.

void mascot_init();
void mascot_draw(const AnimCtx& ctx);
void mascot_clear();

// ─── Timing helpers ──────────────────────────────────────────────────────────
constexpr uint32_t FRAME_MS    = 33;   // ~30 fps
constexpr float    TWO_PI_F    = 6.28318530718f;
constexpr float    PI_F        = 3.14159265359f;

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float sinf01(float t) { return (sinf(t * TWO_PI_F) + 1.0f) * 0.5f; }
