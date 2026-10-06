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
  const size = compact ? Math.min(40, ap.logo_size) : ap.logo_size;
  return (
    <div className="flex min-w-0 items-center gap-2 select-none" data-brand-logo>
      {ap.logo_mode !== 'nome' && (logo ? <img src={logo} alt={title} style={{ height: size, maxWidth: compact ? size : size * 3.2 }} className="shrink-0 object-contain" />
        : <span style={{ height: size, width: size }} className="shrink-0 rounded bg-raised" />)}
      {!compact && ap.logo_mode !== 'logo' && (
        <div className="min-w-0 leading-none">
          <div className="truncate font-display text-2xl tracking-wide">{title}</div>
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
