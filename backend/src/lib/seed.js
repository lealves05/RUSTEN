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
        `insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite)
         values ($1,$2,$3,$4,$5,$6,true,$7) returning id`,
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
