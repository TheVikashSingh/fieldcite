-- Cited-page enrichment (SPEC M-2): the sponsorship or advertise page found on a cited page.
-- sponsorship_price stays for curators; a price is rarely on the cited page itself.
alter table public.cited_pages add column if not exists sponsorship_url text;
