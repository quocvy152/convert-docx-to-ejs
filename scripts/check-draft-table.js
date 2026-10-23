'use strict';

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
  });

  const [tables] = await connection.query(
    "SHOW TABLES LIKE 'template_builder_draft'"
  );
  console.log('draft_table_exists:', tables.length > 0);

  if (tables.length > 0) {
    const [cols] = await connection.query('DESCRIBE template_builder_draft');
    console.log('draft_columns:', cols.map((c) => c.Field).join(','));
  }

  const [grants] = await connection.query('SHOW GRANTS');
  for (const row of grants) {
    const value = Object.values(row)[0];
    // Avoid dumping full grant host noise; keep privilege keywords only.
    console.log('grant:', String(value).replace(/IDENTIFIED BY PASSWORD '[^']+'/gi, 'IDENTIFIED BY ***'));
  }

  const [steps] = await connection.query(
    'SELECT COUNT(*) AS n FROM process_step'
  );
  console.log('process_step_count:', steps[0].n);

  const [templates] = await connection.query(
    'SELECT COUNT(*) AS n FROM file_template'
  );
  console.log('file_template_count:', templates[0].n);

  await connection.end();
}

main().catch((error) => {
  console.error('DB_ERROR', error.code || '', error.message);
  process.exit(1);
});
