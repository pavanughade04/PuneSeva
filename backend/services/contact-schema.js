
async function ensureContactMessagesTable(pool) {
  const result = await pool.query(`
    SELECT
      column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'contact_messages'
  `);

  const columns = new Set(
    result.rows.map((row) => row.column_name)
  );

  const requiredColumns = [
    'id',
    'name',
    'email',
    'subject',
    'message',
    'status',
    'created_at',
    'updated_at'
  ];

  const missingColumns = requiredColumns.filter(
    (column) => !columns.has(column)
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `PostgreSQL contact_messages table is missing columns: ${missingColumns.join(', ')}`
    );
  }
}

module.exports = { ensureContactMessagesTable };
