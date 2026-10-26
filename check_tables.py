
from backend.app import connect

c = connect()
try:
    rows = c.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = %s ORDER BY table_name",
        ("house_assist",)
    ).fetchall()

    print("House Assist tables:")
    for row in rows:
        print("-", row["table_name"])

    if not rows:
        print("No tables found in the house_assist schema.")
finally:
    c.close()
