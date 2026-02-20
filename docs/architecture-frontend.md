# Architecture: Frontend

## Executive Summary
Provides the end user Web interface interacting directly with the backend. Single Page Architecture allowing quick transitions across dashboards spanning entire factory lifecycle.

## Technology Stack
Built strictly on top of `Vite` serving a `React` bundle relying heavily on standard HTML/JSX DOM models layered with `TailwindCSS`. 

## Component Interconnection
Heavily utilizes React Context encapsulating fetch states loading directly via standard HTTP REST conventions against `/api/v1` and `/api/v2/`.
