'use strict';

const { Sequelize } = require('sequelize');
const config = require('../config');

const sequelize = new Sequelize(
  config.mysql.database,
  config.mysql.username,
  config.mysql.password,
  {
    host: config.mysql.host,
    port: config.mysql.port,
    dialect: 'mysql',
    logging: false,
    define: {
      freezeTableName: true,
      timestamps: false,
    },
  }
);

module.exports = sequelize;
