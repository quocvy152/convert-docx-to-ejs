'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const password = process.env.MYSQL_PASSWORD || '';
console.log('host:', process.env.MYSQL_HOST);
console.log('database:', process.env.MYSQL_DATABASE);
console.log('username:', process.env.MYSQL_USERNAME);
console.log('password_length:', password.length);
console.log('password_starts_with_quote:', password.startsWith('"') || password.startsWith("'"));
console.log('password_ends_with_quote:', password.endsWith('"') || password.endsWith("'"));
console.log('password_has_hash_char:', password.includes('#'));
console.log('port:', process.env.MYSQL_PORT || '3306(default)');
