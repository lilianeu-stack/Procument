const logoPath = '/procurement-logo.png';

const variants = {
  sidebar: {
    image: 'h-10 w-10 p-1',
    title: 'text-[14px]',
    caption: 'PROCUREMENT & STORES'
  },
  topbar: {
    image: 'h-8 w-8 p-0.5',
    title: 'text-[11px]'
  },
  login: {
    image: 'h-14 w-14 p-1.5',
    title: 'text-base',
    caption: 'PROCUREMENT & STORES'
  },
  loading: {
    image: 'h-14 w-14 p-1.5',
    title: 'text-base',
    caption: 'PROCUREMENT MANAGEMENT SYSTEM'
  }
};

export default function BrandLogo({ variant = 'sidebar', light = false, compact = false, className = '' }) {
  const style = variants[variant] || variants.sidebar;

  return <div className={`flex items-center gap-3 ${className}`}>
    <span className={`grid shrink-0 place-items-center rounded-xl bg-white shadow-sm ${style.image}`}>
      <img src={logoPath} alt="" className="block h-full w-full object-contain" />
    </span>
    <span className={`leading-tight ${compact ? 'lg:hidden' : ''} ${light ? 'text-white' : 'text-ink'}`}>
      <span className={`display-font block font-extrabold tracking-tight ${style.title}`}>Hope Haven</span>
      {style.caption && <span className={`mt-1 block text-[8px] font-bold tracking-[.13em] ${light ? 'text-slate-300' : 'text-muted'}`}>{style.caption}</span>}
    </span>
  </div>;
}
