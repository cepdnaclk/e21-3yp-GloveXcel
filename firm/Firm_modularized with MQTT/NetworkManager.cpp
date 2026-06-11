#include "NetworkManager.h"
#include "Config.h"

GloveNetworkManager::GloveNetworkManager(
    const char* wifiSsid,
    const char* wifiPassword,
    const char* host,
    int port,
    const char* username,
    const char* pass,
    const char* topic,
    const char* statusTopic,
    const char* deviceId,
    unsigned long pubInterval,
    unsigned long reconnectInterval
) : secureClient(), mqttClient(secureClient) {
    ssid = wifiSsid;
    password = wifiPassword;
    mqttHost = host;
    mqttPort = port;
    mqttUser = username;
    mqttPass = pass;
    mqttTopic = topic;
    mqttStatusTopic = statusTopic;
    mqttDeviceId = deviceId;

    publishInterval = pubInterval;
    wifiReconnectInterval = reconnectInterval;
    mqttReconnectInterval = reconnectInterval;

    previousMqttPublishTime = 0;
    previousWiFiReconnectTime = 0;
    previousMQTTReconnectTime = 0;

    wifiStartRequested = false;
    mqttSetupMessagePrinted = false;
    mqttConnectedMessagePrinted = false;
}

bool GloveNetworkManager::isConfigReady() const {
    if (ssid == nullptr || String(ssid).length() == 0 || String(ssid) == "PUT_YOUR_WIFI_NAME_HERE") {
        return false;
    }

    if (password == nullptr || String(password).length() == 0 || String(password) == "PUT_YOUR_WIFI_PASSWORD_HERE") {
        return false;
    }

    if (mqttPass == nullptr || String(mqttPass).length() == 0 || String(mqttPass) == "PUT_YOUR_HIVEMQ_PASSWORD_HERE") {
        return false;
    }

    if (mqttHost == nullptr || String(mqttHost).length() == 0) {
        return false;
    }

    if (mqttUser == nullptr || String(mqttUser).length() == 0) {
        return false;
    }

    return true;
}

void GloveNetworkManager::begin() {
    secureClient.setInsecure();
    mqttClient.setServer(mqttHost, mqttPort);
    mqttClient.setBufferSize(1024);

    Serial.println();
    Serial.println("MQTT function added for HiveMQ Cloud.");
    Serial.print("MQTT Host: ");
    Serial.println(mqttHost);
    Serial.print("MQTT Port: ");
    Serial.println(mqttPort);
    Serial.print("MQTT Topic: ");
    Serial.println(mqttTopic);

    if (!isConfigReady()) {
        Serial.println("MQTT is not started yet because Wi-Fi/MQTT placeholders are not replaced.");
        Serial.println("Replace WIFI_SSID, WIFI_PASSWORD, and MQTT_PASSWORD before testing MQTT.");
        mqttSetupMessagePrinted = true;
        return;
    }

    startWiFi();
}

void GloveNetworkManager::startWiFi() {
    if (!isConfigReady()) {
        return;
    }

    Serial.println();
    Serial.println("Starting Wi-Fi for MQTT...");
    Serial.print("Wi-Fi SSID: ");
    Serial.println(ssid);

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(ssid, password);

    wifiStartRequested = true;
    previousWiFiReconnectTime = millis();
}

void GloveNetworkManager::update() {
    if (!isConfigReady()) {
        if (!mqttSetupMessagePrinted) {
            Serial.println("MQTT not running: replace Wi-Fi/MQTT placeholders first.");
            mqttSetupMessagePrinted = true;
        }
        return;
    }

    unsigned long currentTime = millis();

    if (WiFi.status() != WL_CONNECTED) {
        mqttConnectedMessagePrinted = false;

        if (!wifiStartRequested || (currentTime - previousWiFiReconnectTime >= wifiReconnectInterval)) {
            previousWiFiReconnectTime = currentTime;

            Serial.println("Wi-Fi not connected. Reconnecting for MQTT...");

            WiFi.disconnect(false);
            delay(100);
            WiFi.begin(ssid, password);

            wifiStartRequested = true;
        }

        return;
    }

    if (mqttClient.connected()) {
        mqttClient.loop();
        return;
    }

    if (currentTime - previousMQTTReconnectTime >= mqttReconnectInterval) {
        previousMQTTReconnectTime = currentTime;
        connectMQTTOnce();
    }
}

void GloveNetworkManager::connectMQTTOnce() {
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    Serial.println();
    Serial.println("Connecting to HiveMQ MQTT broker...");

    String clientId = "ESP32_FORCE_GLOVE_";
    clientId += String((uint32_t)ESP.getEfuseMac(), HEX);

    bool connected = mqttClient.connect(
        clientId.c_str(),
        mqttUser,
        mqttPass
    );

    if (connected) {
        mqttConnectedMessagePrinted = true;

        Serial.println("MQTT connected successfully.");
        Serial.print("ESP32 IP address: ");
        Serial.println(WiFi.localIP());

        mqttClient.publish(mqttStatusTopic, "online", true);
    } else {
        mqttConnectedMessagePrinted = false;

        Serial.print("MQTT connection failed. State: ");
        Serial.println(mqttClient.state());
        Serial.println("Will retry automatically.");
    }
}

bool GloveNetworkManager::isConnected() {
    return mqttClient.connected();
}

bool GloveNetworkManager::publishPotValues(
    const int rawValues[5],
    const int flexValues[5],
    int currentLevel,
    bool holdEnabled
) {
    if (!mqttClient.connected()) {
        return false;
    }

    unsigned long currentTime = millis();

    if (currentTime - previousMqttPublishTime < publishInterval) {
        return false;
    }

    previousMqttPublishTime = currentTime;

    char payload[700];

    snprintf(
        payload,
        sizeof(payload),
        "{"
            "\"device_id\":\"%s\","
            "\"thumb\":%d,"
            "\"index\":%d,"
            "\"middle\":%d,"
            "\"ring\":%d,"
            "\"little\":%d,"
            "\"pot1_raw\":%d,"
            "\"pot2_raw\":%d,"
            "\"pot3_raw\":%d,"
            "\"pot4_raw\":%d,"
            "\"pot5_raw\":%d,"
            "\"current_level\":%d,"
            "\"hold_enabled\":%s"
        "}",
        mqttDeviceId,
        flexValues[0],
        flexValues[1],
        flexValues[2],
        flexValues[3],
        flexValues[4],
        rawValues[0],
        rawValues[1],
        rawValues[2],
        rawValues[3],
        rawValues[4],
        currentLevel,
        holdEnabled ? "true" : "false"
    );

    bool sent = mqttClient.publish(mqttTopic, payload);

    if (MQTT_PRINT_EACH_PUBLISH) {
        if (sent) {
            Serial.print("MQTT published: ");
            Serial.println(payload);
        } else {
            Serial.println("MQTT publish failed.");
        }
    }

    return sent;
}