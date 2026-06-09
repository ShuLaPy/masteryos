 alter table public.dsa_problems
    add constraint dsa_problems_user_url_unique
    unique (user_id, url);