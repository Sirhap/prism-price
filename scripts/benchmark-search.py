"""可重复的 SQLite 索引微基准；仅使用内存数据库，不访问本地或远端 D1。"""
import json
import random
import sqlite3
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def median_ms(connection, sql):
    for _ in range(3):
        connection.execute(sql).fetchall()
    samples = []
    for _ in range(30):
        start = time.perf_counter()
        connection.execute(sql).fetchall()
        samples.append((time.perf_counter() - start) * 1000)
    return round(statistics.median(samples), 3)


def main():
    db = sqlite3.connect(":memory:")
    db.executescript((ROOT / "migrations/0001_init.sql").read_text())
    rng = random.Random(42)
    columns = [row[1] for row in db.execute("PRAGMA table_info(product_groups)")]
    rows = []
    numeric = {"min_price", "median_price", "max_price", "shop_count", "offer_count"}
    for index in range(5500):
        row = {column: (0 if column in numeric else "") for column in columns}
        row.update(
            group_key=str(index), display_name=f"规格商品 {index}",
            brand_group=["Codex", "Claude", "Gemini", "ChatGPT", "AI创作"][index % 5],
            min_price=rng.randint(100, 50000) / 100, shop_count=rng.randint(1, 50),
            offers_preview_json=json.dumps([{"shopName": "模拟店铺", "description": "x" * 4000}]),
        )
        rows.append([row[column] for column in columns])
    db.executemany(
        f"INSERT INTO product_groups ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", rows,
    )
    queries = {
        "品牌默认排序": "SELECT * FROM product_groups WHERE brand_group='Codex' ORDER BY shop_count DESC,min_price ASC,group_key ASC LIMIT 30",
        "全局价格排序": "SELECT * FROM product_groups ORDER BY min_price ASC,shop_count DESC,group_key ASC LIMIT 30",
    }
    before = {name: {"ms": median_ms(db, query), "rows": db.execute(query).fetchall(),
                     "plan": list(db.execute("EXPLAIN QUERY PLAN " + query))} for name, query in queries.items()}
    db.executescript((ROOT / "migrations/0003_search_indexes.sql").read_text())
    result = {"dataset": "5500 rows, ~4KB preview per row", "repetitions": 30, "queries": {}}
    for name, query in queries.items():
        assert db.execute(query).fetchall() == before[name]["rows"]
        result["queries"][name] = {
            "beforeMedianMs": before[name]["ms"], "afterMedianMs": median_ms(db, query),
            "beforePlan": before[name]["plan"], "afterPlan": list(db.execute("EXPLAIN QUERY PLAN " + query)),
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
