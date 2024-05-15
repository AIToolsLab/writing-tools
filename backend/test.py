import psycopg
import os

from dotenv import load_dotenv

load_dotenv()

connection_uri = os.getenv("DATABASE_URI")

with psycopg.connect(connection_uri) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM logs")
        print(cur.fetchall())
