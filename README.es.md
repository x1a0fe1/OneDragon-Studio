# OneDragon Studio · AI漫剧一条龙

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Français](README.fr.md) | **Español** | [العربية](README.ar.md)

> Nota: la interfaz web está disponible en inglés y chino simplificado (cámbiala con «中 / EN» al pie de la barra lateral).

Una línea de producción de cómics dramatizados con IA, del guion al video final, con interfaz web y despliegue local.

```
Guion → Storyboard con IA → Recursos de personajes/escenarios → Primer fotograma de cada plano → Imagen a video → Voz y subtítulos → Video final
```

- **Flujo por etapas**: el resultado de cada paso se guarda y se puede editar en la web; si cambias un paso, se vuelve a ejecutar desde ahí, sin empezar de cero.
- **Cola de tareas en segundo plano**: las operaciones largas se ponen en cola, se reintentan automáticamente si fallan y siguen ejecutándose aunque cierres la página o reinicies el servicio. No necesita Redis / Docker.
- **Modelos intercambiables**: para texto incluye ajustes predefinidos de DeepSeek, OpenAI, Google Gemini, Anthropic Claude, Azure OpenAI, OpenRouter, Alibaba Cloud Model Studio, Volcano Engine Ark, SiliconFlow, Ollama, además de cualquier API compatible con OpenAI, con proxy configurable para APIs del extranjero; para generar imágenes y videos puedes elegir plataformas en la nube (Alibaba Cloud Model Studio (阿里云百炼), Volcano Engine Ark (火山方舟), sin GPU) o ComfyUI (en tu equipo o en un servidor GPU remoto).
- **Formato vertical primero**: 9:16 por defecto, pensado para microdramas y cómics dramatizados en Kuaishou / Douyin.

## Progreso del desarrollo

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Gestión de proyectos / episodios, importación de guiones, storyboard con IA (editable), cola de tareas, ajustes | ✅ |
| 2 | Imágenes de referencia de personajes/escenarios, primer fotograma de cada plano, imagen a video (ComfyUI + proveedor de demostración), subida de tus propias imágenes | ✅ |
| 3 | Voz para los diálogos, subtítulos, montaje del video final (con marca de IA), descarga de MP4 / SRT | ✅ |
| 4 | Importación de historias o novelas y división en capítulos, objetos, biblioteca de recursos entre proyectos, configuración de prompts, registro de IA | ✅ |
| 5 | Generación de imágenes y videos en la nube (Alibaba Cloud Model Studio (阿里云百炼) / Volcano Engine Ark (火山方舟)), episodio en un clic, interfaz con barra lateral y página de bienvenida | ✅ |
| 6 | LLM de texto de varios proveedores (OpenAI / Gemini / Claude / Azure, etc.), interfaz bilingüe chino/inglés, README multilingüe, donaciones con PayPal | ✅ |

## Inicio rápido (Windows)

Requiere Python 3.10+ y Node.js 18+.

Haz doble clic en `start.bat`. La primera vez instalará automáticamente las dependencias y compilará el frontend; después abrirá http://127.0.0.1:8100 .

Luego:

1. Abre **Ajustes** (「设置」), introduce la dirección del modelo de lenguaje, el nombre del modelo y tu propia API Key, y haz clic en **Guardar y probar conexión** (「保存并测试连接」).
2. Vuelve a **Proyectos** (「项目」) y crea una nueva serie. Haz clic en **Importar historia o novela** (「导入故事或小说」) (TXT / EPUB / pegar texto) para dividirla en episodios por títulos de capítulo, por trama con IA o por número de caracteres; en la vista previa puedes cambiar títulos, fusionar y seleccionar episodios. También puedes crear un episodio nuevo y pegar el guion directamente.
3. Haz clic en **Storyboard con IA** (「AI 拆分镜」) y en unos segundos tendrás la tabla de planos: escena, tipo de plano, movimiento de cámara, imagen, diálogo, prompt del primer fotograma y prompt del video, todo editable directamente.
4. Vuelve a la página del proyecto y usa **Generar en un clic las imágenes de referencia que faltan** (「一键生成缺少的参考图」) para crear imágenes de referencia de personajes, escenarios y objetos (también puedes subir las tuyas).
5. En la tabla de planos, usa **Generar primeros fotogramas en lote** (「批量生成首帧」) → **Generar videos en lote** (「批量生成视频」), o vuelve a generar plano por plano.
6. O bien haz clic directamente en **Episodio en un clic** (「一键成片」) en la página del episodio: recorre automáticamente storyboard → imágenes de referencia → primeros fotogramas → videos → voz → montaje, sin rehacer lo que ya existe; si algún paso falla, se detiene y explica el motivo, y tras corregirlo basta con volver a hacer clic para continuar.
7. Haz clic en **Montar video final** (「合成成片」): completa automáticamente la voz de los diálogos, incrusta los subtítulos y la marca **Generado por IA** (「AI生成」), y lo une todo en un MP4 que puedes previsualizar y descargar al final de la página (con subtítulos SRT).

Por defecto, la voz usa la lectura en línea de Edge (gratis, sin Key, interfaz no oficial); también puedes cambiarla por una interfaz `/audio/speech` compatible con OpenAI (por ejemplo, CosyVoice desplegado por ti). Cada personaje puede tener su propia voz; si no se asigna, se elige automáticamente según el género indicado en su descripción física.

Otras páginas:

- **Biblioteca de recursos** (「素材库」): haz clic en **Guardar en la biblioteca** (「存入素材库」) en los personajes, escenarios y objetos de un proyecto, y en **Importar desde la biblioteca** (「从素材库导入」) en otro proyecto; así un mismo personaje conserva su aspecto y su voz en una segunda serie.
- **Prompts** (「提示词」): las plantillas de storyboard con IA, división en episodios con IA e imágenes de referencia se pueden editar en la web; si algo se rompe, restauras los valores por defecto con un clic.
- **Registro de IA** (「AI 日志」): qué se envió al modelo en cada llamada, qué respondió y cuántos tokens usó; si el storyboard sale mal, empieza a revisar aquí.

## Imágenes reales sin GPU: plataformas en la nube

En **Ajustes del sistema** (「系统设置」), elige como proveedor de imágenes / videos **Alibaba Cloud Model Studio (阿里云百炼)** (Tongyi Wanxiang wan2.6) o **Volcano Engine Ark (火山方舟)** (Doubao Seedream / Seedance), introduce tu propia API Key y ya obtendrás imágenes reales; se cobra por imagen / por segundo, según los precios de cada plataforma.

- El primer fotograma de cada plano incluye automáticamente las imágenes de referencia de los personajes, objetos y escenarios que aparecen (hasta 4), para que los personajes se mantengan más coherentes de un plano a otro.
- El video solo genera la imagen (se desactiva la voz propia de la plataforma); la voz, los subtítulos y la marca de IA los gestiona esta herramienta.
- El nombre del modelo se puede cambiar en los ajustes: cuando la plataforma lance un modelo nuevo, basta con cambiar el nombre. **Guardar y probar API Key** (「保存并测试 API Key」) solo valida la Key, sin generar contenido ni gastar dinero.

Por defecto se usa el proveedor **Demostración** (「演示」): no llama a ningún modelo, sino que produce imágenes de relleno con texto y videos de relleno con un zoom lento, para que primero puedas probar todo el flujo.

## Conectar ComfyUI

La generación de imágenes y videos no está atada a ningún modelo concreto: usa los flujos de trabajo que tú mismo hayas ajustado en ComfyUI.

1. Monta el flujo de trabajo en ComfyUI y ejecútalo manualmente hasta que funcione; en el menú elige **Exportar (API)** (「导出 (API)」) para obtener el JSON.
2. Sustituye por marcadores los valores de entrada que cambian en cada ejecución, por ejemplo el prompt positivo `"text": "{{prompt}}"` o el Latent vacío `"width": "{{width}}"`.
3. En **Ajustes** (「设置」), apunta la dirección a ComfyUI (en tu equipo o en un servidor GPU alquilado), pega los tres flujos de trabajo y elige ComfyUI como proveedor de imágenes / videos.

| Flujo de trabajo | Uso | Marcadores obligatorios |
| --- | --- | --- |
| Texto a imagen | Imágenes de referencia de personajes/escenarios; primer fotograma del plano cuando no hay imagen de referencia | `{{prompt}}` |
| Imagen de referencia a imagen (opcional) | Primer fotograma del plano con las imágenes de referencia de los personajes, objetos y escenarios que aparecen (hasta 3) | `{{prompt}}` `{{ref_image_1}}` |
| Imagen a video | Primer fotograma + prompt de video → el video de ese plano | `{{image}}` `{{prompt}}` |

Otros marcadores disponibles: `{{negative}}` `{{seed}}` `{{width}}` `{{height}}` `{{ref_image_2}}` `{{ref_image_3}}` `{{frames}}` `{{fps}}` `{{duration}}` `{{filename_prefix}}`. Si el valor completo es un marcador, se sustituye conservando el tipo original (un número sigue siendo número); si está dentro de un texto, se concatena como texto. Las imágenes se suben automáticamente a ComfyUI y los resultados se descargan automáticamente.

Los prompts están en chino por defecto; los mejores resultados se obtienen con modelos que entiendan chino (como Qwen-Image, la serie Wan o Hunyuan).

## Modo de desarrollo

```bash
# Backend (puerto 8100)
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python -m uvicorn app.main:app --port 8100 --reload --reload-dir app

# Frontend (puerto 5174, la API se redirige automáticamente al 8100)
cd frontend
npm install
npm run dev
```

Documentación de la API: http://127.0.0.1:8100/docs

## Estructura de directorios

```
backend/
  app/
    main.py            Punto de entrada: rutas, archivos estáticos, arranque de la cola de tareas
    models.py          Modelos de datos: proyectos, episodios, planos, personajes, escenarios, objetos, biblioteca de recursos, registro de IA, tareas, ajustes
    prompts.py         Plantillas de prompts editables desde la web
    routers/           Endpoints HTTP
    services/          Lógica de negocio (storyboard, cola de tareas…)
    providers/         Proveedores de modelos (LLM, ComfyUI…)
  data/                Datos de ejecución (base de datos, imágenes y videos generados), fuera de git
frontend/              Web en React + Vite
```

## Datos y privacidad

Las API Keys, los guiones y los recursos generados se guardan solo en tu equipo, en `backend/data/`, y no se suben a ningún sitio (salvo las llamadas a las API de modelos que tú configures). Este directorio está excluido en `.gitignore`.

## Invítame a un té con leche

Si este proyecto te ha ahorrado tiempo, puedes invitarme a un té con leche 🧋 (también hay un acceso en la parte inferior de la barra lateral de la web).

<p align="center"><a href="https://www.paypal.com/ncp/payment/XZ9UJK3EX4JTY"><img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Donar con PayPal" height="40"></a></p>

Puedes pagar con tu saldo de PayPal o con tarjeta de crédito/débito.

### Contactar con el autor

- Correo: [bajiebujiese@126.com](mailto:bajiebujiese@126.com)
- Cuenta oficial de WeChat: **IT架构师修炼** (búscala en WeChat y síguela)

Comentarios, propuestas de colaboración o simplemente charlar: todo es bienvenido.

## Licencia

[MIT](LICENSE)
