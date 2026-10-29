# Shadow GX

Proxy web con interfaz de pestañas estilo Opera GX / Chrome, basado en
[Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet). Sin `<iframe>`:
cada pestaña se renderiza en un `<div>` con Shadow DOM.

## Ejecutar en local

```bash
npm install
npm start        # http://localhost:3000
```

## Desplegar en Render

1. Sube este proyecto a un repositorio de GitHub.
2. En render.com: **New → Web Service** y conecta el repositorio.
3. Build Command: `npm install` · Start Command: `npm start`.

Requiere un servidor Node.js con soporte de WebSocket (no funciona en hosting estático).
