function applyMutationFilters(query, filters = {}) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (value === null) query = query.is(key, null);
    else if (Array.isArray(value)) query = query.in(key, value);
    else query = query.eq(key, value);
  }
  return query;
}

/**
 * Build one consistent Supabase UPDATE chain. `update` must be called on the
 * table query builder before filters and the returning `select` are attached.
 */
export async function mutateRows(client, table, values, filters, { single = false } = {}) {
  let query = client.from(table).update(values);
  query = applyMutationFilters(query, filters);
  query = query.select();
  if (single) query = query.single();
  return await query;
}
