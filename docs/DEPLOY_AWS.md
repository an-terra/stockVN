# Deploy AWS + CI/CD (GitHub Actions)

**Hướng dẫn từng bước (AWS Console + GitHub):** xem **[HUONG_DAN_TRIEN_KHAI_CHI_TIET.md](./HUONG_DAN_TRIEN_KHAI_CHI_TIET.md)**.

Ứng dụng chạy **một container**: Express phục vụ **`/api/*`** và **SPA** (`frontend/dist`) cùng cổng (đọc biến **`PORT`** — App Runner sẽ inject).

## Kiến trúc CI/CD

```text
git push main → GitHub Actions → docker build → Amazon ECR (:latest + :SHA)
                                      → (tuỳ chọn) apprunner start-deployment
```

**Tuỳ chọn không gọi `start-deployment`:** trong App Runner bật **Automatic deployments** khi image ECR đổi — sau mỗi lần push `latest`, service tự redeploy.

## Chuẩn bị AWS một lần

### 1. Tạo ECR repository

```bash
aws ecr create-repository --repository-name stockvn --region ap-southeast-1
```

Đổi `stockvn` / region cho khớp với `env` trong `.github/workflows/deploy-aws.yml`.

### 2. IAM user cho GitHub Actions (access key)

Gắn policy tối thiểu (chỉnh `ACCOUNT_ID`, `REGION`, `stockvn`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrPush",
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
    },
    {
      "Sid": "AppRunnerDeploy",
      "Effect": "Allow",
      "Action": ["apprunner:StartDeployment", "apprunner:DescribeService"],
      "Resource": "arn:aws:apprunner:REGION:ACCOUNT_ID:service/APPRUNNER_SERVICE_ID/*"
    }
  ]
}
```

Nếu không dùng bước `start-deployment`, có thể bỏ statement `AppRunnerDeploy`.

Tạo **Access key** → lưu vào GitHub Secrets: **`AWS_ACCESS_KEY_ID`**, **`AWS_SECRET_ACCESS_KEY`**.

### 3. OIDC (khuyến nghị production — không lưu access key)

1. IAM → Identity providers → Add → **sts.amazonaws.com** + audience `sts.amazonaws.com`.
2. IAM Role → trusted entity **Web identity** (GitHub).
3. Gắn policy giống trên cho role.
4. Trong workflow, thay bước *Configure AWS credentials* bằng:

```yaml
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/YOUR_GITHUB_ROLE
          aws-region: ${{ env.AWS_REGION }}
```

Và thêm vào job:

```yaml
    permissions:
      id-token: write
      contents: read
```

Chi tiết trust policy GitHub: [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials).

### 4. App Runner

1. **Source**: Container registry → **Amazon ECR**.
2. **Image**: repo `stockvn`, tag **`latest`** (workflow luôn push `latest`).
3. **Port**: trùng với app — container `EXPOSE 8000`; App Runner thường set **`PORT`**; service config **Port** phải khớp (thử **8000** nếu health check fail thì đổi theo log).
4. **Health check**: HTTP path **`/api/watchlist`** (GET 200 JSON).
5. **Automatic deployment**: bật nếu không muốn dùng secret **`APP_RUNNER_SERVICE_ARN`**.

Copy **Service ARN** → GitHub Secret **`APP_RUNNER_SERVICE_ARN`** (nếu muốn workflow gọi `start-deployment`).

### 5. Environment App Runner (tuỳ chọn)

- **`CORS_ORIGINS`**: danh sách origin phân tách dấu phẩy nếu sau này tách frontend CDN khác domain.

## Repo GitHub

1. Push code (nhánh **`main`** — workflow chỉ chạy trên `main`; đổi trong YAML nếu cần).
2. Settings → Secrets → thêm credentials và (tuỳ chọn) **`APP_RUNNER_SERVICE_ARN`**.
3. Tab **Actions** → xác nhận workflow **Deploy AWS** chạy xanh.

## Build local

```bash
docker build -t stockvn:local .
docker run --rm -p 8080:8000 -e PORT=8000 stockvn:local
```

Mở `http://localhost:8080`.

## Lưu ý vận hành

- **Filesystem**: `server/data/*.json` trong container là **không bền** khi redeploy; cron/file scan có thể mất sau rollout.
- **Cron**: cần instance luôn chạy (không scale-to-zero nếu muốn lịch đúng giờ).
- **Chi phí**: xem [AWS Pricing](https://aws.amazon.com/pricing/) và Free Tier hiện hành.
