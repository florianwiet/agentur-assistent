-- Tabellen

create table clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_email text,
  notes         text,
  created_at    timestamptz not null default now()
);

create table tasks (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete restrict,
  title      text not null,
  due_date   date,
  status     text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);

create table messages (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  role       text not null check (role in ('user', 'assistant', 'tool')),
  content    text not null,
  created_at timestamptz not null default now()
);

-- Indizes für die häufigsten Abfragen

create index tasks_client_status_idx on tasks (client_id, status);
create index messages_user_idx on messages (user_id, id);

-- Row Level Security

alter table clients  enable row level security;
alter table tasks    enable row level security;
alter table messages enable row level security;

-- Testdaten

insert into clients (name, contact_email, notes) values
  ('Bäckerei Huber', 'info@baeckerei-huber.de', 'Social-Media-Betreuung, Instagram und Facebook'),
  ('Autohaus Maier', 'marketing@autohaus-maier.de', 'Google Ads, monatliches Reporting'),
  ('Fitnessstudio Pulse', 'kontakt@pulse-fitness.de', 'Neukunde, Website-Relaunch geplant');

insert into tasks (client_id, title, due_date, status)
select id, 'Instagram-Posts für Oktober planen', date '2026-10-15', 'open'
from clients where name = 'Bäckerei Huber';

insert into tasks (client_id, title, due_date, status)
select id, 'Monatsreport September senden', date '2026-10-05', 'done'
from clients where name = 'Autohaus Maier';

insert into tasks (client_id, title, due_date, status)
select id, 'Kampagne Herbstaktion aufsetzen', date '2026-10-20', 'open'
from clients where name = 'Autohaus Maier';