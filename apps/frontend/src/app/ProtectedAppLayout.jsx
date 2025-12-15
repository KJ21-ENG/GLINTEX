import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import DashboardLayout from '../components/layouts/DashboardLayout';
import { InventoryProvider } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';

export default function ProtectedAppLayout() {
  const { loading, user, needsBootstrap } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (needsBootstrap) {
    return <Navigate to="/setup" replace />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <InventoryProvider>
      <DashboardLayout />
    </InventoryProvider>
  );
}

