// three.js for Simulations, as one classic script that sets the global THREE (plus
// THREE.OrbitControls), bundled into dist/three.js. A Simulation that uses THREE gets it
// injected (src/core/sim.ts), loaded from the extension itself: the sandbox has no network.
// Plain JS on purpose: three ships no types and the typecheck doesn't need them.
import * as THREE_ from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

globalThis.THREE = { ...THREE_, OrbitControls };
