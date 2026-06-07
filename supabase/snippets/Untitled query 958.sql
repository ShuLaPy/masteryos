select count(*) from problem_bank; → 300.
select pattern, count(*) from problem_bank, unnest(patterns) as pattern group by 1 order by 2 desc; → matches §2.
select count(*) from problem_bank where 'two_pointers' = any(patterns); → 24.
Re-run npm run seed:problems → still 300 rows (idempotent upsert, no duplicates).
Suggestion query smoke test: select slug,title,difficulty from problem_bank where patterns && array['graph_traversal'] and difficulty='medium' limit 5;