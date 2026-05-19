# Thiết kế đăng nhập/đăng ký và lưu danh mục theo dõi

## Mục tiêu

Thêm đăng nhập/đăng ký cho ứng dụng VN Stock, hỗ trợ social login qua Auth0 gồm Google/Gmail, LINE và Facebook. Sau khi đăng nhập, mỗi người dùng có danh sách cổ phiếu theo dõi và thống kê tín hiệu/lãi lỗ riêng. Dữ liệu được lưu bền vững trong Render PostgreSQL thay vì `localStorage` hoặc file trong container.

## Quyết định đã chốt

- **Auth provider:** Auth0.
- **Database:** Render PostgreSQL.
- **Cập nhật lãi/lỗ:** khi người dùng mở trang / xem thống kê, không dùng cron hằng ngày ở giai đoạn này.
- **Deploy target:** Render Web Service Docker hiện có.

## Kiến trúc

Frontend React tích hợp Auth0 SPA SDK để đăng nhập, đăng ký, đăng xuất và lấy access token. Backend Express verify JWT Auth0 cho các API cần tài khoản. Backend dùng `sub` từ token Auth0 làm khóa định danh ổn định cho user.

Luồng dữ liệu:

1. Người dùng bấm đăng nhập/đăng ký.
2. Auth0 xử lý Google, LINE, Facebook hoặc màn hình signup/login.
3. Frontend nhận token và gọi API backend với `Authorization: Bearer <token>`.
4. Backend verify token, upsert user vào PostgreSQL.
5. Watchlist và signal tracking được đọc/ghi theo `user_id`.
6. Khi mở thống kê, backend refresh giá hiện tại và ghi snapshot lãi/lỗ ngày hiện tại nếu cần.

## Auth0

Frontend cần các biến build-time:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`

Backend cần các biến runtime:

- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `DATABASE_URL`
- `ADMIN_EMAILS` (tuỳ chọn): danh sách email admin, phân tách dấu phẩy. Ví dụ `admin@an-terra.com`.

Auth0 application:

- Type: Single Page Application cho frontend.
- Allowed Callback URLs: domain Render, localhost dev.
- Allowed Logout URLs: domain Render, localhost dev.
- Allowed Web Origins: domain Render, localhost dev.
- API/Audience: dùng cho backend verify JWT.

Social connections:

- Google OAuth2 cho Gmail.
- Facebook Login.
- LINE Login qua custom social/OIDC connection trong Auth0; cần cấu hình LINE Developers riêng, gồm callback URL do Auth0 cung cấp.

Tài khoản admin ban đầu:

- Tạo trong Auth0 Dashboard bằng connection `Username-Password-Authentication`.
- Email admin: `admin@an-terra.com`.
- Mật khẩu không ghi vào source code, GitHub, docs hay Render env. Nếu mật khẩu từng được gửi qua chat/log, tạo xong nên đổi lại trong Auth0.

## Quyền admin

Backend xác định quyền admin bằng email trong Auth0 token so với biến môi trường `ADMIN_EMAILS`.

- Nếu email user nằm trong `ADMIN_EMAILS`, `/api/me` trả `role: "admin"`.
- Nếu không, trả `role: "user"`.
- Quyền admin giai đoạn này dùng để hiển thị badge và làm nền cho các API admin sau này; chưa thêm màn hình quản trị riêng.
- Không lưu mật khẩu admin trong DB ứng dụng.

## Database

Bảng đề xuất:

```sql
users (
  id uuid primary key default gen_random_uuid(),
  auth0_sub text unique not null,
  email text,
  name text,
  picture text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null,
  source text,
  source_payload jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
)

signal_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  symbol text not null,
  action text not null check (action in ('MUA', 'BÁN', 'CHỜ')),
  entry_date date not null,
  entry_price numeric not null,
  signal_as_of date,
  source text,
  signal_summary text,
  signal_score numeric,
  signal_payload jsonb,
  note text,
  created_at timestamptz not null default now()
)

signal_track_snapshots (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references signal_tracks(id) on delete cascade,
  snapshot_date date not null,
  mark_price numeric,
  mark_date date,
  pnl_percent numeric,
  signal_correct boolean,
  data_provider text,
  created_at timestamptz not null default now(),
  unique (track_id, snapshot_date)
)
```

Migration:

- Khi app khởi động trên Render, nếu có `DATABASE_URL` thì backend chạy migration idempotent trước khi listen.
- Nếu migration lỗi, server không nên tiếp tục chạy với DB nửa cấu hình; log lỗi rõ để Render deploy fail sớm.

## Backend API

Public API hiện có vẫn giữ cho xem chart/picks cơ bản.

API yêu cầu đăng nhập:

- `GET /api/me`: trả user hiện tại, upsert user nếu lần đầu.
- `GET /api/user/watchlist`: danh sách mã theo dõi của user.
- `POST /api/user/watchlist`: thêm mã theo dõi, có thể kèm `source` và `sourcePayload` để lưu bối cảnh user chọn từ chart/picks/snapshot.
- `DELETE /api/user/watchlist/:symbol`: xóa mã theo dõi.
- `GET /api/user/track`: danh sách tín hiệu theo user kèm snapshot lãi/lỗ mới nhất.
- `POST /api/user/track`: thêm tín hiệu MUA/BÁN/CHỜ theo user; lưu cả snapshot tín hiệu tại thời điểm chọn như `signalSummary`, `signalScore`, `signalAsOf`, `signalPayload`, `source`.
- `DELETE /api/user/track/:id`: xóa tín hiệu của user.
- `POST /api/user/track/refresh`: refresh giá và cập nhật snapshot lãi/lỗ cho ngày hiện tại.

Phân quyền:

- Mọi route `/api/user/*` bắt buộc JWT hợp lệ.
- Backend chỉ thao tác dữ liệu có `user_id` khớp user trong token.
- Không tin user id gửi từ client.
- Role admin lấy từ `ADMIN_EMAILS`, không lấy từ request body.

Response `/api/user/track` và `/api/user/track/refresh` phải cùng shape với `TrackListResponse`: `{ generatedAt, summary, items }`. Các số từ PostgreSQL (`numeric`) được convert về `number | null` trước khi trả frontend.

Khi user bấm theo dõi một mã do app khuyến nghị (ví dụ app gợi ý CTG), backend phải lưu cả:

- mã cổ phiếu (`symbol`)
- hành động tại thời điểm đó (`action`: MUA/BÁN/CHỜ)
- giá vào hoặc giá hiện tại (`entryPrice`)
- ngày/timestamp tín hiệu (`signalAsOf`)
- nguồn người dùng bấm theo dõi (`source`: `chart`, `picks`, `snapshot`, `manual`)
- tóm tắt khuyến nghị (`signalSummary`)
- điểm hội tụ (`signalScore`)
- payload JSON tối giản của tín hiệu (`signalPayload`) gồm TP/SL, lý do, cảnh báo, provider nếu có

Nhờ vậy màn hình tổng kết tín hiệu không chỉ biết user theo dõi “CTG”, mà còn biết CTG được theo dõi vì app từng khuyến nghị gì ở thời điểm đó.

## Cập nhật lãi/lỗ khi mở trang

Khi user mở trang thống kê:

1. Frontend gọi `GET /api/user/track`.
2. Backend đọc các track của user.
3. Nếu snapshot ngày hôm nay chưa có hoặc dữ liệu cũ, backend fetch giá hiện tại/gần nhất qua provider hiện có.
4. Backend tính:
   - `mark_price`
   - `pnl_percent`
   - `signal_correct`
   - `data_provider`
5. Backend ghi/upsert snapshot cho ngày hiện tại và trả kết quả cho UI.

Điều này tiết kiệm chi phí vì không cần Render Cron, nhưng chỉ cập nhật khi user mở trang.

## Frontend UI

Thêm khu vực auth trên header:

- Khi chưa đăng nhập:
  - Nút `Đăng nhập`
  - Nút `Đăng ký`
- Khi đã đăng nhập:
  - Avatar/tên/email
  - Badge `Admin` nếu `/api/me` trả `role: "admin"`
  - Nút `Đăng xuất`

Watchlist:

- Nếu chưa đăng nhập: giữ xem demo/local, nhưng khi lưu theo dõi thì yêu cầu đăng nhập.
- Nếu đã đăng nhập: đọc/ghi watchlist từ API user.
- Khi bấm theo dõi từ chart/picks/snapshot, frontend gửi kèm context tín hiệu hiện tại để backend lưu vào watchlist và/hoặc signal track.

Thống kê tín hiệu:

- Dữ liệu lấy từ `/api/user/track`.
- Có trạng thái đang cập nhật lãi/lỗ.
- Có nút refresh thủ công gọi `/api/user/track/refresh`.
- Hiển thị thông tin gốc lúc user chọn theo dõi: action ban đầu, summary, điểm hội tụ, ngày tín hiệu, entry price, TP/SL nếu có.

## Error handling

- Auth0 chưa cấu hình: UI hiển thị thông báo cấu hình thiếu, không crash.
- Token hết hạn: frontend tự lấy token mới qua Auth0 SDK; nếu thất bại thì yêu cầu đăng nhập lại.
- PostgreSQL lỗi: API trả JSON `{ detail }`, frontend hiển thị lỗi thân thiện.
- Provider giá lỗi: track vẫn hiển thị, snapshot của mã lỗi có `mark_price = null` và thông báo không cập nhật được.
- Async route backend luôn bọc `try/catch` hoặc dùng wrapper để Express 4 không tạo unhandled rejection.

## Testing

Kiểm thử cần có:

- Backend middleware verify JWT: token thiếu/sai/hợp lệ.
- Admin role: email trong/ngoài `ADMIN_EMAILS`.
- DB access: user chỉ thấy dữ liệu của mình.
- Watchlist CRUD theo user.
- Track CRUD theo user.
- Lưu đúng context khuyến nghị khi user theo dõi mã từ chart/picks/snapshot (ví dụ CTG): source, summary, score, signal payload.
- Refresh lãi/lỗ tính đúng `pnl_percent`.
- Frontend build/lint.

## Ngoài phạm vi giai đoạn này

- Cron cập nhật lãi/lỗ tự động hằng ngày.
- Màn hình quản trị/admin API nâng cao.
- Thanh toán/subscription.
- Đồng bộ dữ liệu cũ từ `server/data/signal-track.json` vào PostgreSQL tự động.

