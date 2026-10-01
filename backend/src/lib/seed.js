// Configuração inicial da empresa: unidade, terminal, setores, mesas, cartões e (opcional) cardápio de demonstração.
import { registerCode, cardCode } from './pdv.js';

export async function seedCompany(db, companyId, setup = {}) {
  const u = await db.query('insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id',
    [companyId, setup.unit_name || 'Matriz', setup.day_cutoff ?? 5]);
  const unitId = u.rows[0].id;
  await db.query('insert into terminals (company_id, unit_id, name) values ($1,$2,$3)', [companyId, unitId, 'Caixa 1']);
  const sectors = {};
  for (const name of ['Cozinha', 'Bar', 'Copa']) {
    const s = await db.query('insert into production_sectors (company_id, name) values ($1,$2) returning id', [companyId, name]);
    sectors[name] = s.rows[0].id;
  }
  await createTables(db, companyId, unitId, 1, setup.tables ?? 10);
  await createCards(db, companyId, unitId, 1, setup.cards ?? 50);
  if (setup.demo) await seedDemo(db, companyId, sectors);
  return { unitId, sectors };
}

export async function createTables(db, companyId, unitId, from, count) {
  const created = [];
  for (let n = from; n < from + count; n++) {
    const t = await db.query(
      `insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,
      [companyId, unitId, n, (n - 1) % 6, Math.floor((n - 1) / 6)]);
    if (t.rows[0]) {
      await registerCode(db, companyId, `MESA-${String(unitId).padStart(2, '0')}-${String(n).padStart(3, '0')}`, 'MESA', t.rows[0].id);
      created.push(t.rows[0].id);
    }
  }
  return created;
}

export async function createCards(db, companyId, unitId, from, count, prefix = 'CMD-') {
  const idx = (await db.query('select count(*)::int as n from units where company_id = $1 and id <= $2', [companyId, unitId])).rows[0].n;
  const created = [];
  for (let n = from; n < from + count; n++) {
    const c = await db.query(
      'insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number',
      [companyId, unitId, n]);
    if (c.rows[0]) {
      const code = cardCode(prefix, idx, n);
      await registerCode(db, companyId, code, 'COMANDA', c.rows[0].id);
      created.push({ ...c.rows[0], code });
    }
  }
  return created;
}

const DEMO = [
  ['Cervejas', 'Bar', [['Cerveja IPA 600 ml', 2890, '7890000000011'], ['Pilsen long neck', 1290, '7890000000028'], ['Chope 300 ml', 1190, null]]],
  ['Drinks', 'Bar', [['Caipirinha', 2400, null], ['Gin tônica', 3200, null]]],
  ['Lanches', 'Cozinha', [['Hambúrguer da oficina', 3890, null], ['Porção de fritas', 2690, null]]],
  ['Sem álcool', 'Bar', [['Refrigerante lata', 700, '7890000000035'], ['Água mineral', 500, '7890000000042']]],
];

async function seedDemo(db, companyId, sectors) {
  let sort = 0;
  for (const [cat, sector, items] of DEMO) {
    const c = await db.query('insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id', [companyId, `${cat} (demonstração)`, sort++]);
    for (const [name, price, ean] of items) {
      const p = await db.query(
        `insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite, channels)
         values ($1,$2,$3,$4,$5,$6,true,$7,'{pdv,delivery,cardapio_digital}') returning id`,
        [companyId, c.rows[0].id, sectors[sector], name, price, sector === 'Cozinha' ? 'recipe' : 'resale', sort === 1]);
      if (ean) await registerCode(db, companyId, ean, 'PRODUTO', p.rows[0].id);
      if (name.startsWith('Hambúrguer')) {
        const g = await db.query(`insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da carne',1,1) returning id`, [companyId, p.rows[0].id]);
        for (const o of ['Mal passado', 'Ao ponto', 'Bem passado'])
          await db.query('insert into modifier_options (company_id, group_id, name) values ($1,$2,$3)', [companyId, g.rows[0].id, o]);
        const g2 = await db.query(`insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id`, [companyId, p.rows[0].id]);
        for (const [o, v] of [['Bacon', 600], ['Queijo extra', 400], ['Ovo', 300]])
          await db.query('insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)', [companyId, g2.rows[0].id, o, v]);
      }
    }
  }
}

/* Movimento de exemplo da demonstração: mesa ocupada, comandas abertas com itens (um já pronto na cozinha)
   e um consumo encerrado e pago hoje — para o visitante ver salão, PDV e início com dados. */
export async function seedDemoActivity(db, companyId, unitId, userId, businessDate) {
  const prod = Object.fromEntries((await db.query('select id, name, price_cents, sector_id from products where company_id = $1', [companyId]))
    .rows.map((p) => [p.name, p]));
  const table = (await db.query('select id from dining_tables where company_id = $1 and number = 3', [companyId])).rows[0];
  const cards = (await db.query('select id from tab_cards where company_id = $1 order by number limit 3', [companyId])).rows;
  let seq = 0;
  async function open(kind, { tableId = null, cardId = null, label = null }, items, status = 'aberta') {
    const s = (await db.query(
      `insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, label, status, service_fee_bp, opened_by, business_date,
                                         opened_at, closed_at, closed_by)
       values ($1,$2,$3,$4,$5,$6,$7,1000,$8,$9, now() - interval '90 minutes', case when $7 = 'encerrada' then now() - interval '20 minutes' end,
               case when $7 = 'encerrada' then $8::bigint end) returning id`,
      [companyId, unitId, kind, cardId, tableId, label, status, userId, businessDate])).rows[0].id;
    let total = 0;
    for (const [name, qty, ks] of items) {
      const p = prod[name];
      if (!p) continue;
      const t = p.price_cents * qty;
      total += t;
      await db.query(
        `insert into order_items (company_id, session_id, product_id, description, qty, unit_price_cents, total_cents, sector_id,
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '60 minutes')`,
        [companyId, s, p.id, p.name, qty, p.price_cents, t, p.sector_id, ks, userId, `demo-${s}-${++seq}`]);
    }
    return { id: s, total };
  }
  if (table) {
    await open('mesa', { tableId: table.id, label: 'Mesa 3' },
      [['Hambúrguer da oficina', 2, 'preparando'], ['Porção de fritas', 1, 'pronto'], ['Chope 300 ml', 4, 'entregue']]);
    await db.query("update dining_tables set status = 'ocupada' where id = $1", [table.id]);
  }
  if (cards[0]) await open('comanda', { cardId: cards[0].id }, [['Cerveja IPA 600 ml', 2, 'nao_produz'], ['Caipirinha', 1, 'novo']]);
  if (cards[1]) await open('comanda', { cardId: cards[1].id }, [['Gin tônica', 2, 'entregue'], ['Água mineral', 1, 'nao_produz']]);
  const closed = await open('balcao', { label: 'Balcão' }, [['Pilsen long neck', 3, 'nao_produz'], ['Porção de fritas', 1, 'entregue']], 'encerrada');
  const withFee = closed.total + Math.round(closed.total * 0.1);
  await db.query(
    `insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_id, created_at)
     values ($1,$2,'pix',$3,$4,$5,$6, now() - interval '20 minutes')`,
    [companyId, closed.id, withFee, businessDate, `demo-pay-${closed.id}`, userId]);
}
