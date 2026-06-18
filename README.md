# PostalSignal.es

Ficha de inteligencia local para seguridad residencial y negocio en Espana.

## Arranque

```bash
npm start
```

Abre:

```text
http://localhost:4173
```

Produccion principal:

```text
https://www.postalsignal.es
```

## Despliegue gratuito en Render

El proyecto incluye `render.yaml`, escucha el puerto indicado por `PORT` y expone:

```text
/api/health
```

Configuracion:

- Runtime: Node.js 22.
- Build: `npm install`.
- Start: `npm start`.
- Region: Frankfurt.
- Plan: Free.

Pasos:

1. Subir este directorio a un repositorio de GitHub.
2. En Render, crear un Blueprint y conectar el repositorio.
3. Confirmar el servicio definido en `render.yaml`.
4. Abrir la URL HTTPS `*.onrender.com` asignada por Render.

Limitaciones del plan gratuito de Render:

- El servicio se duerme tras un periodo sin trafico y el primer acceso puede tardar en arrancar.
- El sistema de archivos es temporal. Las busquedas escritas en `data/search-history.json` pueden perderse al reiniciar o desplegar.
- Los datasets incluidos en el repositorio y las consultas a fuentes externas siguen funcionando tras cada arranque.

## Que hace ahora

- Busca por direccion, ciudad, municipio o codigo postal.
- Resuelve municipio/provincia/coordenadas con el dataset real de GeoNames para codigos postales de Espana.
- Muestra mapa con zona aproximada.
- Rastrea noticias reales con Google News RSS y GDELT como respaldo.
- Filtra noticias para quedarse solo con robos, asaltos, alunizajes o intrusiones relacionados con viviendas, domicilios, comercios, locales, negocios, tiendas, bares, restaurantes o naves.
- No muestra noticias inventadas. Si no hay noticias verificables, lo indica.
- Muestra fotos cuando la fuente real aporta imagen verificable. Si no hay imagen verificable, no la inventa.
- Descarga datos oficiales del Portal Estadistico de Criminalidad del Ministerio del Interior:
  - balance trimestral 2026 T1 por municipios mayores de 20.000 habitantes/islas y provincias
  - robos con fuerza en domicilios
  - robos con fuerza en domicilios, establecimientos y otras instalaciones
  - robos con violencia e intimidacion
  - hurtos
  - total de infracciones penales
  - allanamiento/usurpacion de inmuebles por provincia, serie anual
- Cita fuentes, fichero CSV y fecha de actualizacion cuando estan disponibles.
- Muestra noticias como puntos/lista sobre el mapa.
- Al seleccionar una noticia, abre una ficha inferior con fuente, fecha, tipo detectado, enlace original e indicacion de si menciona inhibidor.
- Muestra KPIs oficiales y fuentes verificables.
- Permite imprimir/exportar PDF desde el navegador.

## Siguientes mejoras importantes

1. Ampliar resolucion CP cuando un codigo postal cubre varias localidades.
2. Anadir cache persistente y actualizacion programada de CSV oficiales.
3. Guardar busquedas en una base local.
4. Crear un generador de PDF con marca propia.
5. Afinar scoring con pesos editables y explicacion de calculo.
6. Incorporar empresas locales de alarmas por provincia.
7. Anadir datos de vivienda/actividad urbana oficiales cuando haya fuente municipal o INE fiable.

## Criterio comercial

La herramienta esta pensada para vender prevencion, no miedo. La ficha usa noticias y datos como contexto, sin afirmar que una zona es peligrosa si no hay base estadistica suficiente.
