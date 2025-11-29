const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3001;

const alarmStates = {};

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`[Controle] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Configuração do banco de dados
const dbPath = path.resolve(__dirname, '../../database/despertador.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Controle] Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('[Controle] Conectado ao banco de dados SQLite');
    initDatabase();
  }
});

// Função para inicializar o banco de dados
function initDatabase() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS configs (
      device_id TEXT PRIMARY KEY,
      alarms TEXT DEFAULT '[]',
      light_threshold INTEGER DEFAULT 300,
      enabled INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.run(createTableSQL, (err) => {
    if (err) {
      console.error('[Controle] Erro ao criar tabela configs:', err.message);
    } else {
      console.log('[Controle] Tabela configs verificada/criada com sucesso');
    }
  });
}

// Rota de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'controle', timestamp: new Date().toISOString() });
});

// GET /api/config/:deviceId - Retorna configurações do dispositivo
app.get('/api/config/:deviceId', (req, res) => {
  const { deviceId } = req.params;

  const sql = 'SELECT * FROM configs WHERE device_id = ?';

  db.get(sql, [deviceId], (err, row) => {
    if (err) {
      console.error('[Controle] Erro ao buscar configuração:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar configuração'
      });
    }

    if (!row) {
      // Se não existir configuração, cria uma padrão
      const defaultConfig = {
        device_id: deviceId,
        alarms: '[]',
        light_threshold: 300,
        enabled: 1,
        updated_at: new Date().toISOString()
      };

      const insertSQL = `
        INSERT INTO configs (device_id, alarms, light_threshold, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.run(insertSQL, [
        defaultConfig.device_id,
        defaultConfig.alarms,
        defaultConfig.light_threshold,
        defaultConfig.enabled,
        defaultConfig.updated_at
      ], function(err) {
        if (err) {
          console.error('[Controle] Erro ao criar configuração padrão:', err.message);
          return res.status(500).json({
            success: false,
            error: 'Erro ao criar configuração padrão'
          });
        }

        return res.json({
          success: true,
          data: {
            deviceId: defaultConfig.device_id,
            alarms: JSON.parse(defaultConfig.alarms),
            lightThreshold: defaultConfig.light_threshold,
            enabled: Boolean(defaultConfig.enabled),
            updatedAt: defaultConfig.updated_at
          }
        });
      });
    } else {
      // Retorna configuração existente
      res.json({
        success: true,
        data: {
          deviceId: row.device_id,
          alarms: JSON.parse(row.alarms || '[]'),
          lightThreshold: row.light_threshold,
          enabled: Boolean(row.enabled),
          updatedAt: row.updated_at
        }
      });
    }
  });
});

// PUT /api/config/:deviceId - Atualiza configurações do dispositivo
app.put('/api/config/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const { alarms, lightThreshold, enabled } = req.body;

  // Validações
  if (alarms !== undefined && !Array.isArray(alarms)) {
    return res.status(400).json({
      success: false,
      error: 'O campo alarms deve ser um array'
    });
  }

  if (lightThreshold !== undefined && (typeof lightThreshold !== 'number' || lightThreshold < 0)) {
    return res.status(400).json({
      success: false,
      error: 'O campo lightThreshold deve ser um número positivo'
    });
  }

  const updatedAt = new Date().toISOString();

  // Primeiro, verifica se o dispositivo existe
  db.get('SELECT * FROM configs WHERE device_id = ?', [deviceId], (err, row) => {
    if (err) {
      console.error('[Controle] Erro ao verificar dispositivo:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao verificar dispositivo'
      });
    }

    if (!row) {
      // Se não existe, cria novo registro
      const insertSQL = `
        INSERT INTO configs (device_id, alarms, light_threshold, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `;

      const newAlarms = alarms !== undefined ? JSON.stringify(alarms) : '[]';
      const newThreshold = lightThreshold !== undefined ? lightThreshold : 300;
      const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : 1;

      db.run(insertSQL, [deviceId, newAlarms, newThreshold, newEnabled, updatedAt], function(err) {
        if (err) {
          console.error('[Controle] Erro ao criar configuração:', err.message);
          return res.status(500).json({
            success: false,
            error: 'Erro ao criar configuração'
          });
        }

        return res.json({
          success: true,
          message: 'Configurações criadas',
          data: {
            deviceId: deviceId,
            alarms: alarms || [],
            lightThreshold: newThreshold,
            enabled: Boolean(newEnabled),
            updatedAt: updatedAt
          }
        });
      });
    } else {
      // Se existe, atualiza
      const newAlarms = alarms !== undefined ? JSON.stringify(alarms) : row.alarms;
      const newThreshold = lightThreshold !== undefined ? lightThreshold : row.light_threshold;
      const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : row.enabled;

      const updateSQL = `
        UPDATE configs
        SET alarms = ?, light_threshold = ?, enabled = ?, updated_at = ?
        WHERE device_id = ?
      `;

      db.run(updateSQL, [newAlarms, newThreshold, newEnabled, updatedAt, deviceId], function(err) {
        if (err) {
          console.error('[Controle] Erro ao atualizar configuração:', err.message);
          return res.status(500).json({
            success: false,
            error: 'Erro ao atualizar configuração'
          });
        }

        res.json({
          success: true,
          message: 'Configurações atualizadas',
          data: {
            deviceId: deviceId,
            alarms: JSON.parse(newAlarms),
            lightThreshold: newThreshold,
            enabled: Boolean(newEnabled),
            updatedAt: updatedAt
          }
        });
      });
    }
  });
});

// GET /api/alarm/:deviceId/status - Verifica se deve parar o alarme
app.get('/api/alarm/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const state = alarmStates[deviceId] || { ringing: false, stopRequested: false };

  res.json({
    success: true,
    data: {
      ringing: state.ringing,
      stopRequested: state.stopRequested
    }
  });
});

// POST /api/alarm/:deviceId/trigger - Arduino avisa que alarme começou a tocar
app.post('/api/alarm/:deviceId/trigger', (req, res) => {
  const { deviceId } = req.params;
  alarmStates[deviceId] = { ringing: true, stopRequested: false };

  console.log(`[Controle] Alarme disparado para device: ${deviceId}`);
  res.json({ success: true, message: 'Alarme registrado como tocando' });
});

// POST /api/alarm/:deviceId/stop - Usuário pede para parar o alarme
app.post('/api/alarm/:deviceId/stop', (req, res) => {
  const { deviceId } = req.params;

  if (!alarmStates[deviceId]) {
    alarmStates[deviceId] = { ringing: false, stopRequested: true };
  } else {
    alarmStates[deviceId].stopRequested = true;
    alarmStates[deviceId].ringing = false;
  }

  console.log(`[Controle] Solicitação para parar alarme do device: ${deviceId}`);
  res.json({ success: true, message: 'Alarme será parado' });
});

// POST /api/alarm/:deviceId/ack - Arduino confirma que parou
app.post('/api/alarm/:deviceId/ack', (req, res) => {
  const { deviceId } = req.params;
  alarmStates[deviceId] = { ringing: false, stopRequested: false };

  res.json({ success: true, message: 'Alarme confirmado como parado' });
});

// Rota padrão para endpoints não encontrados
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Controle] Serviço de Controle rodando na porta ${PORT}`);
  console.log(`[Controle] Endpoints disponíveis:`);
  console.log(`  - GET  /api/config/:deviceId`);
  console.log(`  - PUT  /api/config/:deviceId`);
  console.log(`  - GET  /api/alarm/:deviceId/status`);
  console.log(`  - POST /api/alarm/:deviceId/trigger`);
  console.log(`  - POST /api/alarm/:deviceId/stop`);
  console.log(`  - POST /api/alarm/:deviceId/ack`);
});

// Fechar conexão com banco ao encerrar
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('[Controle] Erro ao fechar banco de dados:', err.message);
    }
    console.log('[Controle] Conexão com banco de dados encerrada');
    process.exit(0);
  });
});
