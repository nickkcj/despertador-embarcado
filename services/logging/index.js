const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3002;

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`[Logging] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Configuração do banco de dados
const dbPath = path.resolve(__dirname, '../../../database/despertador.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Logging] Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('[Logging] Conectado ao banco de dados SQLite');
    initDatabase();
  }
});

// Função para inicializar o banco de dados
function initDatabase() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      light INTEGER NOT NULL,
      alarm_triggered INTEGER DEFAULT 0,
      servo_opened INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.run(createTableSQL, (err) => {
    if (err) {
      console.error('[Logging] Erro ao criar tabela logs:', err.message);
    } else {
      console.log('[Logging] Tabela logs verificada/criada com sucesso');
    }
  });

  // Criar índice para melhorar performance de consultas por device_id
  const createIndexSQL = `
    CREATE INDEX IF NOT EXISTS idx_logs_device_id ON logs(device_id)
  `;

  db.run(createIndexSQL, (err) => {
    if (err) {
      console.error('[Logging] Erro ao criar índice:', err.message);
    }
  });
}

// Rota de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'logging', timestamp: new Date().toISOString() });
});

// POST /api/logs - Registra leitura/evento do dispositivo
app.post('/api/logs', (req, res) => {
  const { deviceId, light, alarmTriggered, servoOpened } = req.body;

  // Validações
  if (!deviceId) {
    return res.status(400).json({
      success: false,
      error: 'O campo deviceId é obrigatório'
    });
  }

  if (light === undefined || typeof light !== 'number') {
    return res.status(400).json({
      success: false,
      error: 'O campo light é obrigatório e deve ser um número'
    });
  }

  const timestamp = new Date().toISOString();
  const alarmTriggeredValue = alarmTriggered ? 1 : 0;
  const servoOpenedValue = servoOpened ? 1 : 0;

  const insertSQL = `
    INSERT INTO logs (device_id, light, alarm_triggered, servo_opened, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.run(insertSQL, [deviceId, light, alarmTriggeredValue, servoOpenedValue, timestamp], function(err) {
    if (err) {
      console.error('[Logging] Erro ao inserir log:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao registrar log'
      });
    }

    const logId = this.lastID;

    res.status(201).json({
      success: true,
      message: 'Log registrado',
      data: {
        id: logId,
        deviceId: deviceId,
        light: light,
        alarmTriggered: Boolean(alarmTriggeredValue),
        servoOpened: Boolean(servoOpenedValue),
        timestamp: timestamp
      }
    });
  });
});

// GET /api/logs/:deviceId - Retorna histórico de logs do dispositivo
app.get('/api/logs/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  // Validação do limit para evitar consultas muito grandes
  const maxLimit = Math.min(limit, 1000);

  const sql = `
    SELECT * FROM logs
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;

  db.all(sql, [deviceId, maxLimit, offset], (err, rows) => {
    if (err) {
      console.error('[Logging] Erro ao buscar logs:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar logs'
      });
    }

    // Formatar os dados de saída
    const formattedLogs = rows.map(row => ({
      id: row.id,
      deviceId: row.device_id,
      light: row.light,
      alarmTriggered: Boolean(row.alarm_triggered),
      servoOpened: Boolean(row.servo_opened),
      timestamp: row.timestamp
    }));

    res.json({
      success: true,
      data: formattedLogs,
      count: formattedLogs.length
    });
  });
});

// GET /api/logs - Retorna todos os logs (com paginação)
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  // Validação do limit para evitar consultas muito grandes
  const maxLimit = Math.min(limit, 1000);

  const sql = `
    SELECT * FROM logs
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;

  db.all(sql, [maxLimit, offset], (err, rows) => {
    if (err) {
      console.error('[Logging] Erro ao buscar logs:', err.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar logs'
      });
    }

    // Formatar os dados de saída
    const formattedLogs = rows.map(row => ({
      id: row.id,
      deviceId: row.device_id,
      light: row.light,
      alarmTriggered: Boolean(row.alarm_triggered),
      servoOpened: Boolean(row.servo_opened),
      timestamp: row.timestamp
    }));

    res.json({
      success: true,
      data: formattedLogs,
      count: formattedLogs.length
    });
  });
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
  console.log(`[Logging] Serviço de Logging rodando na porta ${PORT}`);
  console.log(`[Logging] Endpoints disponíveis:`);
  console.log(`  - POST /api/logs`);
  console.log(`  - GET  /api/logs/:deviceId`);
  console.log(`  - GET  /api/logs`);
});

// Fechar conexão com banco ao encerrar
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('[Logging] Erro ao fechar banco de dados:', err.message);
    }
    console.log('[Logging] Conexão com banco de dados encerrada');
    process.exit(0);
  });
});
