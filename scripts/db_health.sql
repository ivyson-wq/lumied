SELECT c.relname as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  s.n_live_tup as estimated_rows
FROM pg_class c
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;
