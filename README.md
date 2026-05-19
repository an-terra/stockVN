# VN Stock Web — biểu đồ EOD & rule minh họa

Ứng dụng web xem **nến, EMA20/50, volume, RSI**, **đánh dấu MUA/BÁN**, **mục tiêu/stop gợi ý (ATR)** và **quét watchlist** theo lịch. Dữ liệu qua **Yahoo chart API** (mã `XXX.VN`).

**Lưu ý:** chỉ phục vụ học tập / minh họa; không phải tư vấn đầu tư.

## Cấu trúc

- `server/` — API Express: `/api/watchlist`, `/api/chart`, `/api/symbols/validate`, `/api/schedule`, `/api/scan/latest`, `POST /api/scan/run`; cron **9:30, 12:00, 14:00** giờ **Asia/Ho_Chi_Minh** (T2–T6); kết quả quét: `server/data/latest-scan.json`
- `frontend/` — React + Vite + Lightweight Charts

## Chạy

**Cửa sổ 1 — backend**

```bash
cd server
npm install
npm start
```

Mặc định: `http://127.0.0.1:8000`

**Cửa sổ 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

Mở `http://localhost:5173`. Vite proxy chuyển `/api` → cổng 8000.

**Cron:** cần giữ `npm start` **chạy liên tục** trong ngày giao dịch. Có thể bấm **Chạy quét ngay** trên UI để tạo file quét không chờ lịch.

## Deploy + CI/CD

- **CI**: `.github/workflows/ci.yml` — **push / PR** `main`: lint + build frontend, **Docker build** thử.
- **`Dockerfile`**: một image API + SPA (`frontend/dist`).
- **Render**: [`docs/HUONG_DAN_RENDER.md`](docs/HUONG_DAN_RENDER.md) — Web Service (**Docker**) / **`render.yaml`**; CD qua Auto Deploy Render hoặc **Deploy Hook** (secret `RENDER_DEPLOY_HOOK_URL`) + `.github/workflows/deploy-render.yml`.
- **AWS** (tuỳ chọn): `.github/workflows/deploy-aws.yml` + [`docs/HUONG_DAN_TRIEN_KHAI_CHI_TIET.md`](docs/HUONG_DAN_TRIEN_KHAI_CHI_TIET.md), [`docs/DEPLOY_AWS.md`](docs/DEPLOY_AWS.md).

## Rule (EOD)

- **MUA (edge):** RSI cắt lên sau vùng quá bán (≤35 → >35); **hoặc** breakout đỉnh high 20 phiên trước + volume > TB20; **hoặc** golden cross (EMA20 cắt lên EMA50).
- **BÁN:** giá cắt xuống EMA20 từ trên.

Danh sách ~30 mã: `server/index.mjs` → `DEFAULT_WATCHLIST`.

## Mục tiêu & khuyến nghị (minh họa)

- **TP1 / TP2:** ≈ đóng cửa + 1,5× và 2,5× **ATR(14)**.
- **Stop gợi ý:** thấp hơn trong hai mức: giá − 1,25×ATR và dưới **EMA20** (mốc kỹ thuật).
- **Kháng cự gợi ý:** max high **20 phiên** gần nhất.
- Nhãn **MUA / BÁN / CHỜ** + bullet **khi nào xem xét mua/bán** trên UI.
- **Điểm hội tụ (0–100):** kết hợp xu hướng EMA, RSI, volume vs TB20, ATR%; chỉ đọc **bối cảnh**, không thay phân tích cơ bản hay cam kết giá.
Dữ liệu là **OHLC/ngày** Yahoo; trong phiên, “đóng cửa” có thể là **giá gần nhất**, có độ trễ so với sàn.

## Gặp lỗi Yahoo / không có dữ liệu

- **CEO:** Yahoo **không** có `CEO.VN` → watchlist dùng **SCR** thay CEO.
- Dùng **`GET /api/symbols/validate`** hoặc nút **Kiểm tra Yahoo (30 mã)** để thấy mã nào `ok: false`.
- Một số mã ký hiệu khác hoặc bị chặn mạng — đổi ticker hoặc tích hợp nguồn khác (broker/API trả phí).
