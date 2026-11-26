import { useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarClock, ClipboardCheck, Database, Download, FileText,
  Globe2, Languages, LayoutDashboard, LockKeyhole, Mail, PackageCheck,
  Search, Save, ShieldCheck, SlidersHorizontal, Users
} from 'lucide-react';

const CATEGORIES = [
  { id: 'general', label: 'General', icon: LayoutDashboard, keys: ['system_name','organization_name','table_page_size','timezone','date_format','time_format','week_start'] },
  { id: 'organization', label: 'Organization', icon: Building2, keys: ['organization_logo','organization_address','organization_email','organization_phone','organization_website','organization_country','organization_city'] },
  { id: 'users', label: 'User & Access', icon: Users, keys: ['password_min_length','session_timeout_minutes','login_attempt_limit','account_lockout_minutes','audit_logging'] },
  { id: 'departments', label: 'Departments', icon: Building2, keys: [] },
  { id: 'procurement', label: 'Procurement', icon: PackageCheck, keys: ['purchase_request_prefix','purchase_order_prefix','goods_receipt_prefix','procurement_method'] },
  { id: 'approval', label: 'Approval Workflows', icon: ClipboardCheck, keys: ['approval_notifications'] },
  { id: 'suppliers', label: 'Supplier', icon: Globe2, keys: ['supplier_prefix'] },
  { id: 'inventory', label: 'Inventory & Stock', icon: PackageCheck, keys: ['low_stock_notifications'] },
  { id: 'financial', label: 'Financial', icon: SlidersHorizontal, keys: ['default_currency','currency_symbol','decimal_precision','tax_rate','payment_terms_days','invoice_prefix'] },
  { id: 'notifications', label: 'Notifications', icon: Mail, keys: ['in_app_notifications','email_notifications','approval_notifications','delivery_notifications','low_stock_notifications'] },
  { id: 'security', label: 'Security', icon: LockKeyhole, keys: ['password_min_length','session_timeout_minutes','login_attempt_limit','account_lockout_minutes','audit_logging'] },
  { id: 'regional', label: 'Date & Region', icon: CalendarClock, keys: ['timezone','date_format','time_format','week_start'] },
  { id: 'documents', label: 'Documents & Print', icon: FileText, keys: ['document_page_size','document_header','document_footer','print_signature_sections','organization_logo'] },
  { id: 'imports', label: 'Import & Export', icon: Download, keys: ['default_export_format','duplicate_import_detection'] },
  { id: 'maintenance', label: 'System Maintenance', icon: Database, keys: ['maintenance_mode'] },
  { id: 'audit', label: 'Audit Logs', icon: ShieldCheck, keys: ['audit_logging'] }
];

const LABELS = {
  system_name: 'System name', organization_name: 'Organization name', organization_logo: 'Official organization logo',
  organization_address: 'Organization address', organization_email: 'Organization email',
  organization_phone: 'Phone number', organization_website: 'Website', organization_country: 'Country',
  organization_city: 'City / district', table_page_size: 'Rows per table page',
  date_format: 'Date format', time_format: 'Time format', timezone: 'System timezone', week_start: 'Week starts',
  default_currency: 'Default currency', currency_symbol: 'Currency symbol', decimal_precision: 'Decimal precision',
  tax_rate: 'Default tax rate (%)', payment_terms_days: 'Default payment terms (days)',
  purchase_request_prefix: 'Purchase Request prefix', purchase_order_prefix: 'Purchase Order prefix',
  goods_receipt_prefix: 'Goods Receipt prefix', invoice_prefix: 'Invoice prefix', supplier_prefix: 'Supplier prefix',
  procurement_method: 'Default procurement method', low_stock_notifications: 'Low-stock notifications',
  approval_notifications: 'Approval notifications', delivery_notifications: 'Delivery notifications',
  in_app_notifications: 'In-app notifications', email_notifications: 'Email notifications',
  password_min_length: 'Minimum password length', session_timeout_minutes: 'Session timeout (minutes)',
  login_attempt_limit: 'Login attempt limit', account_lockout_minutes: 'Account lockout (minutes)',
  audit_logging: 'Audit logging', document_page_size: 'Document page size',
  document_header: 'Document header', document_footer: 'Document footer',
  print_signature_sections: 'Print approval signature sections', default_export_format: 'Default export format',
  duplicate_import_detection: 'Detect duplicate imports', maintenance_mode: 'Maintenance mode'
};

const DESCRIPTIONS = {
  system_name: 'Displayed as the application identity in branded pages.',
  organization_name: 'Used in document headers and organization labels.',
  organization_logo: 'Uses the exact supplied official Procurement Management System logo.',
  table_page_size: 'Default number of rows shown on paginated tables.',
  timezone: 'Dates are converted from UTC for display.',
  default_currency: 'Used for new monetary displays. Existing stored values remain unchanged.',
  tax_rate: 'A default tax percentage for future calculations; it does not rewrite historical invoices.',
  purchase_request_prefix: 'Applied to newly generated Purchase Request references.',
  password_min_length: 'Minimum length for newly created or reset passwords.',
  session_timeout_minutes: 'Informational session policy; authentication middleware applies the existing JWT lifetime.',
  maintenance_mode: 'Reserved control. It is persisted and audited but does not bypass authentication or existing routes.',
  email_notifications: 'Controls email notifications when SMTP is configured through the backend environment.'
};

const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-brand bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

function Field({ name, value, onChange }) {
  const label = LABELS[name] || name;
  const description = DESCRIPTIONS[name];
  if (typeof value === 'boolean') return <label className="flex items-start justify-between gap-4 rounded-xl border border-brand bg-white p-4 transition-colors hover:border-black/20">
    <span><span className="block text-xs font-bold text-black">{label}</span>{description && <span className="mt-1 block text-[11px] leading-4 text-black">{description}</span>}</span>
    <input type="checkbox" checked={value} onChange={(event) => onChange(name, event.target.checked)} className="mt-1 h-4 w-4 accent-black" />
  </label>;
  const selectOptions = {
    date_format: [['DD/MM/YYYY','DD/MM/YYYY'],['MM/DD/YYYY','MM/DD/YYYY'],['YYYY-MM-DD','YYYY-MM-DD']],
    time_format: [['12','12-hour'],['24','24-hour']],
    week_start: [['Monday','Monday'],['Sunday','Sunday']],
    default_currency: [['RWF','Rwandan Franc (RWF)']],
    document_page_size: [['A4','A4'],['Letter','US Letter']],
    default_export_format: [['xlsx','Excel (.xlsx)'],['csv','CSV (.csv)'],['pdf','PDF (.pdf)']],
  };
  if (selectOptions[name]) return <label className="block rounded-xl border border-brand bg-white p-4 transition-colors hover:border-black/20">
    <span className="block text-xs font-bold text-black">{label}</span>
    {description && <span className="mt-1 block text-[11px] leading-4 text-black">{description}</span>}
    <select value={value} onChange={(event) => onChange(name, event.target.value)} className="field mt-3">
      {selectOptions[name].map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
    </select>
  </label>;
  const number = typeof value === 'number';
  const textArea = name === 'organization_address' || name === 'document_footer';
  const common = { value: value ?? '', onChange: (event) => onChange(name, number ? Number(event.target.value) : event.target.value), className: textArea ? 'field mt-3 min-h-20 py-2' : 'field mt-3' };
  return <label className="block rounded-xl border border-brand bg-white p-4 transition-colors hover:border-black/20">
    <span className="block text-xs font-bold text-black">{label}</span>
    {description && <span className="mt-1 block text-[11px] leading-4 text-black">{description}</span>}
    {textArea ? <textarea {...common} /> : <input type={number ? 'number' : 'text'} {...common} readOnly={name === 'organization_logo'} />}
  </label>;
}

export default function SettingsPage({ actions }) {
  const [category, setCategory] = useState('general');
  const [search, setSearch] = useState('');
  const [defaults, setDefaults] = useState({});
  const [values, setValues] = useState({});
  const [saved, setSaved] = useState({});
  const [health, setHealth] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([actions.getSettings(), actions.getAuditLogs()])
      .then(([result, logs]) => {
        if (!active) return;
        setDefaults(result.defaults || {});
        setValues(result.settings || {});
        setSaved(result.settings || {});
        setHealth(result.health || null);
        setAudit(logs.logs || []);
      })
      .catch((exception) => { if (active) setError(exception.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actions]);

  const visibleCategories = useMemo(() => CATEGORIES.filter((item) =>
    !search || item.label.toLowerCase().includes(search.toLowerCase()) ||
    item.keys.some((key) => (LABELS[key] || key).toLowerCase().includes(search.toLowerCase()))
  ), [search]);

  const activeCategory = CATEGORIES.find((item) => item.id === category) || CATEGORIES[0];
  const dirtyKeys = Object.keys(values).filter((key) => JSON.stringify(values[key]) !== JSON.stringify(saved[key]));
  function change(key, value) { setValues((current) => ({ ...current, [key]: value })); setNotice(''); setError(''); }

  async function save() {
    if (!dirtyKeys.length) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const changes = Object.fromEntries(dirtyKeys.map((key) => [key, values[key]]));
      await actions.saveSettings(changes);
      const next = { ...saved, ...changes };
      setSaved(next); setNotice('Settings saved successfully.');
      localStorage.setItem('pims-currency', 'RWF');
      localStorage.setItem('pims-currency-precision', String(next.decimal_precision));
      localStorage.setItem('pims-date-format', next.date_format);
      localStorage.setItem('pims-time-format', next.time_format);
      localStorage.setItem('pims-timezone', next.timezone);
      const refreshed = await actions.getAuditLogs();
      setAudit(refreshed.logs || []);
    } catch (exception) { setError(exception.message); }
    finally { setSaving(false); }
  }

  async function reset() {
    const keys = activeCategory.keys.length ? activeCategory.keys : Object.keys(defaults);
    if (!window.confirm(`Reset ${activeCategory.label} settings to defaults?`)) return;
    setSaving(true); setError('');
    try {
      await actions.resetSettings(keys);
      const next = { ...values, ...Object.fromEntries(keys.map((key) => [key, defaults[key]])) };
      setValues(next); setSaved(next); setNotice(`${activeCategory.label} settings reset to defaults.`);
    } catch (exception) { setError(exception.message); }
    finally { setSaving(false); }
  }

  function cancel() {
    if (dirtyKeys.length && !window.confirm('Discard unsaved settings changes?')) return;
    setValues(saved); setNotice(''); setError('');
  }

  if (loading) return <div role="status" className="rounded-xl border border-brand bg-white p-8 text-sm text-black shadow-dashboard">Loading settings…</div>;

  return <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
    <aside className="rounded-xl border border-brand bg-white p-3 shadow-dashboard xl:sticky xl:top-24 xl:self-start">
      <label className="relative mb-3 block"><Search size={14} className="absolute left-3 top-3 text-black" /><input aria-label="Search settings" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" className="field mt-0 pl-9" /></label>
      <nav aria-label="Settings sections" className="max-h-[620px] space-y-1 overflow-y-auto">
        {visibleCategories.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setCategory(id)}
          aria-current={category === id ? 'page' : undefined}
          className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${category === id ? 'bg-reference text-black' : 'text-black hover:bg-hover hover:text-black'}`}>
          <Icon size={15} />{label}
        </button>)}
      </nav>
    </aside>
    <main className="min-w-0 space-y-4">
      {error && <div role="alert" className="rounded-xl border border-brand bg-white px-4 py-3 text-xs font-medium text-black shadow-dashboard">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-brand bg-white px-4 py-3 text-xs font-medium text-black shadow-dashboard">{notice}</div>}
      {activeCategory.id === 'maintenance' ? <section className="rounded-2xl border border-brand bg-white p-6 shadow-dashboard">
        <h2 className="display-font text-lg font-extrabold">System Maintenance</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[['Server','Running'],['Database',health?.database || 'Unknown'],['Environment',health?.environment || 'Unknown'],['Uptime',`${health?.uptime || 0}s`],['Backend','Connected'],['Application version',health?.applicationVersion || '1.0.0'],['Logo','Loaded'],['Audit logging',values.audit_logging ? 'Enabled' : 'Disabled']].map(([label,value]) =>
            <div key={label} className="rounded-xl border border-brand bg-white p-4 transition-colors hover:border-black/20"><div className="text-[10px] font-bold uppercase tracking-wide text-black">{label}</div><div className="mt-2 text-sm font-extrabold">{value}</div></div>)}
        </div>
      </section> : null}
      {activeCategory.id === 'audit' ? <section className="rounded-2xl border border-brand bg-white p-6 shadow-dashboard">
        <h2 className="display-font text-lg font-extrabold">Audit Logs</h2>
        <div className="mt-4 max-h-96 overflow-y-auto">
          {audit.length ? audit.map((entry) => <div key={entry.id} className="border-b border-subtle py-4 text-xs last:border-0">
            <div className="flex justify-wrap justify-between gap-2"><strong>{entry.action}</strong><span className="text-black">{String(entry.createdAt || '')}</span></div>
            <div className="mt-1 text-black">{entry.actor || 'System'} · {entry.entityType} · {entry.entityId}</div>
          </div>) : <div className="py-8 text-center text-xs text-black">No audit records available.</div>}
        </div>
      </section> : null}
      {activeCategory.id !== 'audit' && <section className="rounded-2xl border border-brand bg-white p-5 shadow-dashboard sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle pb-4">
          <div><h2 className="display-font text-lg font-extrabold">{activeCategory.label}</h2><p className="mt-1 text-xs leading-5 text-black">Changes are validated and saved to the database.</p></div>
          {dirtyKeys.length > 0 && <span className="rounded-full border border-brand bg-white px-3 py-1.5 text-[10px] font-bold text-black">{dirtyKeys.length} unsaved changes</span>}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {activeCategory.keys.map((key) => key in values ? <Field key={key} name={key} value={values[key]} onChange={change} /> : null)}
          {activeCategory.id === 'departments' && <div className="rounded-xl border border-brand bg-hover p-5 text-xs leading-5 text-black md:col-span-2">Department creation and approval assignment are managed from <strong className="text-black">Users Management</strong>. This section is integrated through the existing Department APIs and audit logs.</div>}
        </div>
      </section>}
      {activeCategory.id !== 'audit' && <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={cancel} disabled={!dirtyKeys.length} className={secondaryButtonClass}>Cancel</button>
        <button type="button" onClick={reset} disabled={saving} className={secondaryButtonClass}>Reset section</button>
        <button type="button" onClick={save} disabled={saving || !dirtyKeys.length} className={primaryButtonClass}><Save size={14} />{saving ? 'Saving…' : 'Save changes'}</button>
      </div>}
    </main>
  </div>;
}
