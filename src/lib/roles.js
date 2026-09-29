export const ROLES = /** @type {const} */ (['owner', 'agent', 'tech']);

export const ROLE_META = {
  owner: { label: 'Owner', description: 'Business KPIs and analytics' },
  agent: { label: 'Operations Agent', description: 'Inbox, Kanban and escalations' },
  tech: { label: 'Field Technician', description: 'Assigned jobs and field ops' },
};

export const ROLE_HOME = {
  owner: '/owner',
  agent: '/agent',
  tech: '/tech',
};

export function roleHome(role) {
  return ROLE_HOME[role] ?? ROLE_HOME.owner;
}

export function initialRole({ isDev, storedRole }) {
  return isDev && ROLES.includes(storedRole) ? storedRole : 'owner';
}
