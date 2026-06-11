#ifndef GLOVE_NETWORK_MANAGER_H
#define GLOVE_NETWORK_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

class GloveNetworkManager {
private:
    const char* ssid;
    const char* password;
    const char* mqttHost;
    int mqttPort;
    const char* mqttUser;
    const char* mqttPass;
    const char* mqttTopic;
    const char* mqttStatusTopic;
    const char* mqttDeviceId;

    unsigned long publishInterval;
    unsigned long previousMqttPublishTime;

    unsigned long wifiReconnectInterval;
    unsigned long mqttReconnectInterval;
    unsigned long previousWiFiReconnectTime;
    unsigned long previousMQTTReconnectTime;

    bool wifiStartRequested;
    bool mqttSetupMessagePrinted;
    bool mqttConnectedMessagePrinted;

    WiFiClientSecure secureClient;
    PubSubClient mqttClient;

    bool isConfigReady() const;
    void startWiFi();
    void connectMQTTOnce();

public:
    GloveNetworkManager(
        const char* wifiSsid,
        const char* wifiPassword,
        const char* host,
        int port,
        const char* username,
        const char* pass,
        const char* topic,
        const char* statusTopic,
        const char* deviceId,
        unsigned long pubInterval = 100,
        unsigned long reconnectInterval = 5000
    );

    void begin();
    void update();
    bool isConnected();
    bool publishPotValues(
        const int rawValues[5],
        const int flexValues[5],
        int currentLevel,
        bool holdEnabled
    );
};

#endif