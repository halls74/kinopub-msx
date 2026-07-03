# Установка

## 0. Что понадобится
- Телевизор LG webOS (или любое устройство) с установленным **Media Station X**
  (найдите «Media Station X» в магазине приложений, либо см. https://msx.benzac.de/).
- Аккаунт KinoPUB с активной подпиской.
- **API-ключи KinoPUB** (`client_id` + `client_secret`) — запросите у
  `support@kino.pub`.
- Место для размещения статики по **HTTPS** (рекомендуется **GitHub Pages**) и
  аккаунт Cloudflare для прокси-Worker.

Установка состоит из двух частей: **(A)** статический фронтенд (папка `public/`)
и **(B)** прокси для API. Ниже — сначала размещение фронтенда на GitHub Pages,
затем развёртывание прокси.

---

## A. Размещение фронтенда на GitHub Pages

GitHub Pages бесплатно раздаёт статические файлы по HTTPS с валидным
сертификатом — это ровно то, что нужно MSX.

### A.1. Создайте репозиторий и запушьте код
Назовите репозиторий **`kinopub-msx`** — тогда пути в `start.json` совпадут без
лишних правок (подробнее в шаге A.4).

```bash
cd kinopub-msx            # папка с этим проектом
git init
git add .
git commit -m "KinoPUB MSX shell"
git branch -M main
git remote add origin https://github.com/<ВАШ_ЛОГИН>/kinopub-msx.git
git push -u origin main
```

> ⚠️ **Безопасность ключей.** Файл `config.js` скачивается браузером, поэтому
> любые ключи внутри него становятся **публичными** — независимо от того,
> приватный репозиторий или нет. Не вписывайте `CLIENT_SECRET` в `config.js` при
> публичном хостинге. Правильный путь — хранить ключи в **секретах Worker**
> (часть B), а в `config.js` оставить их пустыми. См. также `.gitignore`, где уже
> исключён локальный файл секретов `.dev.vars`.

### A.2. Включите GitHub Pages
На GitHub: **Settings → Pages → Build and deployment**:
- **Source:** «Deploy from a branch»
- **Branch:** `main`, папка **`/ (root)`**
- Нажмите **Save** и подождите ~1 минуту.

Сайт станет доступен по адресу:
`https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/`

### A.3. Проверьте, что файлы открываются
Откройте в обычном браузере:
- `https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/public/app.html`
  (должна быть видна бледная строка «KinoPUB shell …»)
- `https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/public/player.html`
  (чёрная страница)

Это подтверждает, что HTTPS-хостинг работает. Запомните URL `app.html` — он
понадобится в `start.json` и в параметре запуска MSX.

### A.4. Замените `YOURHOST` в `start.json`
Откройте `public/start.json` и замените во всех строках
`https://YOURHOST/kinopub-msx/public/app.html`
на ваш реальный адрес.

Если репозиторий назван `kinopub-msx`, путь `/kinopub-msx/public/app.html` уже
совпадает — достаточно заменить только `YOURHOST` на `<ВАШ_ЛОГИН>.github.io`,
например:
`https://ivanov.github.io/kinopub-msx/public/app.html`

Быстрая замена через терминал (подставьте свой логин):
```bash
sed -i 's/YOURHOST/ВАШ_ЛОГИН.github.io/g' public/start.json
git commit -am "start.json: подставлен хост" && git push
```

### A.5. Обновления сайта
Любой `git push` в ветку `main` автоматически пересобирает GitHub Pages за
несколько минут. Иногда помогает жёсткое обновление кеша (Pages кеширует).

> **Альтернативы хостингу:** Cloudflare Pages, Netlify, Vercel или собственный
> сервер с валидным TLS — работают так же. Главное, чтобы `public/` отдавался по
> HTTPS.

---

## B. Развёртывание прокси (CORS + клавиатура + субтитры)

Файл `worker/worker.js` — это Cloudflare Worker. Прокси нужен всегда: он
добавляет CORS к ответам API, обслуживает `/msx/keyboard` (поиск) и `/sub`
(субтитры).

### B.1. Разверните Worker
Через Wrangler:
```bash
cd worker
npx wrangler init --from-dash    # либо создайте новый проект воркера
# замените сгенерированный src содержимым worker.js, затем:
npx wrangler deploy
```
Либо вставьте `worker.js` в **Cloudflare Dashboard → Workers → Create → Edit code**.

Запомните URL воркера, например `https://kp-proxy.<вы>.workers.dev`.

### B.2. Положите ключи в секреты (рекомендуется)
Так `client_id`/`client_secret` не попадут в публичный репозиторий:
```bash
npx wrangler secret put KP_CLIENT_ID
npx wrangler secret put KP_CLIENT_SECRET
```
Воркер сам подставит их во все запросы `/oauth2/*`. В этом случае в `config.js`
оставьте `CLIENT_ID`/`CLIENT_SECRET` пустыми.

> **Другой прокси?** Подойдёт любой (Deno Deploy, небольшой Node/Express,
> nginx с `proxy_pass` и `add_header Access-Control-Allow-Origin *`). Он должен
> лишь: (а) проксировать `/oauth2/*` и `/v1/*` на `api.service-kp.com`,
> (б) добавлять разрешающий CORS, (в) обслуживать `/msx/keyboard` и `/sub`, как
> в `worker.js`.

---

## C. Настройка `public/js/config.js`
```js
API_BASE: "https://kp-proxy.<вы>.workers.dev",   // URL вашего воркера, без слэша в конце
CLIENT_ID: "",                                    // пусто, если ключи в секретах воркера
CLIENT_SECRET: "",
```
По желанию поправьте `DEFAULT_SETTINGS` (тип потока, качество, 4K, язык озвучки),
`SECTIONS` и палитру `COLOR`.

После правок закоммитьте и запушьте (GitHub Pages пересоберётся):
```bash
git commit -am "config: указан API_BASE" && git push
```

---

## D. Параметр запуска MSX
На ТВ: **Media Station X → Settings → Start Parameter**, введите **один** из
вариантов:

- Статичное меню (проще всего):
  ```
  menu:https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/public/start.json
  ```
- Динамическое меню, знающее о входе (разделы строятся из API):
  ```
  menu:request:interaction:menu@https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/public/app.html
  ```

Сохраните и перезапустите MSX (или используйте «Reload»).

> Совет: можно мгновенно проверить в браузере ПК через демо-страницу MSX:
> `https://msx.benzac.de/?start=menu:https://<ВАШ_ЛОГИН>.github.io/kinopub-msx/public/start.json`

---

## E. Активация устройства
При первом запуске появится экран активации с **кодом**. На телефоне или
компьютере откройте **kino.pub/device**, войдите и введите код. Приложение на ТВ
опрашивает статус автоматически и после активации открывает главную и показывает
остаток дней подписки в правом верхнем углу.

---

## F. Рекомендуемые настройки MSX
- **Rounded Style: On** — даёт скруглённые постеры в стиле tvOS.
- **Animations: On** — плавные переходы фокуса.
- Убедитесь, что платформа разрешает плееру открывать HLS (на webOS — по
  умолчанию да).

---

## Диагностика
- **Пустая главная / «Ошибка»**: проверьте `API_BASE` и доступность воркера;
  откройте `https://API_BASE/v1/types?access_token=` в браузере — должен прийти
  JSON или ошибка авторизации (а не сетевая/CORS-ошибка).
- **Код входа не подтверждается**: код истёк — нажмите «Новый код» или проверьте
  `CLIENT_ID`/`CLIENT_SECRET` (в `config.js` или в секретах воркера).
- **Нет субтитров**: должен быть доступен маршрут `/sub` того же воркера.
- **Видео не запускается**: смените **Тип потока** (hls2/http) или понизьте
  **Качество** в Настройках; некоторые зеркала/качества ограничены регионом.
- **GitHub Pages показывает старую версию**: подождите пару минут после `push` и
  обновите страницу с очисткой кеша.
