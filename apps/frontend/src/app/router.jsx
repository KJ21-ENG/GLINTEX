import React from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import ProtectedAppLayout from "./ProtectedAppLayout.jsx";

// We will import the pages directly. 
// Note: They will be broken until refactored in the next steps, 
// but we are following the plan to refactor them immediately after.
import {
  Inbound,
  Stock,
  IssueToMachine,
  ReceiveFromMachine,
  OpeningStock,
  Masters,
  Reports,
  Settings,
  Login,
  Setup,
  ScaleTestPage
} from "../pages";
import LabelDesigner from "../pages/Settings/LabelDesigner";

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
        path: "opening-stock",
        element: <OpeningStock />,
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
