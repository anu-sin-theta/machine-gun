# Kavach402 Frontend (`machine-gun/frontend`)

Standalone **A2A Security Marketplace & Zero-Trust Payment Firewall** frontend built with **GSAP**, **Spline 3D**, **Three.js**, **Framer Motion**, and **Lenis**.

## Included Animation & 3D Stack

- **GSAP (`gsap` + `@gsap/react`)**: Pre-registered with `ScrollTrigger`, `TextPlugin`, and `Flip` in `src/lib/gsap.ts`.
- **Spline (`@splinetool/react-spline` + `@splinetool/runtime`)**: Ready-to-use `<SplineScene />` component in `src/components/three/SplineScene.tsx` with a built-in 60 FPS Three.js 3D Orbital Shield fallback. You can paste any `.splinecode` URL live in the navbar or set `NEXT_PUBLIC_SPLINE_SCENE_URL`.
- **Framer Motion (`framer-motion`)**: Layout transitions, category filtering, and live Verifier Agent evidence feed streaming.
- **Lenis (`lenis`)**: Smooth scrolling synced with `gsap.ticker` and `ScrollTrigger.update` in `src/components/providers/SmoothScrollProvider.tsx`.

## Running

```bash
cd frontend
pnpm install
pnpm dev
```

Runs on `http://localhost:3001` and automatically proxies `/api/*` requests to the `machine-gun` backend on `http://localhost:3000` (while also working standalone if the backend is offline).
