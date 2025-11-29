#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <NTPClient.h>
#include <WiFiUdp.h>

// ========== CONFIGURAÇÕES ==========
const char *WIFI_SSID = "NICOLAS";
const char *WIFI_PASSWORD = "20072004nicolas";
const char *SERVER_URL = "http://192.168.15.6:3001";
const char *DEVICE_ID = "despertador01";

// ========== PINOS ==========
const int pinBuzzer = D5;
const int pinLDR = A0;
const int pinRed = D7;
const int pinGreen = D8;
const int pinBlue = D1;

// ========== CONFIGURAÇÕES DE ALARME ==========
int limiteEscuro = 900;
int leituraLDR;
bool alarmeTocando = false;
bool ledLigadoPeloAlarme = false;

// ========== NTP ==========
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -3 * 3600, 60000); // UTC-3 (Brasília)

// ========== ALARMES ==========
struct Alarm
{
  int hour;
  int minute;
  bool enabled;
  bool triggered;
};

Alarm alarms[10];
int alarmCount = 0;

// ========== TIMERS ==========
unsigned long lastConfigFetch = 0;
unsigned long lastStopCheck = 0;
const unsigned long CONFIG_INTERVAL = 30000;
const unsigned long STOP_CHECK_INTERVAL = 500;

WiFiClient wifiClient;

void setup()
{
  Serial.begin(115200);

  pinMode(pinBuzzer, OUTPUT);
  pinMode(pinLDR, INPUT);
  pinMode(pinRed, OUTPUT);
  pinMode(pinGreen, OUTPUT);
  pinMode(pinBlue, OUTPUT);

  desligarLED();
  noTone(pinBuzzer);

  conectarWiFi();
  timeClient.begin();

  fetchConfig();
}

void loop()
{
  timeClient.update();

  unsigned long now = millis();

  if (now - lastConfigFetch >= CONFIG_INTERVAL)
  {
    fetchConfig();
    lastConfigFetch = now;
  }

  if (!alarmeTocando)
  {
    verificarAlarmes();
  }
  else
  {
    tocarAlarme();

    if (now - lastStopCheck >= STOP_CHECK_INTERVAL)
    {
      if (verificarStopRequest())
      {
        pararAlarme();
      }
      lastStopCheck = now;
    }
  }

  delay(100);
}

void conectarWiFi()
{
  Serial.println("Conectando ao WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Conectado! IP: ");
  Serial.println(WiFi.localIP());
}

void fetchConfig()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    conectarWiFi();
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/config/" + DEVICE_ID;

  http.begin(wifiClient, url);
  int httpCode = http.GET();

  if (httpCode == 200)
  {
    String payload = http.getString();

    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc["success"])
    {
      limiteEscuro = doc["data"]["lightThreshold"] | 900;

      JsonArray alarmsArray = doc["data"]["alarms"];
      alarmCount = 0;

      for (JsonObject alarm : alarmsArray)
      {
        if (alarmCount >= 10)
          break;

        const char *time = alarm["time"];
        alarms[alarmCount].hour = atoi(time);
        alarms[alarmCount].minute = atoi(time + 3);
        alarms[alarmCount].enabled = alarm["enabled"] | true;
        alarms[alarmCount].triggered = false;
        alarmCount++;
      }

      Serial.printf("Config atualizada: %d alarmes, limite LDR: %d\n", alarmCount, limiteEscuro);
    }
  }
  else
  {
    Serial.printf("Erro ao buscar config: %d\n", httpCode);
  }

  http.end();
}

void verificarAlarmes()
{
  int currentHour = timeClient.getHours();
  int currentMinute = timeClient.getMinutes();

  for (int i = 0; i < alarmCount; i++)
  {
    if (!alarms[i].enabled)
      continue;

    if (alarms[i].hour == currentHour && alarms[i].minute == currentMinute)
    {
      if (!alarms[i].triggered)
      {
        dispararAlarme(i);
      }
    }
    else
    {
      alarms[i].triggered = false;
    }
  }
}

void dispararAlarme(int alarmIndex)
{
  alarms[alarmIndex].triggered = true;
  alarmeTocando = true;

  Serial.printf("ALARME DISPARADO! %02d:%02d\n",
                alarms[alarmIndex].hour, alarms[alarmIndex].minute);

  notificarTrigger();

  leituraLDR = analogRead(pinLDR);
  if (leituraLDR > limiteEscuro)
  {
    ligarLED(255, 255, 255);
    ledLigadoPeloAlarme = true;
    Serial.println("Ambiente escuro - LED ligado");
  }
  else
  {
    ledLigadoPeloAlarme = false;
    Serial.println("Ambiente claro - LED permanece desligado");
  }
}

void tocarAlarme()
{
  tone(pinBuzzer, 1000, 200);
  delay(300);
  tone(pinBuzzer, 1500, 200);
  delay(300);
}

void pararAlarme()
{
  alarmeTocando = false;
  noTone(pinBuzzer);

  if (ledLigadoPeloAlarme)
  {
    desligarLED();
    ledLigadoPeloAlarme = false;
  }

  notificarAck();
  Serial.println("Alarme parado pelo usuario");
}

void notificarTrigger()
{
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/trigger";

  http.begin(wifiClient, url);
  http.addHeader("Content-Type", "application/json");
  http.POST("{}");
  http.end();
}

bool verificarStopRequest()
{
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/status";

  http.begin(wifiClient, url);
  int httpCode = http.GET();

  bool shouldStop = false;

  if (httpCode == 200)
  {
    String payload = http.getString();

    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc["success"])
    {
      shouldStop = doc["data"]["stopRequested"] | false;
    }
  }

  http.end();
  return shouldStop;
}

void notificarAck()
{
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/alarm/" + DEVICE_ID + "/ack";

  http.begin(wifiClient, url);
  http.addHeader("Content-Type", "application/json");
  http.POST("{}");
  http.end();
}

void ligarLED(int r, int g, int b)
{
  analogWrite(pinRed, r);
  analogWrite(pinGreen, g);
  analogWrite(pinBlue, b);
}

void desligarLED()
{
  analogWrite(pinRed, 0);
  analogWrite(pinGreen, 0);
  analogWrite(pinBlue, 0);
}
