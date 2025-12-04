import React from "react";
import { RouterProvider } from "react-router-dom";
import { InventoryProvider } from "../context/InventoryContext";
import router from "./router.jsx";

export default function App() {
  return (
    <InventoryProvider>
      <RouterProvider router={router} />
    </InventoryProvider>
  );
}