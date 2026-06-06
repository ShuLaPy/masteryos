-- Phase 7: Knowledge Graph & Semantic Search
-- Enable pgvector extension (must be enabled in Supabase dashboard first)
create extension if not exists vector;

-----------------------------------------
-- 1. Concept Embeddings Table
-----------------------------------------
create table if not exists public.concept_embeddings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  source_type text not null check (source_type in ('aiml_concept', 'dsa_problem')),
  source_id uuid not null,
  content_hash text not null,
  embedding vector(1536),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.concept_embeddings enable row level security;
create policy "Users can manage own embeddings" on public.concept_embeddings 
  for all using (auth.uid() = user_id);

-- HNSW index for fast cosine similarity search
create index if not exists concept_embeddings_embedding_idx 
  on public.concept_embeddings using hnsw (embedding vector_cosine_ops);

-- Prevent duplicate embeddings for same content
create unique index if not exists concept_embeddings_source_unique 
  on public.concept_embeddings (user_id, source_type, source_id);

-----------------------------------------
-- 2. Weekly Syntheses Table (for cross-connections)
-----------------------------------------
create table if not exists public.weekly_syntheses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users on delete cascade not null,
  week_number int,
  week_start_date date,
  ai_synthesis text,
  concepts_learned text[],
  problems_logged_count int,
  average_retention float,
  cross_connections jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.weekly_syntheses enable row level security;
create policy "Users can manage own syntheses" on public.weekly_syntheses 
  for all using (auth.uid() = user_id);

-----------------------------------------
-- 3. match_concepts RPC function
-- Returns top-N similar concepts by cosine similarity
-----------------------------------------
create or replace function public.match_concepts(
  query_embedding vector(1536),
  match_count int default 5,
  match_user_id uuid default null
)
returns table (
  id uuid,
  source_type text,
  source_id uuid,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    ce.id,
    ce.source_type,
    ce.source_id,
    1 - (ce.embedding <=> query_embedding) as similarity
  from public.concept_embeddings ce
  where ce.user_id = match_user_id
  order by ce.embedding <=> query_embedding
  limit match_count;
end;
$$;

-----------------------------------------
-- 4. find_cross_connections RPC function
-- Finds AIML-DSA pairs with high cosine similarity
-----------------------------------------
create or replace function public.find_cross_connections(
  p_user_id uuid,
  similarity_threshold float default 0.7,
  max_pairs int default 10
)
returns table (
  aiml_embedding_id uuid,
  aiml_source_id uuid,
  dsa_embedding_id uuid,
  dsa_source_id uuid,
  similarity float
)
language plpgsql
security definer
as $$
begin
  return query
  select
    aiml.id as aiml_embedding_id,
    aiml.source_id as aiml_source_id,
    dsa.id as dsa_embedding_id,
    dsa.source_id as dsa_source_id,
    1 - (aiml.embedding <=> dsa.embedding) as similarity
  from public.concept_embeddings aiml
  cross join public.concept_embeddings dsa
  where aiml.user_id = p_user_id
    and dsa.user_id = p_user_id
    and aiml.source_type = 'aiml_concept'
    and dsa.source_type = 'dsa_problem'
    and 1 - (aiml.embedding <=> dsa.embedding) >= similarity_threshold
  order by aiml.embedding <=> dsa.embedding
  limit max_pairs;
end;
$$;

-----------------------------------------
-- 5. calculate_mastery RPC function
-- Averages direct SRS retention + weighted prerequisite mastery
-----------------------------------------
create or replace function public.calculate_mastery(
  p_concept_id uuid,
  p_user_id uuid
)
returns float
language plpgsql
security definer
as $$
declare
  direct_retention float;
  prereq_mastery float;
  prereq_count int;
  concept_record record;
begin
  -- Get concept with prerequisites
  select * into concept_record 
  from public.aiml_concepts 
  where id = p_concept_id and user_id = p_user_id;
  
  if concept_record is null then
    return 0;
  end if;

  -- Calculate direct retention from SRS cards linked to this concept
  select coalesce(avg(
    case 
      when stability = 0 then 1.0
      else power(1 + (extract(epoch from (now() - due)) / 86400.0) / (9 * stability), -1)
    end
  ), 0) into direct_retention
  from public.srs_cards
  where source_id = p_concept_id 
    and user_id = p_user_id
    and source_type = 'aiml_concept';

  -- If no prerequisites, return direct retention
  if concept_record.mastery_score is not null and concept_record.mastery_score > 0 then
    direct_retention := greatest(direct_retention, concept_record.mastery_score);
  end if;

  -- Cascade mastery is 70% direct + 30% prerequisite average
  -- (prerequisites stored as uuid[] in aiml_concepts, not implemented in current schema)
  -- For now, return the direct retention as mastery
  return least(direct_retention, 1.0);
end;
$$;
