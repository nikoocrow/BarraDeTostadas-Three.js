import * as THREE from 'three';

// Pantalla del monitor: texto animado (máquina de escribir) dibujado en un canvas
// + shader CRT con parpadeo, líneas de escaneo, banda que recorre la pantalla y glitches en las transiciones.
// Se dibuja con mezcla aditiva sobre la pantalla negra del modelo, así que el fondo negro no se nota.

const MESSAGES = ['Barra de Tostadas', 'por Nicolas Castro'];
const TYPE_SPEED = 14;   // letras por segundo
const HOLD = 3.2;        // segundos que el texto completo se queda en pantalla
const GLITCH = 0.35;     // duración del glitch al cambiar de mensaje
const FONT = '"Share Tech Mono", ui-monospace, Consolas, monospace';

export function createScreen({ center, width, height, normal = new THREE.Vector3(-1, 0, 0), color, intensity = 3 }) {
  const W = 1024;
  const H = Math.round((W * height) / width);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // es una máscara, el color lo pone el shader
  tex.anisotropy = 4;

  const uniforms = {
    uTex: { value: tex },
    uColor: { value: color.clone() },
    uIntensity: { value: intensity },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uFlicker: { value: 1 },
    uRes: { value: new THREE.Vector2(W, H) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uGlitch;
      uniform float uFlicker;
      uniform vec2 uRes;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 uv = vUv;

        // Glitch: franjas horizontales desplazadas al azar (fuerte en transiciones, muy leve siempre)
        float row = floor(uv.y * 28.0);
        float tick = floor(uTime * 24.0);
        float g = uGlitch + step(0.985, hash(tick * 1.7)) * 0.4;
        uv.x += (hash(row + tick * 13.1) - 0.5) * 0.12 * g * step(0.55, hash(row * 3.3 + tick));
        // Temblor horizontal mínimo, como una señal analógica
        uv.x += sin(uv.y * 180.0 + uTime * 40.0) * 0.0008;

        // Aberración cromática: canales separados ligeramente
        float ca = 0.0025 + 0.012 * g;
        float r = texture2D(uTex, uv + vec2(ca, 0.0)).r;
        float gC = texture2D(uTex, uv).r;
        float b = texture2D(uTex, uv - vec2(ca, 0.0)).r;
        vec3 text = vec3(r, gC, b);

        // Brillo difuso alrededor de las letras (muestreo barato en cruz)
        float px = 6.0 / uRes.x, py = 6.0 / uRes.y;
        float halo = (texture2D(uTex, uv + vec2(px, 0.0)).r + texture2D(uTex, uv - vec2(px, 0.0)).r
                    + texture2D(uTex, uv + vec2(0.0, py)).r + texture2D(uTex, uv - vec2(0.0, py)).r) * 0.25;

        // Líneas de escaneo y banda luminosa que baja por la pantalla
        float scan = 0.88 + 0.12 * sin(vUv.y * uRes.y * 1.2);
        float band = smoothstep(0.12, 0.0, abs(fract(vUv.y + uTime * 0.18) - 0.5)) * 0.35;

        // Viñeta y fondo de fósforo apenas encendido
        vec2 d = vUv - 0.5;
        float vig = smoothstep(0.75, 0.25, length(d * vec2(1.0, 1.25)));
        vec3 base = uColor * (0.025 + band * 0.05);

        vec3 col = (uColor * (text * (scan + band) + halo * 0.6)) * uIntensity + base;
        col *= vig * uFlicker;
        // Destello blanquecino durante el glitch
        col += uColor * g * 0.15 * hash(row + tick);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.name = 'MonitorScreen';
  mesh.position.copy(center);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  mesh.renderOrder = 2;

  // --- Ajuste del texto a la pantalla: prueba 1, 2 o 3 líneas y se queda con la letra más grande que quepa
  const layouts = MESSAGES.map((msg) => fitText(ctx, msg, W * 0.84, H * 0.7));

  function fitText(c, msg, maxW, maxH) {
    const words = msg.toUpperCase().split(' ');
    let best = null;
    for (let nLines = 1; nLines <= Math.min(3, words.length); nLines++) {
      const lines = splitBalanced(words, nLines);
      c.font = `700 100px ${FONT}`;
      const widest = Math.max(...lines.map((l) => c.measureText(l).width));
      const size = Math.min((100 * maxW) / widest, maxH / (nLines * 1.15));
      if (!best || size > best.size) best = { lines, size };
    }
    return best;
  }

  // Reparte las palabras en n líneas de longitud parecida
  function splitBalanced(words, n) {
    const total = words.join(' ').length;
    const lines = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (lines.length < n - 1 && cur.join(' ').length >= total / n) { lines.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) lines.push(cur.join(' '));
    return lines;
  }

  function draw(layout, chars, cursor) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${layout.size}px ${FONT}`;
    const lh = layout.size * 1.15;
    const y0 = H / 2 - ((layout.lines.length - 1) * lh) / 2;
    let left = chars;
    let cx = 0, cy = y0;
    layout.lines.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, left));
      left -= line.length + 1;
      const full = ctx.measureText(line).width;
      const x = (W - full) / 2;
      const y = y0 + i * lh;
      ctx.fillText(shown, x, y);
      if (shown.length || i === 0) { cx = x + ctx.measureText(shown).width; cy = y; }
    });
    if (cursor) ctx.fillRect(cx + layout.size * 0.08, cy - layout.size * 0.42, layout.size * 0.5, layout.size * 0.84);
    tex.needsUpdate = true;
  }

  // --- Secuencia: escribir → mantener (cursor parpadeando) → glitch → siguiente mensaje
  let msgIndex = 0, t = 0, lastKey = '';
  function update(dt) {
    uniforms.uTime.value += dt;
    t += dt;
    const layout = layouts[msgIndex];
    const len = MESSAGES[msgIndex].length;
    const typeTime = len / TYPE_SPEED;

    let chars, cursor, glitch = 0;
    if (t < typeTime) {
      chars = Math.floor(t * TYPE_SPEED);
      cursor = true;
    } else if (t < typeTime + HOLD) {
      chars = len;
      cursor = Math.floor(t * 2.2) % 2 === 0;
    } else if (t < typeTime + HOLD + GLITCH) {
      chars = len;
      cursor = false;
      glitch = 1;
    } else {
      msgIndex = (msgIndex + 1) % MESSAGES.length;
      t = 0;
      chars = 0;
      cursor = true;
      glitch = 0.6;
    }
    uniforms.uGlitch.value = Math.max(glitch, uniforms.uGlitch.value - dt * 4);

    // Parpadeo: leve vibración constante + caídas bruscas ocasionales
    const now = uniforms.uTime.value;
    const step = Math.floor(now * 15);
    const rnd = fract(Math.sin(step * 91.7) * 43758.5);
    uniforms.uFlicker.value = (0.93 + 0.07 * Math.sin(now * 120)) * (rnd > 0.96 ? 0.45 : rnd > 0.9 ? 0.8 : 1);

    const key = `${msgIndex}|${chars}|${cursor}`;
    if (key !== lastKey) { draw(layouts[msgIndex], chars, cursor); lastKey = key; }
  }

  draw(layouts[0], 0, true);
  return { mesh, uniforms, update };
}

const fract = (x) => x - Math.floor(x);
