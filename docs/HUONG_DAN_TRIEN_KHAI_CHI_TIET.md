# Hướng dẫn triển khai AWS + CI/CD — làm lần lượt

Tài liệu này hướng dẫn **từng bước trên AWS Console và GitHub**. Stack: **Docker → Amazon ECR → AWS App Runner**, CI bằng **GitHub Actions** (file `.github/workflows/deploy-aws.yml`).

**Giả định:** Bạn đã có tài khoản AWS và đã đưa code lên một repo GitHub (remote).

---

## Trước khi bắt đầu — checklist

| Việc | Ghi chú |
|------|--------|
| Repo GitHub có đủ code (Dockerfile, `.github/workflows/deploy-aws.yml`) | Đẩy (`push`) nhánh **`main`** |
| Đã chọn **Region** | Ví dụ **Singapore `ap-southeast-1`** — giữ một region cho mọi bước |
| Biết **AWS Account ID** | Console → click tên account góc phải → hoặc IAM Dashboard có hiển thị |

**Quan trọng — thứ tự đề xuất:**  
Tạo **ECR** và **IAM** trước → **chạy CI một lần** để có image `:latest` trong ECR → **rồi mới tạo App Runner** trỏ vào image đó (App Runner cần image đã tồn tại).

---

## Phần A — Tạo repository Amazon ECR

1. Đăng nhập [AWS Console](https://console.aws.amazon.com/).
2. Ô tìm kiếm trên cùng gõ **ECR** → chọn **Elastic Container Registry**.
3. Góc phải kiểm tra **Region** (ví dụ **Asia Pacific Singapore**).
4. **Repositories** → nút **Create repository**.
5. Điền:
   - **Visibility**: **Private**.
   - **Repository name**: `stockvn` (phải **trùng** với `ECR_REPOSITORY` trong workflow — mặc định là `stockvn`).
6. **Create repository**.
7. Vào repo vừa tạo → copy **URI** dạng  
   `123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/stockvn`  
   (chỉ để đối chiếu sau này; CI không cần dán tay URI này).

---

## Phần B — Tạo IAM User cho GitHub Actions (access key)

### Bước 1: Policy chỉ đẩy ECR (đủ cho lần deploy CI đầu tiên)

1. Console → **IAM** → **Policies** → **Create policy** → tab **JSON**.
2. Dán nội dung sau (**giữ nguyên** — policy ECR push chuẩn):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrAuthAndPush",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    }
  ]
}
```

3. **Next** → đặt tên ví dụ `StockVNGitHubECRPush` → **Create policy**.

### Bước 2: User và gắn policy

1. IAM → **Users** → **Create user**.
2. **User name**: ví dụ `github-actions-stockvn`.
3. **Next** → **Attach policies directly** → chọn **`StockVNGitHubECRPush`** → **Next** → **Create user**.

### Bước 3: Access key

1. Vào user vừa tạo → tab **Security credentials**.
2. **Create access key** → use case **Application running outside AWS** (hoặc **CLI**) → **Next** → **Create access key**.
3. **Copy và lưu an toàn**:
   - **Access key ID**
   - **Secret access key**  
   (secret chỉ hiện một lần.)

---

## Phần C — Cấu hình GitHub Secrets và chạy CI lần đầu

1. Mở **đúng repo** chứa code (ví dụ `https://github.com/an-terra/stockVN`) → **Settings** → **Secrets and variables** → **Actions**.
2. Vào tab **Secrets** → cuộn tới **Repository secrets** (không nhầm **Environment secrets** trừ khi workflow của bạn có khai báo `environment:`).
3. **New repository secret** — thêm **đúng tên** sau (copy nguyên, không đổi hoa/thường):

   | Tên secret | Giá trị |
   |------------|---------|
   | `AWS_ACCESS_KEY_ID` | Access key ID vừa tạo |
   | `AWS_SECRET_ACCESS_KEY` | Secret access key |

   Đường dẫn trực tiếp (thay `OWNER/REPO`):  
   `https://github.com/OWNER/REPO/settings/secrets/actions`

   **Hay gặp lỗi:** tạo secret ở tab **Dependabot** hoặc **Codespaces** thay vì **Actions** → workflow **Deploy AWS** không thấy → báo *Repository chưa có đủ Secrets*.  
   Secret **Organization** phải được gán quyền truy cập repo này (Policies của Organization).

4. **Kiểm tra workflow:**
   - File `.github/workflows/deploy-aws.yml` có `AWS_REGION` và `ECR_REPOSITORY`:
     - `AWS_REGION: ap-southeast-1`
     - `ECR_REPOSITORY: stockvn`  
     Nếu bạn dùng region/tên repo khác → **sửa hai dòng này trong YAML rồi commit**.
5. **Nhánh chạy CI:** workflow chỉ chạy khi **push vào `main`**.  
   Nếu nhánh của bạn là `master` → hoặc đổi tên nhánh thành `main`, hoặc sửa trong YAML:

   ```yaml
   push:
     branches: [main]
   ```

   thành `branches: [master]` (hoặc cả hai).

6. Push code lên `main`:
   ```bash
   git add .
   git commit -m "Chuẩn bị deploy AWS"
   git push origin main
   ```

7. GitHub → tab **Actions** → workflow **Deploy AWS** → mở run mới nhất:
   - **Xanh**: image đã lên ECR (`:latest` và tag theo commit SHA).
   - **Đỏ**: đọc log bước lỗi (thường là sai region, sai tên repo ECR, hoặc IAM thiếu quyền).

---

## Phần D — Tạo App Runner (sau khi đã có image trong ECR)

1. Console → tìm **App Runner** → **Create service**.
2. **Repository type**: **Container registry** → **Amazon ECR**.
3. **Nút Browse** → chọn repo **`stockvn`** → image tag **`latest`**.
4. **ECR access role**: **Create new service role** (để App Runner kéo image từ ECR — làm lần đầu là đủ).
5. **Deployment settings**:
   - **Automatic deployments**: **Enable** (khuyến nghị — mỗi lần CI push `latest`, App Runner tự redeploy).
   - Hoặc **Disable** và sau đó dùng secret `APP_RUNNER_SERVICE_ARN` + policy IAM (phần E dưới).
6. **Configure service**:
   - **Service name**: tuỳ bạn (ví dụ `stockvn-web`).
   - **Virtual CPU & memory**: tier nhỏ nhất có thể để thử (xem pricing).
   - **Port**: **`8000`**  
     (Ứng dụng trong Docker `CMD` dùng `process.env.PORT`; App Runner set `PORT` khớp cổng bạn khai báo — đặt **8000** cho khớp `Dockerfile`.)
7. **Health check** — **HTTP**:
   - **Path**: `/api/watchlist`
   - Protocol/path đúng giúp App Runner biết container đã sống.
8. **Environment variables** (tuỳ chọn): ví dụ sau này tách frontend khác domain thì có thể thêm `CORS_ORIGINS`.
9. **Create & deploy** → đợi trạng thái **Running**.
10. Copy **Default domain** (URL public) của service → mở trình duyệt kiểm tra giao diện và API.

---

## Phần E — (Tuỳ chọn) Cho workflow gọi `start-deployment`

Chỉ cần nếu bạn **tắt Automatic deployment** hoặc muốn ép redeploy ngay sau mỗi push.

1. Sau khi có App Runner → vào service → copy **Service ARN**  
   (dạng `arn:aws:apprunner:ap-southeast-1:123456789012:service/...`).
2. GitHub → **Settings** → **Secrets** → thêm **`APP_RUNNER_SERVICE_ARN`** = ARN vừa copy.
3. IAM → user **`github-actions-stockvn`** → **Add permissions** → **Create inline policy** → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppRunnerStartDeployment",
      "Effect": "Allow",
      "Action": [
        "apprunner:StartDeployment",
        "apprunner:DescribeService"
      ],
      "Resource": "THAY_BẰNG_SERVICE_ARN_CỦA_BẠN"
    }
  ]
}
```

Thay **`THAY_BẰNG_SERVICE_ARN_CỦA_BẠN`** đúng một dòng ARN (có dấu ngoặc kép).

4. Lưu policy → push `main` lại → Actions sẽ push image và gọi `start-deployment`.

---

## Phần F — Kiểm tra và xử lý sự cố

| Hiện tượng | Việc nên làm |
|------------|----------------|
| `Repository chưa có đủ Secrets` / exit code 1 ở bước kiểm tra | Workflow **không** thấy `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY`. Vào `https://github.com/<OWNER>/<REPO>/settings/secrets/actions` → **Repository secrets** (tab **Actions**) → thêm đúng hai tên trên. Không nhầm Dependabot/Codespaces secrets. Hoặc chỉ thêm **`AWS_ROLE_TO_ASSUME`** để đăng nhập bằng OIDC (không cần access key). |
| `Credentials could not be loaded` / `Could not load credentials from any providers` | **Chưa có hoặc sai tên Secrets.** Vào **Repo → Settings → Secrets and variables → Actions** → tab **Secrets** → đảm bảo có đúng hai secret **Repository** (không chỉ Environment): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Tên phải khớp **từng ký tự** (không thêm khoảng trắng, không đổi hoa/thường). Sau đó **Re-run jobs** workflow. Nếu workflow fork từ repo khác hoặc PR từ fork: secrets không được chia sẻ — chạy trên nhánh trong repo của bạn. |
| CI báo `denied` / `Unauthorized` khi push ECR | Kiểm tra region; IAM user có policy ECR; secret GitHub đúng user đó. |
| App Runner **Failed** / health đỏ | Xem tab **Logs** của App Runner; thử đổi **Port** (8000 ↔ 8080) khớp với biến `PORT` trong log container. |
| Trắng trang nhưng API được | Kiểm tra build frontend trong Docker log CI; đảm bảo có `frontend/dist` trong image. |
| CI không chạy | Nhánh không phải `main`; hoặc workflow file không nằm đúng `.github/workflows/deploy-aws.yml`. |

---

## Phần G — Sau khi xong

- Theo dõi **AWS Billing** / Budget để tránh phát sinh ngoài ý muốn.
- File scan trong `server/data/` **không được coi là lưu trữ lâu dài** trên container (redeploy có thể xóa). Production lâu dài nên dùng EFS/S3/DB (tách khỏi phạm vi hướng dẫn này).

---

## Tham khảo thêm

- Tóm tắt kiến trúc và OIDC: [`DEPLOY_AWS.md`](./DEPLOY_AWS.md).
