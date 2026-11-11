from contextlib import contextmanager

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DB_PATH

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(conn, _):
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def add_missing_columns() -> list[str]:
    """老数据库升级：模型里新加的列，表里没有就补上（SQLite 只支持加列，够用了）。"""
    insp = inspect(engine)
    added = []
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(engine.dialect)}'
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                if isinstance(default, str):
                    ddl += " DEFAULT '" + default.replace("'", "''") + "'"
                elif isinstance(default, (int, float)) and not isinstance(default, bool):
                    ddl += f" DEFAULT {default}"
                elif col.type.__class__.__name__ == "JSON":
                    ddl += " DEFAULT '[]'"  # 目前新增的 JSON 列都是列表（default=list）
                conn.exec_driver_sql(ddl)
                added.append(f"{table.name}.{col.name}")
    return added
