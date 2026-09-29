import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Inbox,
  KanbanSquare,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { ROLE_HOME } from '@/lib/roles';

/*
 * Module navigation is per-role because each role is a different console, not a
 * filtered view of one screen. Modules are addressed with `?view=` so a URL is
 * shareable and the back button behaves, without exploding the route table.
 */

export const ROLE_MODULES = {
  owner: [
    { id: 'overview', label: 'Overview', description: 'Business pulse', icon: BarChart3, group: 'Business' },
    { id: 'bookings', label: 'Bookings', description: 'Service schedule', icon: CalendarDays, group: 'Operations' },
    { id: 'complaints', label: 'Complaints', description: 'Customer care', icon: ClipboardList, group: 'Operations' },
    { id: 'escalations', label: 'Escalations', description: 'Priority cases', icon: Users, group: 'Operations' },
  ],
  agent: [
    { id: 'inbox', label: 'Inbox', description: 'Conversations', icon: Inbox, group: 'Workspace' },
    { id: 'board', label: 'Board', description: 'Case workflow', icon: KanbanSquare, group: 'Workspace' },
    { id: 'bookings', label: 'Bookings', description: 'Assign & manage', icon: CalendarDays, group: 'Operations' },
    { id: 'escalations', label: 'Escalations', description: 'Human handoffs', icon: Users, group: 'Operations' },
  ],
  tech: [
    { id: 'jobs', label: 'My Jobs', description: 'Today’s work', icon: Wrench, group: 'Field' },
    { id: 'schedule', label: 'Schedule', description: 'Upcoming visits', icon: CalendarDays, group: 'Field' },
    { id: 'profile', label: 'My Profile', description: 'Field identity', icon: User, group: 'Field' },
  ],
};

export const DEFAULT_MODULE = {
  owner: 'overview',
  agent: 'inbox',
  tech: 'jobs',
};

export function modulesForRole(role) {
  return ROLE_MODULES[role] ?? ROLE_MODULES.owner;
}

export function moduleHref(role, moduleId) {
  return `${ROLE_HOME[role] ?? '/owner'}?view=${moduleId}`;
}

/** Groups modules for rendering, preserving declaration order. */
export function groupedModules(role) {
  const groups = new Map();
  for (const mod of modulesForRole(role)) {
    if (!groups.has(mod.group)) groups.set(mod.group, []);
    groups.get(mod.group).push(mod);
  }
  return [...groups.entries()];
}
