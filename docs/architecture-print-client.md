# Architecture: Print Client

## Executive Summary
Lightweight, localized desktop application serving predominantly as a "print proxy." Bypasses the browser limitations connecting directly with Desktop Level hardware APIs natively printing labels across TSC / Zebra environments.

## Technology Stack
Built utilizing the `Tauri` Framework: integrating Rust (`main.rs`) for the native backend interactions, wrapped around an inner `React` UI view loaded locally via `Vite`.

## Architecture Pattern
A Hybrid Desktop paradigm: Tauri handles systemic permissions and window frames whilst serving as a Web View renderer for the standard frontend tools logic inside. 
