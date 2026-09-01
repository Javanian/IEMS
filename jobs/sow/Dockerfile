FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    pandas \
    psycopg2-binary \
    python-dotenv \
    filelock

CMD ["python", "export/export_txt.py"]
