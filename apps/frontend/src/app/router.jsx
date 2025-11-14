import React from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import InventoryApp from "../features/root/InventoryApp.jsx";

export const router = createBrowserRouter([
  {
    path: "/app/*",
    element: <InventoryApp />,
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
