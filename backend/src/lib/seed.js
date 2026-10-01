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
  let age = 4;
  const kitchenAge = () => { age = age === 4 ? 9 : age === 9 ? 18 : 4; return age; };
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
                                  kitchen_status, launch_mode, user_id, idempotency_key, created_at, sent_at, accepted_at, ready_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11, now() - interval '${kitchenAge()} minutes',
                 case when $9 <> 'nao_produz' then now() - interval '${kitchenAge()} minutes' end,
                 case when $9 in ('aceito','preparando','pronto','entregue') then now() - interval '8 minutes' end,
                 case when $9 in ('pronto','entregue') then now() - interval '3 minutes' end)`,
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
  await seedDemoModules(db, companyId, unitId, userId, closed.id);
}

/* Módulos na demonstração: clientes com fidelidade, estoque com fichas técnicas, cardápio digital com um pedido,
   avaliação e reservas — o visitante vê cada tela funcionando. */
async function seedDemoModules(db, companyId, unitId, userId, closedId) {
  const settings = {
    loyalty: { enabled: true, cents_per_point: 100, point_value_cents: 5, validity_days: 365, min_redeem: 100 },
    delivery: { enabled: true, accepting: true, delivery: true, pickup: true, fee_cents: 700, min_order_cents: 3000, eta_minutes: 40,
      hours: 'Ter a dom, 18h às 0h', areas: 'Centro, Vila Nova e Jardim', payment_methods: ['dinheiro', 'pix', 'cartao'], message: 'Chope em dobro até as 20h!' },
    agent: { enabled: false, name: 'Rústica', greeting: 'Olá! Sou a Rústica, atendente virtual do bar. Posso mostrar o *cardápio*, informar *horário*, montar seu *pedido*, ver o *status* ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.',
      handoff_message: 'Certo! Vou chamar alguém da equipe para continuar com você.', closed_message: 'No momento não estamos recebendo pedidos.', reservation_max_people: 12, reservation_min_hours: 2 },
  };
  await db.query(`update companies set slug = $2, settings = settings || $3::jsonb where id = $1`, [companyId, `demo-${companyId}`, JSON.stringify(settings)]);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const cust = {};
  for (const [name, cpf, phone, bday, tags, consent, pts] of [
    ['Ana Souza', '52998224725', '11988887777', '1990-03-12', ['vip', 'chope'], true, 120],
    ['Bruno Lima', '39053344705', '11977776666', `1987-${month}-21`, ['aniversário'], true, 0],
    ['Carla Dias', null, '11966665555', '1995-08-02', [], false, 0],
  ]) {
    const r = await db.query(`insert into customers (company_id, cpf, name, phone, birthday, tags, consent_whatsapp, consent_at, created_by)
      values ($1,$2,$3,$4,$5,$6,$7, case when $7 then now() end, $8) returning id`, [companyId, cpf, name, phone, bday, tags, consent, userId]);
    cust[name] = r.rows[0].id;
    if (pts) {
      await db.query(`insert into loyalty_ledger (company_id, customer_id, kind, points, expires_at, reason, user_id) values ($1,$2,'ganho',$3, current_date + 365, 'Consumos anteriores', $4)`, [companyId, r.rows[0].id, pts, userId]);
      await db.query('update customers set points = $2 where id = $1', [r.rows[0].id, pts]);
    }
  }
  await db.query('update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1', [closedId, cust['Bruno Lima'], 'Bruno Lima']);
  const mesa = (await db.query("select id from consumption_sessions where company_id = $1 and kind = 'mesa' limit 1", [companyId])).rows[0];
  if (mesa) await db.query('update consumption_sessions set customer_id = $2, customer_name = $3 where id = $1', [mesa.id, cust['Ana Souza'], 'Ana Souza']);
  await db.query('insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,5,$4)', [companyId, closedId, cust['Bruno Lima'], 'Chope gelado e atendimento rápido!']);

  const stock = {};
  for (const [name, unit, qty, cost, min] of [['Carne moída', 'kg', 8, 3200, 2], ['Pão brioche', 'un', 40, 150, 12], ['Batata congelada', 'kg', 12, 900, 4],
    ['Pilsen long neck (garrafa)', 'un', 48, 450, 24], ['Chope (barril)', 'L', 30, 1200, 10], ['Limão', 'kg', 1.5, 600, 3], ['Cachaça', 'L', 4, 2500, 1]]) {
    const r = await db.query('insert into stock_items (company_id, name, unit, min_qty, reorder_qty, avg_cost_cents) values ($1,$2,$3,$4,$5,$6) returning id', [companyId, name, unit, min, min * 3, cost]);
    stock[name] = r.rows[0].id;
    await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, reason, user_id) values ($1,$2,'entrada',$3,$4,'saldo_inicial','Saldo inicial',$5)`,
      [companyId, r.rows[0].id, qty, cost, userId]);
  }
  const prods = Object.fromEntries((await db.query('select id, name from products where company_id = $1', [companyId])).rows.map((p) => [p.name, p.id]));
  for (const [prod, lines, cost] of [['Hambúrguer da oficina', [['Carne moída', 0.18], ['Pão brioche', 1]], 726], ['Porção de fritas', [['Batata congelada', 0.4]], 360],
    ['Chope 300 ml', [['Chope (barril)', 0.3]], 360], ['Caipirinha', [['Limão', 0.12], ['Cachaça', 0.06]], 222]]) {
    if (!prods[prod]) continue;
    const r = await db.query('insert into recipes (company_id, product_id, version, yield_qty, created_by) values ($1,$2,1,1,$3) returning id', [companyId, prods[prod], userId]);
    for (const [it, q] of lines) await db.query('insert into recipe_lines (company_id, recipe_id, stock_item_id, qty) values ($1,$2,$3,$4)', [companyId, r.rows[0].id, stock[it], q]);
    await db.query("update products set stock_mode = 'ficha', cost_cents = $2 where id = $1", [prods[prod], cost]);
  }
  if (prods['Pilsen long neck']) await db.query("update products set stock_mode = 'acabado', stock_item_id = $2, cost_cents = 450 where id = $1", [prods['Pilsen long neck'], stock['Pilsen long neck (garrafa)']]);

  // reservas de hoje à noite (uma pedida pelo agente, aguardando confirmação)
  for (const [name, phone, people, hour, status, source] of [['Diego Martins', '11955554444', 6, 21, 'confirmada', 'equipe'], ['Fernanda Alves', '11944443333', 4, 22, 'pendente', 'agente']]) {
    await db.query(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source)
      values ($1,$2,$3,$4,$5, date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' + make_interval(hours => $6), $7, $8)`,
    [companyId, unitId, name, phone, people, hour, status, source]);
  }
}
