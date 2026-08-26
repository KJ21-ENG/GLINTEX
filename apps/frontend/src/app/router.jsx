import React from "react";
import { createBrowserRouter, redirect, useNavigate } from "react-router-dom";
import ProtectedAppLayout from "./ProtectedAppLayout.jsx";

// We will import the pages directly.
// Note: They will be broken until refactored in the next steps,
// but we are following the plan to refactor them immediately after.
import {
  Inbound,
  Stock,
  IssueToMachine,
  ReceiveFromMachine,
  DispatchV2,
  Packing,
  OpeningStock,
  BoxTransfer,
  Boiler,
  Masters,
  ContractorPayments,
  Reports,
  Settings,
  Login,
  Setup,
  ScaleTestPage,
  SendDocuments
} from "../pages";
import LabelDesigner from "../pages/Settings/LabelDesigner";
import PermissionGate from "../components/common/PermissionGate";
import { ACCESS_LEVELS } from "../utils/permissions";
import PackingSettings from "../components/settings/PackingSettings.jsx";

function PackingRoute() {
  const navigate = useNavigate();
  return <Packing onOpenSettings={() => navigate('/app/settings/packing')} />;
}

export const router = createBrowserRouter([
  {
    path: "/app",
    element: <ProtectedAppLayout />,
    children: [
      {
        index: true,
        loader: () => redirect("/app/inbound"),
      },
      {
        path: "scale-test",
        element: <ScaleTestPage />,
      },
      {
        path: "inbound",
        element: (
          <PermissionGate permission="inbound">
            <Inbound />
          </PermissionGate>
        ),
      },
      {
        path: "stock",
        element: (
          <PermissionGate permissions={['stock', 'packing']}>
            <Stock />
          </PermissionGate>
        ),
      },
      {
        path: "issue",
        element: (
          <PermissionGate permissions={['issue.cutter', 'issue.holo', 'issue.coning']}>
            <IssueToMachine />
          </PermissionGate>
        ),
      },
      {
        path: "receive",
        element: (
          <PermissionGate permissions={['receive.cutter', 'receive.holo', 'receive.coning']}>
            <ReceiveFromMachine />
          </PermissionGate>
        ),
      },
      {
        path: "dispatch",
        element: (
          <PermissionGate permission="dispatch">
            <DispatchV2 />
          </PermissionGate>
        ),
      },
      {
        path: "packing",
        element: (
          <PermissionGate permission="packing">
            <PackingRoute />
          </PermissionGate>
        ),
      },
      {
        path: "opening-stock",
        element: (
          <PermissionGate permission="opening_stock">
            <OpeningStock />
          </PermissionGate>
        ),
      },
      {
        path: "box-transfer",
        element: (
          <PermissionGate permission="box_transfer">
            <BoxTransfer />
          </PermissionGate>
        ),
      },
      {
        path: "boiler",
        element: (
          <PermissionGate permission="boiler">
            <Boiler />
          </PermissionGate>
        ),
      },
      {
        path: "send-documents",
        element: (
          <PermissionGate permission="send_documents">
            <SendDocuments />
          </PermissionGate>
        ),
      },
      {
        path: "masters",
        element: (
          <PermissionGate permission="masters">
            <Masters />
          </PermissionGate>
        ),
      },
      {
        path: "contractor-payments",
        element: (
          <PermissionGate permission="contractor_payments">
            <ContractorPayments />
          </PermissionGate>
        ),
      },
      {
        path: "reports",
        element: (
          <PermissionGate permission="reports">
            <Reports />
          </PermissionGate>
        ),
      },
      {
        path: "settings",
        element: (
          <PermissionGate permission="settings">
            <Settings />
          </PermissionGate>
        ),
      },
      {
        path: "settings/label-designer",
        element: (
          <PermissionGate permission="settings.edit" minLevel={ACCESS_LEVELS.READ}>
            <LabelDesigner />
          </PermissionGate>
        ),
      },
      {
        path: "settings/packing",
        element: (
          <PermissionGate permission="packing">
            <PackingSettings />
          </PermissionGate>
        ),
      },
    ],
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/setup",
    element: <Setup />,
  },
  {
    path: "/",
    loader: () => redirect("/app/inbound"),
  },
  {
    path: "*",
    loader: () => redirect("/app/inbound"),
  },
]);

export default router;
