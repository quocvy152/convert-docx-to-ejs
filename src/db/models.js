'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('./sequelize');

const TemplateBuilderDraft = sequelize.define(
  'TemplateBuilderDraft',
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'draft' },
    original_pdf_path: { type: DataTypes.STRING(512), allowNull: true },
    ejs_content: { type: DataTypes.TEXT('long'), allowNull: false },
    variables_json: { type: DataTypes.JSON, allowNull: true },
    process_step_ids_json: { type: DataTypes.JSON, allowNull: true },
    replace_file_template_id: { type: DataTypes.INTEGER, allowNull: true },
    published_file_template_id: { type: DataTypes.INTEGER, allowNull: true },
    published_path_template: { type: DataTypes.STRING(512), allowNull: true },
    created_by: { type: DataTypes.STRING(128), allowNull: true },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_time: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_time: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { tableName: 'template_builder_draft' }
);

const ProcessStep = sequelize.define(
  'ProcessStep',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.STRING, allowNull: true },
    description_display: { type: DataTypes.STRING, allowNull: true },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: true },
    process_step_type_id: { type: DataTypes.INTEGER, allowNull: true },
    order: { type: DataTypes.INTEGER, allowNull: true },
  },
  { tableName: 'process_step' }
);

const FileTemplate = sequelize.define(
  'FileTemplate',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    path_template: { type: DataTypes.STRING, allowNull: true },
    is_not_signed: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    is_esign: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    is_signed_for_FATCA: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    parent_id: { type: DataTypes.INTEGER, allowNull: true },
    file_template_type_id: { type: DataTypes.INTEGER, allowNull: true },
    file_type_id: { type: DataTypes.INTEGER, allowNull: true },
    data_config: { type: DataTypes.JSON, allowNull: true },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    collect_same_id: { type: DataTypes.INTEGER, allowNull: true },
    is_inactive: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_approved_date_appointment: { type: DataTypes.INTEGER, defaultValue: 0 },
    version: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
  },
  { tableName: 'file_template' }
);

const ProcessStepHasFileTemplate = sequelize.define(
  'ProcessStepHasFileTemplate',
  {
    process_step_id: { type: DataTypes.INTEGER, primaryKey: true },
    file_template_id: { type: DataTypes.INTEGER, primaryKey: true },
    order: { type: DataTypes.INTEGER, allowNull: true },
    is_begin: { type: DataTypes.BOOLEAN, allowNull: true },
  },
  { tableName: 'process_step_has_file_template' }
);

module.exports = {
  sequelize,
  TemplateBuilderDraft,
  ProcessStep,
  FileTemplate,
  ProcessStepHasFileTemplate,
};
