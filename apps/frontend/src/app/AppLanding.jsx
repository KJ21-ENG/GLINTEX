import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useInventory } from '../context/InventoryContext';
import AccessDenied from '../components/common/AccessDenied';
import { getLandingModule, getLandingProcess } from '../utils/landing';

// /app index: send the user to the first module they have permission for.
export default function AppLanding() {
  const { user } = useAuth();
  const { process, setProcess } = useInventory();
  const landing = getLandingModule(user);
  const landingProcess = getLandingProcess(user, landing, process);
  const needsProcess = landingProcess !== process;

  useEffect(() => {
    if (needsProcess) setProcess(landingProcess);
  }, [needsProcess, landingProcess, setProcess]);

  if (!landing) return <AccessDenied />;
  if (needsProcess) return null;
  return <Navigate to={`/app/${landing.key}`} replace />;
}
