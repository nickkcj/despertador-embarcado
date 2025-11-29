const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3000;

// Configuração de CORS para permitir requisições do React Native e ESP32
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`[Gateway] ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Rota de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
});

// Proxy para o Serviço de Controle (porta 3001)
// Rotas: GET/PUT /api/config/:deviceId
app.use('/api/config', createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true,
  pathRewrite: {
    '^/api/config': '/api/config'
  },
  onError: (err, req, res) => {
    console.error('[Gateway] Erro ao conectar com Serviço de Controle:', err.message);
    res.status(503).json({
      success: false,
      error: 'Serviço de Controle indisponível'
    });
  }
}));

// Proxy para o Serviço de Logging (porta 3002)
// Rotas: POST /api/logs, GET /api/logs/:deviceId
app.use('/api/logs', createProxyMiddleware({
  target: 'http://localhost:3002',
  changeOrigin: true,
  pathRewrite: {
    '^/api/logs': '/api/logs'
  },
  onError: (err, req, res) => {
    console.error('[Gateway] Erro ao conectar com Serviço de Logging:', err.message);
    res.status(503).json({
      success: false,
      error: 'Serviço de Logging indisponível'
    });
  }
}));

// Rota padrão para endpoints não encontrados
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Gateway] API Gateway rodando na porta ${PORT}`);
  console.log(`[Gateway] Rotas disponíveis:`);
  console.log(`  - GET  /api/config/:deviceId -> Serviço de Controle (3001)`);
  console.log(`  - PUT  /api/config/:deviceId -> Serviço de Controle (3001)`);
  console.log(`  - POST /api/logs             -> Serviço de Logging (3002)`);
  console.log(`  - GET  /api/logs/:deviceId   -> Serviço de Logging (3002)`);
});
