/* Parâmetros editáveis pelo MASTER da central (contrato v1.1 — "settings" no manifesto).
   Sistema: valem para todas as empresas (tabela system_settings). Empresa: configuração de cada empresa (companies.settings).
   Cada campo: { key, label, type: boolean|number|text|textarea|select, group, help?, options?, min?, max?, step?, unit? } */
import { q, bad } from './core.js';
import { validatePdvLayer } from './pdv.js';

const MODE_OPTIONS = [
  { value: 'manual', label: 'Manual (toque/busca)' },
  { value: 'continua', label: 'Leitura contínua' },
  { value: 'dupla', label: 'Dupla leitura (comanda → produto)' },
];
const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife',
  'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((v) => ({ value: v, label: v.replace('America/', '').replace('_', ' ') }));

export const SYSTEM_FIELDS = [
  { key: 'signup_enabled', label: 'Novos cadastros abertos', type: 'boolean', group: 'Cadastro e demonstração', default: true,
    help: 'Desligado, a tela "Criar conta" do RUSTEN fica fechada (empresas existentes seguem normalmente).' },
  { key: 'demo_enabled', label: 'Botão "Experimentar demonstração" no login', type: 'boolean', group: 'Cadastro e demonstração', default: true },
  { key: 'demo_days', label: 'Dias até apagar demonstrações não ativadas', type: 'number', group: 'Cadastro e demonstração', min: 1, max: 30, step: 1, unit: 'dias', default: 7 },
  { key: 'default_mode', label: 'Modo do PDV em empresas novas', type: 'select', group: 'Padrões de empresas novas', options: MODE_OPTIONS, default: 'manual' },
  { key: 'default_service_fee', label: 'Taxa de serviço padrão', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 30, step: 0.5, unit: '%', default: 10 },
  { key: 'default_tables', label: 'Mesas criadas no cadastro', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 300, step: 1, default: 10 },
  { key: 'default_cards', label: 'Cartões de comanda criados no cadastro', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 2000, step: 1, default: 50 },
  { key: 'default_day_cutoff', label: 'Virada do dia comercial', type: 'number', group: 'Padrões de empresas novas', min: 0, max: 12, step: 1, unit: 'h', default: 5,
    help: 'Vendas antes deste horário contam no dia anterior.' },
  { key: 'notice_text', label: 'Aviso para todos os usuários', type: 'textarea', group: 'Comunicação', max: 300, default: '',
    help: 'Exibido no topo do RUSTEN para todas as empresas. Deixe vazio para não mostrar.' },
  { key: 'notice_level', label: 'Tipo do aviso', type: 'select', group: 'Comunicação', default: 'info',
    options: [{ value: 'info', label: 'Informativo' }, { value: 'warn', label: 'Atenção' }] },
];

export const TENANT_FIELDS = [
  { key: 'name', label: 'Nome da empresa', type: 'text', group: 'Empresa', max: 120 },
  { key: 'timezone', label: 'Fuso horário', type: 'select', group: 'Empresa', options: TIMEZONES },
  { key: 'pdv_mode', label: 'Modo padrão do PDV', type: 'select', group: 'PDV e leitor', options: MODE_OPTIONS },
  { key: 'pdv_scanner_enabled', label: 'Leitor de código habilitado', type: 'boolean', group: 'PDV e leitor' },
  { key: 'pdv_double_read_mandatory', label: 'Dupla leitura obrigatória', type: 'boolean', group: 'PDV e leitor',
    help: 'Exige ler a comanda e depois o produto em cada item; só exceção autorizada sai dela.' },
  { key: 'pdv_allow_manual', label: 'Permitir lançamento manual', type: 'boolean', group: 'PDV e leitor' },
  { key: 'pdv_exception_requires_manager', label: 'Exceção à dupla leitura exige gerente', type: 'boolean', group: 'PDV e leitor' },
  { key: 'pdv_product_timeout_s', label: 'Tempo para ler o produto após a comanda', type: 'number', group: 'PDV e leitor', min: 3, max: 120, step: 1, unit: 's' },
  { key: 'pdv_require_open_cash', label: 'Exigir caixa aberto para receber', type: 'boolean', group: 'Caixa e cobrança' },
  { key: 'pdv_service_fee', label: 'Taxa de serviço', type: 'number', group: 'Caixa e cobrança', min: 0, max: 30, step: 0.5, unit: '%' },
  { key: 'pdv_card_prefix', label: 'Prefixo dos cartões de comanda', type: 'text', group: 'Caixa e cobrança', max: 8, help: 'Letras maiúsculas, números e hífen.' },
];

const strip = ({ default: _d, ...f }) => f;
export const settingsManifest = () => ({ system: SYSTEM_FIELDS.map(strip), tenant: TENANT_FIELDS });

function coerce(field, v) {
  if (v === null || v === undefined) return undefined;
  switch (field.type) {
    case 'boolean': if (typeof v !== 'boolean') throw bad(`${field.label}: valor inválido`); return v;
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max))
        throw bad(`${field.label}: use um valor entre ${field.min} e ${field.max}`);
      return n;
    }
    case 'select':
      if (!field.options.some((o) => o.value === v)) throw bad(`${field.label}: opção inválida`);
      return v;
    default: {
      const s = String(v).trim();
      if (field.max && s.length > field.max) throw bad(`${field.label}: máximo de ${field.max} caracteres`);
      return s;
    }
  }
}

function pick(fields, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('Envie os parâmetros em "values"');
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw bad(`Parâmetro desconhecido: ${k}`);
    const c = coerce(f, v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

// ---------------- sistema ----------------
let sysCache = { at: 0, v: null };
export async function getSystemParams() {
  if (sysCache.v && Date.now() - sysCache.at < 30000) return sysCache.v;
  const base = Object.fromEntries(SYSTEM_FIELDS.map((f) => [f.key, f.default]));
  try {
    const { rows } = await q('select key, value from system_settings');
    for (const r of rows) if (r.key in base) base[r.key] = r.value;
  } catch { /* tabela ainda não criada */ }
  sysCache = { at: Date.now(), v: base };
  return base;
}

export async function setSystemParams(values) {
  const clean = pick(SYSTEM_FIELDS, values);
  for (const [k, v] of Object.entries(clean)) {
    await q(`insert into system_settings (key, value, updated_at) values ($1, $2::jsonb, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
  }
  sysCache.at = 0;
  return getSystemParams();
}

// ---------------- empresa ----------------
const PDV_MAP = {
  pdv_mode: 'mode', pdv_scanner_enabled: 'scanner_enabled', pdv_double_read_mandatory: 'double_read_mandatory', pdv_allow_manual: 'allow_manual',
  pdv_exception_requires_manager: 'exception_requires_manager', pdv_product_timeout_s: 'product_timeout_s', pdv_require_open_cash: 'require_open_cash',
  pdv_card_prefix: 'card_prefix',
};

export async function getTenantParams(companyId) {
  const { rows } = await q('select name, timezone, settings from companies where id = $1', [companyId]);
  const c = rows[0];
  if (!c) return null;
  const pdv = c.settings?.pdv || {};
  const out = { name: c.name, timezone: c.timezone };
  for (const [k, src] of Object.entries(PDV_MAP)) out[k] = pdv[src] ?? null;
  out.pdv_service_fee = pdv.service_fee_bp != null ? pdv.service_fee_bp / 100 : null;
  return out;
}

export async function setTenantParams(db, companyId, values) {
  const clean = pick(TENANT_FIELDS, values);
  if (clean.pdv_card_prefix != null && !/^[A-Z0-9-]{1,8}$/.test(clean.pdv_card_prefix)) throw bad('Prefixo dos cartões: use letras maiúsculas, números e hífen (até 8)');
  if (clean.name != null && clean.name.length < 2) throw bad('Nome da empresa muito curto');
  const layer = {};
  for (const [k, src] of Object.entries(PDV_MAP)) if (k in clean) layer[src] = clean[k];
  if ('pdv_service_fee' in clean) layer.service_fee_bp = Math.round(clean.pdv_service_fee * 100);
  const cur = (await db.query('select settings from companies where id = $1 for update', [companyId])).rows[0];
  const pdv = { ...(cur?.settings?.pdv || {}), ...layer };
  validatePdvLayer(pdv);
  await db.query(`update companies set name = coalesce($2, name), timezone = coalesce($3, timezone),
                    settings = jsonb_set(settings, '{pdv}', $4::jsonb) where id = $1`,
  [companyId, clean.name ?? null, clean.timezone ?? null, JSON.stringify(pdv)]);
  return clean;
}
