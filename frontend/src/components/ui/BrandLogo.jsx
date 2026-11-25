const logoPath = '/procurement-logo.png';

export default function BrandLogo({ variant = 'sidebar', light = false, compact = false, className = '' }) {
  const isLogin = variant === 'login';

  return <div className={`flex items-center gap-3 ${className}`}>
    <span className={`grid ${isLogin ? 'h-14 w-14 p-1.5' : 'h-10 w-10 p-1'} shrink-0 place-items-center rounded-xl bg-white`}>
      <img src={logoPath} alt="" className="block h-full w-full object-contain" />
    </span>
    <span className={`leading-tight ${compact ? 'lg:hidden' : ''} ${light ? 'text-black' : 'text-ink'}`}>
      <span className={`display-font block ${isLogin ? 'text-base' : 'text-[14px]'} font-extrabold tracking-tight`}>Hope Haven</span>
      <span className={`mt-1 block text-[8px] font-bold tracking-[.13em] ${light ? 'text-black' : 'text-muted'}`}>PROCUREMENT &amp; STORES</span>
    </span>
  </div>;
}
