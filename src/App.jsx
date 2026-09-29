import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { AppShell } from '@/components/layout/AppShell';
import { roleHome } from '@/lib/roles';
import { PanelSkeleton } from '@/components/data/EmptyState';

const OwnerDashboard = lazy(() => import('@/views/owner/OwnerDashboard').then((module) => ({ default: module.OwnerDashboard })));
const AgentDashboard = lazy(() => import('@/views/agent/AgentDashboard').then((module) => ({ default: module.AgentDashboard })));
const TechDashboard = lazy(() => import('@/views/tech/TechDashboard').then((module) => ({ default: module.TechDashboard })));

function RoleHome() {
  const { role } = useCurrentUser();
  return <Navigate to={roleHome(role)} replace />;
}

function RoleRoute({ requiredRole, children }) {
  const { role } = useCurrentUser();
  return role === requiredRole ? children : <Navigate to={roleHome(role)} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="p-6"><PanelSkeleton rows={8} /></div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<RoleHome />} />
          <Route path="/owner" element={<RoleRoute requiredRole="owner"><OwnerDashboard /></RoleRoute>} />
          <Route path="/agent" element={<RoleRoute requiredRole="agent"><AgentDashboard /></RoleRoute>} />
          <Route path="/tech" element={<RoleRoute requiredRole="tech"><TechDashboard /></RoleRoute>} />
          <Route path="*" element={<RoleHome />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
