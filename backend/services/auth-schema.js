
const REQUIRED_COLUMNS = {
  users: [
    'id',
    'full_name',
    'email',
    'password_hash',
    'role',
    'is_active'
  ],

  provider_profiles: [
    'id',
    'user_id',
    'business_name',
    'experience_years',
    'service_area',
    'description',
    'approval_status'
  ],

  customer_profiles: [
    'user_id',
    'address',
    'area',
    'city',
    'profile_image'
  ],

  services: [
    'id',
    'provider_id',
    'service_name',
    'category',
    'description',
    'location',
    'image',
    'price',
    'price_type',
    'is_available',
    'approval_status'
  ]
};

async function getTableColumns(pool, tableName) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1`,
    [tableName]
  );

  return new Set(
    result.rows.map((row) => row.column_name)
  );
}

function validateRequiredColumns(tableName, columns) {
  const missingColumns = REQUIRED_COLUMNS[tableName].filter(
    (column) => !columns.has(column)
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `The ${tableName} table is missing required columns: ${missingColumns.join(', ')}`
    );
  }
}

async function loadAuthSchema(pool) {
  const users = await getTableColumns(pool, 'users');
  const providers = await getTableColumns(
    pool,
    'provider_profiles'
  );
  const customerProfiles = await getTableColumns(
    pool,
    'customer_profiles'
  );
  const services = await getTableColumns(
    pool,
    'services'
  );

  validateRequiredColumns('users', users);
  validateRequiredColumns('provider_profiles', providers);
  validateRequiredColumns('customer_profiles', customerProfiles);
  validateRequiredColumns('services', services);

  return {
    users,
    providers,
    customerProfiles,
    services,
    experienceColumn: 'experience_years',
    areaColumn: 'service_area',
    descriptionColumn: 'description'
  };
}

module.exports = { loadAuthSchema };
