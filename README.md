# 🍞 Barra de Tostadas

Escena 3D interactiva hecha con **Three.js**: una tostadora industrial con cinta transportadora donde las rebanadas de pan entran crudas, atraviesan un túnel de chispas azules y un haz de luz naranja, y salen tostadas entre nubes de vapor.

La escena se modeló y animó en **Blender** y se recreó en el navegador intentando ser fiel al render original: materiales, luces, partículas y cámara se trasladaron desde el archivo de Blender.

## Características

- **Tostado progresivo**: shader propio que pasa del pan crudo (miga y corteza vía vertex colors) a pan tostado con manchas Voronoi, según la posición de cada rebanada en la cinta.
- **Animación en bucle** exportada desde Blender (200 frames) y reproducida con `AnimationMixer`.
- **Partículas** emitidas desde las caras de una malla, repartidas por área (como *Emit From: Faces* en Blender):
  - chispas azules en el túnel, empujadas por un campo de viento;
  - humo/vapor en grupos de esferas translúcidas con ruido 3D animado.
- **Haz de luz volumétrico** falso (abanico aditivo) acompañado de un `SpotLight` real con sombras.
- **Post-procesado** con bloom (`UnrealBloomPass`) para los brillos emisivos.
- **Cámara orbital** con límites para no atravesar ni salir del cuenco de la escena.
- **Panel de control** (lil-gui) para ajustar velocidad, exposición, luces, humo, haz de luz, bloom y partículas.
- Pantalla de carga, contador de FPS y panel de créditos animado.

## Tecnologías

- [Three.js](https://threejs.org/) 0.170
- [Vite](https://vitejs.dev/) 6
- [lil-gui](https://lil-gui.georgealways.com/)
- Blender (modelado, animación y exportación glTF)

## Cómo ejecutarlo

Requiere [Node.js](https://nodejs.org/) 18 o superior.

```bash
npm install
npm run dev       # servidor de desarrollo (abre el navegador)
npm run build     # build de producción en dist/
npm run preview   # sirve el build localmente
```

## Controles

| Acción | Control |
| --- | --- |
| Orbitar | Arrastrar con el ratón |
| Zoom | Rueda del ratón |
| Ajustes | Panel *Toast Bar* (esquina superior derecha) |

## Estructura

```
ToastBar/
├── index.html              # canvas, loader, HUD y créditos
├── public/
│   ├── favicon.svg
│   └── models/
│       ├── toastbar.glb    # escena exportada de Blender
│       └── scene-data.json # cámara, luces y caras emisoras de partículas
└── src/
    ├── main.js             # renderer, cámara, carga, GUI y bucle principal
    ├── toastMaterial.js    # shader de tostado crudo → tostado
    ├── particles.js        # emisor por triángulos y sistema de partículas instanciado
    ├── smokeMaterial.js    # material de humo translúcido con ruido
    ├── lightBeam.js        # haz de luz volumétrico + SpotLight
    ├── style.css
    └── assets/perfil.jpg
```

## Créditos

Diseño, modelado y desarrollo por **nikocrow** — [nikocrow.dev](https://nikocrow.dev)
