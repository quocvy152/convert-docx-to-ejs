'use strict';

const path = require('path');
// Prefer this app's .env over shell/user MYSQL_* (common on shared CRM machines).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

const rootDir = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 4050),
  mysql: {
    host: required('MYSQL_HOST', '127.0.0.1'),
    port: Number(process.env.MYSQL_PORT || 3306),
    database: required('MYSQL_DATABASE', 'sunbright_local'),
    username: required('MYSQL_USERNAME', 'root'),
    password: process.env.MYSQL_PASSWORD || '',
  },
  ejsOutputDir: path.resolve(process.env.EJS_OUTPUT_DIR || path.join(rootDir, 'storage', 'published')),
  pathTemplatePrefix: process.env.PATH_TEMPLATE_PREFIX || '/views/mvp_generated',
  uploadsDir: path.join(rootDir, 'storage', 'uploads'),
  // mysql | fs | auto (auto uses MySQL when template_builder_draft exists, else local JSON)
  draftStore: process.env.DRAFT_STORE || 'auto',
  apiKeys: String(process.env.TEMPLATE_BUILDER_API_KEYS || 'dev-key-change-me')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || null,
  requiredPermission: process.env.REQUIRED_PERMISSION || 'FILE_TEMPLATE_CONFIG',
};
