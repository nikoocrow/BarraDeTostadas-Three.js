import * as THREE from 'three';

// Emula el material "Toast" de Blender:
//  - Crudo: mezcla de dos tonos de pan usando el vertex color (miga / corteza), roughness 1
//  - Tostado: base quemada + manchas Voronoi (F1, escala 5, espacio objeto + random por instancia), roughness 0.5
//  - El paso de crudo a tostado lo da el atributo "Factor" (posición a lo largo de la cinta), rampa 0.536 → 0.591
//  - Extra: al tostarse se oscurece hacia un marrón quemado (más en las manchas), controlado por toastBurn

// Compartido por todas las tostadas, para ajustarlo desde la GUI (0 = como en Blender, 1 = muy tostado)
export const toastBurn = { value: 0.8 };

export function createToastMaterial(seed = Math.random()) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    uToast: { value: 0 },
    uSeed: { value: new THREE.Vector3(seed, seed, seed) },
    uBurn: toastBurn,
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uToast;
uniform vec3 uSeed;
uniform float uBurn;
varying vec3 vObjPos;
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float voronoiF1(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash33(i + g) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}`
      )
      .replace(
        '#include <color_fragment>',
        `float vcol = vColor.r;
vec3 rawCol = mix(vec3(0.497, 0.144, 0.035), vec3(0.494, 0.321, 0.120), vcol);
float vd = voronoiF1((vObjPos + uSeed) * 5.0);
vec3 spot = mix(vec3(0.553, 0.025, 0.001), vec3(1.0, 0.364, 0.184), clamp((vd - 0.255) / 0.04, 0.0, 1.0));
vec3 toastCol = mix(vec3(0.495, 0.076, 0.015), spot, vcol);
// Oscurecido: se reemplaza el tono rojizo por café (sRGB ~#7a5232 en la superficie, ~#3c2414 en las manchas)
float spotMask = 1.0 - clamp((vd - 0.2) / 0.15, 0.0, 1.0);
vec3 brown = mix(vec3(0.195, 0.084, 0.031), vec3(0.045, 0.018, 0.007), spotMask);
vec3 burnt = mix(brown, brown * (0.6 + 0.8 * toastCol), 0.35); // conserva algo de la variación original
toastCol = mix(toastCol, burnt, uBurn);
diffuseColor.rgb = mix(rawCol, toastCol, uToast);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(1.0, 0.5, uToast);'
      );
  };
  return mat;
}
