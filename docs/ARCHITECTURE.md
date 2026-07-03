# Архитектура

## Два плагина, один origin

```
                          ┌─────────────────────────────┐
                          │        Media Station X       │
                          │  (нативный UI, фокус, плеер) │
                          └───────────┬───────────┬──────┘
             content:request:…        │           │   video:plugin:…
                                       ▼           ▼
        ┌───────────────────────────────┐   ┌───────────────────────────┐
        │ Плагин взаимодействия (app.html)│  │  Видеоплагин (player.html) │
        │  app.js  → маршрутизатор        │  │  player.js → HTML5 <video> │
        │  ui.js   → сборка JSON для MSX  │  │  докрутка + marktime       │
        │  api.js  → клиент KinoPUB       │  │  озвучка/субтитры/качество │
        └───────────────┬───────────────┘   └──────────────┬────────────┘
                         │  XHR (токен в query)             │ XHR + media-элемент
                         ▼                                  ▼
                 ┌──────────────────────  CORS-прокси (worker.js)  ─────────────────────┐
                 │  /oauth2/*, /v1/*  → api.service-kp.com   ·  /sub  ·  /msx/keyboard   │
                 └──────────────────────────────────────────────────────────────────────┘
```

Оба плагина отдаются с **одного origin**, поэтому `localStorage`
(токены + настройки через `TVXStorage`) общий: плагин взаимодействия выполняет
вход, а плеер переиспользует токен для `marktime`.

## Поток запросов

1. MSX загружает `start.json` (**Menu Root**). Действия пунктов меню —
   `content:request:interaction:{dataId}@{app.html}`.
2. При первом таком действии MSX загружает `app.html` в скрытый iframe и
   вызывает `handleRequest(dataId, data, callback)` (`app.js`).
3. Маршрутизатор:
   - проверяет авторизацию (если не выполнен вход — возвращает экран активации),
   - обращается к API KinoPUB через `api.js`,
   - собирает JSON для MSX через `ui.js`,
   - возвращает его через `callback(content)`.
4. Дальнейшая навигация — это новые действия `content:request:interaction:…`;
   кнопки с побочным эффектом (закладка, список, настройки) выполняют вызов API
   и возвращают обновлённый экран (плюс тост через
   `TVXInteractionPlugin.info`).
5. Кнопки воспроизведения отправляют `video:plugin:{player.html}?…`; MSX
   загружает видеоплагин, тот получает медиа, перематывает на `pos`, играет и
   вызывает `marktime`.

## Таблица маршрутов (`app.js` → `route()`)

| dataId (хвост действия) | Что значит | Вызовы KinoPUB |
|---|---|---|
| `home` / `init` | Полки главной | `watching/serials`, `watching/movies`, `items/fresh`, `items/popular` |
| `menu` / `mainmenu` | Динамическое меню (Menu Root) | `user` |
| `section:{id}[:page]` | Сетка категории | `items?type=…[&genre=…]` |
| `list:{fresh\|hot\|popular}:{type}[:page]` | Список-ярлык | `items/{kind}` |
| `continue` | Продолжить просмотр | `watching/serials`, `watching/movies` |
| `item:{id}` | Страница тайтла (hero + серии) | `items/{id}`, `watching?id=`, `bookmarks/get-item-folders` |
| `similar:{id}` | Сетка похожего | `items/similar` |
| `trailer:{id}` | Воспроизвести трейлер | `items/trailer` |
| `search` | Запуск поиска (нативная клавиатура) | — |
| `searchq` (+`data.q`) | Результаты поиска | `items/search?q=` |
| `searchmore:{page}` | Ещё результаты | `items/search?q=&page=` |
| `searchperson:{cast\|director}` (+`data.q`) | Поиск по персоне | `items?actor=` / `?director=` |
| `bookmarks` | Папки избранного | `bookmarks` |
| `bmfolder:{id}[:page]` | Содержимое папки | `bookmarks/{id}` |
| `bmtoggle:{id}` | Переключить избранное → обновить страницу | `bookmarks/toggle-item` |
| `watchlist:{id}` | Переключить «буду смотреть» | `watching/togglewatchlist` |
| `watched:{id}` | Переключить «просмотрено» | `watching/toggle` |
| `history[:page]` | Сетка истории | `history` |
| `settings` | Экран настроек | `references/*` (кешируется) |
| `setopt:{key}` | Выбор значения настройки | `references/*` |
| `set:{key}:{value}` | Сохранить настройку → обновить | — (локально) |
| `authcheck` / `authnew` / `logout` | Управление авторизацией | `oauth2/*` |

## «Рукопожатие» плеера (`player.js`)

- Запускается с `?mid&id&video&season&pos&type`.
- `GET /v1/items/media-links?mid=` → `files[]` (по качествам `urls.hls4/hls2/hls/http`) + `subtitles[]`.
- `chooseFile()` выбирает качество из настроек (учитывает тумблер **4K**); `streamUrl()` выбирает тип потока.
- На `loadedmetadata`: перемотка на `pos` (докрутка), установка длительности, применение предпочитаемых дорожек **озвучки** и **субтитров**.
- `marktime` отправляется каждые ~15–20 с и при паузе/остановке/окончании/сне — чтобы место остановки было актуальным во всём приложении.

## Авторизация (OAuth2 Device Flow)

```
requestDeviceCode → { code, user_code, verification_uri, interval }
   показать user_code + verification_uri (kino.pub/device)
   опрашивать pollDeviceToken(code) каждые `interval` секунд:
        400 authorization_pending → продолжать ждать
        200 { access_token, refresh_token, expires_in } → сохранить + открыть главную
refresh(refresh_token) вызывается автоматически, когда access-токен устарел или пришёл 401.
```
