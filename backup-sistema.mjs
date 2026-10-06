#!/usr/bin/env node
// Backup automático da versão que vai ser publicada — chamado pelos arquivos PUBLICAR-*.bat.
//
//   node backup-sistema.mjs --sistema ORBI --repo D:\Programacao\ORBI --ref cloudflare
//        [--caminho site-lorler] [--destino D:\Programacao\BACKUP-Sistemas]
//
// Gera  <SISTEMA>_v<NNN>_<AAAA-MM-DD_HHMM>_<ref>-<commit>.zip  com o código exato da versão (git archive),
// mais o arquivo de informações _backup-info.json dentro do zip, e registra em historico-backups.csv
// (data, sistema, versão, commit, SHA-256 do zip). NUNCA sobrescreve: cada execução cria a versão seguinte.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const sistema = String(opt('sistema', '')).toUpperCase().replace(/[^A-Z0-9-]/g, '');
const repo = path.resolve(opt('repo', '.'));
const ref = opt('ref', 'HEAD');
const caminho = opt('caminho', '');
const destino = path.resolve(opt('destino', 'D:\\Programacao\\BACKUP-Sistemas'));
if (!sistema) { console.error('  Backup: informe --sistema'); process.exit(2); }

const git = (...x) => execFileSync('git', ['-C', repo, ...x], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
let commit;
try { commit = git('rev-parse', '--verify', `${ref}^{commit}`); } catch {
  console.error(`  Backup: a versao "${ref}" nao foi encontrada em ${repo}.`); process.exit(3);
}
const curto = commit.slice(0, 7);
const assunto = git('log', '-1', '--format=%s', commit);
const dataCommit = git('log', '-1', '--format=%cI', commit);

fs.mkdirSync(destino, { recursive: true });
// próxima versão deste sistema: maior vNNN já existente + 1 (o número nunca é reaproveitado)
const re = new RegExp(`^${sistema}_v(\\d+)_`, 'i');
const usadas = fs.readdirSync(destino).map((f) => Number((f.match(re) || [])[1] || 0));
let versao = Math.max(0, ...usadas) + 1;

const agora = new Date();
const carimbo = agora.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', '_').replace(/:/g, '').slice(0, 15); // AAAA-MM-DD_HHMM (Brasília)
const refLimpo = ref.replace(/[^a-zA-Z0-9._-]/g, '-');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
const info = path.join(tmpDir, '_backup-info.json');
const tmpZip = path.join(tmpDir, 'versao.zip');
let destinoFinal;
try {
  // reserva o nome: cria o arquivo vazio com "wx" (falha se já existir) e só então grava o conteúdo
  for (;;) {
    const nome = `${sistema}_v${String(versao).padStart(3, '0')}_${carimbo}_${refLimpo}-${curto}.zip`;
    destinoFinal = path.join(destino, nome);
    try { fs.closeSync(fs.openSync(destinoFinal, 'wx')); break; } catch (e) { if (e.code === 'EEXIST') { versao++; continue; } throw e; }
  }
  const versaoTxt = `v${String(versao).padStart(3, '0')}`;
  fs.writeFileSync(info, JSON.stringify({ sistema, versao: versaoTxt, gerado_em: agora.toISOString(), repositorio: repo, ref, commit,
    descricao_commit: assunto, data_commit: dataCommit, caminho: caminho || '(sistema inteiro)', computador: os.hostname() }, null, 2));
  const prefixo = `${sistema}_${versaoTxt}/`;
  const base = ['archive', '--format=zip', `--prefix=${prefixo}`, '-o', tmpZip];
  try { git(...base, `--add-file=${info}`, commit, ...(caminho ? [caminho] : [])); }
  catch { // Git antigo (sem --add-file): zip só com o código e as informações ao lado
    git(...base, commit, ...(caminho ? [caminho] : []));
    fs.copyFileSync(info, destinoFinal.replace(/\.zip$/, '.info.json'), fs.constants.COPYFILE_EXCL);
  }
  fs.copyFileSync(tmpZip, destinoFinal); // o arquivo reservado (vazio) recebe o conteúdo
  const buf = fs.readFileSync(destinoFinal);
  if (!buf.length) throw new Error('arquivo de backup vazio');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const hist = path.join(destino, 'historico-backups.csv');
  if (!fs.existsSync(hist)) fs.writeFileSync(hist, 'data;sistema;versao;arquivo;ref;commit;bytes;sha256;descricao\r\n');
  fs.appendFileSync(hist, [agora.toISOString(), sistema, versaoTxt, path.basename(destinoFinal), ref, commit, buf.length, sha, `"${assunto.replace(/"/g, "'")}"`].join(';') + '\r\n');
  fs.chmodSync(destinoFinal, 0o444); // somente leitura: evita alteração acidental
  console.log(`  Backup OK: ${path.basename(destinoFinal)} (${(buf.length / 1048576).toFixed(1)} MB)`);
  console.log(`  Pasta: ${destino}`);
} catch (e) {
  if (destinoFinal && fs.existsSync(destinoFinal) && fs.statSync(destinoFinal).size === 0) fs.rmSync(destinoFinal, { force: true });
  console.error(`  Backup falhou: ${e.message}`); process.exit(1);
} finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
