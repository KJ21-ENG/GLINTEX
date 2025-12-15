import React from "react";
import { RouterProvider } from "react-router-dom";
import router from "./router.jsx";
import { AuthProvider } from "../context/AuthContext";

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
