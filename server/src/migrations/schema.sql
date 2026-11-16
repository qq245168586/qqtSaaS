CREATE TABLE `companies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL COMMENT '公司代码 tri/tmy',
  `name` VARCHAR(100) NOT NULL COMMENT '公司全称',
  `short_name` VARCHAR(50) NOT NULL COMMENT '公司简称',
  `address` VARCHAR(255) NULL DEFAULT NULL COMMENT '公司地址',
  `phone` VARCHAR(30) NULL DEFAULT NULL COMMENT '公司电话',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公司表';

CREATE TABLE `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `employee_id` BIGINT UNSIGNED NULL,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 1,
  `real_name` VARCHAR(50) NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT 'boss/admin/employee',
  `phone` VARCHAR(30) NULL DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  `last_login_at` DATETIME NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_username` (`company_id`, `username`),
  KEY `idx_company_id` (`company_id`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE `departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `name` VARCHAR(50) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `active_name` VARCHAR(50) GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN `name` ELSE NULL END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_department_active_name` (`active_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表';

CREATE TABLE `employees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `department_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `phone` VARCHAR(30) NULL DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/left',
  `left_on` DATE NULL DEFAULT NULL COMMENT '离职当天起不可分配',
  `rest_start_month` CHAR(7) NULL DEFAULT NULL COMMENT '例休累计起始月份，由系统设置',
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_department_id` (`department_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工表';

CREATE TABLE `categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `name` VARCHAR(50) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `active_name` VARCHAR(50) GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL THEN TRIM(`name`) ELSE NULL END) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_category_active_name` (`active_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务分类表';

CREATE TABLE `customer_categories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_name` (`company_id`, `name`),
  KEY `idx_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户分类表';

CREATE TABLE `customers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NULL DEFAULT NULL,
  `name` VARCHAR(100) NOT NULL,
  `address` VARCHAR(255) NULL DEFAULT NULL,
  `contact` VARCHAR(50) NULL DEFAULT NULL,
  `phone` VARCHAR(30) NULL DEFAULT NULL,
  `category_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_name` (`company_id`, `name`),
  KEY `idx_company_id` (`company_id`),
  KEY `idx_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

CREATE TABLE `products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `spec` VARCHAR(100) NOT NULL DEFAULT '',
  `unit` VARCHAR(20) NOT NULL,
  `default_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_name_spec` (`company_id`, `name`, `spec`),
  KEY `idx_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品表';

CREATE TABLE `personnel` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `role_type` VARCHAR(20) NOT NULL DEFAULT 'general' COMMENT 'maker/warehouse/sales/deliverer/general',
  `sort` INT NOT NULL DEFAULT 0,
  `last_used_at` DATETIME NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_name` (`company_id`, `name`),
  KEY `idx_company_id` (`company_id`),
  KEY `idx_role_type` (`role_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员表（署名池）';

CREATE TABLE `tasks` (
  `customer_name` VARCHAR(100) NULL DEFAULT NULL,
  `product_summary` VARCHAR(500) NULL DEFAULT NULL,
  `delivery_address` VARCHAR(500) NULL DEFAULT NULL,
  `order_amount` DECIMAL(12,2) NULL DEFAULT NULL,
  `delivery_fee` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `order_channel` VARCHAR(50) NULL DEFAULT NULL,
  `entry_progress` VARCHAR(20) NOT NULL DEFAULT 'not_entered',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `detail` TEXT NULL DEFAULT NULL,
  `source_text` TEXT NULL DEFAULT NULL,
  `category_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `department_id` BIGINT UNSIGNED NOT NULL,
  `assignee_employee_id` BIGINT UNSIGNED NOT NULL,
  `order_taker_employee_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'todo',
  `priority` VARCHAR(20) NOT NULL DEFAULT 'normal',
  `task_type` VARCHAR(20) NOT NULL,
  `expected_delivery_at` DATETIME NULL DEFAULT NULL,
  `remark` TEXT NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_company_status` (`company_id`, `status`),
  KEY `idx_company_department` (`company_id`, `department_id`),
  KEY `idx_company_assignee` (`company_id`, `assignee_employee_id`),
  KEY `idx_company_order_taker` (`company_id`, `order_taker_employee_id`),
  KEY `idx_expected_delivery_at` (`expected_delivery_at`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_category_id` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务表';

CREATE TABLE `task_images` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `oss_url` VARCHAR(500) NOT NULL,
  `oss_key` VARCHAR(500) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL DEFAULT 0,
  `mime_type` VARCHAR(50) NOT NULL DEFAULT 'image/png',
  `sort` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务图片表';

CREATE TABLE `delivery_notes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `note_number` VARCHAR(50) NULL,
  `delivery_date` DATE NOT NULL,
  `customer_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `customer_name_snapshot` VARCHAR(100) NOT NULL,
  `customer_address_snapshot` VARCHAR(255) NULL DEFAULT NULL,
  `customer_phone_snapshot` VARCHAR(30) NULL DEFAULT NULL,
  `source_task_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `conversion_request_id` VARCHAR(64) NULL DEFAULT NULL,
  `maker_name` VARCHAR(50) NULL DEFAULT NULL,
  `warehouse_name` VARCHAR(50) NULL DEFAULT NULL,
  `sales_name` VARCHAR(50) NULL DEFAULT NULL,
  `deliverer_name` VARCHAR(50) NULL DEFAULT NULL,
  `is_draft` TINYINT(1) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `printed_at` DATETIME NULL DEFAULT NULL,
  `source_number` VARCHAR(50) NULL DEFAULT NULL,
  `page` INT NULL DEFAULT NULL,
  `total_pages` INT NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_note_number` (`company_id`, `note_number`),
  KEY `idx_company_delivery_date` (`company_id`, `delivery_date`),
  KEY `idx_source_task` (`source_task_id`),
  UNIQUE KEY `uk_task_conversion` (`source_task_id`, `conversion_request_id`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_is_draft` (`is_draft`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单表';

CREATE TABLE `delivery_note_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `delivery_note_id` BIGINT UNSIGNED NOT NULL,
  `product_name` VARCHAR(100) NOT NULL,
  `spec` VARCHAR(100) NOT NULL DEFAULT '',
  `unit` VARCHAR(20) NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `remark` VARCHAR(255) NULL DEFAULT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_note_id` (`delivery_note_id`),
  KEY `idx_company_id` (`company_id`),
  KEY `idx_product_name` (`product_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单明细表';

CREATE TABLE `print_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `name` VARCHAR(60) NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `config_json` JSON NOT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  `global_default_slot` TINYINT GENERATED ALWAYS AS (CASE WHEN `deleted_at` IS NULL AND `is_default` = 1 THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY `uk_global_default` (`global_default_slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打印模板表';

CREATE TABLE `ai_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `api_base_url` VARCHAR(255) NOT NULL,
  `model_name` VARCHAR(100) NOT NULL,
  `api_key_encrypted` VARCHAR(500) NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_id` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI配置表';

CREATE TABLE `settings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` TEXT NULL DEFAULT NULL,
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_key` (`company_id`, `setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统设置表';

CREATE TABLE `app_meta` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `meta_key` VARCHAR(100) NOT NULL,
  `meta_value` TEXT NULL DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_key` (`company_id`, `meta_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用元数据表';

CREATE TABLE `refresh_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  `ip_address` VARCHAR(45) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token_hash` (`token_hash`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_revoked_at` (`revoked_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='刷新令牌表';
CREATE TABLE `company_choice_samples` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type` ENUM('task','delivery') NOT NULL,
  `entity_id` BIGINT UNSIGNED NOT NULL,
  `keyword` VARCHAR(40) NOT NULL,
  `company_code` ENUM('tri','tmy') NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_entity_keyword` (`entity_type`, `entity_id`, `keyword`),
  KEY `idx_keyword_time` (`keyword`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_schedules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `work_date` DATE NOT NULL,
  `shift_kind` VARCHAR(20) NOT NULL,
  `start_time` CHAR(5) NULL,
  `overtime_minutes` INT NOT NULL DEFAULT 0,
  `timeoff_minutes` INT NOT NULL DEFAULT 0,
  `note` VARCHAR(500) NOT NULL DEFAULT '',
  `version` INT NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employee_work_date` (`employee_id`,`work_date`),
  KEY `idx_work_date_employee` (`work_date`,`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `employee_schedule_audit` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `schedule_id` BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `work_date` DATE NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `before_json` LONGTEXT NULL,
  `after_json` LONGTEXT NULL,
  `actor_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_schedule_audit` (`schedule_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_materials` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('shared','tri','tmy') NOT NULL DEFAULT 'shared',
  `standard_name` VARCHAR(120) NOT NULL,
  `normalized_name` VARCHAR(120) NOT NULL,
  `identity_key` CHAR(64) NOT NULL,
  `aliases_json` JSON NOT NULL,
  `category` VARCHAR(100) NOT NULL DEFAULT '',
  `brand` VARCHAR(100) NOT NULL DEFAULT '',
  `spec` VARCHAR(100) NOT NULL DEFAULT '',
  `purchase_unit` VARCHAR(20) NOT NULL,
  `base_unit` VARCHAR(20) NOT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cost_material_identity` (`identity_key`),
  KEY `idx_cost_material_scope_name` (`scope`,`normalized_name`),
  KEY `idx_cost_material_active` (`active`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_price_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `material_id` BIGINT UNSIGNED NOT NULL,
  `purchase_quantity` DECIMAL(30,10) NOT NULL,
  `purchase_price_yuan` DECIMAL(30,10) NOT NULL,
  `unit_cost_yuan_per_base` DECIMAL(30,10) NOT NULL,
  `effective_date` DATE NOT NULL,
  `source` VARCHAR(200) NOT NULL DEFAULT '',
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cost_price_value` (`material_id`,`effective_date`,`purchase_quantity`,`purchase_price_yuan`),
  KEY `idx_cost_price_current` (`material_id`,`effective_date`,`id`),
  CONSTRAINT `fk_cost_price_material` FOREIGN KEY (`material_id`) REFERENCES `cost_materials` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_sops` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope` ENUM('shared','tri','tmy') NOT NULL DEFAULT 'shared',
  `product_name` VARCHAR(120) NOT NULL,
  `product_spec` VARCHAR(100) NOT NULL DEFAULT '',
  `yield_quantity` DECIMAL(30,10) NOT NULL,
  `yield_unit` VARCHAR(20) NOT NULL,
  `version` VARCHAR(30) NOT NULL DEFAULT 'V1.0',
  `calculation_date` DATE NOT NULL,
  `source_text` MEDIUMTEXT NOT NULL,
  `batch_cost_yuan` DECIMAL(30,10) NOT NULL,
  `unit_cost_yuan` DECIMAL(30,10) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cost_sop_updated` (`updated_at`,`id`),
  KEY `idx_cost_sop_product` (`product_name`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_sop_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sop_id` BIGINT UNSIGNED NOT NULL,
  `sort_order` INT NOT NULL,
  `material_id` BIGINT UNSIGNED NOT NULL,
  `material_name` VARCHAR(120) NOT NULL,
  `quantity` DECIMAL(30,10) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  `base_unit` VARCHAR(20) NOT NULL,
  `price_version_id` BIGINT UNSIGNED NOT NULL,
  `unit_cost_yuan_per_base` DECIMAL(30,10) NOT NULL,
  `base_quantity` DECIMAL(30,10) NOT NULL,
  `line_cost_yuan` DECIMAL(30,10) NOT NULL,
  `note` VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cost_sop_item_sort` (`sop_id`,`sort_order`),
  KEY `idx_cost_sop_item_material` (`material_id`),
  CONSTRAINT `fk_cost_sop_item_sop` FOREIGN KEY (`sop_id`) REFERENCES `cost_sops` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cost_sop_item_material` FOREIGN KEY (`material_id`) REFERENCES `cost_materials` (`id`),
  CONSTRAINT `fk_cost_sop_item_price` FOREIGN KEY (`price_version_id`) REFERENCES `cost_price_versions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_calculation_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sop_id` BIGINT UNSIGNED NOT NULL,
  `calculation_date` DATE NOT NULL,
  `batch_cost_yuan` DECIMAL(30,10) NOT NULL,
  `unit_cost_yuan` DECIMAL(30,10) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cost_snapshot_sop` (`sop_id`,`created_at`),
  CONSTRAINT `fk_cost_snapshot_sop` FOREIGN KEY (`sop_id`) REFERENCES `cost_sops` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `cost_import_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kind` VARCHAR(30) NOT NULL,
  `item_count` INT NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cost_import_created` (`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `wiki_directories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `path` varchar(500) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wiki_directory_path` (`path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `wiki_pages` (
  `directory_path` varchar(500) COLLATE utf8mb4_bin NOT NULL DEFAULT '/',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(200) NOT NULL,
  `icon` VARCHAR(16) NOT NULL DEFAULT '📄',
  `content_json` JSON NOT NULL,
  `content_text` MEDIUMTEXT NOT NULL,
  `position` INT NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wiki_parent_position` (`parent_id`,`position`,`id`),
  KEY `idx_wiki_directory` (`directory_path`,`deleted_at`),
  KEY `idx_wiki_updated` (`updated_at`,`id`),
  CONSTRAINT `fk_wiki_parent` FOREIGN KEY (`parent_id`) REFERENCES `wiki_pages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `wiki_page_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `page_id` BIGINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `icon` VARCHAR(16) NOT NULL,
  `content_json` JSON NOT NULL,
  `content_text` MEDIUMTEXT NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wiki_page_version` (`page_id`,`version`),
  KEY `idx_wiki_version_created` (`page_id`,`created_at`,`id`),
  CONSTRAINT `fk_wiki_version_page` FOREIGN KEY (`page_id`) REFERENCES `wiki_pages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `wiki_images` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `oss_key` VARCHAR(500) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_size` BIGINT UNSIGNED NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wiki_image_key` (`oss_key`),
  KEY `idx_wiki_image_created` (`created_at`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `todo_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(200) NOT NULL,
  `note` TEXT NOT NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `recurrence` VARCHAR(20) NOT NULL DEFAULT 'once',
  `cycle_month` CHAR(7) NULL,
  `monthly_anchor_end` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `import_key` VARCHAR(100) NULL,
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  `deleted_at` DATETIME NULL,
  KEY idx_todo_due (deleted_at,progress,ends_at),
  UNIQUE KEY uk_todo_import (import_key),
  KEY idx_todo_monthly (recurrence,deleted_at,cycle_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `todo_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `todo_id` BIGINT UNSIGNED NOT NULL,
  `source_version` INT UNSIGNED NOT NULL,
  `reason` VARCHAR(20) NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `archived_at` DATETIME NOT NULL,
  UNIQUE KEY uk_todo_history_version (todo_id,source_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
