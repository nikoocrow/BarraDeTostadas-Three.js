import * as THREE from 'three';

// Esferas de humo translúcidas:
//  - bordes que se desvanecen (efecto fresnel invertido), así cada esfera se ve suave y "algodonosa"
//  - ruido 3D animado en espacio mundo que da textura y varía la densidad
//  - sin escritura de profundidad, para que los grupos se mezclen como humo
export function createSmokeMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0.75 },
  };
  const mat = new THREE.MeshStandardMaterial({
    // Mismo azul que las chispas (material "Light Blue" de Blender: 0, 0.506, 1)
    // Azul de las chispas mezclado con blanco (más claro, tipo vapor)
    color: new THREE.Color().setRGB(0.55, 0.7, 0.88, THREE.LinearSRGBColorSpace),
    emissive: new THREE.Color().setRGB(0.45, 0.72, 1.0, THREE.LinearSRGBColorSpace),
    emissiveIntensity: 2.2, // por encima del umbral del bloom para que brille como las chispas
    roughness: 0.95,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vWP;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
                     mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y), u.z);
        }
        float fbm(vec3 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
          return v;
        }`
      )
      .replace(
        '#include <opaque_fragment>',
        `float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        float n = fbm(vWP * 2.4 + vec3(0.0, -uTime * 0.7, uTime * 0.2));
        float edge = smoothstep(0.0, 0.85, facing);
        diffuseColor.a = uOpacity * edge * smoothstep(0.2, 0.75, n + edge * 0.35);
        outgoingLight *= mix(0.65, 1.3, n); // núcleos más brillantes, como chispas
        #include <opaque_fragment>`
      );
  };
  return mat;
}
