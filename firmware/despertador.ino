#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <NTPClient.h>
#include <WiFiUdp.h>

const char* WIFI_SSID = "NICOLAS";
const char* WIFI_PASSWORD = "20072004nicolas";
const char* SERVER_URL = "http://192.168.15.6:3001";
const char* DEVICE_ID = "despertador01";

const int pinBuzzer = D5;
const int pinLDR = A0;
const int pinRed = D7;
const int pinGreen = D8;
const int pinBlue = D1;

int limiteEscuro = 900;
bool alarmeTocando = false;
bool ledLigadoPeloAlarme = false;

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -3 * 3600, 60000);

int alarmHour = -1;
int alarmMinute = -1;
bool alarmEnabled = false;
bool alarmTriggered = false;

unsigned long lastConfigFetch = 0;
unsigned long lastStopCheck = 0;

WiFiClient wifiClient;

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(pinBuzzer, OUTPUT);
  pinMode(pinLDR, INPUT);
  pinMode(pinRed, OUTPUT);
  pinMode(pinGreen, OUTPUT);
  pinMode(pinBlue, OUTPUT);

  digitalWrite(pinBuzzer, LOW);
  desligarLED();

  conectarWiFi();

  Serial.println("Iniciando NTP...");
  timeClient.begin();
  timeClient.update();
  Serial.println("NTP OK");

  delay(500);
  fetchConfig();
}

void loop() {
  yield();
  timeClient.update();

  unsigned long now = millis();

  if (now - lastConfigFetch >= 30000) {
    fetchConfig();
    lastConfigFetch = now;
  }

  if (!alarmeTocando) {
    verificarAlarme();
  } else {
    tocarAlarme();

    if (now - lastStopCheck >= 1000) {
      if (verificarStop()) {
        pararAlarme();
      }
      lastStopCheck = now;
    }
  }

  delay(100);
}

void conectarWiFi() {
  Serial.print("WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 60) {
    delay(500);
    Serial.print(".");
    tentativas++;
    yield();
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FALHOU");
  }
}

void fetchConfig() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("Buscando config...");

  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/config/" + DEVICE_ID);
  http.setTimeout(5000);

  int code = http.GET();
  Serial.printf("HTTP: %d\n", code);

  if (code == 200) {
    String json = http.getString();
    Serial.println(json);

    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, json);

    if (err) {
      Serial.print("JSON erro: ");
      Serial.println(err.c_str());
    } else {
      bool success = doc["success"];
      Serial.printf("success: %d\n", success);

      if (success) {
        limiteEscuro = doc["data"]["lightThreshold"] | 900;

        JsonArray arr = doc["data"]["alarms"];
        Serial.printf("alarms size: %d\n", arr.size());

        if (arr.size() > 0) {
          const char* t = arr[0].as<const char*>();
          Serial.printf("time raw: %s\n", t ? t : "NULL");

          if (t != nullptr && strlen(t) >= 5) {
            alarmHour = (t[0] - '0') * 10 + (t[1] - '0');
            alarmMinute = (t[3] - '0') * 10 + (t[4] - '0');
            alarmEnabled = true;
            Serial.printf("Alarme setado: %02d:%02d\n", alarmHour, alarmMinute);
          }
        } else {
          alarmEnabled = false;
          Serial.println("Nenhum alarme configurado");
        }
      }
    }
  }

  http.end();
  yield();
}

void verificarAlarme() {
  if (!alarmEnabled || alarmHour < 0) return;

  int h = timeClient.getHours();
  int m = timeClient.getMinutes();

  if (h == alarmHour && m == alarmMinute) {
    if (!alarmTriggered) {
      dispararAlarme();
    }
  } else {
    alarmTriggered = false;
  }
}

void dispararAlarme() {
  alarmTriggered = true;
  alarmeTocando = true;

  Serial.printf("ALARME! %02d:%02d\n", alarmHour, alarmMinute);

  // Notifica servidor
  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/trigger");
  http.addHeader("Content-Type", "application/json");
  http.POST("{}");
  http.end();

  // Verifica luz
  int ldr = analogRead(pinLDR);
  if (ldr > limiteEscuro) {
    ligarLED(255, 255, 255);
    ledLigadoPeloAlarme = true;
    Serial.println("Escuro - LED ON");
  } else {
    ledLigadoPeloAlarme = false;
    Serial.println("Claro - LED OFF");
  }
}

void tocarAlarme() {
  digitalWrite(pinBuzzer, HIGH);
  delay(100);
  yield();
  digitalWrite(pinBuzzer, LOW);
  delay(100);
  yield();
}

bool verificarStop() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/status");
  http.setTimeout(3000);

  int code = http.GET();
  bool stop = false;

  if (code == 200) {
    String json = http.getString();
    DynamicJsonDocument doc(256);
    if (deserializeJson(doc, json) == DeserializationError::Ok) {
      stop = doc["data"]["stopRequested"] | false;
    }
  }

  http.end();
  return stop;
}

void pararAlarme() {
  alarmeTocando = false;
  digitalWrite(pinBuzzer, LOW);

  if (ledLigadoPeloAlarme) {
    desligarLED();
    ledLigadoPeloAlarme = false;
  }

  // Notifica servidor
  HTTPClient http;
  http.begin(wifiClient, String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/ack");
  http.addHeader("Content-Type", "application/json");
  http.POST("{}");
  http.end();

  Serial.println("Alarme PARADO");
}

void ligarLED(int r, int g, int b) {
  analogWrite(pinRed, r);
  analogWrite(pinGreen, g);
  analogWrite(pinBlue, b);
}

void desligarLED() {
  analogWrite(pinRed, 0);
  analogWrite(pinGreen, 0);
  analogWrite(pinBlue, 0);
}
