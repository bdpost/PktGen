FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpcap-dev \
      iproute2 \
      net-tools \
      iputils-ping \
      traceroute \
      curl \
      iperf3 \
      tcpdump \
      openssh-server \
      openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && ssh-keygen -A \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && echo "root:clab" | chpasswd

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/     /app/
COPY static/  /app/static/

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080 22

ENTRYPOINT ["/entrypoint.sh"]
