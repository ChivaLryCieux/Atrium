import React, { useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * 5-Color Palette requested by user:
 * 黑 (Black) -> 红 (Red) -> 粉 (Pink) -> 黄 (Yellow) -> 橙 (Orange)
 * Obsidian Black, Crimson Red, Radiant Rose Pink, Golden Yellow, and Fiery Orange.
 */
const PALETTE_COLORS = [
  new THREE.Color("#0c0a09"), // 黑 (Deep obsidian black)
  new THREE.Color("#dc2626"), // 红 (Vibrant crimson red)
  new THREE.Color("#f43f5e"), // 粉 (Radiant rose pink)
  new THREE.Color("#facc15"), // 黄 (Brilliant sunny yellow)
  new THREE.Color("#f97316"), // 橙 (Fiery warm orange)
];

function sampleChromaticPalette(t: number): THREE.Color {
  const norm = ((t % 1) + 1) % 1;
  const n = PALETTE_COLORS.length;
  const scaled = norm * n;
  const i1 = Math.floor(scaled) % n;
  const i2 = (i1 + 1) % n;
  const frac = scaled - Math.floor(scaled);
  return PALETTE_COLORS[i1].clone().lerp(PALETTE_COLORS[i2], frac);
}

/**
 * Apply radiant 5-color (Red + Pink + Yellow + Orange + Black) vertex colors
 * to the user's loaded GLB mesh.
 * Strictly preserves the user's actual geometry and vertex structure.
 */
function applyColorfulShading(mesh: THREE.Mesh) {
  const geo = mesh.geometry;
  if (!geo || !geo.attributes.position) return;

  // If the user's model already has textures or custom vertex colors, preserve them
  const existingMat = mesh.material as THREE.MeshStandardMaterial;
  if (existingMat?.map) return;
  if (geo.attributes.color) return;

  const pos = geo.attributes.position;
  const colors: number[] = [];

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // 360-degree angle + subtle depth mapping across the 5 palette stops
    const angle = Math.atan2(y, x);
    const radius = Math.sqrt(x * x + y * y);
    const t = (angle + Math.PI) / (2 * Math.PI) + (z * 0.15) + (radius * 0.05);
    const color = sampleChromaticPalette(t);

    colors.push(color.r, color.g, color.b);
  }

  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  mesh.material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.16,
    metalness: 0.28,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    reflectivity: 0.9,
    flatShading: true,
  });
}

interface StarMeshProps {
  isRotating: boolean;
  spinTrigger?: number;
  slowSpin?: boolean;
}

function disposeScene(scene: THREE.Object3D) {
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }
  });
}

const StarMesh: React.FC<StarMeshProps> = ({ isRotating, spinTrigger, slowSpin = false }) => {
  const groupRef = useRef<THREE.Group>(null);
  const [modelScene, setModelScene] = useState<THREE.Group | null>(null);
  const currentSpeedRef = useRef<number>(0.42);
  const boostRef = useRef<number>(0);

  // Trigger energetic spin whenever clicked or moving between states
  useEffect(() => {
    if (spinTrigger && spinTrigger > 0) {
      boostRef.current = 6.8;
    }
  }, [spinTrigger]);

  useEffect(() => {
    let active = true;
    let loadedScene: THREE.Group | null = null;
    const loader = new GLTFLoader();

    loader.load(
      "/Star.glb",
      (gltf) => {
        if (!active) {
          disposeScene(gltf.scene);
          return;
        }

        // Traverse the user's actual GLB model and apply the Red+Pink+Yellow+Orange+Black shading
        // without altering or discarding the user's geometry
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            applyColorfulShading(mesh);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // Compute bounding box to auto-center and auto-scale ANY GLB model perfectly
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        if (maxDim > 0) {
          gltf.scene.position.sub(center);
          const targetScale = 1.9 / maxDim;
          gltf.scene.scale.setScalar(targetScale);
        }

        const wrapper = new THREE.Group();
        wrapper.add(gltf.scene);
        loadedScene = wrapper;
        setModelScene(wrapper);
      },
      undefined,
      (error) => {
        console.warn("[StarModelViewer] Failed to load /Star.glb:", error);
      }
    );

    return () => {
      active = false;
      if (loadedScene) {
        disposeScene(loadedScene);
        loadedScene = null;
      }
    };
  }, []);

  useFrame((_, delta) => {
    // Gracefully decay the click/move spin boost over ~1.2s
    if (boostRef.current > 0.005) {
      boostRef.current *= Math.exp(-delta * 2.4);
    } else {
      boostRef.current = 0;
    }

    // Always slowly rotate (0.42 rad/s) by default in all idle states.
    // Fast rotate (2.4 rad/s) during reasoning/streaming.
    // High-energy spin boost (+6.8 rad/s) on click/move.
    const baseSpeed = isRotating ? 2.4 : 0.42;
    const targetSpeed = baseSpeed + boostRef.current;
    currentSpeedRef.current += (targetSpeed - currentSpeedRef.current) * Math.min(1, delta * 4.0);

    if (groupRef.current && Math.abs(currentSpeedRef.current) > 0.0005) {
      groupRef.current.rotation.y += currentSpeedRef.current * delta;
      groupRef.current.rotation.x += currentSpeedRef.current * delta * 0.35;
    }
  });

  if (!modelScene) return null;

  return (
    <group
      ref={groupRef}
      rotation={[0.45, 0.65, 0.2]}
    >
      <primitive object={modelScene} />
    </group>
  );
};

export interface StarModelViewerProps {
  isRotating?: boolean;
  spinTrigger?: number;
  slowSpin?: boolean;
}

export const StarModelViewer: React.FC<StarModelViewerProps> = ({
  isRotating = false,
  spinTrigger,
  slowSpin = false,
}) => {
  return (
    <div className="telemetry-star-canvas-wrapper">
      <Canvas
        camera={{ position: [0, 0, 4.0], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
        style={{ width: "100%", height: "100%", background: "transparent", pointerEvents: "none" }}
      >
        <ambientLight intensity={1.1} />
        <directionalLight position={[4, 6, 5]} intensity={1.8} />
        <directionalLight position={[-4, -3, -3]} intensity={0.9} color="#fb7185" />
        <pointLight position={[0, 0, 3.5]} intensity={1.1} color="#fde047" />
        <StarMesh isRotating={isRotating} spinTrigger={spinTrigger} slowSpin={slowSpin} />
      </Canvas>
    </div>
  );
};

export default StarModelViewer;
