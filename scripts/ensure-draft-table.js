'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true,
  });

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'sql', '001_template_builder_draft.sql'),
    'utf8'
  );
  await connection.query(sql);

  const [tables] = await connection.query(
    "SHOW TABLES LIKE 'template_builder_draft'"
  );
  console.log('draft_table:', tables.length ? 'ok' : 'missing');

  try {
    const [steps] = await connection.query(
      'SELECT COUNT(*) AS n FROM process_step'
    );
    console.log('process_step_count:', steps[0].n);
  } catch (error) {
    console.log('process_step_check:', error.code || error.message);
  }

  try {
    const [templates] = await connection.query(
      'SELECT COUNT(*) AS n FROM file_template'
    );
    console.log('file_template_count:', templates[0].n);
  } catch (error) {
    console.log('file_template_check:', error.code || error.message);
  }

  await connection.end();
  console.log('db_ready');
}

main().catch((error) => {
  console.error('DB_ERROR', error.code || '', error.message);
  process.exit(1);
});
