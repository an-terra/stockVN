# Triển khai lên Render

Ứng dụng có **`Dockerfile`** một image (Express + SPA). Render chạy **Web Service** từ image đó; **không cần** AWS/ECR nếu bạn chỉ dùng Render (build trực tiếp từ Git).

**Chi phí & Free tier:** xem [Render pricing](https://render.com/pricing). Free web service có thể **ngủ** khi không traffic — **`node-cron` trong repo có thể không chạy đúng giờ** khi instance đã sleep.

---

## Cách A — Web Service + Docker (nhanh nhất)

1. Vào [dashboard.render.com](https://dashboard.render.com) → đăng ký / đăng nhập.
2. **New +** → **Web Service**.
3. **Connect GitHub** (Authorize Render), chọn repo **`stockVN`** (hoặc repo chứa code này).
4. Cấu hình:
   - **Name**: tùy bạn (vd. `stockvn`).
   - **Region**: chọn region gần (nếu có Singapore / US tùy gói).
   - **Branch**: **`main`** (hoặc branch bạn đang deploy).
   - **Runtime**: **Docker**.
   - **Dockerfile Path**: **`Dockerfile`** (thư mục gốc repo).
   - **Docker Context**: **`.`**
5. **Instance type**: chọn tier (free hoặc trả phí).
6. **Advanced** → **Health Check Path**: **`/api/watchlist`** (GET trả JSON).
7. Biến môi trường (**Environment**): xem **phần “Biến môi trường” bên dưới** — thường **không cần** thêm gì khi SPA + API cùng một Web Service Render.
8. **Create Web Service** → đợi build và **Live**. URL dạng `https://stockvn-xxxx.onrender.com`.

**Auto Deploy:** trong service → **Settings** → **Build & Deploy** → bật deploy khi push branch đã liên kết.

---

## CI/CD đâu có “Environment Variables” trên Render?

Đây là chỗ hay nhầm:

| Chỗ | Việc dùng cho CI/CD |
|-----|---------------------|
| **Environment Variables trên Render** (`Dashboard → service → Environment`) | Chỉ cho **ứng dụng đang chạy trong container**: `PORT`, `CORS_ORIGINS`, … **Không** dùng để GitHub Actions đăng nhập hay “bật” pipeline CI. |
| **GitHub Secrets** (`repo GitHub → Settings → Secrets → Actions`) | Dùng cho **GitHub Actions**: ví dụ `AWS_*` (workflow deploy ECR/AWS), **`RENDER_DEPLOY_HOOK_URL`** (workflow deploy Render sau CI). |
| **Kết nối Git repo trên Render** | Render tự clone + build → đó là **CD** không cần thêm Env trên Render cho “kéo Git”. Chỉ cần OAuth GitHub trong Render và bật **Auto Deploy**. |

### Hai kiểu CD với Render (chọn một rõ ràng)

1. **Chỉ Auto Deploy Render (đơn giản)**  
   Render nối GitHub → mỗi push `main` Render build lại Docker. Repo vẫn chạy **CI** `.github/workflows/ci.yml` để lint/build và **không** cần nhập Env đặc biệt trên Render cho CI/CD.  
   *Lưu ý:* có thể build trên Render chạy **song song** lúc push; CI trên Actions là cổng chất lượng (PR/build thử Docker), không ngăn Render build.

2. **CI xong mới Deploy (chuẩn “CI rồi mới CD”)**  
   - Trên Render: **Tắt Auto Deploy**.  
   - Tạo **Deploy Hook**: service → **Settings** → **Build & Deploy** → **Deploy Hooks** ([docs](https://render.com/docs/deploy-hooks)).  
   - Trên GitHub: thêm secret **`RENDER_DEPLOY_HOOK_URL`** = URL hook.  
   - Workflow cụ repository: `.github/workflows/deploy-render.yml` — chỉ POST hook **sau khi** workflow **`CI`** trên **`main`** kết luận **success**.  

Nếu vừa bật **Auto Deploy** vừa có **Deploy Hook** từ Actions, một push có thể khiến **deploy hai lần** — chỉ giữ một cách.

### Tóm lại

- Muốn “có CI/CD” với Render: **đủ repo + Render nối Git + CI trong Actions**. **Không bắt buộc** khai báo thêm Env trên Render cho mục đích đó.  
- **`ENV` trên Render** chỉ là khi app **runtime** của bạn cần (`CORS_ORIGINS`, không đụng `PORT` tay, … đã nói ở dưới).  
- **GitHub Secrets** mới là chỗ chứa “mật mã để Actions kích hoạt deploy” (hook, AWS keys, …).

---

## Biến môi trường (Environment Variables)

Trong Render: vào Web Service của bạn → tab **Environment** → **Environment Variables**. Có thể bật **Secret** để không hiển thị lại plaintext sau khi lưu ([Env docs](https://render.com/docs/configure-environment-variables)).

Code trong repo chỉ dùng đến các biến sau trên backend:

| Biến | Render gán giúp? | Bạn có cần nhập không? |
|------|-------------------|-------------------------|
| **`PORT`** | **Có** — Render tự inject số cổng | **Đừng** tự gõ `PORT` trừ khi bạn biết rõ; `server/index.mjs` đã `listen(process.env.PORT)`. Gõ sai có thể lệch với proxy của Render → lỗi health/API. |
| **`NODE_ENV`** | Image Docker đặt **`NODE_ENV=production`** | Thường **không cần** thêm trên Dashboard. |
| **`CORS_ORIGINS`** | Không | **Tuỳ chọn.** Chỉ khi trình duyệt gọi API từ **domain khác** hostname Render (SPA tĩnh ở CDN chẳng hạn). Giá trị: nhiều origin, **phân tách dấu phẩy**, ví dụ `https://cdn.example.com,https://staging.example.com`. Mặc định backend vẫn cho `localhost` dev; biến này là **danh sách bổ sung**. |
| **`DATABASE_URL`** | Có nếu bạn tạo Render PostgreSQL và nối qua Blueprint | **Cần** cho đăng nhập/watchlist theo user. Nếu thiếu, các API `/api/user/*` sẽ báo chưa cấu hình DB. |
| **`AUTH0_DOMAIN`** | Không | **Cần** cho backend verify JWT, ví dụ `xxx.us.auth0.com`. |
| **`AUTH0_AUDIENCE`** | Không | **Cần** và phải khớp API Identifier bạn tạo trong Auth0. |
| **`ADMIN_EMAILS`** | Không | Nhập `admin@an-terra.com` để email này có quyền admin sau khi đăng nhập. |

### Biến frontend / API khác hostname

Biến **`VITE_*`** chỉ có tác dụng **lúc build** Vite — trong **`Dockerfile`** đã đặt `VITE_API_BASE` rỗng để SPA gọi **`/api/...`** **cùng** domain Render.

Để bật đăng nhập Auth0 trên frontend, build Docker cần có:

- `VITE_AUTH0_DOMAIN`: cùng giá trị với `AUTH0_DOMAIN`.
- `VITE_AUTH0_CLIENT_ID`: Client ID của Auth0 Single Page Application.
- `VITE_AUTH0_AUDIENCE`: cùng giá trị với `AUTH0_AUDIENCE`.

Trong Auth0 Dashboard, tạo user `admin@an-terra.com` bằng mật khẩu bạn muốn dùng; không lưu mật khẩu vào code hoặc GitHub.

- Muốn trỏ API sang URL khác: phải **đổi build** (Docker `ARG` + `ENV` build-time) và deploy lại, **không** chỉ khai báo Env trên Render cho runtime SPA đã đóng gói sẵn.

### Blueprint (`render.yaml`)

Có thể khai báo thêm ví dụ (sau chỉnh tên/host cho đúng):

```yaml
services:
  - type: web
    name: stockvn
    runtime: docker
    dockerfilePath: ./Dockerfile
    dockerContext: .
    healthCheckPath: /api/watchlist
    envVars:
      # - key: CORS_ORIGINS
      #   value: https://your-frontend.example.com
      - key: NODE_ENV
        value: production
```

(`NODE_ENV` trùng Dockerfile — có thể bỏ; để minh họa syntax `envVars`.)

---

## Cách B — Blueprint (`render.yaml`)

1. Push file **`render.yaml`** (đã có trong repo) lên GitHub trên nhánh **`main`**.
2. Render Dashboard → **Blueprints** → **New Blueprint Instance**.
3. Chọn repo/chỉ định `render.yaml` → Render tạo Web Service theo blueprint.
4. Chỉnh **plan**/region trong UI nếu Render cho phép (một số trường chỉ chỉnh trên Dashboard).

---

## So với pipeline AWS trong repo

- **AWS:** GitHub Actions (`.github/workflows/deploy-aws.yml`) build → **ECR** → (tuỳ chọn) App Runner / ECS.
- **Render:** thường **Render build từ Git** mỗi lần push — **không cần ECR** trừ khi bạn tự cấu hình registry ngoài.

Bạn có thể **giữ workflow CI** (`.github/workflows/ci.yml`) — vẫn hữu ích cho lint/build PR; chỉ không bật **Deploy AWS** nếu không dùng ECR.

---

## Gặp lỗi build / không lên được

| Hiện tượng | Gợi ý |
|------------|--------|
| Build Docker fail | Xem tab **Logs** của deploy; đảm bảo Dockerfile build được local (`docker build -t stockvn .`). |
| Health check failed | Kiểm tra path **`/api/watchlist`** và app đã listen **`PORT`** (Render inject). **Đừng** tự set `PORT` trùng tay với sai giá trị so với platform. |
| Crash sau start | Xem Logs; có thể thiếu file / sai working directory — context Docker là thư mục gốc repo. |

---

## Tài liệu Render

- [Deploy Docker on Render](https://render.com/docs/docker)  
- [Blueprints (`render.yaml`)](https://render.com/docs/infrastructure-as-code)
