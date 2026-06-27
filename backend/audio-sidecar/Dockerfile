# Voiceprint sidecar — turnkey image for Render (or any container host).
# Includes ffmpeg (the app shells out to it to decode/slice audio).
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Render injects $PORT. Default 8077 for local runs.
ENV PORT=8077
EXPOSE 8077
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
