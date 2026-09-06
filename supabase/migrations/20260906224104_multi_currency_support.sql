-- DIP-2.4 — Multi-Currency Support on Accounts/Budgets
-- Jira: STEW-17 | Epic: STEW-2

-- ── currency reference table ───────────────────────────────────────
create table currency (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name text not null
);

alter table currency enable row level security;
alter table currency force row level security;

create policy currency_read on currency
  for select using (auth.role() = 'authenticated');
-- Deliberately no insert/update/delete policy: currency is static
-- reference data populated once by this migration's own seed rows below
-- (executed with migration privileges, not through the client API) and
-- never mutated by any client role thereafter. See Overview for why this
-- table is exempted from the standard audit-trigger convention.

insert into currency (code, name) values
  ('AED','United Arab Emirates Dirham'),('AFN','Afghan Afghani'),('ALL','Albanian Lek'),
  ('AMD','Armenian Dram'),('ANG','Netherlands Antillean Guilder'),('AOA','Angolan Kwanza'),
  ('ARS','Argentine Peso'),('AUD','Australian Dollar'),('AWG','Aruban Florin'),
  ('AZN','Azerbaijani Manat'),('BAM','Bosnia-Herzegovina Convertible Mark'),('BBD','Barbadian Dollar'),
  ('BDT','Bangladeshi Taka'),('BGN','Bulgarian Lev'),('BHD','Bahraini Dinar'),
  ('BIF','Burundian Franc'),('BMD','Bermudan Dollar'),('BND','Brunei Dollar'),
  ('BOB','Bolivian Boliviano'),('BRL','Brazilian Real'),('BSD','Bahamian Dollar'),
  ('BTN','Bhutanese Ngultrum'),('BWP','Botswanan Pula'),('BYN','Belarusian Ruble'),
  ('BZD','Belize Dollar'),('CAD','Canadian Dollar'),('CDF','Congolese Franc'),
  ('CHF','Swiss Franc'),('CLP','Chilean Peso'),('CNY','Chinese Yuan'),
  ('COP','Colombian Peso'),('CRC','Costa Rican Colon'),('CUP','Cuban Peso'),
  ('CVE','Cape Verdean Escudo'),('CZK','Czech Koruna'),('DJF','Djiboutian Franc'),
  ('DKK','Danish Krone'),('DOP','Dominican Peso'),('DZD','Algerian Dinar'),
  ('EGP','Egyptian Pound'),('ERN','Eritrean Nakfa'),('ETB','Ethiopian Birr'),
  ('EUR','Euro'),('FJD','Fijian Dollar'),('FKP','Falkland Islands Pound'),
  ('GBP','British Pound Sterling'),('GEL','Georgian Lari'),('GHS','Ghanaian Cedi'),
  ('GIP','Gibraltar Pound'),('GMD','Gambian Dalasi'),('GNF','Guinean Franc'),
  ('GTQ','Guatemalan Quetzal'),('GYD','Guyanaese Dollar'),('HKD','Hong Kong Dollar'),
  ('HNL','Honduran Lempira'),('HTG','Haitian Gourde'),('HUF','Hungarian Forint'),
  ('IDR','Indonesian Rupiah'),('ILS','Israeli New Shekel'),('INR','Indian Rupee'),
  ('IQD','Iraqi Dinar'),('IRR','Iranian Rial'),('ISK','Icelandic Krona'),
  ('JMD','Jamaican Dollar'),('JOD','Jordanian Dinar'),('JPY','Japanese Yen'),
  ('KES','Kenyan Shilling'),('KGS','Kyrgystani Som'),('KHR','Cambodian Riel'),
  ('KMF','Comorian Franc'),('KPW','North Korean Won'),('KRW','South Korean Won'),
  ('KWD','Kuwaiti Dinar'),('KYD','Cayman Islands Dollar'),('KZT','Kazakhstani Tenge'),
  ('LAK','Laotian Kip'),('LBP','Lebanese Pound'),('LKR','Sri Lankan Rupee'),
  ('LRD','Liberian Dollar'),('LSL','Lesotho Loti'),('LYD','Libyan Dinar'),
  ('MAD','Moroccan Dirham'),('MDL','Moldovan Leu'),('MGA','Malagasy Ariary'),
  ('MKD','Macedonian Denar'),('MMK','Myanma Kyat'),('MNT','Mongolian Tugrik'),
  ('MOP','Macanese Pataca'),('MRU','Mauritanian Ouguiya'),('MUR','Mauritian Rupee'),
  ('MVR','Maldivian Rufiyaa'),('MWK','Malawian Kwacha'),('MXN','Mexican Peso'),
  ('MYR','Malaysian Ringgit'),('MZN','Mozambican Metical'),('NAD','Namibian Dollar'),
  ('NGN','Nigerian Naira'),('NIO','Nicaraguan Cordoba'),('NOK','Norwegian Krone'),
  ('NPR','Nepalese Rupee'),('NZD','New Zealand Dollar'),('OMR','Omani Rial'),
  ('PAB','Panamanian Balboa'),('PEN','Peruvian Sol'),('PGK','Papua New Guinean Kina'),
  ('PHP','Philippine Peso'),('PKR','Pakistani Rupee'),('PLN','Polish Zloty'),
  ('PYG','Paraguayan Guarani'),('QAR','Qatari Rial'),('RON','Romanian Leu'),
  ('RSD','Serbian Dinar'),('RUB','Russian Ruble'),('RWF','Rwandan Franc'),
  ('SAR','Saudi Riyal'),('SBD','Solomon Islands Dollar'),('SCR','Seychellois Rupee'),
  ('SDG','Sudanese Pound'),('SEK','Swedish Krona'),('SGD','Singapore Dollar'),
  ('SHP','Saint Helena Pound'),('SLE','Sierra Leonean Leone'),('SOS','Somali Shilling'),
  ('SRD','Surinamese Dollar'),('SSP','South Sudanese Pound'),('STN','Sao Tome and Principe Dobra'),
  ('SYP','Syrian Pound'),('SZL','Swazi Lilangeni'),('THB','Thai Baht'),
  ('TJS','Tajikistani Somoni'),('TMT','Turkmenistani Manat'),('TND','Tunisian Dinar'),
  ('TOP','Tongan Paanga'),('TRY','Turkish Lira'),('TTD','Trinidad and Tobago Dollar'),
  ('TWD','New Taiwan Dollar'),('TZS','Tanzanian Shilling'),('UAH','Ukrainian Hryvnia'),
  ('UGX','Ugandan Shilling'),('USD','United States Dollar'),('UYU','Uruguayan Peso'),
  ('UZS','Uzbekistani Som'),('VES','Venezuelan Bolivar Soberano'),('VND','Vietnamese Dong'),
  ('VUV','Vanuatu Vatu'),('WST','Samoan Tala'),('XAF','Central African CFA Franc'),
  ('XCD','East Caribbean Dollar'),('XOF','West African CFA Franc'),('XPF','CFP Franc'),
  ('YER','Yemeni Rial'),('ZAR','South African Rand'),('ZMW','Zambian Kwacha'),
  ('ZWG','Zimbabwe Gold');
-- 154 active, transactable currency codes. Extending this list later (a
-- genuinely missing or newly issued code) is a single additive INSERT,
-- never a schema change or a reason to reopen this DIP.

-- ── account.currency: format-only CHECK -> real closed-set FK ──────
alter table account drop constraint account_currency_check;
alter table account
  add constraint account_currency_fkey foreign key (currency) references currency(code);

create index idx_account_budget_currency on account(budget_id, currency);

-- ── budget.default_currency (Parent-settable UI convenience only) ──
-- Nullable, no default: AC1 already establishes that any budget-level
-- default is a convenience only, never a substitute for the explicit,
-- per-record currency AC1 requires on every account. No new RPC or RLS
-- policy: the existing budget_read_write ALL policy (confirmed live:
-- is_household_parent(household_id) OR can_access_budget(id)) already
-- governs UPDATE on budget; the FK below is what enforces "must be a
-- real currency code."
alter table budget add column default_currency char(3) references currency(code);

-- ── fn_inherit_transaction_currency ────────────────────────────────
-- Defined now (this story's own currency-maintenance concern); NOT
-- attached to `transaction` here -- that table does not exist yet.
-- Story 3.1's DIP attaches this trigger; it must not redefine the
-- function.
create function fn_inherit_transaction_currency() returns trigger
language plpgsql as $$
begin
  select currency into new.currency from account where id = new.account_id;
  return new;
end;
$$;
-- Not exposed as a client-callable RPC endpoint: PostgREST does not
-- expose functions whose return type is `trigger` (no serializable HTTP
-- response shape) -- the same reason fn_audit_log() and
-- fn_apply_transaction_to_balance() carry no explicit anon-revoke. No
-- revoke statement needed for this function specifically.
