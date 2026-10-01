import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setToastPublisher } from '@/lib/toast';

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const publish = useCallback((options) => {
    const id = `${Date.now()}-${Math.random()}`;
    const item = { tone: 'success', duration: 5000, ...options, id };
    setItems((current) => [...current.slice(-3), item]);
    if (item.duration) window.setTimeout(() => dismiss(id), item.duration);
    return id;
  }, [dismiss]);

  useEffect(() => {
    setToastPublisher(publish);
    return () => setToastPublisher(null);
  }, [publish]);

  return <>{children}<ToastViewport items={items} onDismiss={dismiss} /></>;
}

function ToastViewport({ items, onDismiss }) {
  return <div data-toast-viewport className="pointer-events-none fixed right-3 bottom-3 z-[100] flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2" aria-live="polite" aria-atomic="false">{items.map((item) => {
    const Icon = item.tone === 'error' ? CircleAlert : item.tone === 'info' ? Info : CheckCircle2;
    return <section key={item.id} role={item.tone === 'error' ? 'alert' : 'status'} className={`toast-card toast-${item.tone} pointer-events-auto flex items-start gap-3 rounded-2xl border bg-popover/95 p-3.5 shadow-2xl backdrop-blur-xl`}><span className="toast-icon grid size-9 shrink-0 place-items-center rounded-xl"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{item.title}</div>{item.description ? <p className="text-muted-foreground mt-0.5 text-xs">{item.description}</p> : null}{item.action ? <Button size="sm" variant="outline" className="mt-2 h-7" onClick={() => { item.action.onClick(); onDismiss(item.id); }}>{item.action.label}</Button> : null}</div><Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1" onClick={() => onDismiss(item.id)} aria-label="Dismiss notification"><X className="size-3.5" /></Button></section>;
  })}</div>;
}
