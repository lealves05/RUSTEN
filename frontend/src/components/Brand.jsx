// Logotipo e fundo do estabelecimento (Configurações › Empresa e aparência). Sem logotipo, vale a marca RUSTEN.
import { useSession } from '../lib/session.jsx';
import { DEFAULT_APPEARANCE, useBrandImage } from '../lib/brand.js';
import { Logo } from './ui.jsx';

export function BrandLogo({ compact = false }) {
  const s = useSession();
  const ap = { ...DEFAULT_APPEARANCE, ...(s.me?.company?.settings?.appearance || {}) };
  const logo = useBrandImage('logo', ap.logo_mode !== 'rusten' && ap.logo_mode !== 'nome' ? s.me?.brand?.logo_v : null);
  if (ap.logo_mode === 'rusten' || (ap.logo_mode !== 'nome' && !s.me?.brand?.logo_v)) return <Logo size={compact ? 32 : 34} withText={!compact} />;
  const title = ap.brand_title || s.me?.company?.name || '';
  const withName = !compact && ap.logo_mode !== 'logo';
  // o logotipo cabe sempre no espaço: altura no máximo a escolhida e largura limitada (menos quando o nome aparece ao lado)
  const h = compact ? 40 : ap.logo_size;
  const maxW = compact ? 44 : withName ? '46%' : '100%';
  return (
    <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden select-none" data-brand-logo>
      {ap.logo_mode !== 'nome' && (logo ? <img src={logo} alt={title} style={{ maxHeight: h, maxWidth: maxW, width: 'auto', height: 'auto' }} className="block shrink object-contain" />
        : <span style={{ height: h, width: h }} className="shrink-0 rounded bg-raised" />)}
      {withName && (
        <div className="min-w-0 flex-1 leading-tight">
          <div className={`line-clamp-2 break-words font-display tracking-wide ${title.length > 18 ? 'text-lg' : 'text-2xl'}`} title={title}>{title}</div>
          {ap.brand_subtitle && <div className="truncate text-[10px] uppercase tracking-widest text-muted">{ap.brand_subtitle}</div>}
        </div>
      )}
    </div>
  );
}

/** Imagem de fundo atrás de todas as telas, com véu da cor do tema para manter a leitura. */
export function BrandBackground() {
  const s = useSession();
  const ap = { ...DEFAULT_APPEARANCE, ...(s.me?.company?.settings?.appearance || {}) };
  const url = useBrandImage('fundo', s.me?.brand?.fundo_v);
  if (!url) return null;
  const fit = ap.bg_fit === 'repetir' ? { backgroundSize: 'auto', backgroundRepeat: 'repeat' } : ap.bg_fit === 'centro' ? { backgroundSize: 'contain', backgroundRepeat: 'no-repeat' } : { backgroundSize: 'cover', backgroundRepeat: 'no-repeat' };
  return (
    <div aria-hidden className="no-print pointer-events-none fixed inset-0 -z-10" data-brand-bg>
      <div className="absolute inset-0" style={{ backgroundImage: `url("${url}")`, backgroundPosition: 'center', ...fit, filter: ap.bg_blur ? 'blur(8px)' : undefined, transform: ap.bg_blur ? 'scale(1.06)' : undefined }} />
      <div className="absolute inset-0" style={{ background: `rgb(var(--bg) / ${ap.bg_overlay})` }} />
    </div>
  );
}
