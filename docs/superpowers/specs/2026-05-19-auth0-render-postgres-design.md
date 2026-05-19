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

Auth0 application:

- Type: Single Page Application cho frontend.
- Allowed Callback URLs: domain Render, localhost dev.
- Allowed Logout URLs: domain Render, localhost dev.
- Allowed Web Origins: domain Render, localhost dev.
- API/Audience: dùng cho backend verify JWT.

Social connections:

- Google OAuth2 cho Gmail.
- Facebook Login.
- LINE Login qua OIDC/OAuth connection trong Auth0.

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

## Backend API

Public API hiện có vẫn giữ cho xem chart/picks cơ bản.

API yêu cầu đăng nhập:

- `GET /api/me`: trả user hiện tại, upsert user nếu lần đầu.
- `GET /api/user/watchlist`: danh sách mã theo dõi của user.
- `POST /api/user/watchlist`: thêm mã theo dõi.
- `DELETE /api/user/watchlist/:symbol`: xóa mã theo dõi.
- `GET /api/user/track`: danh sách tín hiệu theo user kèm snapshot lãi/lỗ mới nhất.
- `POST /api/user/track`: thêm tín hiệu MUA/BÁN/CHỜ theo user.
- `DELETE /api/user/track/:id`: xóa tín hiệu của user.
- `POST /api/user/track/refresh`: refresh giá và cập nhật snapshot lãi/lỗ cho ngày hiện tại.

Phân quyền:

- Mọi route `/api/user/*` bắt buộc JWT hợp lệ.
- Backend chỉ thao tác dữ liệu có `user_id` khớp user trong token.
- Không tin user id gửi từ client.

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
  - Nút `Đăng xuất`

Watchlist:

- Nếu chưa đăng nhập: giữ xem demo/local, nhưng khi lưu theo dõi thì yêu cầu đăng nhập.
- Nếu đã đăng nhập: đọc/ghi watchlist từ API user.

Thống kê tín hiệu:

- Dữ liệu lấy từ `/api/user/track`.
- Có trạng thái đang cập nhật lãi/lỗ.
- Có nút refresh thủ công gọi `/api/user/track/refresh`.

## Error handling

- Auth0 chưa cấu hình: UI hiển thị thông báo cấu hình thiếu, không crash.
- Token hết hạn: frontend tự lấy token mới qua Auth0 SDK; nếu thất bại thì yêu cầu đăng nhập lại.
- PostgreSQL lỗi: API trả JSON `{ detail }`, frontend hiển thị lỗi thân thiện.
- Provider giá lỗi: track vẫn hiển thị, snapshot của mã lỗi có `mark_price = null` và thông báo không cập nhật được.

## Testing

Kiểm thử cần có:

- Backend middleware verify JWT: token thiếu/sai/hợp lệ.
- DB access: user chỉ thấy dữ liệu của mình.
- Watchlist CRUD theo user.
- Track CRUD theo user.
- Refresh lãi/lỗ tính đúng `pnl_percent`.
- Frontend build/lint.

## Ngoài phạm vi giai đoạn này

- Cron cập nhật lãi/lỗ tự động hằng ngày.
- Phân quyền admin.
- Thanh toán/subscription.
- Đồng bộ dữ liệu cũ từ `server/data/signal-track.json` vào PostgreSQL tự động.

