'use strict';

const { Sequelize } = require('sequelize');
// Explicit require so Vercel/NFT bundles mysql2 (Sequelize loads it dynamically).
const mysql2 = require('mysql2');
const config = require('../config');

const sequelize = new Sequelize(
  config.mysql.database,
  config.mysql.username,
  config.mysql.password,
  {
    host: config.mysql.host,
    port: config.mysql.port,
    dialect: 'mysql',
    dialectModule: mysql2,
    logging: false,
    define: {
      freezeTableName: true,
      timestamps: false,
    },
  }
);

module.exports = sequelize;
