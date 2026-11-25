import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Bell, Boxes, Clock3, PackageCheck
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import { dateTimeLabel } from '../../utils/format.js';
import {
  EmptyState, PageHeader, PortalBadge, StatCard, TableScroll, TextLink
} from './PortalUi.jsx';

function MovementTable({ title, movements, onOpen }) {
  return <PageCard title={title}>
    {movements?.length ? <TableScroll minWidth={620}>
      <table className="w-full text-left text-xs">
        <thead className="bg-white text-[10px] uppercase text-muted">
          <tr>{['Date', 'Item', 'Reference', 'Quantity', 'Balance'].map((name) =>
            <th key={name} className="whitespace-nowrap px-4 py-3 font-bold">{name}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {movements.map((movement) => <tr key={movement.id}>
            <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(movement.movementAt)}</td>
            <td className="px-4 py-3"><TextLink onClick={() => onOpen('Bin Card', { item: movement.itemId })}>{movement.itemName}</TextLink>
              <div className="text-[10px] text-muted">{movement.sku}</div></td>
            <td className="px-4 py-3 font-semibold">{movement.referenceNo || movement.source}</td>
            <td className="px-4 py-3">{movement.quantity} {movement.unit}</td>
            <td className="px-4 py-3 font-bold">{movement.balance}</td>
          </tr>)}
        </tbody>
      </table>
    </TableScroll> : <EmptyState title="No stock activity yet" description="Recorded inventory transactions will appear here." />}
  </PageCard>;
}

export default function StockKeeperDashboard({ summary, notifications = [], onNavigate }) {
  const stats = summary?.stats || {};
  const cards = [
    { label: 'Total Stock Items', value: stats.totalStockItems ?? '—', note: 'Items in the inventory catalogue', icon: Boxes, tone: 'blue', page: 'Bin Card' },
    { label: 'Total Stock In', value: stats.totalStockIn ?? '—', note: 'Units recorded as received', icon: ArrowDownToLine, tone: 'emerald', page: 'Bin Card' },
    { label: 'Total Stock Out', value: stats.totalStockOut ?? '—', note: 'Units issued or adjusted out', icon: ArrowUpFromLine, tone: 'amber', page: 'Bin Card' },
    { label: 'Available Stock Balance', value: stats.availableStockBalance ?? '—', note: 'Units currently on hand', icon: PackageCheck, tone: 'indigo', page: 'Bin Card' },
    { label: 'Low Stock Items', value: stats.lowStockItems ?? '—', note: `${stats.zeroStockItems ?? 0} items at zero balance`, icon: AlertTriangle, tone: 'red', page: 'Bin Card' },
    { label: 'Recent Stock Activities', value: summary?.recentActivities?.length ?? '—', note: 'Latest recorded transactions', icon: Clock3, tone: 'slate', page: 'Bin Card' }
  ];

  return <div className="space-y-5">
    <PageHeader eyebrow="Inventory operations" title="Stock Keeper Dashboard"
      description="Live stock balances, recent movements, and items that need attention."
      actions={<button type="button" onClick={() => onNavigate('Notification')} className="relative rounded-lg border border-brand bg-white p-2 text-muted hover:text-black" aria-label="Open notifications">
        <Bell size={16} />{stats.attentionNotifications > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border border-brand bg-white px-1 text-[9px] font-bold text-black">{stats.attentionNotifications}</span>}
      </button>} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => <StatCard key={card.label} {...card} onClick={() => onNavigate(card.page)} />)}
    </section>

    {stats.attentionNotifications > 0 && <button type="button" onClick={() => onNavigate('Notification')}
      className="flex w-full items-center gap-3 rounded-xl border border-brand bg-white p-4 text-left text-xs text-black">
      <AlertTriangle size={17} /><span><strong>{stats.attentionNotifications} notification(s) require attention.</strong> Review approved issues and stock alerts.</span>
      <PortalBadge tone="amber">Review</PortalBadge>
    </button>}

    <div className="grid gap-5 xl:grid-cols-2">
      <MovementTable title="Recent stock-in transactions" movements={summary?.recentStockIn} onOpen={onNavigate} />
      <MovementTable title="Recent stock-out transactions" movements={summary?.recentStockOut} onOpen={onNavigate} />
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <PageCard title="Recently updated Bin Cards" description="Items with the latest inventory changes">
        {summary?.recentBinCards?.length ? <div className="divide-y divide-subtle">
          {summary.recentBinCards.map((item) => <button key={item.id} type="button" onClick={() => onNavigate('Bin Card', { item: item.id })}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span className="min-w-0"><span className="block truncate text-xs font-bold">{item.name}</span><span className="text-[10px] text-muted">{item.sku} · {item.category}</span></span>
            <span className="shrink-0 text-right"><span className="block text-xs font-extrabold">{item.balance} {item.unit}</span><span className="text-[10px] text-muted">{dateTimeLabel(item.updatedAt)}</span></span>
          </button>)}
        </div> : <EmptyState title="No inventory items" description="Items added to the inventory will appear here." />}
      </PageCard>

      <PageCard title="Low-stock alerts" description="Items at or below their minimum stock level">
        {summary?.lowStockItems?.length ? <div className="divide-y divide-subtle">
          {summary.lowStockItems.map((item) => <button key={item.id} type="button" onClick={() => onNavigate('Bin Card', { item: item.id })}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span><span className="block text-xs font-bold">{item.name}</span><span className="text-[10px] text-muted">{item.sku}</span></span>
            <span className="text-right"><span className="block text-xs font-extrabold text-black">{item.balance} {item.unit}</span><span className="text-[10px] text-muted">Minimum {item.minimumStock}</span></span>
          </button>)}
        </div> : <EmptyState title="Stock levels are healthy" description="There are no items below their minimum stock levels." />}
      </PageCard>
    </div>

    <PageCard title="Notifications requiring attention" action={<TextLink onClick={() => onNavigate('Notification')}>View notifications</TextLink>}>
      {notifications.filter((notification) => !notification.isRead).slice(0, 4).length
        ? <div className="divide-y divide-subtle">{notifications.filter((notification) => !notification.isRead).slice(0, 4).map((notification) =>
          <button key={notification.id} type="button" onClick={() => onNavigate('Notification')}
            className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span><span className="block text-xs font-bold">{notification.title}</span><span className="text-[11px] text-muted">{notification.body}</span></span>
            <span className="shrink-0 text-[10px] text-muted">{dateTimeLabel(notification.createdAt)}</span>
          </button>)}</div>
        : <EmptyState title="No unread notifications" description="Inventory updates and approved stock requests will appear here." />}
    </PageCard>
  </div>;
}
