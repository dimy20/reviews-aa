from api.db import get_connection

if __name__ == '__main__':
    conn = get_connection()
    conn.execute("""--sql
        CREATE TABLE IF NOT EXISTS pods(
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        health_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
            CHECK (is_active IN (0, 1))
    )""")