// Imported FIRST by agent.js so config/index.js knows it is running as the
// laptop connector (which does not need JWT_SECRET or a database).
process.env.CONNECTOR_PROCESS = '1';
