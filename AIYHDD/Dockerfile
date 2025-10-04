FROM python:3.10-slim

# --- ★ OpenCVの依存ライブラリを正しいパッケージ名でインストール ★ ---
# 以前のエラーの原因となった 'libgl1-mesa-glx' を 'libgl1' に修正しました。
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED True

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# 起動コマンド (変更なし)
CMD ["python", "-m", "gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--timeout", "120", "app:app"]

