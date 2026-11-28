import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Bell, Boxes, ClipboardCheck,
  Clock3, PackageCheck, Truck
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import {
  EmptyState, PortalBadge, StatCard, TableScroll, TextLink
} from './PortalUi.jsx';

function MovementTable({ title, movements, onOpen }) {
  return <PageCard title={title}>
    {movements?.length ? <TableScroll minWidth={620}>
      <table className="w-full text-left text-xs">
        <thead className="bg-white text-[10px] uppercase text-black">
          <tr>{['Date', 'Item', 'Reference', 'Quantity', 'Balance'].map((name) =>
            <th key={name} className="whitespace-nowrap px-4 py-3 font-bold">{name}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {movements.map((movement) => <tr key={movement.id}>
            <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(movement.movementAt)}</td>
            <td className="px-4 py-3"><TextLink onClick={() => onOpen('Bin Card', { item: movement.itemId })}>{movement.itemName}</TextLink>
              <div className="text-[10px] text-black">{movement.sku}</div></td>
            <td className="px-4 py-3 font-semibold">{movement.referenceNo || movement.source}</td>
            <td className="px-4 py-3">{movement.quantity} {movement.unit}</td>
            <td className="px-4 py-3 font-bold">{movement.balance}</td>
          </tr>)}
        </tbody>
      </table>
    </TableScroll> : <EmptyState title="No stock activity yet" description="Recorded inventory transactions will appear here." />}
  </PageCard>;
}

function ActionList({ title, description, items, empty, onOpen, page, render }) {
  return <PageCard title={title} description={description} action={<TextLink onClick={() => onOpen(page)}>View all</TextLink>}>
    {items?.length ? <div className="divide-y divide-subtle">
      {items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(page, { [item.requestId ? 'request' : 'purchaseOrder']: item.id })}
        className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left hover:bg-white">
        <span className="min-w-0">{render(item)}</span>
        <PortalBadge tone={item.decision === 'Accepted' ? 'emerald' : 'amber'}>{item.decision || item.status || 'Pending'}</PortalBadge>
      </button>)}
    </div> : <EmptyState title={empty} description="New records will appear here as soon as they are saved." />}
  </PageCard>;
}

export default function StockKeeperDashboard({ summary, notifications = [], onNavigate }) {
  const stats = summary?.stats || {};
  const cards = [
    { label: 'Requests awaiting decision', value: stats.pendingRequests ?? '—', note: 'Supervisor-routed requests to accept or reject', icon: ClipboardCheck, tone: 'amber', page: 'Requests from Supervisors' },
    { label: 'Expected deliveries', value: stats.expectedDeliveries ?? '—', note: `${stats.partiallyReceivedDeliveries ?? 0} partially received`, icon: Truck, tone: 'blue', page: 'Stock In' },
    { label: 'Stock items', value: stats.totalStockItems ?? '—', note: 'Catalogue items across all locations', icon: Boxes, tone: 'indigo', page: 'Stock Overview' },
    { label: 'Available balance', value: stats.availableStockBalance ?? '—', note: 'Units currently on hand', icon: PackageCheck, tone: 'emerald', page: 'Stock Overview' },
    { label: 'Low stock items', value: stats.lowStockItems ?? '—', note: `${stats.zeroStockItems ?? 0} items at zero balance`, icon: AlertTriangle, tone: 'red', page: 'Stock Overview' },
    { label: 'Recorded movements', value: Number(stats.totalStockIn || 0) + Number(stats.totalStockOut || 0), note: `${stats.totalStockIn ?? 0} in · ${stats.totalStockOut ?? 0} out`, icon: Clock3, tone: 'slate', page: 'Bin Card' }
  ];

  return <div className="space-y-5">
    <div className="flex justify-end">
      <button type="button" onClick={() => onNavigate('Notifications')} className="relative rounded-lg border border-brand bg-white p-2 text-black hover:text-black" aria-label="Open notifications">
        <Bell size={16} />{stats.unreadNotifications > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full border border-brand bg-white px-1 text-[9px] font-bold text-black">{stats.unreadNotifications}</span>}
      </button>
    </div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => <StatCard key={card.label} {...card} onClick={() => onNavigate(card.page)} />)}
    </section>

    {stats.attentionNotifications > 0 && <button type="button" onClick={() => onNavigate('Notifications')}
      className="flex w-full items-center gap-3 rounded-xl border border-brand bg-white p-4 text-left text-xs text-black">
      <AlertTriangle size={17} /><span><strong>{stats.attentionNotifications} notification(s) require attention.</strong> Review stock requests, expected deliveries and stock alerts.</span>
      <PortalBadge tone="amber">Review</PortalBadge>
    </button>}

    <div className="grid gap-5 xl:grid-cols-2">
      <ActionList
        title="Supervisor requests"
        description="Pending and accepted requests requiring Stock Keeper action"
        items={summary?.requestsAwaitingAction}
        empty="No requests awaiting action"
        page="Requests from Supervisors"
        onOpen={onNavigate}
        render={(item) => <><span className="block text-xs font-bold">{item.reference} · {item.requester}</span>
          <span className="text-[10px] text-black">{item.department || '—'} · {item.supervisorName || '—'}</span>
          <span className="mt-1 block text-[10px]">{item.items}</span>
          <span className="text-[10px]">{dateTimeLabel(item.routedAt)}</span></>}
      />
      <ActionList
        title="Expected deliveries"
        description="Approved purchase orders awaiting receipt"
        items={summary?.expectedDeliveries}
        empty="No expected deliveries"
        page="Stock In"
        onOpen={onNavigate}
        render={(item) => <><span className="block text-xs font-bold">{item.reference} · {item.supplier}</span>
          <span className="text-[10px] text-black">Expected {dateLabel(item.expectedDate) || 'date to be confirmed'}</span>
          <span className="mt-1 block text-[10px]">{item.items}</span>
          <span className="text-[10px]">{item.procurementOfficer || '—'}</span></>}
      />
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <MovementTable title="Recent stock-in transactions" movements={summary?.recentStockIn} onOpen={onNavigate} />
      <MovementTable title="Recent stock-out transactions" movements={summary?.recentStockOut} onOpen={onNavigate} />
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <PageCard title="Recently updated Bin Cards" description="Items with the latest inventory changes" action={<TextLink onClick={() => onNavigate('Bin Card')}>View Bin Card</TextLink>}>
        {summary?.recentBinCards?.length ? <div className="divide-y divide-subtle">
          {summary.recentBinCards.map((item) => <button key={item.id} type="button" onClick={() => onNavigate('Bin Card', { item: item.id })}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span className="min-w-0"><span className="block truncate text-xs font-bold">{item.name}</span><span className="text-[10px] text-black">{item.sku} · {item.category}</span></span>
            <span className="shrink-0 text-right"><span className="block text-xs font-extrabold">{item.balance} {item.unit}</span><span className="text-[10px] text-black">{dateTimeLabel(item.updatedAt)}</span></span>
          </button>)}
        </div> : <EmptyState title="No inventory items" description="Items added to the inventory will appear here." />}
      </PageCard>

      <PageCard title="Low-stock alerts" description="Items at or below their minimum stock level" action={<TextLink onClick={() => onNavigate('Stock Overview')}>View stock</TextLink>}>
        {summary?.lowStockItems?.length ? <div className="divide-y divide-subtle">
          {summary.lowStockItems.map((item) => <button key={item.id} type="button" onClick={() => onNavigate('Bin Card', { item: item.id })}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span><span className="block text-xs font-bold">{item.name}</span><span className="text-[10px] text-black">{item.sku}</span></span>
            <span className="text-right"><span className="block text-xs font-extrabold text-black">{item.balance} {item.unit}</span><span className="text-[10px] text-black">Minimum {item.minimumStock}</span></span>
          </button>)}
        </div> : <EmptyState title="Stock levels are healthy" description="There are no items below their minimum stock levels." />}
      </PageCard>
    </div>

    <PageCard title="Notifications requiring attention" action={<TextLink onClick={() => onNavigate('Notifications')}>View notifications</TextLink>}>
      {notifications.filter((notification) => !notification.isRead).slice(0, 4).length
        ? <div className="divide-y divide-subtle">{notifications.filter((notification) => !notification.isRead).slice(0, 4).map((notification) =>
          <button key={notification.id} type="button" onClick={() => onNavigate('Notifications')}
            className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left hover:bg-white">
            <span><span className="block text-xs font-bold">{notification.title}</span><span className="text-[11px] text-black">{notification.body}</span></span>
            <span className="shrink-0 text-[10px] text-black">{dateTimeLabel(notification.createdAt)}</span>
          </button>)}</div>
        : <EmptyState title="No unread notifications" description="Requests, deliveries, issues and stock alerts will appear here." />}
    </PageCard>
  </div>;
}
