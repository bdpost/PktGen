FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpcap-dev \
      iproute2 \
      net-tools \
      tcpdump \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/     /app/
COPY static/  /app/static/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
