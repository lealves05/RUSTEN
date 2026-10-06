// Configurações › Integrações: leitura de notas por foto (chave da Anthropic) e busca do XML da NF-e pela chave (Focus NFe).
// Antes ficavam no meio da tela de lançar nota; aqui ficam junto das outras integrações, longe da operação.
import { useState } from 'react';
import { Barcode, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { Loading, useLoad, useToast } from './ui.jsx';

export default function NoteIntegrations() {
  const toast = useToast();
  const status = useLoad(() => api('/api/stock/notes/status'), []);
  const [key, setKey] = useState('');
  const [token, setToken] = useState('');
  if (status.loading && !status.data) return <Loading />;
  if (!status.data) return null;
  const saveKey = async () => { try { await api('/api/stock/notes/key', { method: 'PUT', body: { api_key: key } }); setKey(''); status.reload(); toast('Leitura por foto ativada'); } catch (x) { toast(x.message, 'bad'); } };
  const saveToken = async (value) => {
    try { await api('/api/stock/notes/focus', { method: 'PUT', body: { token: value } }); setToken(''); status.reload(); toast(value ? 'Busca do XML pela chave ativada' : 'Busca do XML pela chave desligada'); }
    catch (x) { toast(x.message, 'bad'); }
  };
  const enabled = status.data.xml_by_key;
  return (
    <div className="space-y-4" data-note-integrations>
      <div className="card p-4 text-sm">
        <h3 className="flex items-center gap-2 font-display text-xl"><KeyRound size={18} /> Estoque: ler nota pela foto</h3>
        {status.data.photo ? <p className="mt-1 text-muted">Ativa{status.data.own_key ? ' com a chave desta empresa' : ' pela plataforma'}. As fotos são lidas pela IA Claude (Anthropic) e não ficam guardadas.</p>
          : <p className="mt-1 text-muted">Permite fotografar a nota ou o pedido do fornecedor em Estoque › Lançar nota. Precisa de uma chave da API da Anthropic (console.anthropic.com). Sem ela, use o XML da nota.</p>}
        <div className="mt-2 flex flex-wrap gap-2"><input className="input max-w-md font-mono" type="password" autoComplete="off" placeholder={status.data.own_key ? 'manter a chave atual' : 'chave sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Chave da API da Anthropic" />
          <button className="btn-ghost" onClick={() => (key ? saveKey() : toast('Cole a chave da Anthropic no campo ao lado', 'warn'))}>Salvar chave</button></div>
      </div>
      <div className="card p-4 text-sm">
        <h3 className="flex items-center gap-2 font-display text-xl"><Barcode size={18} /> Estoque: itens da nota pelo código de barras</h3>
        <p className="mt-1 text-muted">{enabled
          ? 'Ativa: ao ler o código de barras da nota fiscal em papel (DANFE), o sistema busca o XML na Focus NFe e já traz os itens.'
          : 'Opcional. Com uma conta na Focus NFe (CNPJ e certificado digital cadastrados lá), basta ler o código de barras da nota em papel (DANFE) para trazer os itens. Sem ela, o sistema pede o arquivo XML que o fornecedor envia.'}</p>
        <div className="mt-2 flex flex-wrap gap-2"><input className="input max-w-md font-mono" type="password" autoComplete="off" placeholder={enabled ? 'manter o token atual' : 'token da Focus NFe'} value={token} onChange={(e) => setToken(e.target.value)} aria-label="Token da Focus NFe" />
          <button className="btn-ghost" onClick={() => (token ? saveToken(token) : toast('Cole o token da Focus NFe no campo ao lado', 'warn'))}>Salvar token</button>
          {enabled && <button className="btn-ghost" onClick={() => saveToken('')}>Desligar</button>}</div>
      </div>
    </div>
  );
}
