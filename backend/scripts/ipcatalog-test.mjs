// Teste do leitor do catálogo público da InfinitePay (sem rede: respostas simuladas).
import assert from 'node:assert/strict';
import { fetchCatalog } from '../src/lib/ipcatalog.js';
const H='barteste';
const md=`# Loja: BAR TESTE LTDA

Handle: \`barteste\`

## Summary

x

## Applied Filters

- none

## Categories

- CHOPP e CERVEJA (11-chopp-e-cerveja)
- COZINHA (12-cozinha)
- DRINKS e DOSES (13-drinks-e-doses)

## Human Store Filters

- a

## Catalog

- Chopp Pilsen 300ml - R$ 12,00 - available - https://loja.infinitepay.io/llms/barteste/a1-chopp-pilsen-300ml.md
- Batata - frita G - R$ 1.032,50 - available - https://loja.infinitepay.io/llms/barteste/a2-batata-frita.md
- Caipirinha "limão" - R$ 22,00 - unavailable - https://loja.infinitepay.io/llms/barteste/a3-caipirinha.md

## Cart URL Builder

- x
`;
const prod=(slug,name,price,q=999,sc=false)=>`{\\"path\\":\\"/${H}/${slug}\\",\\"info\\":{\\"sales_product\\":{\\"photo\\":\\"https://x/y?v=1\\\\u0026q=thumbnail\\",\\"name\\":\\"${name}\\",\\"product_type\\":\\"physical\\",\\"duration\\":null,\\"variations\\":[{\\"id\\":1,\\"price\\":${price},\\"promotional_price\\":null,\\"down_payment_price\\":0,\\"quantity\\":${q},\\"stock_control\\":${sc}},{\\"id\\":2,\\"price\\":${price+500},\\"promotional_price\\":null,\\"down_payment_price\\":0,\\"quantity\\":${q},\\"stock_control\\":${sc}}],\\"product_default_variation_index\\":0}}}`;
const page=(items,next)=>`<html><script>self.__next_f.push([1,"[\\"$\\",\\"$L29\\",null,{\\"products\\":[${items.join(',')}],\\"initialMeta\\":{\\"current_page\\":1,\\"next_page\\":${next},\\"prev_page\\":null}}]"])</script><a href="/${H}/a1">x</a></html>`;
const routes={
 [`/llms/${H}.md`]:md,
 [`/${H}`]:page([prod('a1-chopp-pilsen-300ml','Chopp Pilsen 300ml',1200),prod('a2-batata-frita','Batata - frita G',103250)],2),
 [`/${H}?page=2`]:page([prod('a3-caipirinha','Caipirinha \\\\\\"limão\\\\\\"',2200,0,true),prod('a4-agua','Água sem gás',500)],'null'),
 [`/${H}?categories=11-chopp-e-cerveja`]:page([prod('a1-chopp-pilsen-300ml','Chopp Pilsen 300ml',1200)],'null'),
 [`/${H}?categories=12-cozinha`]:page([prod('a2-batata-frita','Batata - frita G',103250)],'null'),
};
const f=async(url)=>{const u=new URL(url);const k=u.pathname+u.search;const t=routes[k];return t==null?{status:404,ok:false,text:async()=>''}:{status:200,ok:true,text:async()=>t};};
const r=await fetchCatalog(H,f);
assert.equal(r.store, 'BAR TESTE LTDA');
assert.deepEqual(r.categories.map((c) => c.name), ['CHOPP e CERVEJA', 'COZINHA', 'DRINKS e DOSES']);
const by = Object.fromEntries(r.products.map((p) => [p.slug, p]));
assert.equal(by['a2-batata-frita'].name, 'Batata - frita G'); assert.equal(by['a2-batata-frita'].price_cents, 103250); assert.equal(by['a2-batata-frita'].category, 'COZINHA');
assert.equal(by['a3-caipirinha'].available, false); assert.equal(by['a3-caipirinha'].name, 'Caipirinha "limão"');
assert.equal(by['a4-agua'].name, 'Água sem gás'); assert.equal(by['a1-chopp-pilsen-300ml'].variations, 2);
assert.equal(await fetchCatalog('naoexiste', f), null);
console.log('ipcatalog: OK');
