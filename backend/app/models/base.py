from datetime import datetime
from uuid import UUID
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Thiết lập schema mặc định là 'app' cho tất cả model
metadata_obj = MetaData(schema="app")

class Base(DeclarativeBase):
    metadata = metadata_obj
