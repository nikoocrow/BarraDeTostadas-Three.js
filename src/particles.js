import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();

// Emite desde las caras de una malla (igual que "Emit From: Faces" en Blender), repartido por área
export class TriangleEmitter {
  constructor(tris) {
    this.tris = tris
      .map((t) => {
        const a = new THREE.Vector3(...t.p[0]);
        const b = new THREE.Vector3(...t.p[1]);
        const c = new THREE.Vector3(...t.p[2]);
        return { a, b, c, n: new THREE.Vector3(...t.n).normalize(), area: new THREE.Triangle(a, b, c).getArea() };
      })
      .filter((t) => t.area > 1e-8);
    this.cdf = [];
    let acc = 0;
    for (const t of this.tris) { acc += t.area; this.cdf.push(acc); }
    this.total = acc;
  }

  sample(pos, nrm) {
    const r = Math.random() * this.total;
    let lo = 0, hi = this.cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.cdf[mid] < r) lo = mid + 1; else hi = mid; }
    const t = this.tris[lo];
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    pos.copy(t.a).addScaledVector(_ab.subVectors(t.b, t.a), u).addScaledVector(_ac.subVectors(t.c, t.a), v);
    nrm.copy(t.n);
  }
}

// Sistema de partículas Newtoniano simple con InstancedMesh (una sola draw call)
export class ParticleSystem {
  constructor(opts) {
    Object.assign(this, {
      max: 1000, rate: 100, life: 1, lifeRandom: 0,
      normalVelocity: 1, randomVelocity: 0,
      acceleration: new THREE.Vector3(),
      size: 0.1, sizeRandom: 0, fadeIn: 0, fadeOut: 0.15,
      grow: 0, lifeAttributes: false,
      clusterSize: 1, clusterSpread: 0, clusterLifeJitter: 0.15,
    }, opts);
    const max = this.max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.lifeArr = new Float32Array(max);
    this.sizeArr = new Float32Array(max);
    this.seedArr = new Float32Array(max);
    this.count = 0;
    this.accum = 0;
    this.mesh = new THREE.InstancedMesh(opts.geometry, opts.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (this.lifeAttributes) {
      // vida normalizada (0-1) y semilla por partícula para shaders tipo sprite
      this.aLife = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
      this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
      opts.geometry.setAttribute('aLife', this.aLife);
      opts.geometry.setAttribute('aSeed', this.aSeed);
    }
  }

  // Emite un grupo de partículas que nacen juntas (mismo punto, misma dirección y vida parecida)
  spawn() {
    this.emitter.sample(_p, _n);
    _r.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(this.randomVelocity);
    _n.multiplyScalar(this.normalVelocity).add(_r);
    const baseLife = this.life * (1 - this.lifeRandom * Math.random());
    const n = this.clusterSize;
    for (let c = 0; c < n; c++) {
      if (this.count >= this.max) return;
      const lifeT = n > 1 ? baseLife * (1 - this.clusterLifeJitter * Math.random()) : baseLife;
      if (lifeT <= 0.001) continue;
      const i = this.count++;
      const k = i * 3;
      let ox = 0, oy = 0, oz = 0;
      if (n > 1) {
        // punto aleatorio dentro de una esfera de radio clusterSpread
        do { ox = Math.random() * 2 - 1; oy = Math.random() * 2 - 1; oz = Math.random() * 2 - 1; } while (ox * ox + oy * oy + oz * oz > 1);
        ox *= this.clusterSpread; oy *= this.clusterSpread; oz *= this.clusterSpread;
      }
      this.pos[k] = _p.x + ox; this.pos[k + 1] = _p.y + oy; this.pos[k + 2] = _p.z + oz;
      this.vel[k] = _n.x + ox * 0.6; this.vel[k + 1] = _n.y + oy * 0.6; this.vel[k + 2] = _n.z + oz * 0.6;
      this.age[i] = 0;
      this.lifeArr[i] = lifeT;
      this.sizeArr[i] = this.size * (1 - this.sizeRandom * Math.random());
      this.seedArr[i] = Math.random();
    }
  }

  update(dt) {
    this.accum += this.rate * dt;
    let n = Math.floor(this.accum);
    this.accum -= n;
    while (n-- > 0) this.spawn();

    const ax = this.acceleration.x * dt, ay = this.acceleration.y * dt, az = this.acceleration.z * dt;
    const m = this.mesh.instanceMatrix.array;
    const P = this.pos, V = this.vel;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.lifeArr[i]) {
        const last = --this.count;
        if (i !== last) {
          const a = i * 3, b = last * 3;
          P[a] = P[b]; P[a + 1] = P[b + 1]; P[a + 2] = P[b + 2];
          V[a] = V[b]; V[a + 1] = V[b + 1]; V[a + 2] = V[b + 2];
          this.age[i] = this.age[last]; this.lifeArr[i] = this.lifeArr[last]; this.sizeArr[i] = this.sizeArr[last]; this.seedArr[i] = this.seedArr[last];
        }
        continue;
      }
      const k = i * 3;
      V[k] += ax; V[k + 1] += ay; V[k + 2] += az;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;

      const t = this.age[i] / this.lifeArr[i];
      let s = this.sizeArr[i];
      if (this.fadeIn > 0) s *= Math.min(1, t / this.fadeIn);
      if (this.fadeOut > 0) s *= Math.min(1, (1 - t) / this.fadeOut);
      if (this.grow > 0) s *= 1 + this.grow * t;
      if (this.aLife) { this.aLife.array[i] = t; this.aSeed.array[i] = this.seedArr[i]; }

      const o = i * 16;
      m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
      m[o + 12] = P[k]; m[o + 13] = P[k + 1]; m[o + 14] = P[k + 2]; m[o + 15] = 1;
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.aLife) { this.aLife.needsUpdate = true; this.aSeed.needsUpdate = true; }
  }
}
