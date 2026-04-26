# Codex Continuation Context

Date: 2026-04-26
Workspace: `c:\Users\ryana\Desktop\NJIT-Claude-Hack`

## User Goal

Continue the ESP32-S3-EYE hackathon firmware from the previous Claude Code session. The user wants the ESP32 firmware to use the confirmed ESP-BSP pinout, stream microphone audio over WebSocket, show state on the ST7789 LCD, use the supplied mascot image as the visual direction, and avoid losing context before session credits run out.

## Confirmed ESP32-S3-EYE Pins

From official `espressif/esp-bsp` for `bsp/esp32_s3_eye`:

- LCD ST7789:
  - PCLK/SCLK: GPIO 21
  - DATA0/MOSI: GPIO 47
  - DC: GPIO 43
  - CS: GPIO 44
  - RST: not connected
  - Backlight: GPIO 48
- I2S microphone:
  - BCK/SCLK: GPIO 41
  - WS/LCLK: GPIO 42
  - DATA/DSIN: GPIO 2
  - MCLK and DOUT: not connected
- Buttons:
  - BOOT/BSP_BUTTON_5: GPIO 0
  - BSP_BUTTON_1 through BSP_BUTTON_4 are ADC-based on ADC channel 0, GPIO 1, with voltage thresholds in `bsp_button.c`.

## Current Repo State

- ESP-IDF project is in `babel_esp`.
- Main firmware file: `babel_esp/main/babel_esp.c`
- Component CMake file: `babel_esp/main/CMakeLists.txt`
- Existing untracked ESP project already had WiFi, I2S mic, WebSocket streaming.
- Other unrelated modified files existed before this work:
  - `babel/server/index.ts`
  - `babel/web/package-lock.json`
- Do not revert unrelated work.

## What Was Changed

`babel_esp/main/babel_esp.c` was replaced with an integrated firmware:

- Keeps WiFi credentials and WebSocket URI from existing file:
  - SSID: `iPhone`
  - password: `sajJas45`
  - URI: `ws://172.20.10.3:8765`
- Keeps microphone streaming over WebSocket.
- Adds ST7789 LCD init with ESP-IDF `esp_lcd`.
- Adds strip-based 240x240 renderer.
- Adds simple bitmap text for `BABEL`, `CONNECTING`, `LISTENING`, and `MUTED`.
- Adds a mascot-style orange/cream face inspired by the user-provided image.
- Adds BOOT button polling on GPIO 0 to toggle mute.
- When muted, audio frames are read but not sent.
- Display state is:
  - `CONNECTING` while WebSocket is not connected
  - `LISTENING` while WebSocket is connected
  - `MUTED` after BOOT toggles mute

`babel_esp/main/CMakeLists.txt` was updated to require:

- `esp_wifi`
- `esp_event`
- `esp_netif`
- `nvs_flash`
- `esp_websocket_client`
- `esp_driver_gpio`
- `esp_driver_i2s`
- `esp_driver_spi`
- `esp_lcd`

## Build Verification

The firmware was build-verified successfully after the source edits.

The normal `idf.py build` was not available on PATH. `export.ps1` was blocked by PowerShell execution policy, and `export.bat` expected a missing Python env named `idf5.5_py3.14_env`. A manual environment using the installed Python 3.11 ESP-IDF venv worked.

Successful build command pattern:

```powershell
$env:IDF_PATH='C:\Espressif\frameworks\esp-idf-v5.5.4'
$env:IDF_TOOLS_PATH='C:\Espressif'
$env:IDF_PYTHON_ENV_PATH='C:\Espressif\python_env\idf5.5_py3.11_env'
$env:ESP_ROM_ELF_DIR='C:\Espressif\tools\esp-rom-elfs\20241011'
$env:PATH='C:\Espressif\tools\xtensa-esp-elf\esp-14.2.0_20260121\xtensa-esp-elf\bin;C:\Espressif\tools\cmake\3.30.2\bin;C:\Espressif\tools\ninja\1.12.1;C:\Espressif\tools\idf-git\2.44.0\cmd;C:\Espressif\python_env\idf5.5_py3.11_env\Scripts;' + $env:PATH
& 'C:\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe' 'C:\Espressif\frameworks\esp-idf-v5.5.4\tools\idf.py' -B build_codex build
```

Build result:

- `babel_esp/build_codex/bootloader/bootloader.bin`
- `babel_esp/build_codex/partition_table/partition-table.bin`
- `babel_esp/build_codex/babel_esp.bin`
- App binary size: `0xe2e00`, leaving `0x1d200` bytes free in the 1 MB factory partition.

## Important Implementation Notes

- ESP-IDF local path appears to be `C:\Espressif\frameworks\esp-idf-v5.5.4`.
- Local API check showed `esp_lcd_panel_dev_config_t` uses `.rgb_ele_order`, not `.rgb_element_order`.
- The code currently sets `.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR` and calls `esp_lcd_panel_invert_color(..., true)`, matching the previous Claude plan and common ST7789 behavior.
- Pixel colors are byte-swapped in `rgb565()` before sending over SPI. If colors look wrong, first test removing that byte swap or changing `LCD_RGB_ELEMENT_ORDER_BGR` to `LCD_RGB_ELEMENT_ORDER_RGB`.
- No ADC button support was implemented yet. Only BOOT mute is implemented.
- No server-side translation-state signal is wired yet, so there is no true `TRANSLATING` display state.

## Next Steps

1. Build the ESP project:
   - `idf.py build` from `babel_esp`
2. Fix any compile errors from ESP-IDF API/component naming.
3. Flash and monitor:
   - `idf.py -p COMx flash monitor`
4. If LCD is blank:
   - verify backlight GPIO 48 level
   - try `esp_lcd_panel_set_gap(s_lcd_panel, 0, 20)`
   - try RGB instead of BGR
   - try disabling color inversion
5. If colors are odd:
   - revisit byte swapping in `rgb565()`
6. If audio still streams but mute does not work:
   - check BOOT pull-up/polling on GPIO 0
7. Later enhancement:
   - implement ADC GPIO 1 thresholds for MENU/MUTE using ESP-IDF oneshot ADC or the `iot_button` component.
