import datetime

from sqlalchemy import Column, Integer, String, Boolean, DateTime
from .config import Base


class Log(Base):
    __tablename__ = 'logs'

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    username = Column(String)
    interaction = Column(String)
    prompt = Column(String, nullable=True)
    ui_id = Column(String, nullable=True)


class Request(Base):
    __tablename__ = 'request'

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

    username = Column(String)
    prompt = Column(String)
    text = Column(String)
    response = Column(String)
    success = Column(Boolean)
