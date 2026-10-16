import * as THREE from 'three';

// Haz de luz volumétrico falso (abanico aditivo) + SpotLight real con sombras,
// para que las tostadas lo atraviesen, se iluminen y proyecten su sombra.
export function createLightBeam({
  origin,                 // centro de la tira emisiva
  direction,              // hacia dónde apunta la tira
  color,
  length = 4.5,
  startHalfHeight = 0.67, // alto de la tira / 2
  startHalfWidth = 0.035, // ancho de la tira / 2
  endHalfHeight = 1.0,
  endHalfWidth = 1.6,
  intensity = 0.6,
  spotIntensity = 25,
}) {
  // --- Geometría: tubo que pasa de la forma de la tira (línea vertical) a un abanico amplio
  const geo = new THREE.CylinderGeometry(1, 1, 1, 64, 24, true);
  const pos = geo.attributes.position;
  const sArr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 0.5 - y; // 0 en la tira, 1 al final del haz
    const h = THREE.MathUtils.lerp(startHalfHeight, endHalfHeight, s);
    const w = THREE.MathUtils.lerp(startHalfWidth, endHalfWidth, s);
    pos.setXYZ(i, s * length, x * h, z * w);
    sArr[i] = s;
  }
  geo.setAttribute('aS', new THREE.BufferAttribute(sArr, 1));
  geo.computeVertexNormals();

  const uniforms = {
    uColor: { value: color.clone() },
    uIntensity: { value: intensity },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aS;
      varying float vS;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      void main() {
        vS = aS;
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = -mv.xyz;
        vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying float vS;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vLocal;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vnoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
                   mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y), u.z);
      }
      void main() {
        // bordes suaves: el haz se ve más denso donde lo miras de frente
        float facing = abs(dot(normalize(vN), normalize(vView)));
        float edge = pow(facing, 1.6);
        // se desvanece a lo largo del recorrido
        float fall = pow(1.0 - vS, 1.3);
        // rayos y polvo flotando dentro del haz
        float rays = vnoise(vec3(vLocal.y * 5.0, vLocal.z * 3.0, vLocal.x * 0.35 - uTime * 0.25));
        float dust = vnoise(vec3(vLocal * 7.0) + vec3(0.0, uTime * 0.4, 0.0));
        float a = uIntensity * edge * fall * (0.55 + 0.45 * rays) * (0.85 + 0.3 * dust);
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'LightBeam';
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.clone().normalize());
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;

  // --- Luz real: ilumina las tostadas al pasar y proyecta sus sombras
  const spot = new THREE.SpotLight(color, spotIntensity, 0, 0.6, 0.75, 2);
  spot.position.copy(origin).addScaledVector(direction, 0.08);
  spot.target.position.copy(origin).addScaledVector(direction, 5);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 0.05;
  spot.name = 'BeamSpot';

  return { mesh, spot, uniforms };
}
