import React from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import DashboardLayout from "../components/layouts/DashboardLayout";

// We will import the pages directly. 
// Note: They will be broken until refactored in the next steps, 
// but we are following the plan to refactor them immediately after.
import {
  Inbound,
  Stock,
  IssueToMachine,
  ReceiveFromMachine,
  Masters,
  Reports,
  Settings
} from "../pages";
import LabelDesigner from "../pages/Settings/LabelDesigner";

export const router = createBrowserRouter([
  {
    path: "/app",
    element: <DashboardLayout />,
    children: [
      {
        index: true,
        loader: () => redirect("/app/inbound"),
      },
      {
        path: "inbound",
        element: <Inbound />,
      },
      {
        path: "stock",
        element: <Stock />,
      },
      {
        path: "issue",
        element: <IssueToMachine />,
      },
      {
        path: "receive",
        element: <ReceiveFromMachine />,
      },
      {
        path: "masters",
        element: <Masters />,
      },
      {
        path: "reports",
        element: <Reports />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
      {
        path: "settings/label-designer",
        element: <LabelDesigner />,
      },
    ],
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