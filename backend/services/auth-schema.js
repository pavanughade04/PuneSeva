const REQUIRED_USER_COLUMNS = ['id', 'full_name', 'email', 'password_hash', 'role'];

async function getTableColumns(pool, tableName) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function ensureCustomerProfiles(pool) {
  const [tables] = await pool.execute(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
    ['customer_profiles']
  );
  if (tables.length > 0) return getTableColumns(pool, 'customer_profiles');

  const [userTables] = await pool.execute(
    `SELECT t.ENGINE, c.COLUMN_TYPE
     FROM INFORMATION_SCHEMA.TABLES AS t
     JOIN INFORMATION_SCHEMA.COLUMNS AS c
       ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
     WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'users' AND c.COLUMN_NAME = 'id'`
  );
  const userTable = userTables[0];
  const idType = userTable?.COLUMN_TYPE.match(/^(tinyint|smallint|mediumint|int|bigint)(?:\(\d+\))?( unsigned)?$/i);
  if (!userTable || userTable.ENGINE !== 'InnoDB' || !idType) {
    throw new Error('Cannot create customer_profiles: users.id must be a supported integer on an InnoDB table.');
  }

  const userIdType = `${idType[1].toUpperCase()}${idType[2] ? ' UNSIGNED' : ''}`;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_profiles (
      user_id ${userIdType} NOT NULL,
      address VARCHAR(255) NULL,
      area VARCHAR(120) NULL,
      city VARCHAR(100) NOT NULL DEFAULT 'Pune',
      profile_image VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      CONSTRAINT fk_customer_profiles_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  return getTableColumns(pool, 'customer_profiles');
}

async function loadAuthSchema(pool) {
  const users = await getTableColumns(pool, 'users');
  const providers = await getTableColumns(pool, 'provider_profiles');
  const services = await getTableColumns(pool, 'services');

  const missingUserColumns = REQUIRED_USER_COLUMNS.filter((column) => !users.has(column));
  if (missingUserColumns.length > 0) {
    throw new Error(`The users table is missing required columns: ${missingUserColumns.join(', ')}`);
  }
  if (!users.has('account_status') && !users.has('is_active')) {
    throw new Error('The users table must include account_status or is_active.');
  }
  for (const column of ['user_id', 'business_name', 'approval_status']) {
    if (!providers.has(column)) {
      throw new Error(`The provider_profiles table is missing required column: ${column}`);
    }
  }

  const experienceColumn = ['experience_years', 'years_experience']
    .find((column) => providers.has(column));
  const areaColumn = ['service_area', 'area'].find((column) => providers.has(column));
  const descriptionColumn = ['description', 'bio'].find((column) => providers.has(column));
  if (!experienceColumn || !areaColumn || !descriptionColumn) {
    throw new Error('The provider_profiles table is missing supported experience, area, or description columns.');
  }

  const customerProfiles = await ensureCustomerProfiles(pool);

  return {
    users,
    providers,
    services,
    customerProfiles,
    experienceColumn,
    areaColumn,
    descriptionColumn
  };
}

module.exports = { loadAuthSchema };
