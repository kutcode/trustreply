from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from app.models import Base
from app.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_sync_url():
    url = settings.database_url
    if url.startswith("sqlite"):
        return url.replace("+aiosqlite", "")
    elif "+asyncpg" in url:
        return url.replace("+asyncpg", "+psycopg2")
    elif "postgresql://" in url and "+asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+psycopg2://")
    return url


def run_migrations_offline():
    url = get_sync_url()
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    url = get_sync_url()
    connectable = engine_from_config(
        {"sqlalchemy.url": url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
