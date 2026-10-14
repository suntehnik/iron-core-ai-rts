import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RobotDesign } from '../types/robot';
import { RobotMeshFactory } from '../rendering/RobotMeshFactory';

interface RobotVisualizerProps {
  design: RobotDesign;
  width?: number;
  height?: number;
}

export const RobotVisualizer: React.FC<RobotVisualizerProps> = ({
  design,
  width = 240,
  height = 180,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 1.2, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight('#ffffff', 1.4);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight('#38bdf8', 2.0);
    dirLight.position.set(5, 8, 4);
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight('#f59e0b', 0.8);
    backLight.position.set(-5, 3, -4);
    scene.add(backLight);

    // Robot Mesh
    const robotMesh = RobotMeshFactory.createRobotMesh(design, design.color || '#3b82f6');
    scene.add(robotMesh);

    // Pedestal platform
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.6, 0.2, 24),
      new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7 })
    );
    pedestal.position.y = -0.1;
    scene.add(pedestal);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      robotMesh.rotation.y += 0.015;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [design, width, height]);

  return <div ref={mountRef} className="rounded-lg overflow-hidden border border-slate-700/60 bg-slate-900/60" />;
};
