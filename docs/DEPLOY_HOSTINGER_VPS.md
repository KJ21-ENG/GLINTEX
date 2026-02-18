# Deploy GLINTEX on a Hostinger VPS (Ubuntu 24.04)

This guide deploys GLINTEX using Docker Compose (Postgres + backend + frontend) and serves it via Nginx + HTTPS.

## 0) Decide a URL

Recommended: use a dedicated subdomain so it doesn't interfere with your existing website.

Example: `inventory.yourdomain.com`

In Hostinger DNS Manager:
- Add an **A record** for `inventory` → your VPS public IP.

## Optional: automated bootstrap

After cloning the repo (step 3), you can run the included bootstrap script to automate steps 2–7:

```bash
cd /opt/glintex
sudo bash scripts/vps/bootstrap_hostinger_vps.sh --domain inventory.yourdomain.com --email you@example.com
```

If your repo is already present at `/opt/glintex`, omit `--repo`. If you prefer to do everything manually, continue below.

## 1) SSH to the VPS

```bash
ssh root@YOUR_VPS_IP
```

## 2) Install prerequisites

```bash
apt update
apt install -y git ca-certificates curl gnupg ufw
apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

## 3) Clone the repo

```bash
mkdir -p /opt/glintex
cd /opt/glintex
git clone <YOUR_REPO_URL> .
```

## 4) Create `/opt/glintex/.env`

This file is used by `docker compose` for environment variables.

```bash
nano /opt/glintex/.env
```

Example (edit domain + strong password):

```env
# Frontend will call `${VITE_API_BASE}/api/*`
VITE_API_BASE=https://inventory.yourdomain.com

# Cookies must be secure when served via HTTPS
COOKIE_SECURE=true

# IMPORTANT: set a strong password for the default admin (only used when DB has zero users)
DEFAULT_ADMIN_USERNAME=admin
DEFAULT_ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DEFAULT_ADMIN_DISPLAY_NAME=Admin

# Optional
BARCODE_MATERIAL_CODE=MET
SESSION_TTL_DAYS=30

# Optional ports (prod binds them to localhost via docker-compose.prod.yml)
BACKEND_PORT=4001
FRONTEND_PORT=4173
POSTGRES_PORT=5433
```

## 5) Start the stack (production ports bound to localhost)

Do NOT use `docker compose up` without `-f`, because this repo includes `docker-compose.override.yml` for dev.

```bash
cd /opt/glintex
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

## 6) Install Nginx and configure reverse proxy

```bash
apt install -y nginx
```

Create an Nginx site config:

```bash
nano /etc/nginx/sites-available/glintex-inventory
```

Template (replace `inventory.yourdomain.com`):

```nginx
server {
  server_name inventory.yourdomain.com;

  client_max_body_size 20m;

  location /api/ {
    proxy_pass http://127.0.0.1:4001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable it:

```bash
ln -sf /etc/nginx/sites-available/glintex-inventory /etc/nginx/sites-enabled/glintex-inventory
nginx -t
systemctl reload nginx
```

## 7) HTTPS certificate (Let’s Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d inventory.yourdomain.com --redirect
```

If you run HTTP temporarily, set `COOKIE_SECURE=false` and `VITE_API_BASE=http://inventory.yourdomain.com`, then switch both back to HTTPS after certbot succeeds and rebuild:

```bash
cd /opt/glintex
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## 8) Firewall (recommended)

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

## 9) Verify

```bash
curl -sS https://inventory.yourdomain.com/api/health
```

Open:
- `https://inventory.yourdomain.com/login`

## Backups (no data loss)

Backup Postgres without exposing the DB port publicly:

```bash
cd /opt/glintex
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
  pg_dump -U glintex -d glintex -Fc > /opt/glintex_backup_$(date +%F).dump
```

## Updates

```bash
cd /opt/glintex
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 backend
```
