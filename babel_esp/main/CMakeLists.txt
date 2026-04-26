idf_component_register(SRCS "babel_esp.c"
                    INCLUDE_DIRS "."
                    REQUIRES
                        esp_wifi
                        esp_event
                        esp_netif
                        esp_adc
                        nvs_flash
                        esp_websocket_client
                        esp_driver_gpio
                        esp_driver_i2c
                        esp_driver_i2s
                        esp_driver_ledc
                        esp_driver_spi
                        esp_lcd)
