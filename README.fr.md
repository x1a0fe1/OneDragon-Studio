# OneDragon Studio · AI漫剧一条龙

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Français** | [Español](README.es.md) | [العربية](README.ar.md)

> L’interface web est disponible en anglais et en chinois simplifié (bouton « 中 / EN » en bas de la barre latérale).

Une chaîne de production de BD animées par IA (AI comic drama), du script à la vidéo finale, avec interface web et déploiement local.

```
Script → Découpage IA en plans → Ressources personnages/décors → Première image des plans → Image vers vidéo → Voix off et sous-titres → Montage final
```

- **Processus par étapes** : le résultat de chaque étape est enregistré et modifiable dans la page web ; si vous modifiez une étape, seule la suite est relancée à partir de celle-ci, sans tout recommencer.
- **File de tâches en arrière-plan** : les opérations longues sont mises en file d’attente, relancées automatiquement en cas d’échec, et reprennent même si vous fermez la page ou redémarrez le service. Ni Redis ni Docker ne sont nécessaires.
- **Modèles interchangeables** : pour le texte, des préréglages sont intégrés pour DeepSeek, OpenAI, Google Gemini, Anthropic Claude, Azure OpenAI, OpenRouter, Alibaba Cloud Model Studio, Volcano Engine Ark, Ollama, ainsi que toute API compatible OpenAI, avec un proxy configurable pour les API étrangères ; pour la génération d’images et de vidéos, vous pouvez choisir une plateforme cloud (Alibaba Cloud Model Studio (阿里云百炼), Volcano Engine Ark (火山方舟), sans GPU) ou ComfyUI (en local ou sur un serveur GPU distant).
- **Vertical d’abord** : format 9:16 par défaut, pensé pour les mini-séries et BD animées de Kuaishou / Douyin.

## Avancement du développement

| Phase | Contenu | Statut |
| --- | --- | --- |
| 1 | Gestion des projets / épisodes, import de script, découpage IA en plans (modifiable), file de tâches, paramètres | ✅ |
| 2 | Images de référence personnages/décors, première image des plans, image vers vidéo (ComfyUI + fournisseur de démonstration), envoi de vos propres images | ✅ |
| 3 | Doublage des répliques, sous-titres, montage final (mention IA), téléchargement MP4 / SRT | ✅ |
| 4 | Import d’histoires ou de romans avec découpage en chapitres, accessoires, médiathèque partagée entre projets, configuration des prompts, journal IA | ✅ |
| 5 | Génération d’images et de vidéos dans le cloud (Alibaba Cloud Model Studio (阿里云百炼) / Volcano Engine Ark (火山方舟)), épisode en un clic, interface à barre latérale et page d’accueil | ✅ |

## Démarrage rapide (Windows)

Python 3.10+ et Node.js 18+ sont requis.

Double-cliquez sur `start.bat`. Au premier lancement, les dépendances sont installées et le frontend est compilé automatiquement, puis http://127.0.0.1:8100 s’ouvre.

Ensuite :

1. Ouvrez **Paramètres** (「设置」), renseignez l’adresse du grand modèle de langage, le nom du modèle et votre propre clé API, puis cliquez sur **Enregistrer et tester la connexion** (「保存并测试连接」).
2. Revenez à **Projets** (「项目」) et créez une nouvelle série. Cliquez sur **Importer une histoire ou un roman** (「导入故事或小说」) (TXT / EPUB / coller le texte) pour la découper en plusieurs épisodes selon les titres de chapitre, selon l’intrigue (par IA) ou selon le nombre de caractères ; dans l’aperçu, vous pouvez modifier les titres, fusionner et cocher les épisodes. Vous pouvez aussi créer un épisode et y coller directement un script.
3. Cliquez sur **Découpage IA en plans** (「AI 拆分镜」) : en quelques dizaines de secondes, vous obtenez un tableau de plans (décor, valeur de plan, mouvement de caméra, image, répliques, prompt de première image, prompt vidéo), entièrement modifiable.
4. De retour sur la page du projet, **Générer en un clic les images de référence manquantes** (「一键生成缺少的参考图」) crée les images de référence des personnages, décors et accessoires (vous pouvez aussi envoyer les vôtres).
5. Dans le tableau de plans, lancez **Générer toutes les premières images** (「批量生成首帧」) → **Générer toutes les vidéos** (「批量生成视频」), ou régénérez les plans un par un.
6. Ou cliquez directement sur **Épisode en un clic** (「一键成片」) dans la page de l’épisode : tout s’enchaîne automatiquement (découpage en plans → images de référence → premières images → vidéos → doublage → montage), sans refaire ce qui existe déjà ; si une étape échoue, le processus s’arrête en indiquant la raison, et il suffit de recliquer une fois le problème corrigé pour reprendre.
7. Cliquez sur **Montage final** (「合成成片」) : les doublages manquants sont complétés automatiquement, les sous-titres et la mention **Généré par IA** (「AI生成」) sont incrustés, et le tout est assemblé en un seul MP4, à prévisualiser et télécharger en bas de la page (avec sous-titres SRT).

Le doublage utilise par défaut la lecture en ligne d’Edge TTS (gratuite, sans clé, interface non officielle) ; vous pouvez aussi utiliser une interface `/audio/speech` compatible OpenAI (par exemple CosyVoice déployé par vos soins). Chaque personnage peut avoir sa propre voix ; à défaut, la voix est choisie automatiquement selon le genre indiqué dans la description physique.

Quelques autres pages :

- **Médiathèque** (「素材库」) : dans un projet, cliquez sur **Ajouter à la médiathèque** (「存入素材库」) pour un personnage, un décor ou un accessoire, puis sur **Importer depuis la médiathèque** (「从素材库导入」) dans un autre projet : le même personnage garde son apparence et sa voix dans une deuxième série.
- **Prompts** (「提示词」) : les modèles de prompts du découpage IA en plans, du découpage IA en épisodes et des images de référence sont modifiables dans la page web, avec restauration des valeurs par défaut en un clic en cas d’erreur.
- **Journal IA** (「AI 日志」) : ce qui a été envoyé au grand modèle à chaque appel, ce qu’il a répondu et le nombre de tokens utilisés. Si le découpage en plans ne vous convient pas, commencez par regarder ici.

## De vraies images sans GPU : les plateformes cloud

Dans **Paramètres système** (「系统设置」), choisissez **Alibaba Cloud Model Studio (阿里云百炼)** (Tongyi Wanxiang wan2.6) ou **Volcano Engine Ark (火山方舟)** (Doubao Seedream / Seedance) comme fournisseur de génération d’images / de vidéos, renseignez votre propre clé API et vous obtiendrez de vraies images. La facturation se fait à l’image / à la seconde, selon les tarifs de la plateforme.

- La première image de chaque plan inclut automatiquement les images de référence des personnages, accessoires et décors présents (4 au maximum), pour des personnages plus cohérents d’un plan à l’autre.
- Les vidéos ne contiennent que l’image (le doublage intégré de la plateforme est désactivé) ; le doublage, les sous-titres et la mention IA sont gérés par cet outil.
- Les noms de modèles se modifient dans les paramètres : quand la plateforme publie un nouveau modèle, il suffit de changer le nom. **Enregistrer et tester la clé API** (「保存并测试 API Key」) vérifie uniquement la clé, sans rien générer ni rien facturer.

Le fournisseur par défaut est **Démo** (「演示」) : il n’appelle aucun modèle et produit des images de substitution avec du texte et des vidéos de substitution avec un lent zoom avant, pour valider d’abord l’ensemble du processus.

## Connecter ComfyUI

La génération d’images et de vidéos n’est liée à aucun modèle précis : elle utilise les workflows que vous avez vous-même mis au point dans ComfyUI.

1. Construisez votre workflow dans ComfyUI et exécutez-le manuellement avec succès, puis choisissez **Exporter (API)** (「导出 (API)」) dans le menu pour obtenir le JSON.
2. Remplacez les valeurs d’entrée qui changent à chaque exécution par des placeholders, par exemple `"text": "{{prompt}}"` pour le prompt positif et `"width": "{{width}}"` pour le Latent vide.
3. Dans **Paramètres** (「设置」), indiquez l’adresse de ComfyUI (en local ou sur un serveur GPU loué), collez les trois workflows et choisissez ComfyUI comme fournisseur de génération d’images / de vidéos.

| Workflow | Usage | Placeholders obligatoires |
| --- | --- | --- |
| Texte vers image | Images de référence personnages/décors ; première image d’un plan sans image de référence | `{{prompt}}` |
| Image de référence vers image (facultatif) | Première image d’un plan incluant les images de référence des personnages, accessoires et décors présents (3 au maximum) | `{{prompt}}` `{{ref_image_1}}` |
| Image vers vidéo | Première image + prompt vidéo → la vidéo de ce plan | `{{image}}` `{{prompt}}` |

Autres placeholders disponibles : `{{negative}}` `{{seed}}` `{{width}}` `{{height}}` `{{ref_image_2}}` `{{ref_image_3}}` `{{frames}}` `{{fps}}` `{{duration}}` `{{filename_prefix}}`. Lorsque la valeur entière est un placeholder, elle est remplacée en conservant son type d’origine (un nombre reste un nombre) ; lorsqu’il est inséré dans du texte, il est concaténé comme du texte. Les images sont envoyées automatiquement à ComfyUI et les résultats téléchargés automatiquement.

Les prompts sont en chinois par défaut : choisissez de préférence un modèle qui comprend le chinois (comme Qwen-Image, la série Wan ou Hunyuan) pour de meilleurs résultats.

## Mode développement

```bash
# Backend (port 8100)
cd backend
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\python -m uvicorn app.main:app --port 8100 --reload --reload-dir app

# Frontend (port 5174, API automatiquement redirigée vers 8100)
cd frontend
npm install
npm run dev
```

Documentation de l’API : http://127.0.0.1:8100/docs

## Structure des répertoires

```
backend/
  app/
    main.py            Point d'entrée : routes, fichiers statiques, démarrage de la file de tâches
    models.py          Modèles de données : projets, épisodes, plans, personnages, décors, accessoires, médiathèque, journal IA, tâches, paramètres
    prompts.py         Modèles de prompts modifiables depuis la page web
    routers/           API HTTP
    services/          Logique métier (découpage en plans, file de tâches…)
    providers/         Fournisseurs de modèles (LLM, ComfyUI…)
  data/                Données d'exécution (base de données, images et vidéos générées), hors git
frontend/              Interface web React + Vite
```

## Données et confidentialité

Les clés API, les scripts et les contenus générés sont stockés uniquement sur votre machine, dans `backend/data/`, et ne sont envoyés nulle part (hormis les appels aux interfaces de modèles que vous avez configurées). Ce répertoire est exclu dans `.gitignore`.

## Offrez-moi un thé au lait

Si ce projet vous a fait gagner du temps, n’hésitez pas à m’offrir un thé au lait 🧋 (un accès est aussi disponible en bas de la barre latérale de l’interface web).

<p align="center"><a href="https://www.paypal.com/ncp/payment/XZ9UJK3EX4JTY"><img src="https://img.shields.io/badge/PayPal-Donate-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="Faire un don avec PayPal" height="40"></a></p>

Paiement par solde PayPal ou carte bancaire.

### Contacter l’auteur

- E-mail : [bajiebujiese@126.com](mailto:bajiebujiese@126.com)
- Compte officiel WeChat : **IT架构师修炼** (à rechercher dans WeChat pour s’abonner)

Questions, retours, collaborations ou simples échanges : vous êtes les bienvenus.

## Licence

[MIT](LICENSE)
