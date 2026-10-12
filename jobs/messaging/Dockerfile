# Image for the Kafka workers (SAP order sync and SAP confirmation posting).
# Code is mounted at runtime, like the other job containers:
#   ./jobs/messaging -> /messaging, plus ./jobs/sap_staging or ./jobs/etl -> /app
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

ENV PYTHONUNBUFFERED=1
