// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.
globalThis.__RUSTEN_ENV_DEFAULTS__={EDGE_RUNTIME:"1",NODE_ENV:"production",DB_SCHEMA:"rusten",DB_POOL_MAX:"3",PATH_PREFIX:"/rusten-api",CORS_ORIGINS:"*"};import fa from"npm:express@5.2.1";import kt from"npm:express@5.2.1";import la from"npm:helmet@8.3.0";import pa from"npm:cors@2.8.6";import _a from"node:path";import{fileURLToPath as ya}from"node:url";import ge from"npm:pg@8.23.1";import Oe from"node:crypto";import{Buffer as Ye}from"node:buffer";var St=globalThis.__RUSTEN_ENV_DEFAULTS__||{},j=new Proxy({},{get:(e,n)=>{let t=typeof process<"u"?process.env[n]:void 0;return t!==void 0&&t!==""?t:St[n]}});ge.types.setTypeParser(20,e=>Number(e));ge.types.setTypeParser(1700,e=>Number(e));ge.types.setTypeParser(1082,e=>e);var Ct=e=>/localhost|127\.0\.0\.1|\/tmp/.test(e||""),ze=j.DATABASE_URL||
j.SUPABASE_DB_URL,se=new ge.Pool({connectionString:ze,ssl:ze&&!Ct(ze)?{rejectUnauthorized:!1}:void 0,max:Number(j.DB_POOL_MAX||10)}),Ne=j.DB_SCHEMA;if(Ne){if(!/^[a-z_][a-z0-9_]*$/.
test(Ne))throw new Error("DB_SCHEMA inv\xE1lido");se.on("connect",e=>{e.query(`set search_path to ${Ne}, public`).catch(()=>{})})}var c=(e,n)=>se.query(e,n);async function k(e){let n=await se.
connect();try{await n.query("begin");let t=await e(n);return await n.query("commit"),t}catch(t){throw await n.query("rollback").catch(()=>{}),t}finally{n.release()}}var v=class extends Error{constructor(n,t,a,o){
super(t),this.status=n,this.code=a,this.extra=o}},_=(e,n="invalid")=>new v(400,e,n),S=(e="Sem permiss\xE3o para esta a\xE7\xE3o",n="forbidden")=>new v(403,e,n),I=(e="N\xE3o encontrado")=>new v(
404,e,"not_found"),g=(e,n="conflict",t)=>new v(409,e,n,t);function h(e,n){let t=e.safeParse(n??{});if(!t.success){let a=t.error.issues[0];throw _(`${a.path.join(".")||"dados"}: ${a.
message}`)}return t.data}var d=e=>(n,t,a)=>Promise.resolve(e(n,t,a)).catch(a);function De(e,n,t=0,a=0){let o=Math.round(Number(n)*1e3),s=Math.round((e+t)*o/1e3);return Math.max(0,s-
a)}function We(e,n){let t=Math.floor(e/n),a=e-t*n;return Array.from({length:n},(o,s)=>t+(s<a?1:0))}function W(e,n="America/Sao_Paulo",t=5){let a=new Intl.DateTimeFormat("en-CA",{timeZone:n,
year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(e),o=i=>a.find(r=>r.type===i).value,s=new Date(Date.UTC(+o("year"),+o("month")-1,+o("day")));
return+o("hour")<t&&(s=new Date(s.getTime()-864e5)),s.toISOString().slice(0,10)}var M=e=>Oe.createHash("sha256").update(String(e)).digest("hex"),V=(e=32)=>Oe.randomBytes(e).toString(
"base64url");function Ze(e,n){let t=Ye.from(String(e)),a=Ye.from(String(n));return t.length===a.length&&Oe.timingSafeEqual(t,a)}function Xe(e){let n=e==null?"":String(e);return/^[=+\-@\t\r]/.
test(n)&&(n=`'${n}`),/[";\n]/.test(n)?`"${n.replace(/"/g,'""')}"`:n}import Et from"node:crypto";import{Buffer as zt}from"node:buffer";import at from"npm:jsonwebtoken@9.0.3";var Z={"pdv.lancar":"Lan\xE7ar itens","pdv.lancamento_manual":"Lan\xE7amento manual (busca, cat\xE1logo, c\xF3digo digitado)","pdv.alterar_modo":"Trocar modo de leitura no PDV","pd\
v.excecao_dupla_leitura":"Exce\xE7\xE3o manual na dupla leitura obrigat\xF3ria","pdv.autorizar":"Autorizar opera\xE7\xF5es de outros usu\xE1rios (gerente)","pdv.abrir_comanda":"Abr\
ir comanda/mesa/balc\xE3o","pdv.alterar_quantidade":"Alterar quantidade na leitura","pdv.alterar_preco":"Alterar pre\xE7o do item","pdv.desconto":"Conceder desconto","pdv.cancelar_\
item":"Cancelar item","pdv.cancelar_venda":"Cancelar consumo inteiro","pdv.transferir_item":"Transferir itens e consumos","pdv.reabrir_comanda":"Reabrir consumo encerrado","pdv.rec\
eber":"Receber pagamentos","pdv.taxa_servico":"Ajustar/remover taxa de servi\xE7o","caixa.abrir":"Abrir caixa","caixa.fechar":"Fechar caixa","caixa.sangria":"Sangria e despesa de c\
aixa","caixa.suprimento":"Suprimento","caixa.reabrir":"Reabrir caixa","financeiro.visualizar":"Ver dados financeiros","financeiro.estornar":"Estornar pagamentos","salao.visualizar":"\
Ver sal\xE3o e mesas","salao.gerenciar":"Cadastrar mesas e mudar situa\xE7\xE3o","cardapio.visualizar":"Ver card\xE1pio","cardapio.gerenciar":"Cadastrar produtos, pre\xE7os e c\xF3digos",
"comandas.gerenciar":"Gerar, bloquear e substituir cart\xF5es de comanda","estoque.ajustar":"Ajustar estoque","relatorios.visualizar":"Ver relat\xF3rios","relatorios.cmv":"Ver CMV \
e margem","usuarios.gerenciar":"Gerenciar usu\xE1rios e perfis","configuracoes.gerenciar":"Alterar configura\xE7\xF5es","assinatura.gerenciar":"Gerenciar assinatura","auditoria.vis\
ualizar":"Ver auditoria","dados.pessoais":"Ver dados pessoais de clientes"},et=Object.keys(Z),Qe=(...e)=>et.filter(n=>!e.includes(n)),tt=[{key:"owner",name:"Propriet\xE1rio",level:100,
permissions:et},{key:"admin",name:"Administrador",level:90,permissions:Qe("assinatura.gerenciar")},{key:"gerente",name:"Gerente",level:70,permissions:Qe("assinatura.gerenciar","usu\
arios.gerenciar","configuracoes.gerenciar")},{key:"caixa",name:"Caixa",level:40,permissions:["pdv.lancar","pdv.lancamento_manual","pdv.abrir_comanda","pdv.receber","caixa.abrir","c\
aixa.fechar","caixa.sangria","caixa.suprimento","salao.visualizar","cardapio.visualizar"]},{key:"garcom",name:"Gar\xE7om",level:30,permissions:["pdv.lancar","pdv.lancamento_manual",
"pdv.abrir_comanda","salao.visualizar","cardapio.visualizar"]},{key:"cozinha",name:"Cozinha",level:20,permissions:["cardapio.visualizar"]},{key:"bar",name:"Bar",level:20,permissions:[
"cardapio.visualizar","pdv.lancar"]},{key:"estoque",name:"Estoque",level:30,permissions:["estoque.ajustar","cardapio.visualizar","relatorios.cmv"]},{key:"financeiro",name:"Financei\
ro",level:50,permissions:["financeiro.visualizar","financeiro.estornar","relatorios.visualizar","relatorios.cmv","caixa.reabrir","auditoria.visualizar"]},{key:"entregador",name:"En\
tregador",level:10,permissions:[]},{key:"consulta",name:"Consulta",level:5,permissions:["salao.visualizar","cardapio.visualizar","relatorios.visualizar"]}],re={pdv:"PDV e comandas",
salao:"Sal\xE3o, mesas e reservas",cozinha:"Cozinha, bar e KDS",delivery:"Delivery e card\xE1pio digital",cardapio:"Card\xE1pio",estoque:"Estoque, compras e fichas t\xE9cnicas",clientes:"\
Clientes e fidelidade",financeiro:"Caixa e financeiro",relatorios:"Relat\xF3rios",marketing:"Marketing",agente:"Agente WhatsApp",fiscal:"Fiscal",infinitepay:"Importa\xE7\xE3o e concilia\xE7\
\xE3o InfinitePay"},$e={scanner_enabled:!0,mode:"manual",double_read_mandatory:!1,allow_manual:!0,allow_manual_exception:!0,exception_requires_manager:!0,allow_mode_change:!0,product_timeout_s:15,
open_free_card_on_scan:!1,feedback_sound:!0,qty_per_scan:1,max_qty_per_scan:20,terminator:"Enter",kitchen_send:"imediato",require_open_cash:!0,service_fee_bp:1e3,card_prefix:"CMD-"};var Nt=j.NODE_ENV==="production",nt=j.JWT_SECRET||j.SUPABASE_SERVICE_ROLE_KEY||(Nt?null:"dev-only-rusten-secret-not-for-production");if(!nt)throw new Error("JWT_SECRET \xE9 obrigat\xF3ri\
o em produ\xE7\xE3o");var Ot=e=>zt.from(Et.hkdfSync("sha256",nt,"rusten",e,32)),ot=Ot("access-token"),Dt=12*3600,it=30;function Re(e,n){return at.sign({sub:String(e.id),cid:String(
e.company_id),sid:n},ot,{expiresIn:Dt,algorithm:"HS256"})}async function st(e,n){let{rows:t}=await c(`select u.id, u.company_id, u.unit_id, u.name, u.email, u.role_key, u.active, u\
.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,[e,n]);return t[0]}function G(){return async(e,n,t)=>{try{let a=e.headers.authorization||"",o=a.startsWith("Bearer ")?a.slice(7):null;if(!o)
throw new v(401,"Sess\xE3o expirada. Entre novamente.","unauthenticated");let s;try{s=at.verify(o,ot,{algorithms:["HS256"]})}catch{throw new v(401,"Sess\xE3o expirada. Entre novamente\
.","unauthenticated")}let i=await st(Number(s.sub),Number(s.cid));if(!i||!i.active)throw new v(401,"Usu\xE1rio inativo","unauthenticated");let r=await c("select revoked_at from use\
r_sessions where id = $1 and user_id = $2",[s.sid,i.id]);if(!r.rows[0]||r.rows[0].revoked_at)throw new v(401,"Sess\xE3o encerrada","unauthenticated");if(s.iat*1e3<new Date(i.password_changed_at).
getTime()-1e3)throw new v(401,"Senha alterada. Entre novamente.","unauthenticated");let u={userId:i.id,companyId:i.company_id,unitId:i.unit_id,name:i.name,email:i.email,role:i.role_key,
roleName:i.role_name,level:i.level,perms:new Set(i.permissions),company:{id:i.company_id,name:i.company_name,segment:i.segment,timezone:i.timezone,settings:i.settings},access:rt(i.
access,i.access_updated_at),sessionId:s.sid,terminalId:null},f=Number(e.headers["x-terminal-id"]);if(f){let y=await c("select id, unit_id from terminals where id = $1 and company_i\
d = $2 and active",[f,u.companyId]);y.rows[0]&&(u.terminalId=y.rows[0].id,u.terminalUnitId=y.rows[0].unit_id)}u.can=y=>u.perms.has(y),e.ctx=u,t()}catch(a){t(a)}}}var p=(...e)=>(n,t,a)=>{
let o=e.find(s=>!n.ctx.can(s));if(o)return a(S(`Sem permiss\xE3o: ${o}`));a()};function J(e,n){if(!e.can(n))throw S(`Sem permiss\xE3o: ${n}`)}async function w(e,n,t,{entity:a,entityId:o,
reason:s,data:i,unitId:r}={}){await e.query(`insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[n.companyId,r??n.terminalUnitId??n.unitId??null,n.terminalId??null,n.userId??null,t,a??null,o!=null?String(o):null,s??null,Ae(i??{})])}var At=/pass|senha|token|secret|segredo|hash|card_number|cvv/i;
function Ae(e){return Array.isArray(e)?e.map(Ae):e&&typeof e=="object"?Object.fromEntries(Object.entries(e).map(([n,t])=>[n,At.test(n)?"[omitido]":Ae(t)])):e}function rt(e,n,t=new Date){
let a=e||{},o=Object.keys(re);if(!Object.keys(a).length)return{allowed:!0,state:"sem_central",modules:o,warning:null,managed:!1};let i={modules:Array.isArray(a.modules)&&a.modules.
length?a.modules:o,plan:a.plan??null,managed:!0,updatedAt:n,support:a.support??null},r=u=>u==="indefinido"||u&&new Date(u)>t;return a.admin_block?.active||a.blocked===!0?{...i,allowed:!1,
state:"bloqueio_administrativo",reason:a.admin_block?.reason||a.block_reason||"Acesso bloqueado pela administra\xE7\xE3o"}:r(a.manual_release_until)?{...i,allowed:!0,state:"liberac\
ao_manual",warning:a.warning??null}:r(a.paid_until)?{...i,allowed:!0,state:"ativa",warning:a.warning??null}:a.trial_ends_at==="ilimitado"||r(a.trial_ends_at)?{...i,allowed:!0,state:"\
teste",trialEndsAt:a.trial_ends_at,warning:a.warning??null}:a.grace_until&&r(a.grace_until)?{...i,allowed:!0,state:"carencia",graceUntil:a.grace_until,warning:a.warning||`Pagamento\
 pendente. O acesso ser\xE1 bloqueado em ${new Date(a.grace_until).toLocaleDateString("pt-BR")}.`}:!("paid_until"in a)&&!("trial_ends_at"in a)&&["active","ativa","trial","teste","g\
race","carencia"].includes(a.status)?{...i,allowed:!0,state:a.status,warning:a.warning??null}:{...i,allowed:!1,state:"vencida",reason:a.block_reason||"Assinatura vencida. Regulariz\
e para continuar operando."}}var pe=e=>(n,t,a)=>{let o=n.ctx.access;if(!o.allowed)return a(new v(402,o.reason,"access_blocked",{state:o.state}));if(e&&!o.modules.includes(e))return a(
S("M\xF3dulo n\xE3o inclu\xEDdo no plano","module_disabled"));a()};async function ce(e,n,t){let{rows:a}=await c(`insert into rate_limits(key, count, reset_at) values ($1, 1, now() \
+ make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,[e,t]);if(a[0].count>n)throw new v(429,"Muitas tentativas. Aguarde alguns minutos.","rate_limited")}import ct from"node:fs";import be from"node:path";import{fileURLToPath as ut}from"node:url";var dt=be.join(be.dirname(ut(import.meta.url)),"migrations");async function Te({log:e=console.log}={}){let n=await se.connect();try{await n.query("select pg_advisory_lock(424242)"),
await n.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);let t=new Set((await n.query("select name from schema_migrations")).rows.map(o=>o.name)),a=ct.readdirSync(
dt).filter(o=>/^\d+_.+\.sql$/.test(o)).sort();for(let o of a){if(t.has(o))continue;let s=ct.readFileSync(be.join(dt,o),"utf8");await n.query("begin");try{await n.query(s),await n.query(
"insert into schema_migrations(name) values ($1)",[o]),await n.query("commit"),e(`migra\xE7\xE3o aplicada: ${o}`)}catch(i){throw await n.query("rollback"),new Error(`falha na migra\
\xE7\xE3o ${o}: ${i.message}`)}}}finally{await n.query("select pg_advisory_unlock(424242)").catch(()=>{}),n.release()}}!j.EDGE_RUNTIME&&process.argv[1]&&ut(import.meta.url)===be.resolve(
process.argv[1])&&Te().then(()=>se.end()).catch(e=>{console.error(e.message),process.exit(1)});import{Router as Ft}from"npm:express@5.2.1";import ye from"npm:bcryptjs@3.0.3";import Bt from"node:crypto";import{z as x}from"npm:zod@4.6.5";var Rt=["scanner_enabled","allow_manual","allow_manual_exception","allow_mode_change","open_free_card_on_scan"],Tt=["double_read_mandatory","exception_requires_manager","require_op\
en_cash"],Pt=["max_qty_per_scan"];function Pe(e={},n={},t={}){let a=[$e,e||{},n||{},t||{}],o={...$e};for(let s of a.slice(1))for(let[i,r]of Object.entries(s))!(i in $e)||r===void 0||
r===null||(Rt.includes(i)?o[i]=o[i]&&!!r:Tt.includes(i)?o[i]=o[i]||!!r:Pt.includes(i)?o[i]=Math.min(o[i],Number(r)):o[i]=r);return o.double_read_mandatory&&(o.mode="dupla"),o.scanner_enabled||
(o.mode="manual"),!o.scanner_enabled&&!o.allow_manual&&(o.allow_manual=!0),o.qty_per_scan=Math.min(Math.max(1,Number(o.qty_per_scan)||1),o.max_qty_per_scan),o}function xe(e){if(e.scanner_enabled===
!1&&e.allow_manual===!1)throw _("Configura\xE7\xE3o eliminaria todos os meios de lan\xE7amento: mantenha o leitor ou o lan\xE7amento manual.");if(e.mode&&!["manual","continua","dup\
la"].includes(e.mode))throw _("Modo inv\xE1lido");if(e.double_read_mandatory&&e.scanner_enabled===!1)throw _("Dupla leitura obrigat\xF3ria exige o leitor habilitado.");if(e.product_timeout_s!=
null&&(e.product_timeout_s<3||e.product_timeout_s>120))throw _("Tempo de espera do produto deve ficar entre 3 e 120 segundos")}async function U(e,n,t){let a=await e.query("select s\
ettings from companies where id = $1",[n.companyId]),o=t?await e.query("select settings from units where id = $1 and company_id = $2",[t,n.companyId]):{rows:[]},s=n.terminalId?await e.
query("select settings from terminals where id = $1",[n.terminalId]):{rows:[]};return Pe(a.rows[0]?.settings?.pdv,o.rows[0]?.settings?.pdv,s.rows[0]?.settings?.pdv)}var de=e=>String(
e??"").replace(/[\r\n\t]/g,"").trim();async function _e(e,n,t){let a=de(t);if(!a)return{type:"DESCONHECIDO",code:a};if(a.length>128)return{type:"DESCONHECIDO",code:a.slice(0,128)};
let{rows:o}=await e.query("select entity, entity_id from scan_codes where company_id = $1 and code = $2",[n,a]);if(!o[0])return{type:"DESCONHECIDO",code:a};let{entity:s,entity_id:i}=o[0];
if(s==="PRODUTO"){let r=await e.query(`select p.id, p.name, p.price_cents, p.kind, p.unit, p.active,
              exists(select 1 from modifier_groups g where g.product_id = p.id) as has_options,
              exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as has_required
         from products p where p.id = $1 and p.company_id = $2`,[i,n]);return r.rows[0]?{type:"PRODUTO",code:a,product:r.rows[0]}:{type:"DESCONHECIDO",code:a}}if(s==="COMANDA"){let r=await e.
query(`select c.id, c.number, c.unit_id, c.status, c.block_reason,
              (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id,
              (select s.status from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_status
         from tab_cards c where c.id = $1 and c.company_id = $2`,[i,n]);return r.rows[0]?{type:"COMANDA",code:a,card:r.rows[0]}:{type:"DESCONHECIDO",code:a}}if(s==="MESA"){let r=await e.
query("select id, number, unit_id, status, area from dining_tables where id = $1 and company_id = $2",[i,n]);return r.rows[0]?{type:"MESA",code:a,table:r.rows[0]}:{type:"DESCONHECI\
DO",code:a}}return{type:s,code:a,id:i}}async function X(e,n,t,a,o){let s=de(t);if(!s)throw _("C\xF3digo vazio");if(s.length>128)throw _("C\xF3digo muito longo");let i=await e.query(
"select entity, entity_id from scan_codes where company_id = $1 and code = $2",[n,s]);if(i.rows[0]){if(i.rows[0].entity===a&&Number(i.rows[0].entity_id)===Number(o))return;throw g(
`C\xF3digo ${s} j\xE1 est\xE1 em uso (${i.rows[0].entity.toLowerCase()} ${i.rows[0].entity_id}). Cadastros amb\xEDguos n\xE3o s\xE3o permitidos.`,"code_in_use")}await e.query("inse\
rt into scan_codes (company_id, code, entity, entity_id) values ($1,$2,$3,$4)",[n,s,a,o])}var mt=(e,n,t)=>`${e}${n>1?`${n}-`:""}${String(t).padStart(6,"0")}`;async function R(e,n,t){
let{rows:a}=await e.query("select * from consumption_sessions where id = $1 and company_id = $2 for update",[t,n]);if(!a[0])throw I("Consumo n\xE3o encontrado");return a[0]}function Q(e){
if(e.status!=="aberta")throw g(`Consumo ${{em_fechamento:"em fechamento",encerrada:"encerrada",cancelada:"cancelada"}[e.status]||e.status}: n\xE3o aceita lan\xE7amentos`,"session_n\
ot_open")}function ue(e,n){if(e.unitId&&Number(e.unitId)!==Number(n)&&e.level<90)throw S("Registro de outra unidade")}async function O(e,n){let t=await e.query("select service_fee_\
bp from consumption_sessions where id = $1",[n]),a=await e.query("select coalesce(sum(total_cents) filter (where status = 'ativo'), 0)::bigint as items from order_items where sessi\
on_id = $1",[n]),o=await e.query("select coalesce(sum(amount_cents) filter (where status = 'confirmado'), 0)::bigint as paid from payments where session_id = $1",[n]),s=Number(a.rows[0].
items),i=Math.round(s*(t.rows[0]?.service_fee_bp||0)/1e4),r=s+i,u=Number(o.rows[0].paid);return{items:s,serviceFee:i,serviceFeeBp:t.rows[0]?.service_fee_bp||0,total:r,paid:u,balance:r-
u}}async function lt(e,n,t={}){let o=(await e.query("insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id",[n,t.unit_name||"Matriz",t.day_cutoff??5])).rows[0].
id;await e.query("insert into terminals (company_id, unit_id, name) values ($1,$2,$3)",[n,o,"Caixa 1"]);let s={};for(let i of["Cozinha","Bar","Copa"]){let r=await e.query("insert i\
nto production_sectors (company_id, name) values ($1,$2) returning id",[n,i]);s[i]=r.rows[0].id}return await Me(e,n,o,1,t.tables??10),await Ue(e,n,o,1,t.cards??50),t.demo&&await Ut(
e,n,s),{unitId:o,sectors:s}}async function Me(e,n,t,a,o){let s=[];for(let i=a;i<a+o;i++){let r=await e.query(`insert into dining_tables (company_id, unit_id, number, pos_x, pos_y) \
values ($1,$2,$3,$4,$5)
       on conflict do nothing returning id`,[n,t,i,(i-1)%6,Math.floor((i-1)/6)]);r.rows[0]&&(await X(e,n,`MESA-${String(t).padStart(2,"0")}-${String(i).padStart(3,"0")}`,"MESA",r.rows[0].
id),s.push(r.rows[0].id))}return s}async function Ue(e,n,t,a,o,s="CMD-"){let i=(await e.query("select count(*)::int as n from units where company_id = $1 and id <= $2",[n,t])).rows[0].
n,r=[];for(let u=a;u<a+o;u++){let f=await e.query("insert into tab_cards (company_id, unit_id, number) values ($1,$2,$3) on conflict do nothing returning id, number",[n,t,u]);if(f.
rows[0]){let y=mt(s,i,u);await X(e,n,y,"COMANDA",f.rows[0].id),r.push({...f.rows[0],code:y})}}return r}var Mt=[["Cervejas","Bar",[["Cerveja IPA 600 ml",2890,"7890000000011"],["Pils\
en long neck",1290,"7890000000028"],["Chope 300 ml",1190,null]]],["Drinks","Bar",[["Caipirinha",2400,null],["Gin t\xF4nica",3200,null]]],["Lanches","Cozinha",[["Hamb\xFArguer da ofici\
na",3890,null],["Por\xE7\xE3o de fritas",2690,null]]],["Sem \xE1lcool","Bar",[["Refrigerante lata",700,"7890000000035"],["\xC1gua mineral",500,"7890000000042"]]]];async function Ut(e,n,t){
let a=0;for(let[o,s,i]of Mt){let r=await e.query("insert into categories (company_id, name, sort, demo) values ($1,$2,$3,true) returning id",[n,`${o} (demonstra\xE7\xE3o)`,a++]);for(let[
u,f,y]of i){let $=await e.query(`insert into products (company_id, category_id, sector_id, name, price_cents, kind, demo, favorite)
         values ($1,$2,$3,$4,$5,$6,true,$7) returning id`,[n,r.rows[0].id,t[s],u,f,s==="Cozinha"?"recipe":"resale",a===1]);if(y&&await X(e,n,y,"PRODUTO",$.rows[0].id),u.startsWith(
"Hamb\xFArguer")){let N=await e.query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Ponto da carne',1,1) returning id",[n,$.rows[0].
id]);for(let B of["Mal passado","Ao ponto","Bem passado"])await e.query("insert into modifier_options (company_id, group_id, name) values ($1,$2,$3)",[n,N.rows[0].id,B]);let ne=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select) values ($1,$2,'Adicionais',0,3) returning id",[n,$.rows[0].id]);for(let[B,oe]of[["Bacon",600],
["Queijo extra",400],["Ovo",300]])await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[n,ne.rows[0].id,B,oe])}}}}import pt from"node:crypto";var ee="rusten",L=()=>!!(j.PLATFORM_SECRET&&j.PLATFORM_HUB_URL),Lt=300*1e3;function _t(e,{method:n,path:t,body:a="",ts:o=Date.now(),nonce:s=pt.randomBytes(16).toString("hex")}){let i=`${o}\
.${s}.${n.toUpperCase()}.${t}.${M(a)}`,r=pt.createHmac("sha256",e).update(i).digest("hex");return{"x-platform-timestamp":String(o),"x-platform-nonce":s,"x-platform-signature":r,"x-\
platform-product":ee}}async function yt(e,n,t){try{let a=j.PLATFORM_SECRET;if(!a)throw new v(503,"Central n\xE3o configurada","platform_disabled");let o=Number(e.headers["x-platfor\
m-timestamp"]),s=String(e.headers["x-platform-nonce"]||""),i=String(e.headers["x-platform-signature"]||"");if(!o||Math.abs(Date.now()-o)>Lt)throw new v(401,"Assinatura expirada","b\
ad_signature");if(!/^[a-zA-Z0-9_-]{16,64}$/.test(s))throw new v(401,"Nonce inv\xE1lido","bad_signature");let r=_t(a,{method:e.method,path:e.originalUrl.split("?")[0].replace(j.PATH_PREFIX||
/^$/,""),body:e.rawBody||"",ts:o,nonce:s})["x-platform-signature"];if(!Ze(r,i))throw new v(401,"Assinatura inv\xE1lida","bad_signature");if(!(await c("insert into platform_nonces (\
nonce) values ($1) on conflict do nothing returning nonce",[s])).rows[0])throw new v(401,"Requisi\xE7\xE3o repetida","replay");await c("delete from platform_nonces where created_at\
 < now() - interval '1 day'"),t()}catch(a){t(a)}}async function te(e,n,t){if(!L())throw new v(503,"Central n\xE3o configurada","platform_disabled");let a=new URL(j.PLATFORM_HUB_URL);
if(a.protocol!=="https:"&&j.NODE_ENV==="production")throw new Error("PLATFORM_HUB_URL deve usar HTTPS");let o=t?JSON.stringify(t):"",s=await fetch(new URL(n,a),{method:e,headers:{"\
content-type":"application/json",..._t(j.PLATFORM_SECRET,{method:e,path:n,body:o})},body:o||void 0,signal:AbortSignal.timeout(1e4)}),i=await s.text(),r;try{r=JSON.parse(i)}catch{r=
{raw:i.slice(0,200)}}if(!s.ok)throw new v(502,r?.error||`Central respondeu ${s.status}`,"hub_error");return r}async function ve(e,n){let{rows:t}=await e.query(`select c.id, c.name,\
 c.segment, c.document, c.email, c.phone, c.created_at, c.last_access_at, c.access,
            (select json_build_object('name', u.name, 'email', u.email) from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner,
            (select count(*)::int from units where company_id = c.id) as units,
            (select count(*)::int from users where company_id = c.id and active) as users,
            (select count(*)::int from terminals where company_id = c.id and active) as terminals
       from companies c where c.id = $1`,[n]),a=t[0];return a?{remote_id:String(a.id),product:ee,name:a.name,segment:a.segment,document:a.document,email:a.email,phone:a.phone,owner:a.
owner,created_at:a.created_at,last_access_at:a.last_access_at,usage:{units:a.units,users:a.users,terminals:a.terminals},access:a.access}:null}async function Ie(e,n,t,a={}){L()&&await e.
query("insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)",[n,t,a])}async function ke(e=20){if(!L())return{sent:0,failed:0};let{rows:n}=await c(`select * fro\
m platform_outbox where sent_at is null and attempts < 20
                            order by id limit $1`,[e]),t=0,a=0;for(let o of n)try{if(o.kind==="tenant.created"||o.kind==="tenant.updated"){let s=await ve({query:c},o.company_id),i=await te(
"POST","/api/hub/v1/tenants",s);i?.access&&await je(o.company_id,i.access)}await c("update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id \
= $1",[o.id]),t++}catch(s){await c("update platform_outbox set attempts = attempts + 1, last_error = $2 where id = $1",[o.id,String(s.message).slice(0,300)]),a++}return{sent:t,failed:a}}
var Ht=["status","blocked","block_reason","admin_block","manual_release_until","paid_until","trial_ends_at","grace_until","plan","cycle","modules","limits","warning","support"];async function je(e,n){
let t=Object.fromEntries(Object.entries(n||{}).filter(([o])=>Ht.includes(o)));return!!(await c("update companies set access = $2, access_updated_at = now() where id = $1 returning \
id",[e,t])).rows[0]}var H=Ft(),qt=["12345678","senha123","password","qwerty","123456789","rusten123","abc12345"];function we(e){if(e.length<10)throw _("A senha precisa ter pelo menos 10 caracteres");if(!/[a-zA-Z]/.
test(e)||!/\d/.test(e))throw _("A senha precisa ter letras e n\xFAmeros");if(qt.some(n=>e.toLowerCase().includes(n)))throw _("Senha muito comum")}var Vt=["bar","restaurante","lanch\
onete","cafeteria","pub","food_truck","hamburgueria","pizzaria","padaria","outro"],Gt=x.object({company:x.object({name:x.string().trim().min(2).max(120),segment:x.enum(Vt).default(
"restaurante"),document:x.string().trim().max(20).optional(),phone:x.string().trim().max(30).optional(),email:x.string().trim().email().max(160).optional(),address:x.object({street:x.
string().max(160).optional(),city:x.string().max(80).optional(),state:x.string().max(2).optional(),zip:x.string().max(10).optional()}).partial().optional()}),owner:x.object({name:x.
string().trim().min(2).max(120),email:x.string().trim().toLowerCase().email().max(160),password:x.string().min(1).max(200)}),accept_terms:x.literal(!0,{message:"\xC9 preciso aceitar o\
s termos"}),plan:x.object({code:x.string().max(60).optional(),cycle:x.enum(["mensal","anual"]).optional(),trial:x.boolean().optional()}).optional(),setup:x.object({unit_name:x.string().
trim().max(80).optional(),tables:x.number().int().min(0).max(300).default(10),cards:x.number().int().min(0).max(2e3).default(50),mode:x.enum(["manual","continua","dupla"]).default(
"manual"),demo:x.boolean().default(!1),day_cutoff:x.number().int().min(0).max(12).default(5)}).default({})});H.post("/register",d(async(e,n)=>{if(j.ALLOW_SIGNUP==="false")throw new v(
403,"Novos cadastros est\xE3o temporariamente fechados","signup_closed");await ce(`register:${e.ip}`,10,3600);let t=h(Gt,e.body);if(we(t.owner.password),(await c("select 1 from use\
rs where lower(email) = $1",[t.owner.email])).rows[0])throw new v(409,'Este e-mail j\xE1 est\xE1 cadastrado. Use "Entrar" ou recupere a senha.',"email_taken");let o=await ye.hash(t.
owner.password,12),s=await k(async r=>{let f=(await r.query(`insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,[t.company.name,t.company.segment,t.company.document??null,t.company.phone??null,t.company.email??t.owner.email,t.company.address??
{},{pdv:{mode:t.setup.mode},plan_request:t.plan??null}])).rows[0].id;for(let N of tt)await r.query("insert into roles (company_id, key, name, level, permissions, system) values ($1\
,$2,$3,$4,$5,true)",[f,N.key,N.name,N.level,N.permissions]);let y=await r.query("insert into users (company_id, name, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') r\
eturning id",[f,t.owner.name,t.owner.email,o]),$={companyId:f,userId:y.rows[0].id};return await lt(r,f,t.setup),await w(r,$,"empresa.cadastrada",{entity:"company",entityId:f,data:{
segment:t.company.segment,plan:t.plan??null}}),await Ie(r,f,"tenant.created"),{companyId:f,userId:y.rows[0].id}}),i=await wt({id:s.userId,company_id:s.companyId},e);n.status(201).json(
i)}));async function wt(e,n){let t=Bt.randomUUID(),a=V(48);return await c(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,[t,e.id,M(a),it,n.ip]),{access_token:Re(e,t),refresh_token:`${t}.${a}`}}var Jt,Kt=()=>Jt||=ye.hashSync("dummy-p\
assword-for-timing",12);H.get("/plans",d(async(e,n)=>{if(!L())return n.json({hub:!1,plans:[]});try{let t=await te("GET","/api/hub/v1/plans?product=rusten");n.json({hub:!0,plans:t.plans||
[],trial:t.trial??null,trial_days:t.trial_days??null,signup_open:t.signup_open??!0})}catch{n.json({hub:!0,plans:[],unavailable:!0})}}));H.post("/login",d(async(e,n)=>{let t=h(x.object(
{email:x.string().trim().toLowerCase().max(160),password:x.string().max(200)}),e.body);await ce(`login:${e.ip}`,30,900),await ce(`login-user:${t.email}`,15,900);let{rows:a}=await c(
"select * from users where lower(email) = $1",[t.email]),o=a[0],s=await ye.compare(t.password,o?.password_hash||Kt()),i=new v(401,"E-mail ou senha incorretos","bad_credentials");if(!o||
!o.active)throw i;if(o.locked_until&&new Date(o.locked_until)>new Date)throw new v(423,"Conta bloqueada temporariamente por tentativas inv\xE1lidas. Tente em 15 minutos.","locked");
if(!s)throw await c(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`,[o.id]),await w({query:c},{companyId:o.company_id,userId:o.id},"login.falhou",{entity:"user",entityId:o.id}),i;await c("update users set failed_attempts\
 = 0, locked_until = null where id = $1",[o.id]),await c("update companies set last_access_at = now() where id = $1",[o.company_id]),await w({query:c},{companyId:o.company_id,userId:o.
id},"login",{entity:"user",entityId:o.id}),n.json(await wt(o,e))}));H.post("/refresh",d(async(e,n)=>{let t=String(e.body?.refresh_token||""),[a,o]=t.split(".");if(!a||!o||!/^[0-9a-f-]{36}$/.
test(a))throw new v(401,"Sess\xE3o inv\xE1lida","unauthenticated");let s=await k(async i=>{let{rows:r}=await i.query("select s.*, u.company_id, u.active from user_sessions s join u\
sers u on u.id = s.user_id where s.id = $1 for update of s",[a]),u=r[0];if(!u||u.revoked_at||new Date(u.expires_at)<new Date||!u.active)throw new v(401,"Sess\xE3o expirada","unauth\
enticated");if(u.refresh_hash!==M(o))return await i.query("update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[u.user_id]),await w(i,{companyId:u.
company_id,userId:u.user_id},"sessao.reuso_detectado",{entity:"user",entityId:u.user_id}),null;let f=V(48);return await i.query("update user_sessions set refresh_hash = $2, rotated\
_at = now() where id = $1",[a,M(f)]),{access_token:Re({id:u.user_id,company_id:u.company_id},a),refresh_token:`${a}.${f}`}});if(!s)throw new v(401,"Sess\xE3o encerrada por seguran\xE7a. \
Entre novamente.","unauthenticated");n.json(s)}));H.post("/logout",G(),d(async(e,n)=>{e.body?.all===!0?await c("update user_sessions set revoked_at = now() where user_id = $1 and r\
evoked_at is null",[e.ctx.userId]):await c("update user_sessions set revoked_at = now() where id = $1",[e.ctx.sessionId]),n.json({ok:!0})}));H.post("/password",G(),d(async(e,n)=>{let t=h(
x.object({current:x.string().max(200),next:x.string().max(200)}),e.body);we(t.next);let{rows:a}=await c("select password_hash from users where id = $1",[e.ctx.userId]);if(!await ye.
compare(t.current,a[0].password_hash))throw _("Senha atual incorreta");await c("update users set password_hash = $2, password_changed_at = now() where id = $1",[e.ctx.userId,await ye.
hash(t.next,12)]),await c("update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null",[e.ctx.userId,e.ctx.sessionId]),await w({query:c},e.ctx,
"senha.alterada",{entity:"user",entityId:e.ctx.userId}),n.json({ok:!0})}));H.get("/me",G(),d(async(e,n)=>{let t=e.ctx,a=await c("select id, name, day_cutoff from units where compan\
y_id = $1 and active order by id",[t.companyId]),o=t.terminalUnitId||t.unitId||a.rows[0]?.id;n.json({user:{id:t.userId,name:t.name,email:t.email,role:t.role,roleName:t.roleName,level:t.
level,unitId:t.unitId},company:t.company,permissions:[...t.perms],access:t.access,units:a.rows,unitId:o,terminalId:t.terminalId,pdv:await U({query:c},t,o),catalog:{permissions:Z,modules:re}})}));import{Router as Yt}from"npm:express@5.2.1";import Le from"npm:bcryptjs@3.0.3";import{z as m}from"npm:zod@4.6.5";var E=Yt();async function ft(e,n){let t=await c("select level from roles where company_id = $1 and key = $2",[e,n]);if(!t.rows[0])throw _("Perfil inexistente");return t.rows[0].level}
E.get("/users",p("usuarios.gerenciar"),d(async(e,n)=>{let{rows:t}=await c(`select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at\
,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`,[e.ctx.companyId]);n.json(t)}));var ht=m.object({name:m.string().trim().min(2).max(120),email:m.string().trim().toLowerCase().
email().max(160),password:m.string().max(200).optional(),role_key:m.string().max(40),unit_id:m.number().int().nullable().optional(),active:m.boolean().optional()});E.post("/users",
p("usuarios.gerenciar"),d(async(e,n)=>{let t=h(ht,e.body);if(await ft(e.ctx.companyId,t.role_key)>e.ctx.level)throw S("N\xE3o \xE9 poss\xEDvel criar usu\xE1rio com perfil acima do seu");
if(!t.password)throw _("Informe a senha inicial");if(we(t.password),t.unit_id&&await He(e.ctx.companyId,t.unit_id),(await c("select 1 from users where lower(email) = $1",[t.email])).
rows[0])throw g("E-mail j\xE1 cadastrado");let o=await c("insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id",[e.
ctx.companyId,t.name,t.email,await Le.hash(t.password,12),t.role_key,t.unit_id??null]);await w({query:c},e.ctx,"usuario.criado",{entity:"user",entityId:o.rows[0].id,data:{role:t.role_key}}),
await Ie({query:c},e.ctx.companyId,"tenant.updated"),n.status(201).json({id:o.rows[0].id})}));E.put("/users/:id",p("usuarios.gerenciar"),d(async(e,n)=>{let t=Number(e.params.id),a=h(
ht.partial(),e.body),s=(await c(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`,[t,e.ctx.companyId])).rows[0];if(!s)throw I("Usu\xE1rio n\xE3o encontrado");if(s.level>e.ctx.level||s.level===e.ctx.level&&
s.id!==e.ctx.userId&&e.ctx.role!=="owner")throw S("N\xE3o \xE9 poss\xEDvel alterar usu\xE1rio de n\xEDvel igual ou superior");if(a.role_key&&await ft(e.ctx.companyId,a.role_key)>e.
ctx.level)throw S("Perfil acima do seu");if(s.role_key==="owner"&&a.role_key&&a.role_key!=="owner"&&(await c("select count(*)::int n from users where company_id = $1 and role_key =\
 'owner' and active",[e.ctx.companyId])).rows[0].n<=1)throw _("A empresa precisa de ao menos um propriet\xE1rio ativo");a.unit_id&&await He(e.ctx.companyId,a.unit_id);let i=null;a.
password&&(we(a.password),i=await Le.hash(a.password,12)),await c(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,[t,e.ctx.companyId,a.name??null,a.email??null,a.role_key??null,"unit_id"in a,a.unit_id??null,a.active??null,i]),(a.active===!1||i)&&await c(
"update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",[t]),await w({query:c},e.ctx,"usuario.alterado",{entity:"user",entityId:t,data:{...a,password:a.
password?"alterada":void 0}}),n.json({ok:!0})}));E.get("/roles",p("usuarios.gerenciar"),d(async(e,n)=>{let{rows:t}=await c("select key, name, level, permissions, system from roles \
where company_id = $1 order by level desc",[e.ctx.companyId]);n.json({roles:t,catalog:Z})}));E.put("/roles/:key",p("usuarios.gerenciar"),d(async(e,n)=>{let t=h(m.object({name:m.string().
trim().min(2).max(60).optional(),permissions:m.array(m.string()).max(200).optional(),level:m.number().int().min(1).max(99).optional()}),e.body),a=(await c("select * from roles wher\
e company_id = $1 and key = $2",[e.ctx.companyId,e.params.key])).rows[0];if(!a)throw I("Perfil n\xE3o encontrado");if(a.key==="owner")throw S("O perfil Propriet\xE1rio n\xE3o pode ser al\
terado");if(a.level>=e.ctx.level)throw S("S\xF3 \xE9 poss\xEDvel alterar perfis abaixo do seu n\xEDvel");if(t.level&&t.level>=e.ctx.level)throw S("N\xEDvel acima do seu");if(t.permissions){
let o=t.permissions.find(i=>!(i in Z));if(o)throw _(`Permiss\xE3o inv\xE1lida: ${o}`);let s=t.permissions.find(i=>!e.ctx.can(i));if(s)throw S(`Voc\xEA n\xE3o pode conceder o que n\xE3o tem:\
 ${s}`)}await c("update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2",[e.ctx.companyId,
a.key,t.name??null,t.permissions??null,t.level??null]),await w({query:c},e.ctx,"perfil.alterado",{entity:"role",entityId:a.key,data:{before:a.permissions,after:t.permissions}}),n.json(
{ok:!0})}));E.post("/roles",p("usuarios.gerenciar"),d(async(e,n)=>{let t=h(m.object({name:m.string().trim().min(2).max(60),level:m.number().int().min(1).max(99),permissions:m.array(
m.string()).max(200)}),e.body);if(t.level>=e.ctx.level)throw S("N\xEDvel acima do seu");let a=t.permissions.find(s=>!(s in Z)||!e.ctx.can(s));if(a)throw S(`Permiss\xE3o inv\xE1lida ou n\xE3\
o conced\xEDvel: ${a}`);let o=`custom_${V(4).toLowerCase().replace(/[^a-z0-9]/g,"x")}`;await c("insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,$4,$5\
)",[e.ctx.companyId,o,t.name,t.level,t.permissions]),await w({query:c},e.ctx,"perfil.criado",{entity:"role",entityId:o,data:t}),n.status(201).json({key:o})}));async function He(e,n){
if(!(await c("select id from units where id = $1 and company_id = $2",[n,e])).rows[0])throw _("Unidade inv\xE1lida")}E.get("/units",d(async(e,n)=>{n.json((await c("select id, name,\
 active, day_cutoff, settings from units where company_id = $1 order by id",[e.ctx.companyId])).rows)}));E.post("/units",p("configuracoes.gerenciar"),d(async(e,n)=>{let t=h(m.object(
{name:m.string().trim().min(2).max(80),day_cutoff:m.number().int().min(0).max(12).default(5)}),e.body),a=await c("insert into units (company_id, name, day_cutoff) values ($1,$2,$3)\
 returning id",[e.ctx.companyId,t.name,t.day_cutoff]);await w({query:c},e.ctx,"unidade.criada",{entity:"unit",entityId:a.rows[0].id,data:t}),n.status(201).json({id:a.rows[0].id})}));
E.put("/units/:id",p("configuracoes.gerenciar"),d(async(e,n)=>{let t=h(m.object({name:m.string().trim().min(2).max(80).optional(),day_cutoff:m.number().int().min(0).max(12).optional(),
active:m.boolean().optional()}),e.body);if(!(await c("update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 an\
d company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.day_cutoff??null,t.active??null])).rows[0])throw I();await w({query:c},e.ctx,"unidade.alterada",
{entity:"unit",entityId:e.params.id,data:t}),n.json({ok:!0})}));E.get("/terminals",d(async(e,n)=>{n.json((await c("select id, unit_id, name, active, settings from terminals where c\
ompany_id = $1 order by id",[e.ctx.companyId])).rows)}));E.post("/terminals",p("configuracoes.gerenciar"),d(async(e,n)=>{let t=h(m.object({name:m.string().trim().min(2).max(60),unit_id:m.
number().int()}),e.body);await He(e.ctx.companyId,t.unit_id);let a=await c("insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id",[e.ctx.companyId,t.unit_id,
t.name]);await w({query:c},e.ctx,"terminal.criado",{entity:"terminal",entityId:a.rows[0].id,data:t}),n.status(201).json({id:a.rows[0].id})}));E.put("/terminals/:id",p("configuracoe\
s.gerenciar"),d(async(e,n)=>{let t=h(m.object({name:m.string().trim().min(2).max(60).optional(),active:m.boolean().optional()}),e.body);if(!(await c("update terminals set name = co\
alesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,t.name??null,t.active??null])).rows[0])throw I();
n.json({ok:!0})}));var Wt=m.object({name:m.string().trim().min(2).max(120),segment:m.string().max(30),document:m.string().max(20).nullable(),phone:m.string().max(30).nullable(),email:m.
string().email().max(160).nullable(),timezone:m.string().max(60),address:m.record(m.string(),m.string().max(160)),appearance:m.object({theme:m.enum(["claro","escuro","auto"]).optional(),
density:m.enum(["confortavel","compacta"]).optional(),menu:m.enum(["lateral","superior"]).optional(),accent:m.string().regex(/^#[0-9a-fA-F]{6}$/).optional()})}).partial();E.get("/s\
ettings",d(async(e,n)=>{let t=(await c("select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1",[e.ctx.companyId])).rows[0];n.json(
t)}));E.put("/settings",p("configuracoes.gerenciar"),d(async(e,n)=>{let t=h(Wt,e.body);if(t.timezone)try{new Intl.DateTimeFormat("pt-BR",{timeZone:t.timezone})}catch{throw _("Fuso \
hor\xE1rio inv\xE1lido")}await c(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,[e.ctx.companyId,t.name??null,t.segment??null,t.document??null,t.phone??null,t.email??null,t.timezone??null,t.address??null,t.appearance?JSON.stringify(t.
appearance):null]),await w({query:c},e.ctx,"configuracoes.empresa",{entity:"company",entityId:e.ctx.companyId,data:t}),n.json({ok:!0})}));var Zt=m.object({scanner_enabled:m.boolean(),
mode:m.enum(["manual","continua","dupla"]),double_read_mandatory:m.boolean(),allow_manual:m.boolean(),allow_manual_exception:m.boolean(),exception_requires_manager:m.boolean(),allow_mode_change:m.
boolean(),product_timeout_s:m.number().int(),open_free_card_on_scan:m.boolean(),feedback_sound:m.boolean(),qty_per_scan:m.number().int().min(1).max(100),max_qty_per_scan:m.number().
int().min(1).max(100),terminator:m.enum(["Enter","Tab"]),kitchen_send:m.enum(["imediato","lote"]),require_open_cash:m.boolean(),service_fee_bp:m.number().int().min(0).max(3e3),card_prefix:m.
string().regex(/^[A-Z0-9-]{1,8}$/)}).partial();E.get("/pdv-settings",d(async(e,n)=>{let t=Number(e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId||null,a=await c("select settin\
gs->'pdv' as s from companies where id = $1",[e.ctx.companyId]),o=t?await c("select settings->'pdv' as s from units where id = $1 and company_id = $2",[t,e.ctx.companyId]):{rows:[]},
s=Number(e.query.terminal_id)||e.ctx.terminalId,i=s?await c("select settings->'pdv' as s from terminals where id = $1 and company_id = $2",[s,e.ctx.companyId]):{rows:[]};n.json({company:a.
rows[0]?.s||{},unit:o.rows[0]?.s||{},terminal:i.rows[0]?.s||{},effective:Pe(a.rows[0]?.s,o.rows[0]?.s,i.rows[0]?.s)})}));E.put("/pdv-settings/:level",p("configuracoes.gerenciar"),d(
async(e,n)=>{let t=h(m.enum(["company","unit","terminal"]),e.params.level),a=h(Zt,e.body?.settings);xe(a);let o=Number(e.body?.id);await k(async s=>{let i;if(t==="company"){i=(await s.
query("select settings->'pdv' s, settings from companies where id = $1 for update",[e.ctx.companyId])).rows[0];let r={...i.s||{},...a};xe(r),await s.query("update companies set set\
tings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1",[e.ctx.companyId,JSON.stringify(r)])}else{let r=t==="unit"?"units":"terminals";if(i=(await s.query(`select settings->\
'pdv' s from ${r} where id = $1 and company_id = $2 for update`,[o,e.ctx.companyId])).rows[0],!i)throw I();let u={...i.s||{},...a};xe(u),await s.query(`update ${r} set settings = j\
sonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`,[o,e.ctx.companyId,JSON.stringify(u)])}await w(s,e.ctx,"pdv.configuracao",{entity:t,entityId:o||e.ctx.companyId,
data:{before:i?.s||{},after:a}})}),n.json({ok:!0,effective:await U({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId)})}));E.get("/audit",p("auditoria.visualizar"),d(async(e,n)=>{
let t=Math.min(Number(e.query.limit)||50,500),a=Math.max(Number(e.query.offset)||0,0),o=[e.ctx.companyId],s="a.company_id = $1";e.query.action&&(o.push(`${String(e.query.action)}%`),
s+=` and a.action like $${o.length}`),e.query.entity&&(o.push(String(e.query.entity)),s+=` and a.entity = $${o.length}`),e.query.entity_id&&(o.push(String(e.query.entity_id)),s+=` \
and a.entity_id = $${o.length}`),o.push(t,a);let{rows:i}=await c(`select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as \
user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${s} order by a.id desc limit $${o.length-1} offset $${o.length}`,o);if(e.query.format==="csv")return n.type("text/csv; charset=utf-8").attachment("auditoria.csv"),n.send(
["data;usuario;acao;entidade;id;motivo",...i.map(r=>[r.created_at.toISOString(),r.user_name,r.action,r.entity,r.entity_id,r.reason].map(Xe).join(";"))].join(`
`));n.json(i)}));E.post("/authorizations",d(async(e,n)=>{let t=h(m.object({email:m.string().trim().toLowerCase().max(160),password:m.string().max(200),action:m.enum(["excecao_dupla\
_leitura","cancelar_item","desconto","alterar_preco","reabrir_comanda","cancelar_venda","taxa_servico"]),reason:m.string().trim().min(3).max(300)}),e.body);await ce(`auth-mgr:${e.ctx.
companyId}:${t.email}`,5,600);let a={excecao_dupla_leitura:"pdv.excecao_dupla_leitura",cancelar_item:"pdv.cancelar_item",desconto:"pdv.desconto",alterar_preco:"pdv.alterar_preco",reabrir_comanda:"\
pdv.reabrir_comanda",cancelar_venda:"pdv.cancelar_venda",taxa_servico:"pdv.taxa_servico"}[t.action],{rows:o}=await c(`select u.id, u.password_hash, r.permissions from users u join \
roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`,[t.email,e.ctx.companyId]),s=o[0];if(!(s&&await Le.compare(t.password,s.password_hash))||
!s.permissions.includes("pdv.autorizar")||!s.permissions.includes(a))throw await w({query:c},e.ctx,"autorizacao.negada",{data:{action:t.action,email:t.email}}),S("Autoriza\xE7\xE3o recus\
ada: credenciais inv\xE1lidas ou sem permiss\xE3o para autorizar esta a\xE7\xE3o");let r=V(24);await c(`insert into manager_authorizations (company_id, requested_by, authorized_by,\
 action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,[e.ctx.companyId,e.ctx.userId,s.id,t.action,{reason:t.reason,terminal:e.ctx.terminalId},M(r)]),await w({query:c},
e.ctx,"autorizacao.concedida",{reason:t.reason,data:{action:t.action,authorized_by:s.id}}),n.json({authorization:r,expires_in:120})}));async function K(e,n,t,a){if(!t)throw S("Esta\
 a\xE7\xE3o exige autoriza\xE7\xE3o de um gerente","authorization_required");let{rows:o}=await e.query(`update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`,[M(t),n.companyId,n.userId,a]);if(!o[0])throw S("Autoriza\xE7\xE3o gerencial inv\xE1lida, expirada ou j\xE1 utilizada");return o[0]}import{Router as Xt}from"npm:express@5.2.1";import{z as b}from"npm:zod@4.6.5";var T=Xt();T.get("/categories",p("cardapio.visualizar"),d(async(e,n)=>{n.json((await c("select id, name, sort, active, demo from categories where company_id = $1 order by sort, nam\
e",[e.ctx.companyId])).rows)}));T.post("/categories",p("cardapio.gerenciar"),d(async(e,n)=>{let t=h(b.object({name:b.string().trim().min(1).max(80),sort:b.number().int().default(0)}),
e.body),a=await c("insert into categories (company_id, name, sort) values ($1,$2,$3) returning id",[e.ctx.companyId,t.name,t.sort]);n.status(201).json({id:a.rows[0].id})}));T.put("\
/categories/:id",p("cardapio.gerenciar"),d(async(e,n)=>{let t=h(b.object({name:b.string().trim().min(1).max(80),sort:b.number().int(),active:b.boolean()}).partial(),e.body);if(!(await c(
"update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id",[Number(e.params.id),e.ctx.companyId,
t.name??null,t.sort??null,t.active??null])).rows[0])throw I();n.json({ok:!0})}));T.get("/sectors",d(async(e,n)=>{n.json((await c("select id, name, active from production_sectors wh\
ere company_id = $1 order by id",[e.ctx.companyId])).rows)}));T.post("/sectors",p("cardapio.gerenciar"),d(async(e,n)=>{let t=h(b.object({name:b.string().trim().min(2).max(60)}),e.body),
a=await c("insert into production_sectors (company_id, name) values ($1,$2) returning id",[e.ctx.companyId,t.name]);n.status(201).json({id:a.rows[0].id})}));T.get("/products",p("ca\
rdapio.visualizar"),d(async(e,n)=>{let t=[e.ctx.companyId],a="p.company_id = $1";e.query.active!=="all"&&(a+=" and p.active"),e.query.q&&(t.push(`%${String(e.query.q).slice(0,60)}%`,
de(e.query.q)),a+=` and (p.name ilike $${t.length-1} or p.sku = $${t.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.\
entity_id = p.id and s.code = $${t.length}))`),e.query.category_id&&(t.push(Number(e.query.category_id)),a+=` and p.category_id = $${t.length}`);let o=e.ctx.can("relatorios.cmv")||
e.ctx.can("cardapio.gerenciar"),{rows:s}=await c(`select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${o?"p.cost_cents,":""} p.favorite, p.active, p.demo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${a} order by p.favorite desc, p.name limit 500`,t);n.json(s)}));var gt=b.object({name:b.string().trim().min(1).max(120),description:b.string().max(500).
nullable().optional(),sku:b.string().trim().max(40).nullable().optional(),kind:b.enum(["resale","recipe","produced","combo","addon","weight"]).default("resale"),unit:b.enum(["un","\
kg","g","L","ml"]).default("un"),price_cents:b.number().int().min(0).max(1e8),cost_cents:b.number().int().min(0).max(1e8).default(0),category_id:b.number().int().nullable().optional(),
sector_id:b.number().int().nullable().optional(),favorite:b.boolean().default(!1),active:b.boolean().default(!0),channels:b.array(b.enum(["pdv","delivery","cardapio_digital"])).default(
["pdv"]),allergens:b.string().max(500).nullable().optional(),codes:b.array(b.string().max(128)).max(20).default([]),groups:b.array(b.object({name:b.string().trim().min(1).max(60),min:b.
number().int().min(0).max(20),max:b.number().int().min(1).max(20),options:b.array(b.object({name:b.string().trim().min(1).max(60),price_cents:b.number().int().min(0).max(1e6)})).min(
1).max(40)})).max(10).optional()});async function $t(e,n,t){if(t.category_id&&!(await e.query("select 1 from categories where id = $1 and company_id = $2",[t.category_id,n])).rows[0])
throw _("Categoria inv\xE1lida");if(t.sector_id&&!(await e.query("select 1 from production_sectors where id = $1 and company_id = $2",[t.sector_id,n])).rows[0])throw _("Setor inv\xE1l\
ido");if(t.kind==="weight"&&t.unit==="un")throw _("Produto por peso precisa de unidade kg ou g");for(let a of t.groups||[])if(a.min>a.max)throw _(`Grupo ${a.name}: m\xEDnimo maior que\
 m\xE1ximo`)}async function bt(e,n,t,a){if(!a)return;await e.query("delete from modifier_groups where product_id = $1 and company_id = $2",[t,n]);let o=0;for(let s of a){let i=await e.
query("insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id",[n,t,s.name,s.min,s.max,o++]);for(let r of s.
options)await e.query("insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)",[n,i.rows[0].id,r.name,r.price_cents])}}T.post("/products",p("ca\
rdapio.gerenciar"),d(async(e,n)=>{let t=h(gt,e.body),a=await k(async o=>{await $t(o,e.ctx.companyId,t);let i=(await o.query(`insert into products (company_id, name, description, sk\
u, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,[e.ctx.companyId,t.name,t.description??null,t.sku||null,t.kind,t.unit,t.price_cents,t.cost_cents,t.category_id??
null,t.sector_id??null,t.favorite,t.active,t.channels,t.allergens??null])).rows[0].id;for(let r of t.codes)await X(o,e.ctx.companyId,r,"PRODUTO",i);return await bt(o,e.ctx.companyId,
i,t.groups),await o.query("insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)",[e.ctx.companyId,i,t.price_cents,e.ctx.
userId]),await w(o,e.ctx,"produto.criado",{entity:"product",entityId:i,data:{name:t.name,price_cents:t.price_cents}}),i}).catch(o=>{throw o.code==="23505"?g("SKU j\xE1 usado em outro \
produto"):o});n.status(201).json({id:a})}));T.put("/products/:id",p("cardapio.gerenciar"),d(async(e,n)=>{let t=Number(e.params.id),a=h(gt.partial(),e.body);await k(async o=>{let s=(await o.
query("select * from products where id = $1 and company_id = $2 for update",[t,e.ctx.companyId])).rows[0];if(!s)throw I("Produto n\xE3o encontrado");await $t(o,e.ctx.companyId,{...s,
...a});let i={...s,...a};if(await o.query(`update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,[t,e.ctx.companyId,i.name,i.description,i.sku||null,i.kind,i.unit,i.
price_cents,i.cost_cents,i.category_id,i.sector_id,i.favorite,i.active,i.channels,i.allergens]),a.price_cents!=null&&a.price_cents!==s.price_cents&&(await o.query("insert into prod\
uct_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)",[e.ctx.companyId,t,s.price_cents,a.price_cents,e.ctx.userId]),await w(o,e.ctx,"pr\
oduto.preco",{entity:"product",entityId:t,data:{before:s.price_cents,after:a.price_cents}})),a.codes){let r=a.codes.map(de).filter(Boolean);await o.query("delete from scan_codes wh\
ere company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))",[e.ctx.companyId,t,r]);for(let u of r)await X(o,e.ctx.companyId,u,"PRODUTO",t)}await bt(o,e.
ctx.companyId,t,a.groups),await w(o,e.ctx,"produto.alterado",{entity:"product",entityId:t,data:{...a,groups:a.groups?"alterados":void 0}})}).catch(o=>{throw o.code==="23505"?g("SKU\
 j\xE1 usado em outro produto"):o}),n.json({ok:!0})}));T.get("/products/:id/prices",p("cardapio.visualizar"),d(async(e,n)=>{n.json((await c(`select h.old_cents, h.new_cents, h.crea\
ted_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`,[Number(e.params.id),e.ctx.companyId])).rows)}));T.delete("/demo",p("configuracoes.gerenciar"),
d(async(e,n)=>{let t=await k(async a=>{let s=(await a.query("select distinct product_id from order_items where company_id = $1",[e.ctx.companyId])).rows.map(u=>u.product_id),i=await a.
query("update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id",[e.ctx.companyId,s]);await a.query("delete from scan_codes wher\
e company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]),await a.query("delet\
e from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))",[e.ctx.companyId,s]);let r=await a.
query("delete from products where company_id = $1 and demo and not (id = any($2)) returning id",[e.ctx.companyId,s]);return await a.query("delete from categories c where c.company_\
id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)",[e.ctx.companyId]),await w(a,e.ctx,"demonstracao.removida",{data:{removed:r.rowCount,deactivated:i.
rowCount}}),{removed:r.rowCount,deactivated:i.rowCount}});n.json(t)}));import{Router as Qt}from"npm:express@5.2.1";import{z}from"npm:zod@4.6.5";var P=Qt(),ea=e=>Number(e.query.unit_id||e.body?.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;async function Se(e){let n=ea(e);return n?(ue(e.ctx,n),n):(await c("select id from uni\
ts where company_id = $1 and active order by id limit 1",[e.ctx.companyId])).rows[0]?.id}P.get("/tables",p("salao.visualizar"),d(async(e,n)=>{let t=await Se(e),a=e.ctx.can("pdv.rec\
eber")||e.ctx.can("financeiro.visualizar")||e.ctx.can("pdv.lancar"),{rows:o}=await c(`select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
            (select code from scan_codes s where s.company_id = t.company_id and s.entity = 'MESA' and s.entity_id = t.id limit 1) as code,
            (select count(*)::int from consumption_sessions s where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as open_sessions,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status in ('novo','aceito','preparando')) as preparing,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status = 'pronto') as ready
            ${a?`, (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo') as consumed_cents`:""}
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`,[e.ctx.companyId,t]);n.json({unitId:t,tables:o})}));P.post("/tables",p("salao\
.gerenciar"),d(async(e,n)=>{let t=h(z.object({from:z.number().int().min(1).max(9999),count:z.number().int().min(1).max(200),area:z.string().max(40).default("Sal\xE3o"),capacity:z.number().
int().min(1).max(50).default(4)}),e.body),a=await Se(e),o=await k(async s=>{let i=await Me(s,e.ctx.companyId,a,t.from,t.count);return i.length&&await s.query("update dining_tables \
set area = $2, capacity = $3 where id = any($1)",[i,t.area,t.capacity]),await w(s,e.ctx,"mesas.criadas",{unitId:a,data:{from:t.from,count:i.length}}),i});n.status(201).json({created:o.
length})}));P.put("/tables/:id",p("salao.visualizar"),d(async(e,n)=>{let t=h(z.object({status:z.enum(["livre","ocupada","reservada","conta","limpeza"]).optional(),area:z.string().max(
40).optional(),capacity:z.number().int().min(1).max(50).optional(),pos_x:z.number().int().min(0).max(40).optional(),pos_y:z.number().int().min(0).max(40).optional(),active:z.boolean().
optional()}),e.body);if(["area","capacity","pos_x","pos_y","active"].some(s=>s in t)&&!e.ctx.can("salao.gerenciar"))throw _("Sem permiss\xE3o para alterar a estrutura do sal\xE3o");
if(t.status&&!e.ctx.can("salao.gerenciar")&&!e.ctx.can("pdv.lancar"))throw _("Sem permiss\xE3o para mudar a situa\xE7\xE3o da mesa");if(t.status==="livre"&&(await c("select 1 from \
consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')",[Number(e.params.id),e.ctx.companyId])).rows[0])throw g("Mesa com consumo abe\
rto n\xE3o pode ser liberada");if(!(await c(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,[Number(e.params.id),
e.ctx.companyId,t.status??null,t.area??null,t.capacity??null,t.pos_x??null,t.pos_y??null,t.active??null])).rows[0])throw I("Mesa n\xE3o encontrada");await w({query:c},e.ctx,"mesa.a\
lterada",{entity:"table",entityId:e.params.id,data:t}),n.json({ok:!0})}));P.get("/cards",p("pdv.lancar"),d(async(e,n)=>{let t=await Se(e),{rows:a}=await c(`select c.id, c.number, c\
.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            (select s.id from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') limit 1) as session_id
       from tab_cards c where c.company_id = $1 and c.unit_id = $2 order by c.number`,[e.ctx.companyId,t]);n.json({unitId:t,cards:a})}));P.post("/cards",p("comandas.gerenciar"),d(async(e,n)=>{
let t=h(z.object({from:z.number().int().min(1).max(999999),count:z.number().int().min(1).max(1e3)}),e.body),a=await Se(e),o=await k(async s=>{let i=(await s.query("select coalesce(\
settings->'pdv'->>'card_prefix','CMD-') p from companies where id = $1",[e.ctx.companyId])).rows[0].p,r=await Ue(s,e.ctx.companyId,a,t.from,t.count,i);return await w(s,e.ctx,"coman\
das.geradas",{unitId:a,data:{from:t.from,count:r.length}}),r});n.status(201).json({created:o})}));P.post("/cards/:id/block",p("comandas.gerenciar"),d(async(e,n)=>{let t=h(z.object(
{reason:z.string().trim().min(3).max(200)}),e.body);if(!(await c("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id",[Number(
e.params.id),e.ctx.companyId,t.reason])).rows[0])throw I();await w({query:c},e.ctx,"comanda.bloqueada",{entity:"card",entityId:e.params.id,reason:t.reason}),n.json({ok:!0})}));P.post(
"/cards/:id/unblock",p("comandas.gerenciar"),d(async(e,n)=>{if(!(await c("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id",
[Number(e.params.id),e.ctx.companyId])).rows[0])throw I();await w({query:c},e.ctx,"comanda.desbloqueada",{entity:"card",entityId:e.params.id}),n.json({ok:!0})}));P.post("/cards/:id\
/replace",p("comandas.gerenciar"),d(async(e,n)=>{let t=h(z.object({new_card_id:z.number().int(),reason:z.string().trim().min(3).max(200)}),e.body);await k(async a=>{let o=(await a.
query("select * from tab_cards where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0],s=(await a.query("select * from tab_cards where id = $1\
 and company_id = $2 for update",[t.new_card_id,e.ctx.companyId])).rows[0];if(!o||!s)throw I("Cart\xE3o n\xE3o encontrado");if(s.status!=="ativo")throw _("O novo cart\xE3o est\xE1 bloque\
ado");if(o.unit_id!==s.unit_id)throw _("Cart\xF5es de unidades diferentes");if((await a.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fec\
hamento')",[s.id])).rows[0])throw g("O novo cart\xE3o j\xE1 tem consumo em aberto");await a.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1",[o.id,
`Substitu\xEDdo pelo ${s.number}: ${t.reason}`]);let r=await a.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta'\
,'em_fechamento') returning id",[o.id,s.id]);await w(a,e.ctx,"comanda.substituida",{entity:"card",entityId:o.id,reason:t.reason,data:{new_card:s.id,session:r.rows[0]?.id??null}})}),
n.json({ok:!0})}));import{Router as ta}from"npm:express@5.2.1";import{z as l}from"npm:zod@4.6.5";var C=ta();async function xt(e,n,t){let a=await e.query("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2",
[t,n]);if(!a.rows[0])throw _("Unidade inv\xE1lida");return a.rows[0]}C.post("/resolve",p("pdv.lancar"),d(async(e,n)=>{let{code:t}=h(l.object({code:l.string().max(256)}),e.body),a=await _e(
{query:c},e.ctx.companyId,t);a.type==="DESCONHECIDO"&&await w({query:c},e.ctx,"leitura.desconhecida",{data:{code:a.code.slice(0,40)}}),n.json(a)}));C.get("/sessions",p("pdv.lancar"),
d(async(e,n)=>{let t=e.query.status==="all"?null:["aberta","em_fechamento"],a=[e.ctx.companyId],o="s.company_id = $1";t&&(a.push(t),o+=` and s.status = any($${a.length})`);let s=Number(
e.query.unit_id)||e.ctx.terminalUnitId||e.ctx.unitId;s&&(a.push(s),o+=` and s.unit_id = $${a.length}`);let{rows:i}=await c(`select s.id, s.kind, s.status, s.label, s.customer_name,\
 s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${o} order by s.opened_at desc limit 300`,a);n.json(i)}));var aa=l.object({kind:l.enum(["comanda","mesa","balcao","retirada"]),card_id:l.number().int().optional(),card_code:l.
string().max(128).optional(),table_id:l.number().int().optional(),customer_name:l.string().trim().max(80).optional(),label:l.string().trim().max(60).optional(),unit_id:l.number().int().
optional()});async function na(e,n,t){J(n,"pdv.abrir_comanda");let a=t.unit_id||n.terminalUnitId||n.unitId,o=null,s=null;if(t.card_code&&!t.card_id){let y=await _e(e,n.companyId,t.
card_code);if(y.type!=="COMANDA")throw _("C\xF3digo n\xE3o \xE9 de comanda");t.card_id=y.card.id}if(t.card_id){let y=(await e.query("select * from tab_cards where id = $1 and compa\
ny_id = $2 for update",[t.card_id,n.companyId])).rows[0];if(!y)throw I("Comanda n\xE3o encontrada");if(y.status!=="ativo")throw g(`Comanda ${y.number} bloqueada${y.block_reason?`: ${y.
block_reason}`:""}`,"card_blocked");let $=await e.query("select id from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento')",[y.id]);if($.rows[0])throw g(
`Comanda ${y.number} j\xE1 est\xE1 em uso`,"card_busy",{session_id:$.rows[0].id});o=y.id,a=y.unit_id}if(t.table_id){let y=(await e.query("select * from dining_tables where id = $1 \
and company_id = $2 and active",[t.table_id,n.companyId])).rows[0];if(!y)throw I("Mesa n\xE3o encontrada");if(a&&y.unit_id!==a)throw _("Mesa e comanda de unidades diferentes");s=y.
id,a=y.unit_id}if(t.kind==="comanda"&&!o)throw _("Informe a comanda");if(t.kind==="mesa"&&!s)throw _("Informe a mesa");a||(a=(await e.query("select id from units where company_id =\
 $1 and active order by id limit 1",[n.companyId])).rows[0]?.id),ue(n,a);let i=await U(e,n,a),{day_cutoff:r,timezone:u}=await xt(e,n.companyId,a),f=await e.query(`insert into consu\
mption_sessions (company_id, unit_id, kind, card_id, table_id, customer_name, label, service_fee_bp, opened_by, business_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[n.companyId,a,t.kind,o,s,t.customer_name??null,t.label??null,t.kind==="balcao"||t.kind==="retirada"?0:i.service_fee_bp,n.
userId,W(new Date,u,r)]);return s&&await e.query("update dining_tables set status = 'ocupada' where id = $1 and status in ('livre','reservada','limpeza')",[s]),await w(e,n,"consumo\
.aberto",{entity:"session",entityId:f.rows[0].id,unitId:a,data:{kind:t.kind,card:o,table:s}}),f.rows[0]}C.post("/sessions",d(async(e,n)=>{let t=h(aa,e.body),a=await k(o=>na(o,e.ctx,
t)).catch(o=>{throw o.code==="23505"?g("Comanda j\xE1 est\xE1 em uso","card_busy"):o});n.status(201).json(a)}));async function oa(e,n,t){let a=(await e.query(`select s.*, c.number \
as card_number, t.number as table_number, u.name as opened_by_name
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by where s.id = $1 and s.company_id = $2`,[t,n.companyId])).rows[0];if(!a)throw I("Consumo n\xE3o encontrado");let o=(await e.query(`sel\
ect i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`,[t])).rows,s=(await e.query(`select p.id, p.method, p.amount_cents, p.tendere\
d_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`,[t])).rows;return{...a,items:o,payments:s,totals:await O(e,t)}}C.get("/sessions/\
:id",p("pdv.lancar"),d(async(e,n)=>{n.json(await oa({query:c},e.ctx,Number(e.params.id)))}));var ia=l.object({session_id:l.number().int(),product_id:l.number().int().optional(),qty:l.
number().positive().max(9999).optional(),option_ids:l.array(l.number().int()).max(40).default([]),notes:l.string().trim().max(200).optional(),launch_mode:l.enum(["manual","continua",
"dupla","excecao","balcao"]),idempotency_key:l.string().regex(/^[A-Za-z0-9_-]{8,80}$/),scan:l.object({card_code:l.string().max(128).optional(),product_code:l.string().max(128).optional()}).
optional(),price_override_cents:l.number().int().min(0).max(1e8).optional(),discount_cents:l.number().int().min(0).max(1e8).optional(),authorization:l.string().max(100).optional(),
exception_reason:l.string().trim().max(200).optional()});C.post("/items",p("pdv.lancar"),d(async(e,n)=>{let t=h(ia,e.body),a=e.ctx,o=await c("select * from order_items where compan\
y_id = $1 and idempotency_key = $2",[a.companyId,t.idempotency_key]);if(o.rows[0]){if(Number(o.rows[0].session_id)!==t.session_id)throw g("Chave de opera\xE7\xE3o j\xE1 usada em outro lan\xE7a\
mento","idempotency_mismatch");return n.json({item:o.rows[0],replay:!0,totals:await O({query:c},t.session_id)})}let s=await k(async i=>{let r=await R(i,a.companyId,t.session_id);ue(
a,r.unit_id),Q(r);let u=await U(i,a,r.unit_id),f=t.product_id,y=null;if(t.launch_mode==="dupla"||t.launch_mode==="continua"){if(!u.scanner_enabled)throw S("Leitor desabilitado nest\
a configura\xE7\xE3o","scanner_disabled");if(t.launch_mode==="continua"&&u.double_read_mandatory)throw S("Dupla leitura obrigat\xF3ria: leitura cont\xEDnua n\xE3o permitida","doubl\
e_read_required");let D=await _e(i,a.companyId,t.scan?.product_code);if(D.type!=="PRODUTO")throw _("C\xF3digo lido n\xE3o \xE9 de produto","not_a_product");if(f&&f!==D.product.id)throw _(
"Produto informado difere do c\xF3digo lido");if(f=D.product.id,t.launch_mode==="dupla"){let q=await _e(i,a.companyId,t.scan?.card_code);if(q.type!=="COMANDA")throw _("Dupla leitur\
a exige a leitura da comanda antes do produto","card_required");if(Number(q.card.id)!==Number(r.card_id))throw g("Comanda lida n\xE3o corresponde ao consumo de destino","card_misma\
tch")}}else if(t.launch_mode==="excecao"){if(!u.allow_manual_exception)throw S("Exce\xE7\xE3o manual desabilitada","exception_disabled");if(J(a,"pdv.excecao_dupla_leitura"),!t.exception_reason)
throw _("Informe o motivo da exce\xE7\xE3o");u.exception_requires_manager&&(y=(await K(i,a,t.authorization,"excecao_dupla_leitura")).authorized_by)}else{if(u.double_read_mandatory)
throw S("Dupla leitura obrigat\xF3ria: use a exce\xE7\xE3o autorizada para lan\xE7ar manualmente","double_read_required");if(!u.allow_manual)throw S("Lan\xE7amento manual desabilitado",
"manual_disabled");J(a,"pdv.lancamento_manual")}if(!f)throw _("Informe o produto");let $=(await i.query("select * from products where id = $1 and company_id = $2",[f,a.companyId])).
rows[0];if(!$)throw I("Produto n\xE3o encontrado");if(!$.active)throw g(`${$.name} est\xE1 indispon\xEDvel`,"product_inactive");let N=t.qty,ne=t.launch_mode==="dupla"||t.launch_mode===
"continua";if($.kind==="weight"){if(!N)throw _(`${$.name} \xE9 vendido por peso: informe o peso`,"weight_required")}else{if(N=N??(ne?u.qty_per_scan:1),!Number.isInteger(N))throw _(
"Quantidade deve ser inteira para este produto");if(ne&&N!==u.qty_per_scan&&(J(a,"pdv.alterar_quantidade"),N>u.max_qty_per_scan))throw _(`Quantidade por leitura limitada a ${u.max_qty_per_scan}`)}
let B=(await i.query(`select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`,[$.id])).rows,oe=[];for(let D of B){let q=D.options.filter(le=>t.option_ids.includes(le.id));if(q.length<D.min_select)
throw _(`Escolha ${D.min_select===1?"uma op\xE7\xE3o":`${D.min_select} op\xE7\xF5es`} em "${D.name}"`,"options_required");if(q.length>D.max_select)throw _(`No m\xE1ximo ${D.max_select}\
 em "${D.name}"`);for(let le of q)oe.push({group:D.name,id:le.id,name:le.name,price_cents:le.price_cents})}if(oe.length!==new Set(t.option_ids).size)throw _("Op\xE7\xE3o inv\xE1lida para es\
te produto");let fe=oe.reduce((D,q)=>D+q.price_cents,0),ie=$.price_cents,he={};t.price_override_cents!=null&&t.price_override_cents!==$.price_cents&&(a.can("pdv.alterar_preco")||await K(
i,a,t.authorization,"alterar_preco"),ie=t.price_override_cents,he.price={from:$.price_cents,to:ie});let me=t.discount_cents||0;me&&(a.can("pdv.desconto")||await K(i,a,t.authorization,
"desconto"),he.discount=me);let Je=De(ie,N,fe,me);if(me>De(ie,N,fe,0))throw _("Desconto maior que o valor do item");let Ke=(await i.query(`insert into order_items (company_id, sess\
ion_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,[a.companyId,r.id,$.id,$.name,N,$.unit,ie,JSON.stringify(oe),fe,me,Je,t.notes??null,$.sector_id,
$.sector_id?"novo":"nao_produz",t.launch_mode,a.terminalId,a.userId,t.idempotency_key])).rows[0];return await i.query("update consumption_sessions set version = version + 1 where i\
d = $1",[r.id]),(t.launch_mode==="excecao"||Object.keys(he).length)&&await w(i,a,t.launch_mode==="excecao"?"pdv.excecao_manual":"pdv.item_ajustado",{entity:"item",entityId:Ke.id,unitId:r.
unit_id,reason:t.exception_reason,data:{session:r.id,product:$.id,authorized_by:y,...he}}),{item:Ke,totals:await O(i,r.id),confirmation:{product:$.name,qty:N,unit_price_cents:ie+fe,
total_cents:Je,destination:r.card_id?`Comanda ${(await i.query("select number from tab_cards where id = $1",[r.card_id])).rows[0].number}`:r.label||`Consumo ${r.id}`}}}).catch(async i=>{
if(i.code==="23505"){let r=await c("select * from order_items where company_id = $1 and idempotency_key = $2",[a.companyId,t.idempotency_key]);if(r.rows[0])return{item:r.rows[0],replay:!0,
totals:await O({query:c},r.rows[0].session_id)}}throw i});n.status(s.replay?200:201).json(s)}));C.get("/items/by-key/:key",p("pdv.lancar"),d(async(e,n)=>{let t=await c("select * fr\
om order_items where company_id = $1 and idempotency_key = $2",[e.ctx.companyId,String(e.params.key).slice(0,80)]);n.json({found:!!t.rows[0],item:t.rows[0]||null})}));C.post("/item\
s/:id/cancel",p("pdv.lancar"),d(async(e,n)=>{let t=h(l.object({reason:l.string().trim().min(3).max(200),authorization:l.string().max(100).optional()}),e.body),a=await k(async o=>{let s=(await o.
query("select * from order_items where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!s)throw I("Item n\xE3o encontrado");let i=await R(o,e.ctx.companyId,
s.session_id);Q(i);let r=(await o.query("select * from order_items where id = $1 for update",[s.id])).rows[0];if(r.status!=="ativo")throw g("Item j\xE1 cancelado");let u=null;e.ctx.
can("pdv.cancelar_item")||(u=(await K(o,e.ctx,t.authorization,"cancelar_item")).authorized_by);let f=["preparando","pronto","entregue"].includes(r.kitchen_status);if(await o.query(
`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,[r.id,t.reason,e.ctx.userId]),(await O(o,i.id)).
balance<0)throw g("Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.","overpaid");return await o.query("update consumption_sessions \
set version = version + 1 where id = $1",[i.id]),await w(o,e.ctx,"pdv.item_cancelado",{entity:"item",entityId:r.id,unitId:i.unit_id,reason:t.reason,data:{session:i.id,total_cents:r.
total_cents,after_preparation:f,kitchen_status:r.kitchen_status,authorized_by:u}}),{ok:!0,after_preparation:f,totals:await O(o,i.id)}});n.json(a)}));C.post("/items/transfer",p("pdv\
.transferir_item"),d(async(e,n)=>{let t=h(l.object({item_ids:l.array(l.number().int()).min(1).max(200),target_session_id:l.number().int(),reason:l.string().trim().min(3).max(200)}),
e.body);n.json(await k(a=>vt(a,e.ctx,t.item_ids,t.target_session_id,t.reason)))}));async function vt(e,n,t,a,o){let s=(await e.query("select * from order_items where id = any($1) a\
nd company_id = $2 and status = 'ativo'",[t,n.companyId])).rows;if(s.length!==new Set(t).size)throw _("Itens inv\xE1lidos ou j\xE1 cancelados");let i=[...new Set(s.map(y=>Number(y.
session_id)))],r=[...i,a].sort((y,$)=>y-$),u={};for(let y of r)u[y]=await R(e,n.companyId,y);let f=u[a];Q(f);for(let y of i){let $=u[y];if(Q($),y===a)throw _("Origem e destino igua\
is");if($.unit_id!==f.unit_id)throw _("Transfer\xEAncia entre unidades n\xE3o permitida")}for(let y of s){let $=await e.query(`insert into order_items (company_id, session_id, prod\
uct_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,[y.id,a,n.terminalId,n.userId,String(y.
id)]);await e.query("update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1",[y.id,`Transferido para consumo ${a} (ite\
m ${$.rows[0].id})`,n.userId])}for(let y of i){if((await O(e,y)).balance<0)throw g("A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.","overpaid");await e.
query("update consumption_sessions set version = version + 1 where id = $1",[y])}return await e.query("update consumption_sessions set version = version + 1 where id = $1",[a]),await w(
e,n,"pdv.itens_transferidos",{entity:"session",entityId:a,reason:o,data:{items:t,from:i}}),{ok:!0,moved:s.length}}C.post("/sessions/:id/merge",p("pdv.transferir_item"),d(async(e,n)=>{
let t=h(l.object({target_session_id:l.number().int(),reason:l.string().trim().min(3).max(200)}),e.body),a=Number(e.params.id);n.json(await k(async o=>{let s=(await o.query("select \
id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'",[a,e.ctx.companyId])).rows.map(u=>u.id);if(!s.length)throw _("Consumo sem itens para juntar");if((await o.
query("select 1 from payments where session_id = $1 and status = 'confirmado'",[a])).rows[0])throw g("Consumo com pagamento registrado n\xE3o pode ser juntado; transfira os itens rest\
antes","has_payments");let r=await vt(o,e.ctx,s,t.target_session_id,t.reason);return await o.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_\
by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1",[a,e.ctx.userId]),r}))}));C.post("/sessions/:id/move-table",p("pdv.transferir_item"),d(async(e,n)=>{let t=h(l.object(
{table_id:l.number().int(),reason:l.string().trim().min(3).max(200)}),e.body);await k(async a=>{let o=await R(a,e.ctx.companyId,Number(e.params.id));Q(o);let s=(await a.query("sele\
ct * from dining_tables where id = $1 and company_id = $2 and active",[t.table_id,e.ctx.companyId])).rows[0];if(!s)throw I("Mesa n\xE3o encontrada");if(s.unit_id!==o.unit_id)throw _(
"Mesa de outra unidade");await a.query("update consumption_sessions set table_id = $2, version = version + 1 where id = $1",[o.id,s.id]),await a.query("update dining_tables set sta\
tus = 'ocupada' where id = $1",[s.id]),o.table_id&&await Fe(a,o.table_id),await w(a,e.ctx,"pdv.mesa_trocada",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.table_id,to:s.
id}})}),n.json({ok:!0})}));async function Fe(e,n){await e.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','conta')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`,[n])}C.post("/sessions/:id/service-fee",p("pdv.l\
ancar"),d(async(e,n)=>{let t=h(l.object({bp:l.number().int().min(0).max(3e3),reason:l.string().trim().min(3).max(200),authorization:l.string().max(100).optional()}),e.body);n.json(
await k(async a=>{let o=await R(a,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw g("Consumo encerrado");e.ctx.can("pdv.taxa_servico")||
await K(a,e.ctx,t.authorization,"taxa_servico");let s=(await O(a,o.id)).paid;await a.query("update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, ve\
rsion = version + 1 where id = $1",[o.id,t.bp,t.reason]);let i=await O(a,o.id);if(s>i.total)throw g("Pagamento registrado supera o novo total. Estorne antes.","overpaid");return await w(
a,e.ctx,"pdv.taxa_servico",{entity:"session",entityId:o.id,reason:t.reason,data:{from:o.service_fee_bp,to:t.bp}}),i}))}));C.post("/sessions/:id/request-close",p("pdv.lancar"),d(async(e,n)=>{
n.json(await k(async t=>{let a=await R(t,e.ctx.companyId,Number(e.params.id));return Q(a),await t.query("update consumption_sessions set status = 'em_fechamento', version = version\
 + 1 where id = $1",[a.id]),a.table_id&&await t.query("update dining_tables set status = 'conta' where id = $1",[a.table_id]),{ok:!0}}))}));C.post("/sessions/:id/resume",p("pdv.lan\
car"),d(async(e,n)=>{n.json(await k(async t=>{let a=await R(t,e.ctx.companyId,Number(e.params.id));if(a.status!=="em_fechamento")throw g("Consumo n\xE3o est\xE1 em fechamento");return await t.
query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1",[a.id]),a.table_id&&await t.query("update dining_tables set status = 'ocupada' where \
id = $1",[a.table_id]),{ok:!0}}))}));C.post("/sessions/:id/suspend",p("pdv.lancar"),d(async(e,n)=>{let t=h(l.object({suspended:l.boolean()}),e.body);await c("update consumption_ses\
sions set suspended = $3 where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId,t.suspended]),n.json({ok:!0})}));C.get("/sessions/:id/split",p("pdv.lancar"),d(async(e,n)=>{
let t=Math.min(Math.max(Number(e.query.parts)||2,2),50),a=await O({query:c},Number(e.params.id));n.json({parts:We(Math.max(a.balance,0),t),balance:a.balance})}));C.post("/sessions/\
:id/close",p("pdv.receber"),d(async(e,n)=>{let t=h(l.object({version:l.number().int()}),e.body);n.json(await k(async a=>{let o=await R(a,e.ctx.companyId,Number(e.params.id));if(!["\
aberta","em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerrado","already_closed");if(o.version!==t.version)throw g("O consumo foi alterado em outro terminal. Confira \
antes de fechar.","version_conflict",{version:o.version});let s=await O(a,o.id);if(s.balance!==0)throw g(`Saldo pendente de ${(s.balance/100).toFixed(2)}. Receba antes de encerrar.`,
"balance_pending");if(s.items===0)throw _("Consumo sem itens: use cancelar");return await a.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_b\
y = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await Fe(a,o.table_id),await w(a,e.ctx,"consumo.encerrado",{entity:"session",entityId:o.id,unitId:o.unit_id,
data:s}),{ok:!0,totals:s}}))}));C.post("/sessions/:id/cancel",p("pdv.lancar"),d(async(e,n)=>{let t=h(l.object({reason:l.string().trim().min(3).max(200),authorization:l.string().max(
100).optional()}),e.body);n.json(await k(async a=>{let o=await R(a,e.ctx.companyId,Number(e.params.id));if(!["aberta","em_fechamento"].includes(o.status))throw g("Consumo j\xE1 encerr\
ado");let s=await O(a,o.id);if(s.paid>0)throw g("H\xE1 pagamentos confirmados: estorne antes de cancelar","has_payments");let i=null;return s.items>0&&!e.ctx.can("pdv.cancelar_vend\
a")&&(i=(await K(a,e.ctx,t.authorization,"cancelar_venda")).authorized_by),await a.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, cancele\
d_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`,[o.id,`Consumo cancelado: ${t.reason}`,e.ctx.userId]),await a.query("update consumption_sessions set status = 'cance\
lada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1",[o.id,e.ctx.userId]),o.table_id&&await Fe(a,o.table_id),await w(a,e.ctx,"consumo.cancelado",{entity:"\
session",entityId:o.id,reason:t.reason,data:{items_cents:s.items,authorized_by:i}}),{ok:!0}}))}));C.post("/sessions/:id/reopen",p("pdv.lancar"),d(async(e,n)=>{let t=h(l.object({reason:l.
string().trim().min(3).max(200),authorization:l.string().max(100).optional()}),e.body);n.json(await k(async a=>{let o=await R(a,e.ctx.companyId,Number(e.params.id));if(o.status!=="\
encerrada")throw g("S\xF3 consumos encerrados podem ser reabertos");let s=null;if(e.ctx.can("pdv.reabrir_comanda")||(s=(await K(a,e.ctx,t.authorization,"reabrir_comanda")).authorized_by),
o.card_id&&(await a.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2",[o.card_id,o.id])).rows[0])throw g("O cart\xE3o\
 j\xE1 est\xE1 em uso por outro consumo. Transfira os itens em vez de reabrir.","card_busy");return await a.query("update consumption_sessions set status = 'aberta', closed_at = nu\
ll, closed_by = null, version = version + 1 where id = $1",[o.id]),o.table_id&&await a.query("update dining_tables set status = 'ocupada' where id = $1",[o.table_id]),await w(a,e.ctx,
"consumo.reaberto",{entity:"session",entityId:o.id,reason:t.reason,data:{authorized_by:s}}),{ok:!0}}))}));async function sa(e,n,t){let a=[n.companyId],o="company_id = $1 and status\
 = 'aberto'";return n.terminalId?(a.push(n.terminalId),o+=` and terminal_id = $${a.length}`):(a.push(n.userId,t),o+=` and user_id = $${a.length-1} and unit_id = $${a.length} and te\
rminal_id is null`),(await e.query(`select * from cash_sessions where ${o} order by id desc limit 1`,a)).rows[0]}var ra=l.object({method:l.enum(["dinheiro","pix","debito","credito",
"vale","outro"]),amount_cents:l.number().int().positive().max(1e8),tendered_cents:l.number().int().positive().max(1e8).optional(),idempotency_key:l.string().regex(/^[A-Za-z0-9_-]{8,80}$/)});
C.post("/sessions/:id/payments",p("pdv.receber"),d(async(e,n)=>{let t=h(ra,e.body),a=e.ctx,o=await c("select * from payments where company_id = $1 and idempotency_key = $2",[a.companyId,
t.idempotency_key]);if(o.rows[0])return n.json({payment:o.rows[0],replay:!0,totals:await O({query:c},o.rows[0].session_id)});let s=await k(async i=>{let r=await R(i,a.companyId,Number(
e.params.id));if(ue(a,r.unit_id),!["aberta","em_fechamento"].includes(r.status))throw g("Consumo encerrado","session_not_open");let u=await U(i,a,r.unit_id),f=await sa(i,a,r.unit_id);
if(!f&&u.require_open_cash)throw g("Abra o caixa antes de receber","cash_closed");let y=await O(i,r.id);if(t.amount_cents>y.balance)throw _(`Valor maior que o saldo (${(y.balance/100).
toFixed(2)})`,"over_balance");let $=0;if(t.tendered_cents!=null){if(t.method!=="dinheiro")throw _("Troco s\xF3 \xE9 permitido em dinheiro","change_not_allowed");if(t.tendered_cents<
t.amount_cents)throw _("Valor entregue menor que o valor a pagar");$=t.tendered_cents-t.amount_cents}let{day_cutoff:N,timezone:ne}=await xt(i,a.companyId,r.unit_id),B=(await i.query(
`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[a.companyId,r.id,f?.id??null,t.method,t.amount_cents,t.tendered_cents??null,$,W(new Date,ne,N),t.idempotency_key,a.userId])).
rows[0];return await i.query("update consumption_sessions set version = version + 1 where id = $1",[r.id]),await w(i,a,"pagamento.registrado",{entity:"payment",entityId:B.id,unitId:r.
unit_id,data:{session:r.id,method:t.method,amount_cents:t.amount_cents,change_cents:$}}),{payment:B,totals:await O(i,r.id)}}).catch(async i=>{if(i.code==="23505"){let r=await c("se\
lect * from payments where company_id = $1 and idempotency_key = $2",[a.companyId,t.idempotency_key]);if(r.rows[0])return{payment:r.rows[0],replay:!0,totals:await O({query:c},r.rows[0].
session_id)}}throw i});n.status(s.replay?200:201).json(s)}));C.post("/payments/:id/refund",p("financeiro.estornar"),d(async(e,n)=>{let t=h(l.object({reason:l.string().trim().min(3).
max(200)}),e.body);n.json(await k(async a=>{let o=(await a.query("select * from payments where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw I(
"Pagamento n\xE3o encontrado");let s=await R(a,e.ctx.companyId,o.session_id);if(!["aberta","em_fechamento"].includes(s.status))throw g("Reabra o consumo antes de estornar","session\
_closed");if(!(await a.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now()
                              where id = $1 and status = 'confirmado' returning id`,[o.id,t.reason,e.ctx.userId])).rows[0])throw g("Pagamento j\xE1 estornado");return await a.query(
"update consumption_sessions set version = version + 1 where id = $1",[s.id]),await w(a,e.ctx,"pagamento.estornado",{entity:"payment",entityId:o.id,reason:t.reason,data:{amount_cents:o.
amount_cents,method:o.method}}),{ok:!0,totals:await O(a,s.id)}}))}));C.post("/mode",p("pdv.lancar"),d(async(e,n)=>{let t=h(l.object({from:l.enum(["manual","continua","dupla"]),to:l.
enum(["manual","continua","dupla"]),reason:l.string().trim().max(200).optional()}),e.body),a=await U({query:c},e.ctx,e.ctx.terminalUnitId||e.ctx.unitId);if(t.from!==t.to){if(J(e.ctx,
"pdv.alterar_modo"),!a.allow_mode_change)throw S("Troca de modo desabilitada nesta configura\xE7\xE3o","mode_locked");if(a.double_read_mandatory&&t.to!=="dupla")throw S("Dupla leit\
ura obrigat\xF3ria: use a exce\xE7\xE3o autorizada","double_read_required");if(!a.scanner_enabled&&t.to!=="manual")throw S("Leitor desabilitado","scanner_disabled")}await w({query:c},
e.ctx,"pdv.modo_alterado",{reason:t.reason,data:{from:t.from,to:t.to}}),n.json({ok:!0,mode:t.to})}));import{Router as ca}from"npm:express@5.2.1";import{z as A}from"npm:zod@4.6.5";var F=ca(),Be=["dinheiro","pix","debito","credito","vale","outro"];async function Ce(e,n){let t=(await e.query("select opening_cents from cash_sessions where id = $1",[n])).rows[0],
a=(await e.query("select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' group by method",[n])).rows,o=(await e.
query("select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind",[n])).rows,s=Object.fromEntries(Be.map(r=>[r,0]));for(let r of a)
s[r.method]=Number(r.total);let i=Object.fromEntries(o.map(r=>[r.kind,Number(r.total)]));return s.dinheiro=t.opening_cents+s.dinheiro+(i.suprimento||0)-(i.sangria||0)-(i.despesa||0),
{byMethod:s,opening:t.opening_cents,movements:i}}async function It(e){let n=[e.ctx.companyId],t="c.company_id = $1 and c.status = 'aberto'";return e.ctx.terminalId?(n.push(e.ctx.terminalId),
t+=` and c.terminal_id = $${n.length}`):(n.push(e.ctx.userId),t+=` and c.user_id = $${n.length} and c.terminal_id is null`),(await c(`select c.*, u.name as user_name from cash_sess\
ions c join users u on u.id = c.user_id where ${t} order by c.id desc limit 1`,n)).rows[0]}F.get("/current",d(async(e,n)=>{let t=await It(e);if(!t)return n.json({open:!1});let a=e.
ctx.can("financeiro.visualizar");n.json({open:!0,cash:{id:t.id,opened_at:t.opened_at,user_name:t.user_name,opening_cents:t.opening_cents,business_date:t.business_date},expected:a?await Ce(
{query:c},t.id):null})}));F.post("/open",p("caixa.abrir"),d(async(e,n)=>{let t=h(A.object({opening_cents:A.number().int().min(0).max(1e7)}),e.body),a=e.ctx.terminalUnitId||e.ctx.unitId||
(await c("select id from units where company_id = $1 order by id limit 1",[e.ctx.companyId])).rows[0].id;if(!e.ctx.terminalId&&(await c("select 1 from terminals where company_id = \
$1 and active limit 1",[e.ctx.companyId])).rows[0])throw _("Identifique o terminal deste dispositivo antes de abrir o caixa","terminal_required");if(await It(e))throw g("J\xE1 existe \
caixa aberto neste terminal","cash_open");let o=(await c("select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1",[a])).rows[0],s=await c(
"insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,a,e.ctx.terminalId,e.
ctx.userId,t.opening_cents,W(new Date,o.timezone,o.day_cutoff)]).catch(i=>{throw i.code==="23505"?g("J\xE1 existe caixa aberto neste terminal","cash_open"):i});await w({query:c},e.
ctx,"caixa.aberto",{entity:"cash",entityId:s.rows[0].id,unitId:a,data:t}),n.status(201).json({id:s.rows[0].id})}));F.post("/:id/movements",d(async(e,n)=>{let t=h(A.object({kind:A.enum(
["sangria","suprimento","despesa"]),amount_cents:A.number().int().positive().max(1e7),reason:A.string().trim().min(3).max(200)}),e.body);J(e.ctx,t.kind==="suprimento"?"caixa.suprim\
ento":"caixa.sangria");let a=await k(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw I("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa fechado");if(t.kind!=="suprimento"){let r=await Ce(o,s.id);if(t.amount_cents>r.byMethod.dinheiro)
throw _("Valor maior que o dinheiro esperado na gaveta")}let i=await o.query("insert into cash_movements (company_id, cash_session_id, kind, amount_cents, reason, user_id) values (\
$1,$2,$3,$4,$5,$6) returning id",[e.ctx.companyId,s.id,t.kind,t.amount_cents,t.reason,e.ctx.userId]);return await w(o,e.ctx,`caixa.${t.kind}`,{entity:"cash",entityId:s.id,reason:t.
reason,data:{amount_cents:t.amount_cents}}),{id:i.rows[0].id}});n.status(201).json(a)}));F.post("/:id/close",p("caixa.fechar"),d(async(e,n)=>{let t=h(A.object({counted:A.object(Object.
fromEntries(Be.map(o=>[o,A.number().int().min(0).max(1e8).default(0)]))),notes:A.record(A.string(),A.number().int().min(0).max(1e5)).optional(),justification:A.string().trim().max(
300).optional()}),e.body),a=await k(async o=>{let s=(await o.query("select * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).
rows[0];if(!s)throw I("Caixa n\xE3o encontrado");if(s.status!=="aberto")throw g("Caixa j\xE1 fechado");let i=await Ce(o,s.id),r=Object.fromEntries(Be.map(f=>[f,(t.counted[f]||0)-(i.
byMethod[f]||0)])),u=Object.values(r).reduce((f,y)=>f+y,0);if(Object.values(r).some(f=>f!==0)&&!t.justification)throw _("H\xE1 diferen\xE7a na confer\xEAncia: informe a justificativa",
"justification_required");return await o.query(`update cash_sessions set status = 'fechado', closed_at = now(), closed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,[s.id,e.ctx.userId,{...t.counted,notes:t.notes??null},i.byMethod,u,t.justification??null]),await w(o,
e.ctx,"caixa.fechado",{entity:"cash",entityId:s.id,reason:t.justification,data:{difference_cents:u,by_method:r}}),{ok:!0,expected:i.byMethod,counted:t.counted,difference_cents:u,by_method:r}});
n.json(a)}));F.post("/:id/reopen",p("caixa.reabrir"),d(async(e,n)=>{let t=h(A.object({reason:A.string().trim().min(3).max(200)}),e.body);await k(async a=>{let o=(await a.query("sel\
ect * from cash_sessions where id = $1 and company_id = $2 for update",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!o)throw I();if(o.status!=="fechado")throw g("Caixa n\xE3o es\
t\xE1 fechado");if(new Date(o.closed_at)<new Date(Date.now()-48*3600*1e3))throw _("Reabertura permitida at\xE9 48 horas ap\xF3s o fechamento");if((o.terminal_id?await a.query("sele\
ct 1 from cash_sessions where terminal_id = $1 and status = 'aberto'",[o.terminal_id]):{rows:[]}).rows[0])throw g("J\xE1 existe outro caixa aberto neste terminal");await a.query("u\
pdate cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1",[o.id]),await w(a,e.ctx,"caixa.reaberto",{entity:"cash",entityId:o.id,reason:t.reason,data:{
previous:{counted:o.counted,difference_cents:o.difference_cents,closed_at:o.closed_at}}})}),n.json({ok:!0})}));F.get("/",p("financeiro.visualizar"),d(async(e,n)=>{n.json((await c(`\
select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`,[e.ctx.companyId])).rows)}));F.get("/:id/report",p("financeiro.visualizar"),d(async(e,n)=>{let t=(await c(
"select * from cash_sessions where id = $1 and company_id = $2",[Number(e.params.id),e.ctx.companyId])).rows[0];if(!t)throw I();let a=(await c("select m.kind, m.amount_cents, m.rea\
son, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id",[t.id])).rows;n.json({cash:t,expected:await Ce(
{query:c},t.id),movements:a})}));import{Router as da}from"npm:express@5.2.1";var Ee=da();Ee.get("/dashboard",d(async(e,n)=>{let t=e.ctx,a=(await c("select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit \
1",[t.companyId,t.terminalUnitId||t.unitId||null])).rows[0],o=W(new Date,t.company.timezone,a?.day_cutoff??5),s=t.can("financeiro.visualizar"),i=(await c(`select
       (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
         where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' and s.status <> 'cancelada') as consumed_cents,
       (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado') as received_cents,
       (select count(*)::int from consumption_sessions where company_id = $1 and status in ('aberta','em_fechamento')) as open_sessions,
       (select count(*)::int from dining_tables where company_id = $1 and active and status in ('ocupada','conta')) as busy_tables,
       (select count(*)::int from dining_tables where company_id = $1 and active) as total_tables,
       (select count(*)::int from order_items where company_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','preparando')) as preparing,
       (select count(*)::int from cash_sessions where company_id = $1 and business_date = $2 and status = 'fechado' and difference_cents <> 0) as cash_differences,
       (select count(*)::int from cash_sessions where company_id = $1 and status = 'aberto') as open_cash,
       (select count(*)::int from products where company_id = $1 and demo) as demo_products`,[t.companyId,o])).rows[0],r=s?(await c(`select extract(hour from p.created_at at time z\
one $3)::int as hour, sum(p.amount_cents)::bigint as cents
       from payments p where p.company_id = $1 and p.business_date = $2 and p.status = 'confirmado' group by 1 order by 1`,[t.companyId,o,t.company.timezone])).rows:null,u=(await c(
`select i.description, sum(i.qty)::numeric as qty ${s?", sum(i.total_cents)::bigint as cents":""}
       from order_items i join consumption_sessions s on s.id = i.session_id
      where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' group by 1 order by 2 desc limit 5`,[t.companyId,o])).rows;s||(delete i.consumed_cents,delete i.received_cents,
delete i.cash_differences),n.json({business_date:o,...i,by_hour:r,top:u,access:t.access,pending_modules:["delivery","estoque","cozinha","clientes","marketing","agente","fiscal","re\
latorios"]})}));Ee.get("/search",d(async(e,n)=>{let t=String(e.query.q||"").trim().slice(0,60);if(t.length<2)return n.json([]);let a=e.ctx,o=`%${t}%`,s=[];if(a.can("cardapio.visual\
izar")){let i=await c("select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6",[a.companyId,o,t]);s.push(...i.rows.map(r=>({type:"\
produto",id:r.id,label:r.name,to:`/cardapio?produto=${r.id}`})))}if(a.can("pdv.lancar")){let i=Number(t.replace(/\D/g,""));if(i){let u=await c(`select s.id, c.number card, t.number\
 tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`,[a.companyId,i]);s.push(...u.
rows.map(f=>({type:"consumo",id:f.id,label:f.card?`Comanda ${f.card}`:f.tbl?`Mesa ${f.tbl}`:`Consumo ${f.id}`,to:`/pdv?sessao=${f.id}`})))}let r=await c(`select s.id, s.customer_na\
me, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`,[a.companyId,o]);s.push(...r.rows.map(u=>({type:"consumo",id:u.id,label:u.customer_name||u.label,
to:`/pdv?sessao=${u.id}`})))}if(a.can("usuarios.gerenciar")){let i=await c("select id, name from users where company_id = $1 and name ilike $2 limit 4",[a.companyId,o]);s.push(...i.
rows.map(r=>({type:"usuario",id:r.id,label:r.name,to:"/configuracoes/usuarios"})))}n.json(s)}));import{Router as qe}from"npm:express@5.2.1";import ua from"npm:bcryptjs@3.0.3";import{z as ma}from"npm:zod@4.6.5";var Y=qe();Y.use(yt);Y.get("/manifest",(e,n)=>{n.json({product:ee,name:"RUSTEN",description:"Gest\xE3o para bares e restaurantes",contract:"v1",modules:Object.entries(re).map(([t,a])=>({
key:t,name:a})),billing_page:"/configuracoes/assinatura"})});Y.get("/tenants",d(async(e,n)=>{let{rows:t}=await c("select id from companies order by id"),a=[];for(let o of t)a.push(
await ve({query:c},o.id));n.json({tenants:a})}));Y.get("/tenants/:id",d(async(e,n)=>{let t=await ve({query:c},Number(e.params.id));if(!t)throw I("Empresa n\xE3o encontrada");let a=await c(
"select id, name, email, role_key, active, created_at from users where company_id = $1 order by id",[Number(e.params.id)]);n.json({...t,users:a.rows})}));Y.post("/tenants/:id/acces\
s",d(async(e,n)=>{let t=Number(e.params.id);if(!await je(t,e.body?.access??e.body))throw I("Empresa n\xE3o encontrada");await w({query:c},{companyId:t},"central.situacao_recebida",
{entity:"company",entityId:t,data:e.body?.access??e.body}),n.json({ok:!0})}));Y.post("/tenants/:id/owner-reset",d(async(e,n)=>{let t=Number(e.params.id),{rows:a}=await c("select id\
, email from users where company_id = $1 and role_key = 'owner' and active order by id limit 1",[t]);if(!a[0])throw I("Respons\xE1vel n\xE3o encontrado");let o=`Rst${V(9)}9`;await c(
"update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1",[a[0].id,await ua.hash(o,12)]),await c("update user_sessi\
ons set revoked_at = now() where user_id = $1 and revoked_at is null",[a[0].id]),await w({query:c},{companyId:t},"central.senha_provisoria",{entity:"user",entityId:a[0].id}),n.json(
{email:a[0].email,temporary_password:o})}));var Ve=qe();Ve.get("/platform",d(async(e,n)=>{let t=j.CRON_SECRET;if(!t||e.headers.authorization!==`Bearer ${t}`)return n.status(401).json(
{error:"n\xE3o autorizado"});n.json(await ke(50))}));var ae=qe();ae.use(G());ae.get("/",(e,n)=>n.json({access:e.ctx.access,hub:L()}));ae.post("/verify",p("assinatura.gerenciar"),d(
async(e,n)=>{if(!L())return n.json({access:e.ctx.access,hub:!1});let t=await te("GET",`/api/hub/v1/tenants/${ee}:${e.ctx.companyId}/access`);t?.access&&await je(e.ctx.companyId,t.access),
await w({query:c},e.ctx,"assinatura.verificacao"),n.json({ok:!0,refreshed:!!t?.access})}));ae.post("/billing/:action",p("assinatura.gerenciar"),d(async(e,n)=>{let t=h(ma.enum(["che\
ckout","renew","change-plan","cancel"]),e.params.action),a=await te("POST",`/api/hub/v1/tenants/${ee}:${e.ctx.companyId}/billing/${t}`,e.body||{});await w({query:c},e.ctx,`assinatu\
ra.${t}`),n.json(a)}));ae.get("/billing",p("assinatura.gerenciar"),d(async(e,n)=>{if(!L())return n.json({hub:!1});n.json(await te("GET",`/api/hub/v1/tenants/${ee}:${e.ctx.companyId}\
/billing`))}));function Ge(){let e=kt();e.disable("x-powered-by"),e.set("trust proxy",1),e.use(la());let n=(j.CORS_ORIGINS||"http://localhost:5173").split(",").map(o=>o.trim()).filter(Boolean),t=o=>!o||
n.includes(o)||n.includes("*")&&/^https:\/\//.test(o);e.use(pa({origin:(o,s)=>s(null,t(o)),credentials:!1,allowedHeaders:["content-type","authorization","x-terminal-id"]})),e.use(kt.
json({limit:"1mb",verify:(o,s,i)=>{o.rawBody=i.toString("utf8")}})),e.get("/api/health",(o,s)=>s.json({ok:!0,service:"rusten-api"})),e.use("/api/auth",H),e.use("/api/platform/v1",Y),
e.use("/api/cron",Ve),e.use("/api/access",ae);let a=[G(),pe()];return e.use("/api/admin",...a,E),e.use("/api/home",...a,Ee),e.use("/api/menu",...a,pe("cardapio"),T),e.use("/api/flo\
or",...a,P),e.use("/api/pdv",...a,pe("pdv"),C),e.use("/api/cash",...a,pe("pdv"),F),e.use("/api",(o,s,i)=>i(new v(404,"Rota n\xE3o encontrada","not_found"))),e.use((o,s,i,r)=>{if(o instanceof
v)return i.status(o.status).json({error:o.message,code:o.code,...o.extra||{}});if(o?.type==="entity.parse.failed")return i.status(400).json({error:"JSON inv\xE1lido",code:"invalid"});
if(o?.type==="entity.too.large")return i.status(413).json({error:"Requisi\xE7\xE3o muito grande",code:"too_large"});if(o?.code==="22P02"||o?.code==="22003")return i.status(400).json(
{error:"Valor inv\xE1lido",code:"invalid"});if(o?.code==="23503")return i.status(400).json({error:"Refer\xEAncia inv\xE1lida",code:"invalid_reference"});console.error(JSON.stringify(
{level:"error",msg:o?.message,path:s.path,method:s.method,code:o?.code})),i.status(500).json({error:"Erro interno. Tente novamente.",code:"internal"})}),e}var wa=!j.EDGE_RUNTIME&&process.
argv[1]&&ya(import.meta.url)===_a.resolve(process.argv[1]);if(wa){let e=Number(j.PORT||3001);await Te(),Ge().listen(e,()=>console.log(`RUSTEN API na porta ${e}`)),setInterval(()=>ke().
catch(()=>{}),6e4).unref()}var jt=fa();jt.use(j.PATH_PREFIX,Ge());jt.listen(8e3);
