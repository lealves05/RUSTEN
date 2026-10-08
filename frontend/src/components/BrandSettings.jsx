// Configurações › Empresa e aparência: o sistema com a cara do estabelecimento.
// Logotipo, nome exibido, cor, tipos de letra, cantos, estilo do menu, imagem de fundo e fundo da TV.
// As escolhas aparecem na hora (pré-visualização); só ficam valendo para todos depois de "Salvar".
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, MonitorPlay, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession, applyTheme } from '../lib/session.jsx';
import { ACCENTS, BODY_FONTS, DEFAULT_APPEARANCE, DISPLAY_FONTS, applyBrand, forgetBrandImage, prepareLogo, shrinkImage, useBrandImage } from '../lib/brand.js';
import { Field, Toggle, useToast } from './ui.jsx';

const LIMITS = { logo: { max: 600, maxBytes: 380 * 1024, keepAlpha: true }, fundo: { max: 1920, maxBytes: 1500 * 1024 }, tv_fundo: { max: 1920, maxBytes: 1500 * 1024 } };

export function ImagePicker({ kind, title, hint, manage, onError, tall }) {
  const s = useSession();
  const toast = useToast();
  const url = useBrandImage(kind, s.me?.brand?.[`${kind}_v`]);
  const [busy, setBusy] = useState(false);
  const [autoBg, setAutoBg] = useState(true);
  const pick = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setBusy(true);
    try {
      let data; let note = '';
      if (kind === 'logo') {
        const r = await prepareLogo(file, { removeBg: autoBg });
        data = r.data;
        note = [r.removedBg && 'fundo removido', r.trimmed && 'sobras cortadas'].filter(Boolean).join(' e ');
      } else data = await shrinkImage(file, LIMITS[kind]);
      await api(`/api/brand/${kind}`, { method: 'PUT', body: { data_url: data } });
      forgetBrandImage(kind); await s.reload(); toast(note ? `Logotipo ajustado (${note})` : 'Imagem salva');
    } catch (x) { onError(x); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await api(`/api/brand/${kind}`, { method: 'DELETE' }); forgetBrandImage(kind); await s.reload(); toast('Imagem removida'); } catch (x) { onError(x); }
  };
  return (
    <div className="rounded-xl border border-dashed border-line p-3" data-brand-picker={kind}>
      <div className="text-sm font-semibold">{title}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
      <div className={`relative mt-2 overflow-hidden rounded-lg ${tall ? 'h-32' : 'h-24'}`}
        style={{ background: 'repeating-conic-gradient(rgb(var(--line)) 0 25%, transparent 0 50%) 0 0 / 16px 16px' }}>
        {url ? <img src={url} alt={title} className={`absolute inset-0 h-full w-full ${tall ? 'object-cover' : 'object-contain p-2'}`} />
          : <span className="absolute inset-0 grid place-items-center text-xs text-muted">Nenhuma imagem</span>}
      </div>
      {kind === 'logo' && manage && <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={autoBg} onChange={(e) => setAutoBg(e.target.checked)} data-logo-autobg /> Ajustar sozinho: tirar o fundo liso (branco ou de uma cor) e cortar as sobras</label>}
      {manage && (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer py-1 text-sm"><ImagePlus size={16} /> {busy ? 'Enviando…' : url ? 'Trocar' : 'Escolher imagem'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} disabled={busy} data-brand-input={kind} /></label>
          {url && <button type="button" className="btn-ghost py-1 text-sm text-rust" onClick={remove}><Trash2 size={16} /> Remover</button>}
        </div>
      )}
    </div>
  );
}

const Seg = ({ value, options, onChange, disabled, name }) => (
  <div className="inline-flex flex-wrap gap-1 rounded-lg border border-line p-1" role="radiogroup" aria-label={name}>
    {options.map(([v, l]) => (
      <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
        className={`rounded-md px-3 py-1.5 text-sm font-semibold ${value === v ? 'bg-copper text-white dark:text-black' : 'hover:bg-raised'}`}>{l}</button>))}
  </div>
);

/** Editor da aparência. `value`/`onChange` = f.appearance da tela da empresa. */
export function BrandSettings({ value, onChange, manage, companyName, onError }) {
  const s = useSession();
  const ap = { ...DEFAULT_APPEARANCE, ...value };
  const set = (k, v) => onChange({ ...ap, [k]: v });
  // pré-visualização ao vivo; ao sair da tela volta ao que está salvo
  useEffect(() => { applyBrand(ap); }, [JSON.stringify(ap)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyTheme(ap.theme); }, [ap.theme]);
  const saved = useRef(null);
  saved.current = s.me?.company?.settings?.appearance || {};
  useEffect(() => () => { applyBrand(saved.current); applyTheme(localStorage.getItem('rusten.theme.user') || saved.current.theme); }, []);
  const logo = useBrandImage('logo', s.me?.brand?.logo_v);
  const dis = !manage;
  const title = ap.brand_title || companyName;

  return (
    <div className="space-y-6" data-brand-settings>
      <section className="space-y-3">
        <h3 className="font-display text-2xl">Marca</h3>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ImagePicker kind="logo" title="Logotipo" hint="Pode ser JPG ou PNG: o sistema tira o fundo liso, corta as sobras e ajusta o tamanho sozinho. Aparece no menu, no Painel da TV e nas telas." manage={manage} onError={onError} />
          <div className="space-y-3">
            <Field label="O que aparece no topo do menu">
              <select className="input" disabled={dis} value={ap.logo_mode} onChange={(e) => set('logo_mode', e.target.value)} data-brand-mode>
                <option value="rusten">Marca RUSTEN (padrão)</option><option value="logo_nome">Logotipo + nome</option><option value="logo">Só o logotipo</option><option value="nome">Só o nome</option>
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome exibido"><input className="input" disabled={dis} maxLength={40} placeholder={companyName} value={ap.brand_title} onChange={(e) => set('brand_title', e.target.value)} /></Field>
              <Field label="Frase (opcional)"><input className="input" disabled={dis} maxLength={60} placeholder="ex.: chopp gelado desde 1998" value={ap.brand_subtitle} onChange={(e) => set('brand_subtitle', e.target.value)} /></Field>
            </div>
            <Field label={`Tamanho do logotipo (${ap.logo_size}px)`}><input type="range" min="24" max="96" step="2" disabled={dis} value={ap.logo_size} onChange={(e) => set('logo_size', Number(e.target.value))} className="w-full" /></Field>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-2xl">Cores e letras</h3>
        <Field label="Cor da marca" hint="Botões, destaques e menu. O tom é ajustado sozinho para continuar legível no tema claro e no escuro.">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={dis} onClick={() => set('accent', '')} className={`h-9 rounded-full border-2 px-3 text-xs font-semibold ${!ap.accent ? 'border-ink' : 'border-line'}`}>Padrão</button>
            {ACCENTS.map(([c, l]) => (
              <button key={c} type="button" disabled={dis} title={l} aria-label={l} aria-pressed={ap.accent === c} onClick={() => set('accent', c)}
                className={`h-9 w-9 rounded-full border-2 ${ap.accent === c ? 'border-ink ring-2 ring-offset-2 ring-offset-surface' : 'border-transparent'}`} style={{ background: c }} />))}
            <label className="inline-flex items-center gap-2 text-sm">Outra: <input type="color" disabled={dis} value={ap.accent || '#ce8a48'} onChange={(e) => set('accent', e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-line bg-surface" data-brand-color /></label>
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Letra dos títulos">
            <select className="input" disabled={dis} value={ap.font_display} onChange={(e) => set('font_display', e.target.value)} style={{ fontFamily: DISPLAY_FONTS[ap.font_display]?.css }}>
              {Object.entries(DISPLAY_FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select>
          </Field>
          <Field label="Letra dos textos">
            <select className="input" disabled={dis} value={ap.font_body} onChange={(e) => set('font_body', e.target.value)}>
              {Object.entries(BODY_FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Field label="Cantos"><Seg name="Cantos" disabled={dis} value={ap.radius} onChange={(v) => set('radius', v)} options={[['reto', 'Retos'], ['padrao', 'Padrão'], ['arredondado', 'Arredondados']]} /></Field>
          <Field label="Menu lateral"><Seg name="Menu lateral" disabled={dis} value={ap.sidebar} onChange={(v) => set('sidebar', v)} options={[['padrao', 'Padrão'], ['cor', 'Cor da marca'], ['escura', 'Escuro'], ['transparente', 'Transparente']]} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tema"><select className="input" value={ap.theme} onChange={(e) => set('theme', e.target.value)}><option value="auto">Automático</option><option value="claro">Claro</option><option value="escuro">Escuro</option></select></Field>
          <Field label="Densidade"><select className="input" value={ap.density} onChange={(e) => set('density', e.target.value)}><option value="confortavel">Confortável</option><option value="compacta">Compacta</option></select></Field>
          <Field label="Menu"><select className="input" value={ap.menu} onChange={(e) => set('menu', e.target.value)}><option value="lateral">Lateral</option><option value="superior">Superior</option></select></Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-2xl">Imagem de fundo</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <ImagePicker kind="fundo" tall title="Fundo do sistema" hint="Foto do salão, textura, parede… Fica atrás de todas as telas, com um véu para manter a leitura." manage={manage} onError={onError} />
          <div className="space-y-3">
            <Field label={`Véu sobre a imagem (${Math.round(ap.bg_overlay * 100)}%)`} hint="Mais véu = imagem mais suave e texto mais legível.">
              <input type="range" min="0.3" max="0.95" step="0.01" disabled={dis} value={ap.bg_overlay} onChange={(e) => set('bg_overlay', Number(e.target.value))} className="w-full" data-brand-overlay />
            </Field>
            <Field label="Ajuste da imagem"><Seg name="Ajuste da imagem" disabled={dis} value={ap.bg_fit} onChange={(v) => set('bg_fit', v)} options={[['cobrir', 'Preencher'], ['centro', 'Inteira'], ['repetir', 'Repetir (textura)']]} /></Field>
            <Toggle checked={!!ap.bg_blur} disabled={dis} onChange={(v) => set('bg_blur', v)} label="Desfocar a imagem" hint="Bom para fotos com muitos detalhes." />
          </div>
        </div>
      </section>

      {s.hasModule('painel_tv') && <section className="space-y-3">
        <h3 className="font-display text-2xl">Painel da TV</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <ImagePicker kind="tv_fundo" tall title="Fundo do Painel da TV" hint="Use no Painel da TV com o fundo “Imagem da empresa”." manage={manage} onError={onError} />
          <div className="space-y-2 text-sm text-muted">
            <p>Na TV, toque na engrenagem para escolher fundo, cores, letras, tamanho, som, voz, frases, logotipo e mensagem no rodapé. Quem gerencia as configurações pode salvar o estilo como <b>padrão de todas as TVs</b>.</p>
            <Link to="/painel-tv" className="btn-ghost inline-flex"><MonitorPlay size={16} /> Abrir o Painel da TV</Link>
          </div>
        </div>
      </section>}

      <section className="space-y-2">
        <h3 className="font-display text-2xl">Prévia</h3>
        <Preview ap={ap} logo={logo} title={title} />
        {manage && <button type="button" className="btn-ghost" onClick={() => onChange({ ...DEFAULT_APPEARANCE, theme: ap.theme, density: ap.density, menu: ap.menu })}><RotateCcw size={16} /> Voltar ao visual RUSTEN</button>}
      </section>
    </div>
  );
}

function Preview({ ap, logo, title }) {
  const side = { padrao: 'bg-surface', cor: 'bg-copper text-white', escura: 'bg-[#121212] text-[#f3e9d2]', transparente: 'bg-surface/70' }[ap.sidebar] || 'bg-surface';
  return (
    <div className="flex h-44 overflow-hidden rounded-xl border border-line" data-brand-preview>
      <div className={`w-40 shrink-0 space-y-2 p-3 ${side}`}>
        <div className="flex items-center gap-2">
          {ap.logo_mode !== 'rusten' && ap.logo_mode !== 'nome' && logo ? <img src={logo} alt="" className="h-8 max-w-[56px] object-contain" /> : <img src="/rusten.svg" alt="" className="h-7 w-7" />}
          {ap.logo_mode !== 'logo' && <span className="truncate font-display text-lg leading-none">{ap.logo_mode === 'rusten' ? 'RUSTEN' : title}</span>}
        </div>
        <div className={`rounded-lg px-2 py-1 text-xs font-semibold ${ap.sidebar === 'cor' ? 'bg-white text-copper' : 'bg-copper text-white dark:text-black'}`}>PDV</div>
        <div className="px-2 text-xs font-semibold opacity-80">SALÃO</div>
        <div className="px-2 text-xs font-semibold opacity-80">COZINHA</div>
      </div>
      <div className="flex-1 space-y-2 p-3">
        <div className="font-display text-2xl">Comanda 12</div>
        <div className="card p-2 text-sm">Caipirinha de limão · <b className="text-copper">R$ 22,00</b></div>
        <div className="flex gap-2"><span className="btn-primary min-h-0 py-1 text-sm">Receber</span><span className="btn-ghost min-h-0 py-1 text-sm">Imprimir</span></div>
      </div>
    </div>
  );
}
