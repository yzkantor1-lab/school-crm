-- School public website builder tables

create table site_settings (
  key text primary key,
  value text not null default ''
);

insert into site_settings (key, value) values
  ('school_name', 'Our School'),
  ('school_tagline', 'Excellence in Education'),
  ('school_email', ''),
  ('school_phone', ''),
  ('school_address', ''),
  ('logo_url', '');

create table site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  meta_description text not null default '',
  published boolean not null default false,
  is_homepage boolean not null default false,
  show_in_nav boolean not null default true,
  nav_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table site_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references site_pages(id) on delete cascade,
  type text not null,
  order_index integer not null default 0,
  content jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default homepage
insert into site_pages (slug, title, published, is_homepage, show_in_nav, nav_order)
values ('home', 'Home', true, true, false, 0);

insert into site_blocks (page_id, type, order_index, content)
select id, 'hero', 0, '{
  "headline": "Welcome to Our School",
  "subheadline": "Nurturing minds, building futures. A place where every student thrives.",
  "buttonLabel": "Learn More",
  "buttonLink": "/about",
  "bgColor": "#1e3a5f",
  "textColor": "#ffffff",
  "imageUrl": ""
}'::jsonb
from site_pages where slug = 'home';

insert into site_blocks (page_id, type, order_index, content)
select id, 'card_grid', 1, '{
  "columns": 3,
  "cards": [
    {"title": "Academic Excellence", "description": "Our rigorous curriculum prepares students for success in higher education and beyond.", "image": "", "link": "", "linkLabel": ""},
    {"title": "Community & Values", "description": "We foster a welcoming environment built on respect, integrity, and collaboration.", "image": "", "link": "", "linkLabel": ""},
    {"title": "Enriching Activities", "description": "From sports to the arts, students discover their passions and develop lifelong skills.", "image": "", "link": "", "linkLabel": ""}
  ]
}'::jsonb
from site_pages where slug = 'home';
