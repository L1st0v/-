# Описание того, как хостинг должен собрать и запустить проект.
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# На хостинге приложение слушает порт 80,
# а база лежит на постоянном диске.
ENV PORT=80
ENV DB_PATH=/data/event.db

CMD ["python", "run.py"]
