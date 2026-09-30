// Motor do PDV: configuração efetiva, roteador de códigos e regras comuns de lançamento.
import { q, bad, conflict, notFound, forbidden } from './core.js';
import { DEFAULT_PDV } from './catalog.js';

const AND_KEYS = ['scanner_enabled', 'allow_manual', 'allow_manual_exception', 'allow_mode_change', 'open_free_card_on_scan'];
const OR_KEYS = ['double_read_mandatory', 'exception_requires_manager', 'require_open_cash'];
const MIN_KEYS = ['max_qty_per_scan'];

/* Precedência terminal → unidade → empresa. Um nível mais específico pode restringir,
   nunca liberar o que um nível superior negou (flags permissivas usam E; exigências usam OU). */
export function mergePdv(company = {}, unit = {}, terminal = {}) {
  const layers = [DEFAULT_PDV, company || {}, unit || {}, terminal || {}];
  const out = { ...DEFAULT_PDV };
  for (const layer of layers.slice(1)) {
    for (const [k, v] of Object.entries(layer)) {
      if (!(k in DEFAULT_PDV) || v === undefined || v === null) continue;
      if (AND_KEYS.includes(k)) out[k] = out[k] && !!v;
      else if (OR_KEYS.includes(k)) out[k] = out[k] || !!v;
      else if (MIN_KEYS.includes(k)) out[k] = Math.min(out[k], Number(v));
      else out[k] = v;
    }
  }
  if (out.double_read_mandatory) out.mode = 'dupla';
  if (!out.scanner_enabled) out.mode = 'manual';
  // Nunca eliminar todos os meios de lançamento
  if (!out.scanner_enabled && !out.allow_manual) out.allow_manual = true;
  out.qty_per_scan = Math.min(Math.max(1, Number(out.qty_per_scan) || 1), out.max_qty_per_scan);
  return out;
}

export function validatePdvLayer(layer) {
  if (layer.scanner_enabled === false && layer.allow_manual === false)
    throw bad('Configuração eliminaria todos os meios de lançamento: mantenha o leitor ou o lançamento manual.');
  if (layer.mode && !['manual', 'continua', 'dupla'].includes(layer.mode)) throw bad('Modo inválido');
  if (layer.double_read_mandatory && layer.scanner_enabled === false)
    throw bad('Dupla leitura obrigatória exige o leitor habilitado.');
  if (layer.product_timeout_s != null && (layer.product_timeout_s < 3 || layer.product_timeout_s > 120))
    throw bad('Tempo de espera do produto deve ficar entre 3 e 120 segundos');
}

export async function pdvSettings(db, ctx, unitId) {
  const c = await db.query('select settings from companies where id = $1', [ctx.companyId]);
  const u = unitId ? await db.query('select settings from units where id = $1 and company_id = $2', [unitId, ctx.companyId]) : { rows: [] };
  const t = ctx.terminalId ? await db.query('select settings from terminals where id = $1', [ctx.terminalId]) : { rows: [] };
  return mergePdv(c.rows[0]?.settings?.pdv, u.rows[0]?.settings?.pdv, t.rows[0]?.settings?.pdv);
}

export const normalizeCode = (raw) => String(raw ?? '').replace(/[\r\n\t]/g, '').trim();

/* Roteador único de códigos. Classifica dentro da empresa autenticada; reconhecer não autoriza agir. */
export async function resolveCode(db, companyId, raw) {
  const code = normalizeCode(raw);
  if (!code) return { type: 'DESCONHECIDO', code };
  if (code.length > 128) return { type: 'DESCONHECIDO', code: code.slice(0, 128) };
  const { rows } = await db.query(
    'select entity, entity_id from scan_codes where company_id = $1 and code = $2', [companyId, code]);
  if (!rows[0]) return { type: 'DESCONHECIDO', code };
  const { entity, entity_id: id } = rows[0];
  if (entity === 'PRODUTO') {
    const p = await db.query(
      `select p.id, p.name, p.price_cents, p.kind, p.unit, p.active,
              exists(select 1 from modifier_groups g where g.product_id = p.id) as has_options,
              exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as has_required
         from products p where p.id = $1 and p.company_id = $2`, [id, companyId]);
    if (!p.rows[0]) return { type: 'DESCONHECIDO', code };
    return { type: 'PRODUTO', code, product: p.rows[0] };
  }
  if (entity === 'COMANDA') {
    const c = await db.query(
      `select c.id, c.number, c.unit_id, c.status, c.block_reason,
              (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id,
              (select s.status from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_status
         from tab_cards c where c.id = $1 and c.company_id = $2`, [id, companyId]);
    if (!c.rows[0]) return { type: 'DESCONHECIDO', code };
    return { type: 'COMANDA', code, card: c.rows[0] };
  }
  if (entity === 'MESA') {
    const t = await db.query('select id, number, unit_id, status, area from dining_tables where id = $1 and company_id = $2', [id, companyId]);
    if (!t.rows[0]) return { type: 'DESCONHECIDO', code };
    return { type: 'MESA', code, table: t.rows[0] };
  }
  return { type: entity, code, id };
}

export async function registerCode(db, companyId, code, entity, entityId) {
  const c = normalizeCode(code);
  if (!c) throw bad('Código vazio');
  if (c.length > 128) throw bad('Código muito longo');
  const ex = await db.query('select entity, entity_id from scan_codes where company_id = $1 and code = $2', [companyId, c]);
  if (ex.rows[0]) {
    if (ex.rows[0].entity === entity && Number(ex.rows[0].entity_id) === Number(entityId)) return;
    throw conflict(`Código ${c} já está em uso (${ex.rows[0].entity.toLowerCase()} ${ex.rows[0].entity_id}). Cadastros ambíguos não são permitidos.`, 'code_in_use');
  }
  await db.query('insert into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)', [companyId, c, entity, entityId]);
}

export const cardCode = (prefix, unitIdx, number) =>
  `${prefix}${unitIdx > 1 ? `${unitIdx}-` : ''}${String(number).padStart(6, '0')}`;

// Carrega a sessão travada para alteração (bloqueio de linha evita corrida entre terminais)
export async function lockSession(db, companyId, sessionId) {
  const { rows } = await db.query(
    'select * from consumption_sessions where id = $1 and company_id = $2 for update', [sessionId, companyId]);
  if (!rows[0]) throw notFound('Consumo não encontrado');
  return rows[0];
}

export function assertOpen(session) {
  if (session.status !== 'aberta') {
    const map = { em_fechamento: 'em fechamento', encerrada: 'encerrada', cancelada: 'cancelada' };
    throw conflict(`Consumo ${map[session.status] || session.status}: não aceita lançamentos`, 'session_not_open');
  }
}

export function assertUnitScope(ctx, unitId) {
  if (ctx.unitId && Number(ctx.unitId) !== Number(unitId) && ctx.level < 90)
    throw forbidden('Registro de outra unidade');
}

/* Totais de uma sessão: consumo (itens ativos), taxa de serviço discriminada, pagos e saldo. */
export async function sessionTotals(db, sessionId) {
  const s = await db.query('select service_fee_bp from consumption_sessions where id = $1', [sessionId]);
  const it = await db.query(
    `select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from order_items where session_id = $1`, [sessionId]);
  const pay = await db.query(
    `select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1`, [sessionId]);
  const items = Number(it.rows[0].items);
  const serviceFee = Math.round((items * (s.rows[0]?.service_fee_bp || 0)) / 10000);
  const total = items + serviceFee;
  const paid = Number(pay.rows[0].paid);
  return { items, serviceFee, serviceFeeBp: s.rows[0]?.service_fee_bp || 0, total, paid, balance: total - paid };
}
