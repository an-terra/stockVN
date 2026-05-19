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
7. Biến môi trường (tuỳ chọn):
   - **`CORS_ORIGINS`**: chỉ khi sau này bạn host frontend ở domain khác domain API; ví dụ `https://app.example.com,https://other.com`
8. **Create Web Service** → đợi build và **Live**. URL dạng `https://stockvn-xxxx.onrender.com`.

**Auto Deploy:** trong service → **Settings** → **Build & Deploy** → bật deploy khi push branch đã liên kết.

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
| Health check failed | Kiểm tra path **`/api/watchlist`** và app đã listen **`PORT`** (Render inject — code đã dùng `process.env.PORT`). |
| Crash sau start | Xem Logs; có thể thiếu file / sai working directory — context Docker là thư mục gốc repo. |

---

## Tài liệu Render

- [Deploy Docker on Render](https://render.com/docs/docker)  
- [Blueprints (`render.yaml`)](https://render.com/docs/infrastructure-as-code)
