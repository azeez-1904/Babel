#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/ledc.h"
#include "driver/spi_master.h"

#include "esp_adc/adc_oneshot.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

#include "esp_websocket_client.h"

/* ESP32-S3-EYE pinout confirmed from esp-bsp/bsp/esp32_s3_eye. */
#define WIFI_SSID          "iPhone"
#define WIFI_PASS          "sajJas45"
#define WS_URI             "ws://172.20.10.3:8765"

#define MIC_BCK_PIN        GPIO_NUM_41
#define MIC_WS_PIN         GPIO_NUM_42
#define MIC_DATA_PIN       GPIO_NUM_2
#define SAMPLE_RATE_HZ     16000

#define LCD_HOST           SPI2_HOST
#define LCD_H_RES          240
#define LCD_V_RES          240
#define LCD_PCLK_PIN       GPIO_NUM_21
#define LCD_MOSI_PIN       GPIO_NUM_47
#define LCD_DC_PIN         GPIO_NUM_43
#define LCD_CS_PIN         GPIO_NUM_44
#define LCD_RST_PIN        GPIO_NUM_NC
#define LCD_BACKLIGHT_PIN  GPIO_NUM_48
#define LCD_PIXEL_CLOCK_HZ (40 * 1000 * 1000)
#define LCD_STRIP_LINES    16

#define BOOT_BUTTON_PIN    GPIO_NUM_0
#define ADC_BUTTON_UNIT    ADC_UNIT_1
#define ADC_BUTTON_CHAN    ADC_CHANNEL_0
#define CAM_SIOD_PIN       GPIO_NUM_4
#define CAM_SIOC_PIN       GPIO_NUM_5
#define CAM_XCLK_PIN       GPIO_NUM_15
#define CAM_SCCB_ADDR      0x30
#define PCM_BUF_BYTES      2048
#define AUDIO_TASK_STACK   4096
#define AUDIO_TASK_PRIO    5
#define DISPLAY_TASK_STACK 8192
#define DISPLAY_TASK_PRIO  3

static const char *TAG = "babel_esp";

static i2s_chan_handle_t s_mic_handle;
static esp_websocket_client_handle_t s_ws_handle;
static esp_lcd_panel_handle_t s_lcd_panel;
static adc_oneshot_unit_handle_t s_adc_handle;

static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0

typedef enum {
    DISPLAY_CONNECTING,
    DISPLAY_LISTENING,
    DISPLAY_MUTED,
} display_state_t;

static volatile bool s_ws_connected = false;
static volatile bool s_muted = false;
static volatile display_state_t s_display_state = DISPLAY_CONNECTING;
static volatile uint32_t s_anim_frame = 0;
static volatile bool s_camera_seen = false;
static volatile bool s_mic_seen = false;

typedef enum {
    BOARD_BUTTON_NONE = -1,
    BOARD_BUTTON_MENU,
    BOARD_BUTTON_PLAY,
    BOARD_BUTTON_DOWN,
    BOARD_BUTTON_UP,
    BOARD_BUTTON_BOOT,
} board_button_t;

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b)
{
    return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static int square_i(int value)
{
    return value * value;
}

static const char *state_text(display_state_t state)
{
    switch (state) {
        case DISPLAY_LISTENING:
            return "LISTENING";
        case DISPLAY_MUTED:
            return "MUTED";
        case DISPLAY_CONNECTING:
        default:
            return "CONNECTING";
    }
}

static uint16_t state_bg(display_state_t state)
{
    switch (state) {
        case DISPLAY_LISTENING:
            return rgb565(255, 255, 255);
        case DISPLAY_MUTED:
            return rgb565(255, 255, 255);
        case DISPLAY_CONNECTING:
        default:
            return rgb565(255, 255, 255);
    }
}

static uint16_t state_accent(display_state_t state)
{
    switch (state) {
        case DISPLAY_LISTENING:
            return rgb565(42, 31, 29);
        case DISPLAY_MUTED:
            return rgb565(42, 31, 29);
        case DISPLAY_CONNECTING:
        default:
            return rgb565(42, 31, 29);
    }
}

static const uint8_t *glyph_for(char c)
{
    static const uint8_t A[7] = {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11};
    static const uint8_t B[7] = {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E};
    static const uint8_t C[7] = {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E};
    static const uint8_t D[7] = {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E};
    static const uint8_t E[7] = {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F};
    static const uint8_t G[7] = {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F};
    static const uint8_t H[7] = {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11};
    static const uint8_t I[7] = {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1F};
    static const uint8_t L[7] = {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F};
    static const uint8_t M[7] = {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11};
    static const uint8_t N[7] = {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11};
    static const uint8_t O[7] = {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E};
    static const uint8_t S[7] = {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E};
    static const uint8_t T[7] = {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04};
    static const uint8_t U[7] = {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E};
    static const uint8_t W[7] = {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A};
    static const uint8_t blank[7] = {0, 0, 0, 0, 0, 0, 0};

    switch (c) {
        case 'A': return A;
        case 'B': return B;
        case 'C': return C;
        case 'D': return D;
        case 'E': return E;
        case 'G': return G;
        case 'H': return H;
        case 'I': return I;
        case 'L': return L;
        case 'M': return M;
        case 'N': return N;
        case 'O': return O;
        case 'S': return S;
        case 'T': return T;
        case 'U': return U;
        case 'W': return W;
        default:  return blank;
    }
}

static bool text_pixel(const char *text, int origin_x, int origin_y, int scale, int x, int y)
{
    if (x < origin_x || y < origin_y) {
        return false;
    }

    int local_x = x - origin_x;
    int local_y = y - origin_y;
    int char_w = 6 * scale;
    int char_index = local_x / char_w;
    int len = (int)strlen(text);
    if (char_index < 0 || char_index >= len) {
        return false;
    }

    int glyph_x = (local_x % char_w) / scale;
    int glyph_y = local_y / scale;
    if (glyph_x >= 5 || glyph_y < 0 || glyph_y >= 7) {
        return false;
    }

    const uint8_t *glyph = glyph_for(text[char_index]);
    return (glyph[glyph_y] & (1 << (4 - glyph_x))) != 0;
}

static uint16_t mascot_pixel(display_state_t state, uint32_t frame, int x, int y)
{
    const uint16_t bg = state_bg(state);
    const uint16_t ink = rgb565(28, 21, 20);
    const uint16_t orange = rgb565(230, 76, 20);
    const uint16_t orange_shadow = rgb565(170, 42, 12);
    const uint16_t orange_light = rgb565(255, 122, 58);

    static const char sprite[30][41] = {
        "........................................",
        "..................SSSSSSSS..............",
        "................SSSSSSSSSS..............",
        "............################SS..........",
        "............##################SS........",
        "..........####################SS........",
        "..........######################SS......",
        "....#####.######################SS......",
        "....#####.######################SS......",
        "....#####.######KK######KK######SS......",
        "..........######KK######KK######SS......",
        "..........######KK######KK######SS......",
        "..........######################SS.#####",
        "..........######################SS.#####",
        "..........########################.#####",
        "..........########################......",
        "..........#######KKKKKKKKKK#######......",
        "..........#######KKKKKKKKKK#######......",
        "..........#######KKKKKKKKKK#######......",
        "..........#######KKKKKKKKKK#######......",
        "..........########################......",
        "..........########################......",
        "..........########################......",
        "............####################........",
        "............####################........",
        "..........####..####..####..####........",
        "..........####..####..####..####........",
        "..........####..####..####..####........",
        "..........####..####..####..####........",
        "........................................",
    };

    int bob = (int)((frame / 6) % 8);
    if (bob > 3) {
        bob = 7 - bob;
    }

    int scale = 5;
    int origin_x = (LCD_H_RES - 40 * scale) / 2;
    int origin_y = 18 + bob;
    int sx = (x - origin_x) / scale;
    int sy = (y - origin_y) / scale;

    if (x < origin_x || y < origin_y || sx < 0 || sx >= 40 || sy < 0 || sy >= 30) {
        return bg;
    }

    char pixel = sprite[sy][sx];
    bool blink = (frame % 48) < 3;
    bool eye_pixel = (sy >= 9 && sy <= 11 && ((sx >= 16 && sx <= 17) || (sx >= 24 && sx <= 25)));

    if (state == DISPLAY_MUTED && eye_pixel) {
        pixel = '#';
    } else if (blink && eye_pixel && sy != 10) {
        pixel = '#';
    }

    switch (pixel) {
        case '#':
            if (sy <= 5 && sx <= 17) {
                return orange_light;
            }
            return orange;
        case 'S':
            return orange_shadow;
        case 'K':
            return ink;
        default:
            return bg;
    }
}

static void render_display_frame(uint16_t *strip)
{
    display_state_t state = s_display_state;
    uint32_t frame = s_anim_frame;
    const uint16_t text_color = rgb565(28, 21, 20);
    const uint16_t sub_color = rgb565(230, 76, 20);
    const char *status = "BABEL";
    const char *title = "CLAUDE";
    int title_x = (LCD_H_RES - (int)strlen(title) * 6 * 3) / 2;
    int status_x = (LCD_H_RES - (int)strlen(status) * 6 * 3) / 2;

    for (int y0 = 0; y0 < LCD_V_RES; y0 += LCD_STRIP_LINES) {
        int h = LCD_STRIP_LINES;
        if (y0 + h > LCD_V_RES) {
            h = LCD_V_RES - y0;
        }

        for (int y = y0; y < y0 + h; ++y) {
            for (int x = 0; x < LCD_H_RES; ++x) {
                uint16_t color = mascot_pixel(state, frame, x, y);
                if (text_pixel(title, title_x, 184, 3, x, y)) {
                    color = text_color;
                } else if (text_pixel(status, status_x, 215, 3, x, y)) {
                    color = sub_color;
                }
                strip[(y - y0) * LCD_H_RES + x] = color;
            }
        }

        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(s_lcd_panel, 0, y0, LCD_H_RES, y0 + h, strip));
    }
}

static void display_task(void *pvParams)
{
    uint16_t *strip = heap_caps_malloc(LCD_H_RES * LCD_STRIP_LINES * sizeof(uint16_t), MALLOC_CAP_DMA);
    if (!strip) {
        ESP_LOGE(TAG, "Failed to allocate LCD strip buffer");
        vTaskDelete(NULL);
        return;
    }

    while (1) {
        gpio_set_level(LCD_BACKLIGHT_PIN, 0);
        render_display_frame(strip);
        s_anim_frame++;
        vTaskDelay(pdMS_TO_TICKS(80));
    }
}

static void display_init(void)
{
    gpio_config_t backlight_cfg = {
        .pin_bit_mask = 1ULL << LCD_BACKLIGHT_PIN,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&backlight_cfg));
    gpio_set_level(LCD_BACKLIGHT_PIN, 0);

    spi_bus_config_t buscfg = {
        .sclk_io_num = LCD_PCLK_PIN,
        .mosi_io_num = LCD_MOSI_PIN,
        .miso_io_num = GPIO_NUM_NC,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = LCD_H_RES * LCD_STRIP_LINES * sizeof(uint16_t),
    };
    ESP_ERROR_CHECK(spi_bus_initialize(LCD_HOST, &buscfg, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io_handle = NULL;
    esp_lcd_panel_io_spi_config_t io_config = {
        .dc_gpio_num = LCD_DC_PIN,
        .cs_gpio_num = LCD_CS_PIN,
        .pclk_hz = LCD_PIXEL_CLOCK_HZ,
        .spi_mode = 0,
        .trans_queue_depth = 10,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_HOST, &io_config, &io_handle));

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = LCD_RST_PIN,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .data_endian = LCD_RGB_DATA_ENDIAN_LITTLE,
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io_handle, &panel_config, &s_lcd_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(s_lcd_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(s_lcd_panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(s_lcd_panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_lcd_panel, true));
    gpio_set_level(LCD_BACKLIGHT_PIN, 0);

    ESP_LOGI(TAG, "LCD ready PCLK=%d MOSI=%d DC=%d CS=%d BL=%d",
             LCD_PCLK_PIN, LCD_MOSI_PIN, LCD_DC_PIN, LCD_CS_PIN, LCD_BACKLIGHT_PIN);
}

static const char *button_name(board_button_t button)
{
    switch (button) {
        case BOARD_BUTTON_MENU: return "MENU";
        case BOARD_BUTTON_PLAY: return "PLAY";
        case BOARD_BUTTON_DOWN: return "DOWN";
        case BOARD_BUTTON_UP:   return "UP";
        case BOARD_BUTTON_BOOT: return "BOOT";
        default:                return "NONE";
    }
}

static void send_button_event(board_button_t button)
{
    if (!s_ws_handle || !esp_websocket_client_is_connected(s_ws_handle)) {
        ESP_LOGI(TAG, "Button %s pressed (WS not connected)", button_name(button));
        return;
    }

    char msg[64];
    int len = snprintf(msg, sizeof(msg), "{\"type\":\"button\",\"button\":\"%s\"}", button_name(button));
    int sent = esp_websocket_client_send_text(s_ws_handle, msg, len, pdMS_TO_TICKS(100));
    if (sent < 0) {
        ESP_LOGW(TAG, "Button %s event send failed", button_name(button));
    } else {
        ESP_LOGI(TAG, "Button %s event sent", button_name(button));
    }
}

static void set_muted(bool muted)
{
    s_muted = muted;
    s_display_state = s_muted ? DISPLAY_MUTED :
                      (s_ws_connected ? DISPLAY_LISTENING : DISPLAY_CONNECTING);
    ESP_LOGI(TAG, "Mute %s", s_muted ? "on" : "off");
}

static board_button_t adc_button_from_raw(int raw)
{
    if (raw >= 2310 && raw <= 2510) {
        return BOARD_BUTTON_MENU;
    }
    if (raw >= 1880 && raw <= 2080) {
        return BOARD_BUTTON_PLAY;
    }
    if (raw >= 720 && raw <= 920) {
        return BOARD_BUTTON_DOWN;
    }
    if (raw >= 280 && raw <= 480) {
        return BOARD_BUTTON_UP;
    }
    return BOARD_BUTTON_NONE;
}

static void handle_button_press(board_button_t button)
{
    switch (button) {
        case BOARD_BUTTON_BOOT:
        case BOARD_BUTTON_PLAY:
            set_muted(!s_muted);
            send_button_event(button);
            break;
        case BOARD_BUTTON_MENU:
        case BOARD_BUTTON_UP:
        case BOARD_BUTTON_DOWN:
            send_button_event(button);
            break;
        default:
            break;
    }
}

static void buttons_task(void *pvParams)
{
    bool last_boot_pressed = false;
    board_button_t last_adc_button = BOARD_BUTTON_NONE;

    gpio_config_t button_cfg = {
        .pin_bit_mask = 1ULL << BOOT_BUTTON_PIN,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&button_cfg));

    adc_oneshot_unit_init_cfg_t adc_unit_cfg = {
        .unit_id = ADC_BUTTON_UNIT,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&adc_unit_cfg, &s_adc_handle));

    adc_oneshot_chan_cfg_t adc_chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc_handle, ADC_BUTTON_CHAN, &adc_chan_cfg));
    ESP_LOGI(TAG, "Buttons ready: ADC GPIO1 MENU/PLAY/DOWN/UP and BOOT GPIO0");

    while (1) {
        bool boot_pressed = gpio_get_level(BOOT_BUTTON_PIN) == 0;
        if (boot_pressed && !last_boot_pressed) {
            handle_button_press(BOARD_BUTTON_BOOT);
        }
        last_boot_pressed = boot_pressed;

        int raw = 0;
        esp_err_t err = adc_oneshot_read(s_adc_handle, ADC_BUTTON_CHAN, &raw);
        if (err == ESP_OK) {
            board_button_t adc_button = adc_button_from_raw(raw);
            if (adc_button != BOARD_BUTTON_NONE && last_adc_button == BOARD_BUTTON_NONE) {
                ESP_LOGI(TAG, "ADC button %s raw=%d", button_name(adc_button), raw);
                handle_button_press(adc_button);
            }
            last_adc_button = adc_button;
        } else {
            ESP_LOGW(TAG, "ADC button read failed: %s", esp_err_to_name(err));
        }
        vTaskDelay(pdMS_TO_TICKS(40));
    }
}

static void camera_xclk_start(void)
{
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_1_BIT,
        .timer_num = LEDC_TIMER_1,
        .freq_hz = 10000000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));

    ledc_channel_config_t channel = {
        .gpio_num = CAM_XCLK_PIN,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_1,
        .duty = 1,
        .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
    ESP_LOGI(TAG, "Camera XCLK started on GPIO%d", CAM_XCLK_PIN);
}

static esp_err_t camera_read_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t *value)
{
    return i2c_master_transmit_receive(dev, &reg, 1, value, 1, 100);
}

static void camera_diag_task(void *pvParams)
{
    vTaskDelay(pdMS_TO_TICKS(600));
    camera_xclk_start();
    vTaskDelay(pdMS_TO_TICKS(50));

    i2c_master_bus_handle_t bus = NULL;
    i2c_master_dev_handle_t cam = NULL;
    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = CAM_SIOD_PIN,
        .scl_io_num = CAM_SIOC_PIN,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };

    esp_err_t err = i2c_new_master_bus(&bus_cfg, &bus);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "CAM diag: I2C bus init failed: %s", esp_err_to_name(err));
        vTaskDelete(NULL);
        return;
    }

    err = i2c_master_probe(bus, CAM_SCCB_ADDR, 200);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "CAM diag: no camera ACK at SCCB/I2C 0x%02x: %s",
                 CAM_SCCB_ADDR, esp_err_to_name(err));
        ESP_LOGE(TAG, "CAM diag pins SIOD=%d SIOC=%d XCLK=%d", CAM_SIOD_PIN, CAM_SIOC_PIN, CAM_XCLK_PIN);
        i2c_del_master_bus(bus);
        vTaskDelete(NULL);
        return;
    }

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = CAM_SCCB_ADDR,
        .scl_speed_hz = 100000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dev_cfg, &cam));

    uint8_t pid = 0;
    uint8_t ver = 0;
    esp_err_t pid_err = camera_read_reg(cam, 0x0A, &pid);
    esp_err_t ver_err = camera_read_reg(cam, 0x0B, &ver);

    if (pid_err == ESP_OK && ver_err == ESP_OK) {
        s_camera_seen = true;
        ESP_LOGI(TAG, "CAM OK: sensor ACK on 0x%02x, PID=0x%02x VER=0x%02x", CAM_SCCB_ADDR, pid, ver);
    } else {
        s_camera_seen = true;
        ESP_LOGW(TAG, "CAM ACK OK: sensor responds at 0x%02x, ID read failed pid=%s ver=%s",
                 CAM_SCCB_ADDR, esp_err_to_name(pid_err), esp_err_to_name(ver_err));
    }

    while (1) {
        ESP_LOGI(TAG, "HW diag: CAM=%s MIC=%s WS=%s",
                 s_camera_seen ? "OK" : "NO",
                 s_mic_seen ? "OK" : "WAIT",
                 s_ws_connected ? "OK" : "WAIT");
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *disc = (wifi_event_sta_disconnected_t *)data;
        ESP_LOGW(TAG, "WiFi disconnected reason=%d, retrying", disc->reason);
        esp_wifi_connect();
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        if (!s_muted) {
            s_display_state = DISPLAY_CONNECTING;
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "WiFi connected IP=" IPSTR, IP2STR(&ev->ip_info.ip));
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
            WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
            IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL));

    wifi_config_t wifi_cfg = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
            .pmf_cfg = {
                .capable = true,
                .required = false,
            },
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Connecting to \"%s\"", WIFI_SSID);
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
}

static void mic_init(void)
{
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
    chan_cfg.dma_frame_num = 240;
    chan_cfg.dma_desc_num = 4;
    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, NULL, &s_mic_handle));

    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE_HZ),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = MIC_BCK_PIN,
            .ws = MIC_WS_PIN,
            .dout = I2S_GPIO_UNUSED,
            .din = MIC_DATA_PIN,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv = false,
            },
        },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(s_mic_handle, &std_cfg));
    ESP_ERROR_CHECK(i2s_channel_enable(s_mic_handle));

    ESP_LOGI(TAG, "I2S mic ready BCK=%d WS=%d DATA=%d %u Hz mono 16-bit",
             MIC_BCK_PIN, MIC_WS_PIN, MIC_DATA_PIN, SAMPLE_RATE_HZ);
}

static void ws_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    switch (id) {
        case WEBSOCKET_EVENT_CONNECTED:
            s_ws_connected = true;
            if (!s_muted) {
                s_display_state = DISPLAY_LISTENING;
            }
            ESP_LOGI(TAG, "WebSocket connected uri=%s", WS_URI);
            break;
        case WEBSOCKET_EVENT_DISCONNECTED:
            s_ws_connected = false;
            if (!s_muted) {
                s_display_state = DISPLAY_CONNECTING;
            }
            ESP_LOGW(TAG, "WebSocket disconnected");
            break;
        case WEBSOCKET_EVENT_ERROR:
            ESP_LOGE(TAG, "WebSocket error");
            break;
        default:
            break;
    }
}

static void ws_init(void)
{
    esp_websocket_client_config_t ws_cfg = {
        .uri = WS_URI,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms = 10000,
    };
    s_ws_handle = esp_websocket_client_init(&ws_cfg);
    esp_websocket_register_events(s_ws_handle, WEBSOCKET_EVENT_ANY, ws_event_handler, NULL);
    ESP_ERROR_CHECK(esp_websocket_client_start(s_ws_handle));
    ESP_LOGI(TAG, "WebSocket client started target=%s", WS_URI);
}

static void audio_stream_task(void *pvParams)
{
    static int16_t pcm_buf[PCM_BUF_BYTES / sizeof(int16_t)];
    size_t bytes_read = 0;
    uint32_t diag_counter = 0;

    ESP_LOGI(TAG, "Audio stream task running");

    while (1) {
        esp_err_t err = i2s_channel_read(s_mic_handle, pcm_buf, sizeof(pcm_buf),
                                         &bytes_read, pdMS_TO_TICKS(200));
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "I2S read error: %s", esp_err_to_name(err));
            continue;
        }
        if (bytes_read == 0 || s_muted) {
            continue;
        }

        int sample_count = (int)(bytes_read / sizeof(int16_t));
        int32_t abs_sum = 0;
        int32_t peak = 0;
        for (int i = 0; i < sample_count; ++i) {
            int32_t sample = pcm_buf[i];
            int32_t abs_sample = sample < 0 ? -sample : sample;
            if (abs_sample > peak) {
                peak = abs_sample;
            }
            abs_sum += abs_sample;
        }
        int mean_abs = sample_count > 0 ? (int)(abs_sum / sample_count) : 0;
        if (peak > 100 || mean_abs > 20) {
            s_mic_seen = true;
        }
        if ((diag_counter++ % 16) == 0) {
            ESP_LOGI(TAG, "MIC level mean_abs=%d peak=%ld bytes=%u",
                     mean_abs, peak, (unsigned)bytes_read);
        }

        if (s_ws_handle && esp_websocket_client_is_connected(s_ws_handle)) {
            int sent = esp_websocket_client_send_bin(
                    s_ws_handle, (const char *)pcm_buf, (int)bytes_read, pdMS_TO_TICKS(200));
            if (sent < 0) {
                ESP_LOGW(TAG, "WS send failed (%u bytes dropped)", (unsigned)bytes_read);
            }
        }
        taskYIELD();
    }
}

void app_main(void)
{
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES ||
        nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_err);

    display_init();
    xTaskCreate(display_task, "display", DISPLAY_TASK_STACK, NULL, DISPLAY_TASK_PRIO, NULL);
    xTaskCreate(buttons_task, "buttons", 3072, NULL, 4, NULL);

    wifi_init_sta();
    mic_init();
    ws_init();

    xTaskCreate(camera_diag_task, "camera_diag", 4096, NULL, 4, NULL);
    xTaskCreate(audio_stream_task, "audio_stream", AUDIO_TASK_STACK, NULL, AUDIO_TASK_PRIO, NULL);
}
