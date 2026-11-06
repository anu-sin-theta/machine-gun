"use client";

import type { Application } from "@splinetool/runtime";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
});

export interface SplineSceneProps {
  /** Optional .splinecode scene URL. Falls back to the built-in 3D Three.js Kavach Orbital Shield if omitted. */
  sceneUrl?: string;
  riskMode?: "idle" | "low" | "medium" | "high";
  className?: string;
  onLoad?: (app: Application) => void;
}

export function SplineScene({
  sceneUrl,
  riskMode = "idle",
  className,
  onLoad,
}: SplineSceneProps) {
  const [splineError, setSplineError] = useState(false);
  const resolvedUrl =
    sceneUrl || process.env.NEXT_PUBLIC_SPLINE_SCENE_URL || "";

  if (resolvedUrl && !splineError) {
    return (
      <div className={cn("relative h-full w-full overflow-hidden", className)}>
        <Spline
          scene={resolvedUrl}
          onLoad={onLoad}
          onError={() => setSplineError(true)}
        />
      </div>
    );
  }

  return <KavachOrbitalCanvas riskMode={riskMode} className={className} />;
}

/**
 * Interactive Three.js 3D A2A Shield & Verifier Node Mesh.
 * Reacts to pointer position and live risk state (idle / low / medium / high).
 */
function KavachOrbitalCanvas({
  riskMode = "idle",
  className,
}: {
  riskMode: "idle" | "low" | "medium" | "high";
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const riskRef = useRef(riskMode);
  riskRef.current = riskMode;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100,
    );
    camera.position.set(0, 0, 6.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Core wireframe icosahedron (Kavach Rust/WASM Shield)
    const shieldGeo = new THREE.IcosahedronGeometry(1.45, 2);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      wireframe: true,
      transparent: true,
      opacity: 0.38,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    scene.add(shieldMesh);

    // Inner glowing core (0G Confidential TEE enclave)
    const innerGeo = new THREE.OctahedronGeometry(0.78, 1);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    scene.add(innerMesh);

    // Orbital ring for x402 Verifier Agents (TasteSkill rule: no violet/purple; use warm sand/amber & cyan)
    const ringGeo = new THREE.TorusGeometry(2.25, 0.015, 16, 120);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2.6;
    scene.add(ringMesh);

    // Second orbital ring (World ID Agent Pass)
    const ring2Geo = new THREE.TorusGeometry(2.55, 0.012, 16, 120);
    const ring2Mat = new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      transparent: true,
      opacity: 0.28,
    });
    const ring2Mesh = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2Mesh.rotation.x = -Math.PI / 3.1;
    ring2Mesh.rotation.y = Math.PI / 5;
    scene.add(ring2Mesh);

    // 3 Specialist Verifier Agent satellite nodes
    const satellites: THREE.Mesh[] = [];
    const satColors = [0x34d399, 0x38bdf8, 0xf59e0b];
    for (let i = 0; i < 3; i++) {
      const satGeo = new THREE.SphereGeometry(0.11, 16, 16);
      const satMat = new THREE.MeshBasicMaterial({
        color: satColors[i] ?? 0x34d399,
      });
      const sat = new THREE.Mesh(satGeo, satMat);
      scene.add(sat);
      satellites.push(sat);
    }

    // Pointer interaction
    const pointer = { x: 0, y: 0 };
    const onPointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener("mousemove", onPointerMove);

    const onResize = () => {
      if (!container) return;
      camera.aspect =
        container.clientWidth / Math.max(container.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    const palette: Record<
      "idle" | "low" | "medium" | "high",
      { shield: number; inner: number; speed: number }
    > = {
      idle: { shield: 0x38bdf8, inner: 0x818cf8, speed: 1 },
      low: { shield: 0x10b981, inner: 0x34d399, speed: 1.2 },
      medium: { shield: 0xf59e0b, inner: 0xfbbf24, speed: 1.8 },
      high: { shield: 0xef4444, inner: 0xf87171, speed: 2.8 },
    };

    let frameId = 0;
    let clock = 0;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const mode = palette[riskRef.current];
      clock += 0.01 * mode.speed;

      shieldMat.color.lerp(new THREE.Color(mode.shield), 0.06);
      innerMat.color.lerp(new THREE.Color(mode.inner), 0.06);

      shieldMesh.rotation.y = clock * 0.55 + pointer.x * 0.35;
      shieldMesh.rotation.x = clock * 0.25 + pointer.y * 0.25;

      innerMesh.rotation.y = -clock * 0.9;
      innerMesh.rotation.z = clock * 0.6;

      ringMesh.rotation.z = clock * 0.4;
      ring2Mesh.rotation.z = -clock * 0.3;

      satellites.forEach((sat, idx) => {
        const angle = clock * 1.4 + (idx * Math.PI * 2) / 3;
        sat.position.set(
          Math.cos(angle) * 2.25,
          Math.sin(angle) * 0.85,
          Math.sin(angle) * 1.9,
        );
      });

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("resize", onResize);
      shieldGeo.dispose();
      shieldMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={cn("relative h-full w-full select-none", className)}
    />
  );
}
