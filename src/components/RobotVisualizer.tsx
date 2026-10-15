import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { TEAM_COLORS } from '../config/balance';
import { RobotMeshFactory } from '../rendering/RobotMeshFactory';
import { RobotDesign } from '../types/robot';

/** Rotating model preview: the upgrade visibly changes the robot (brief §7). */
export const RobotVisualizer: React.FC<{ design: RobotDesign; width?: number; height?: number }> = ({ design, width = 150, height = 124 }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; model: THREE.Group | null; raf: number } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff6e0', '#8a7a60', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(4, 8, 5);
    scene.add(sun);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.25, 32), new THREE.MeshLambertMaterial({ color: '#334155' }));
    pedestal.position.y = -0.13;
    scene.add(pedestal);
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    camera.position.set(6.5, 4.6, 7.5);
    camera.lookAt(0, 1.3, 0);
    const state = { renderer, scene, camera, model: null as THREE.Group | null, raf: 0 };
    ctx.current = state;
    const animate = () => {
      state.raf = requestAnimationFrame(animate);
      if (state.model) state.model.rotation.y += 0.012;
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(state.raf);
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, [width, height]);

  const key = `${design.chassisId}|${design.modules.join(',')}`;
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const prevRot = c.model?.rotation.y ?? -0.6;
    if (c.model) c.scene.remove(c.model);
    const rig = RobotMeshFactory.createRobot(design, TEAM_COLORS.player);
    rig.root.rotation.y = prevRot;
    c.scene.add(rig.root);
    c.model = rig.root;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={mountRef} className="rounded-xl overflow-hidden bg-gradient-to-b from-slate-700/50 to-slate-900/60 border border-white/10" style={{ width, height }} />;
};
